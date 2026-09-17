import { Inject, Injectable, Logger } from '@nestjs/common';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { WappiService } from '../notifications/wappi.service';
import { REDIS } from '../redis/redis.module';
import { E } from '../common/errors';
import { loadEnv } from '../config/env';
import { T } from '../notifications/templates';
import { maskPhoneForDisplay } from '@somex/shared';

export interface OtpIssueResult {
  requestId: string;
  channel: 'whatsapp' | 'dev';
  ttlSec: number;
  resendAfterSec: number;
  maskedPhone: string;
  devCode?: string;
}

/**
 * One-time codes delivered via WhatsApp (Wappi). Protections:
 *  - per-phone and per-IP hourly quotas + resend cooldown (Redis)
 *  - hashed storage, 5 attempts, 5 minute TTL, single use
 *  - identical responses for known/unknown numbers (no enumeration)
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly wappi: WappiService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private async quota(key: string, limit: number, ttlSec: number): Promise<{ allowed: boolean; ttl: number }> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSec);
    const ttl = await this.redis.ttl(key);
    return { allowed: n <= limit, ttl: ttl > 0 ? ttl : ttlSec };
  }

  async issue(phone: string, purpose: OtpPurpose, ctx: { ip?: string; deviceFingerprint?: string; meta?: Record<string, unknown> }): Promise<OtpIssueResult> {
    const [ttlSec, resendSec, maxPerHour, maxPerIpHour, template] = await Promise.all([
      this.settings.num('security.otp_ttl_sec'),
      this.settings.num('security.otp_resend_sec'),
      this.settings.num('security.otp_max_per_hour'),
      this.settings.num('security.otp_max_per_ip_hour'),
      this.settings.get('wappi.otp_template'),
    ]);

    const cooldownKey = `otp:cd:${purpose}:${phone}`;
    const cdTtl = await this.redis.ttl(cooldownKey);
    if (cdTtl > 0) throw E.tooMany(`Код уже отправлен. Повторная отправка через ${cdTtl} сек.`, cdTtl);

    const q1 = await this.quota(`otp:q:phone:${phone}`, maxPerHour, 3600);
    if (!q1.allowed) throw E.tooMany('Превышен лимит кодов для этого номера. Попробуйте через час.', q1.ttl);
    if (ctx.ip) {
      const q2 = await this.quota(`otp:q:ip:${ctx.ip}`, maxPerIpHour, 3600);
      if (!q2.allowed) throw E.tooMany('Слишком много запросов с вашего адреса.', q2.ttl);
    }

    // invalidate previous codes for this phone/purpose
    await this.prisma.otpCode.updateMany({ where: { phone, purpose, consumedAt: null }, data: { consumedAt: new Date() } });

    const code = this.crypto.otpCode(6);
    const env = loadEnv();
    const configured = await this.wappi.isConfigured();
    const channel: OtpChannel = configured ? OtpChannel.WHATSAPP : OtpChannel.DEV;

    const row = await this.prisma.otpCode.create({
      data: {
        phone,
        purpose,
        channel,
        codeHash: this.crypto.blindIndex(`${phone}:${purpose}:${code}`),
        expiresAt: new Date(Date.now() + ttlSec * 1000),
        ip: ctx.ip,
        deviceFingerprint: ctx.deviceFingerprint,
        meta: ctx.meta as any,
      },
    });
    await this.redis.set(cooldownKey, '1', 'EX', resendSec);

    let devCode: string | undefined;
    if (configured) {
      const text = T.otp(template, code, Math.round(ttlSec / 60));
      const res = await this.wappi.sendText(phone, text);
      if (!res.ok) {
        this.logger.error(`OTP delivery failed for ${maskPhoneForDisplay(phone)}: ${res.error}`);
        if (!env.OTP_DEV_ECHO) throw E.bad('OTP_DELIVERY_FAILED', 'Не удалось отправить код в WhatsApp. Убедитесь, что номер зарегистрирован в WhatsApp, и попробуйте снова.');
        devCode = code;
      }
    } else {
      if (env.NODE_ENV === 'production') throw E.bad('OTP_CHANNEL_UNAVAILABLE', 'Канал доставки кодов не настроен. Обратитесь в поддержку.');
      this.logger.warn(`[DEV OTP] ${phone} ${purpose} -> ${code}`);
      if (env.OTP_DEV_ECHO) devCode = code;
    }

    return {
      requestId: row.id,
      channel: configured ? 'whatsapp' : 'dev',
      ttlSec,
      resendAfterSec: resendSec,
      maskedPhone: maskPhoneForDisplay(phone),
      devCode,
    };
  }

  /** Returns true when the code is valid; consumes it. Throws with remaining attempts otherwise. */
  async verify(phone: string, purpose: OtpPurpose, code: string): Promise<boolean> {
    const row = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw E.bad('OTP_NOT_FOUND', 'Код не запрошен или уже использован. Запросите новый код.');
    if (row.expiresAt < new Date()) throw E.bad('OTP_EXPIRED', 'Срок действия кода истёк. Запросите новый.');
    if (row.attempts >= row.maxAttempts) {
      await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      throw E.bad('OTP_LOCKED', 'Превышено число попыток. Запросите новый код.');
    }
    const ok = this.crypto.safeEqual(row.codeHash, this.crypto.blindIndex(`${phone}:${purpose}:${code}`));
    if (!ok) {
      const updated = await this.prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      const left = Math.max(0, updated.maxAttempts - updated.attempts);
      throw E.bad('OTP_INVALID', left > 0 ? `Неверный код. Осталось попыток: ${left}` : 'Неверный код. Запросите новый.', { attemptsLeft: left });
    }
    await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return true;
  }
}
