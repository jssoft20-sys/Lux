import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly settings: SettingsService) {}

  private async transport() {
    const host = await this.settings.get('smtp.host');
    if (!host) return null;
    const [port, secure, user, pass] = await Promise.all([
      this.settings.num('smtp.port'),
      this.settings.bool('smtp.secure'),
      this.settings.get('smtp.user'),
      this.settings.get('smtp.pass'),
    ]);
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 10_000,
    });
  }

  async isConfigured() {
    return !!(await this.settings.get('smtp.host'));
  }

  async send(to: string | string[], subject: string, html: string, text?: string): Promise<boolean> {
    const t = await this.transport();
    if (!t) {
      this.logger.debug(`SMTP not configured, skipping mail "${subject}"`);
      return false;
    }
    try {
      await t.sendMail({ from: await this.settings.get('smtp.from'), to, subject, html, text: text ?? html.replace(/<[^>]+>/g, '') });
      return true;
    } catch (e) {
      this.logger.error(`Mail send failed: ${(e as Error).message}`);
      return false;
    }
  }

  async alertAdmins(subject: string, html: string): Promise<boolean> {
    const list = (await this.settings.get('smtp.alert_emails'))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return false;
    return this.send(list, `[Somex] ${subject}`, html);
  }

  async verify(): Promise<{ ok: boolean; detail: string }> {
    const t = await this.transport();
    if (!t) return { ok: false, detail: 'SMTP_NOT_CONFIGURED' };
    try {
      await t.verify();
      return { ok: true, detail: 'SMTP connection verified' };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
