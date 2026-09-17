import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BlacklistService } from '../risk/blacklist.service';

export type ScreeningRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export interface ScreeningResult {
  risk: ScreeningRisk;
  provider: string;
  reasons: string[];
  details?: unknown;
}

/**
 * Wallet / transaction-origin screening. The internal provider combines the blacklist with
 * platform history; `external_http` forwards to an adapter for a commercial AML provider.
 * Result decides whether a deposit is credited immediately or held for compliance review.
 */
@Injectable()
export class ScreeningService {
  private readonly logger = new Logger(ScreeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly blacklist: BlacklistService,
  ) {}

  async screenAddress(address: string, network: string, ctx?: { userId?: string; amount?: number }): Promise<ScreeningResult> {
    const reasons: string[] = [];
    let risk: ScreeningRisk = 'LOW';
    const bump = (r: ScreeningRisk, reason: string) => {
      reasons.push(reason);
      if (r === 'HIGH' || (r === 'MEDIUM' && risk === 'LOW')) risk = r;
    };

    if (await this.blacklist.isListed('WALLET_ADDRESS', address)) bump('HIGH', 'Адрес в чёрном списке');
    const badHistory = await this.prisma.deposit.count({ where: { fromAddress: address, status: 'REJECTED' } });
    if (badHistory) bump('HIGH', `Адрес связан с ${badHistory} отклонёнными депозитами`);
    const heldHistory = await this.prisma.deposit.count({ where: { fromAddress: address, status: 'HELD' } });
    if (heldHistory) bump('MEDIUM', 'Адрес ранее удерживался на проверке');
    // same source address funding many different accounts is a mule pattern
    const distinctUsers = await this.prisma.deposit.groupBy({ by: ['userId'], where: { fromAddress: address, ...(ctx?.userId ? { userId: { not: ctx.userId } } : {}) } });
    if (distinctUsers.length >= 3) bump('MEDIUM', `Адрес пополнял ${distinctUsers.length} разных аккаунтов`);
    if (ctx?.userId) {
      const bannedLinks = await this.prisma.deposit.count({ where: { fromAddress: address, user: { status: { in: ['BANNED', 'FROZEN'] } } } });
      if (bannedLinks) bump('HIGH', 'Адрес связан с заблокированным аккаунтом');
    }

    const provider = await this.settings.get('wallet.screening_provider');
    let details: unknown;
    if (provider === 'external_http') {
      const url = await this.settings.get('wallet.screening_url');
      const key = await this.settings.get('wallet.screening_api_key');
      if (url) {
        try {
          const res = await axios.post(url, { address, network, amount: ctx?.amount }, { headers: key ? { Authorization: `Bearer ${key}` } : {}, timeout: 20_000 });
          details = res.data;
          const ext = String(res.data?.risk ?? '').toUpperCase() as ScreeningRisk;
          if (ext === 'HIGH' || ext === 'MEDIUM') bump(ext, `Внешний провайдер: ${ext}${res.data?.reason ? ` (${res.data.reason})` : ''}`);
        } catch (e) {
          this.logger.warn(`external screening failed: ${(e as Error).message}`);
          bump('MEDIUM', 'Внешний провайдер недоступен — требуется ручная проверка');
        }
      }
    }
    return { risk, provider, reasons, details };
  }
}
