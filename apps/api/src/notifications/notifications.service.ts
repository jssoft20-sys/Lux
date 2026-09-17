import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WappiService } from './wappi.service';
import { MailService } from './mail.service';

export interface NotifyInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  whatsapp?: boolean; // also push through WhatsApp
  whatsappText?: string; // custom WhatsApp text (defaults to body)
}

/**
 * In-app notifications + WhatsApp outbox. Outbox rows are delivered by a cron worker with retries,
 * so a temporary Wappi outage never blocks a business transaction.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly wappi: WappiService,
    private readonly mail: MailService,
  ) {}

  async notify(input: NotifyInput) {
    await this.prisma.notification.create({
      data: { userId: input.userId, channel: NotificationChannel.INAPP, title: input.title, body: input.body, data: input.data as any, status: NotificationStatus.SENT, sentAt: new Date() },
    });
    if (input.whatsapp && (await this.settings.bool('wappi.notifications_enabled'))) {
      await this.prisma.notification.create({
        data: { userId: input.userId, channel: NotificationChannel.WHATSAPP, title: input.title, body: input.whatsappText ?? input.body, data: input.data as any },
      });
      setImmediate(() => this.drain().catch(() => undefined));
    }
  }

  /** Direct WhatsApp send that bypasses the outbox (used for OTP where latency matters). */
  async sendWhatsAppNow(phone: string, text: string) {
    return this.wappi.sendText(phone, text);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      const pending = await this.prisma.notification.findMany({
        where: { channel: NotificationChannel.WHATSAPP, status: NotificationStatus.QUEUED },
        include: { user: { select: { phone: true } } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const n of pending) {
        const res = await this.wappi.sendText(n.user.phone, n.body);
        if (res.ok) {
          await this.prisma.notification.update({ where: { id: n.id }, data: { status: NotificationStatus.SENT, sentAt: new Date() } });
        } else {
          const attempts = Number((n.data as any)?.attempts ?? 0) + 1;
          const failed = attempts >= 3 || res.error === 'WAPPI_NOT_CONFIGURED';
          await this.prisma.notification.update({
            where: { id: n.id },
            data: { status: failed ? NotificationStatus.FAILED : NotificationStatus.QUEUED, error: res.error?.slice(0, 500), data: { ...((n.data as any) || {}), attempts } },
          });
          if (res.error === 'WAPPI_NOT_CONFIGURED') break;
        }
      }
    } catch (e) {
      this.logger.error(`outbox drain failed: ${(e as Error).message}`);
    } finally {
      this.draining = false;
    }
  }

  async adminAlert(subject: string, html: string) {
    return this.mail.alertAdmins(subject, html);
  }
}
