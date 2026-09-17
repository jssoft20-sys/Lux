import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { SettingsService } from '../settings/settings.service';

export interface WappiSendResult {
  ok: boolean;
  messageId?: string;
  status?: string;
  error?: string;
}

/**
 * WhatsApp delivery through Wappi.pro (https://wappi.pro/api-documentation).
 *   POST {api}/api/sync/message/send?profile_id={profile}   Authorization: {token}
 *   body: { recipient: "996555123456", body: "text" }
 */
@Injectable()
export class WappiService {
  private readonly logger = new Logger(WappiService.name);

  constructor(private readonly settings: SettingsService) {}

  async isConfigured(): Promise<boolean> {
    const [token, profile] = await Promise.all([this.settings.get('wappi.token'), this.settings.get('wappi.profile_id')]);
    return !!token && !!profile;
  }

  private async client() {
    const [apiUrl, token, profileId] = await Promise.all([
      this.settings.get('wappi.api_url'),
      this.settings.get('wappi.token'),
      this.settings.get('wappi.profile_id'),
    ]);
    return { apiUrl: apiUrl.replace(/\/+$/, ''), token, profileId };
  }

  /** phone in E.164 (+996...) → Wappi recipient digits only */
  static recipient(phone: string): string {
    return phone.replace(/\D+/g, '');
  }

  async sendText(phone: string, body: string, botId = 'somex'): Promise<WappiSendResult> {
    const { apiUrl, token, profileId } = await this.client();
    if (!token || !profileId) return { ok: false, error: 'WAPPI_NOT_CONFIGURED' };
    try {
      const res = await axios.post(
        `${apiUrl}/api/sync/message/send`,
        { recipient: WappiService.recipient(phone), body },
        {
          params: { profile_id: profileId, bot_id: botId },
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          timeout: 15_000,
        },
      );
      const data = res.data || {};
      const ok = data.status === 'done' || data.status === 'ok' || !!data.message_id;
      if (!ok) this.logger.warn(`Wappi unexpected response: ${JSON.stringify(data).slice(0, 300)}`);
      return { ok, messageId: data.message_id, status: data.status, error: ok ? undefined : data.detail || data.error || 'UNEXPECTED_RESPONSE' };
    } catch (e) {
      const err = e as AxiosError<any>;
      const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
      this.logger.error(`Wappi send failed: ${detail}`);
      return { ok: false, error: detail };
    }
  }

  /** Admin → Settings → "Проверить подключение" */
  async status(): Promise<{ ok: boolean; detail: unknown }> {
    const { apiUrl, token, profileId } = await this.client();
    if (!token || !profileId) return { ok: false, detail: 'WAPPI_NOT_CONFIGURED' };
    try {
      const res = await axios.get(`${apiUrl}/api/sync/get/status`, {
        params: { profile_id: profileId },
        headers: { Authorization: token },
        timeout: 15_000,
      });
      return { ok: true, detail: res.data };
    } catch (e) {
      const err = e as AxiosError<any>;
      return { ok: false, detail: err.response?.data ?? err.message };
    }
  }
}
