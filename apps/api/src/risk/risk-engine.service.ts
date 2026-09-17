import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RiskAction, RiskEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { RISK_RULES } from '@somex/shared';
import { BlacklistService } from './blacklist.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dec } from '../common/utils/money';
import { hours, days } from '../common/utils/time';

export interface RiskSignal {
  code: string;
  weight: number;
  detail?: string;
}

export interface RiskContext {
  userId: string;
  type: RiskEventType;
  amountUsdt?: number;
  ip?: string;
  deviceId?: string;
  counterpartyId?: string;
  withdrawAddress?: string;
  network?: string;
  refType?: string;
  refId?: string;
  extraSignals?: RiskSignal[];
}

export interface RiskVerdict {
  score: number;
  action: RiskAction;
  signals: RiskSignal[];
  eventId: string;
}

/**
 * Somex Risk Engine — rule-based scoring 0..100 executed for every sensitive operation.
 * Rules and weights live in the RiskRule table (editable in admin); thresholds in settings.
 * Nothing here auto-bans a person: BLOCK stops the operation and puts it in the review queue.
 */
@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly blacklist: BlacklistService,
    private readonly notifications: NotificationsService,
  ) {}

  async ensureRules() {
    for (const r of RISK_RULES) {
      await this.prisma.riskRule.upsert({ where: { code: r.code }, create: { code: r.code, name: r.name, weight: r.weight }, update: {} });
    }
  }

  private async weights(): Promise<Map<string, { weight: number; enabled: boolean; params: any }>> {
    const rows = await this.prisma.riskRule.findMany();
    const m = new Map<string, { weight: number; enabled: boolean; params: any }>();
    for (const r of rows) m.set(r.code, { weight: r.weight, enabled: r.enabled, params: r.params });
    for (const r of RISK_RULES) if (!m.has(r.code)) m.set(r.code, { weight: r.weight, enabled: true, params: null });
    return m;
  }

  async evaluate(ctx: RiskContext): Promise<RiskVerdict> {
    const rules = await this.weights();
    const signals: RiskSignal[] = [];
    const hit = (code: string, detail?: string) => {
      const r = rules.get(code);
      if (!r || !r.enabled) return;
      signals.push({ code, weight: r.weight, detail });
    };

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      include: { devices: true, ips: { orderBy: { lastSeenAt: 'desc' }, take: 20 } },
    });
    const now = Date.now();
    const [largeOrder, largeWithdraw] = await Promise.all([this.settings.num('risk.large_order_usdt'), this.settings.num('risk.large_withdraw_usdt')]);

    if (user.kycStatus !== 'APPROVED' && ctx.type !== RiskEventType.LOGIN && ctx.type !== RiskEventType.KYC && ctx.type !== RiskEventType.DEPOSIT) hit('NO_KYC');
    if (user.sensitiveOpsLockedUntil && user.sensitiveOpsLockedUntil.getTime() > now && (ctx.type === RiskEventType.WITHDRAWAL || ctx.type === RiskEventType.ORDER_RELEASE)) {
      hit('SENSITIVE_OPS_COOLDOWN', `until ${user.sensitiveOpsLockedUntil.toISOString()}`);
    }
    if (now - user.createdAt.getTime() < days(7)) hit('NEW_ACCOUNT', `${Math.floor((now - user.createdAt.getTime()) / days(1))}d`);

    // devices
    if (ctx.deviceId) {
      const d = user.devices.find((x) => x.id === ctx.deviceId);
      if (d && !d.trusted && now - d.firstSeenAt.getTime() < days(1)) hit('NEW_DEVICE', d.model ?? undefined);
      const recentNew = user.devices.filter((x) => now - x.firstSeenAt.getTime() < days(1)).length;
      if (recentNew > 0 && user.devices.length > 1 && ctx.type !== RiskEventType.LOGIN) hit('DEVICE_CHANGED_RECENTLY', `${recentNew} new device(s)`);
      if (d) {
        const shared = await this.prisma.device.count({ where: { fingerprint: d.fingerprint, userId: { not: ctx.userId } } });
        if (shared > 0) {
          hit('DEVICE_SHARED_ACCOUNTS', `${shared} other account(s)`);
          const linkedBanned = await this.prisma.device.count({ where: { fingerprint: d.fingerprint, userId: { not: ctx.userId }, user: { status: { in: ['BANNED', 'FROZEN'] } } } });
          if (linkedBanned > 0) hit('LINKED_TO_BLACKLISTED', 'shared device with banned/frozen account');
        }
      }
    }
    if (user.phoneChangedAt && now - user.phoneChangedAt.getTime() < hours(48)) hit('PHONE_CHANGED_RECENTLY');

    // ip
    if (ctx.ip) {
      const ipRow = user.ips.find((x) => x.ip === ctx.ip);
      if (ipRow?.isProxy) hit('IP_PROXY_VPN', ctx.ip);
      if (ipRow?.country && ipRow.country !== 'KG') hit('IP_FOREIGN', ipRow.country);
      const sharedIp = await this.prisma.userIp.count({ where: { ip: ctx.ip, userId: { not: ctx.userId }, lastSeenAt: { gt: new Date(now - days(30)) } } });
      if (sharedIp >= 3) hit('IP_SHARED_ACCOUNTS', `${sharedIp} accounts`);
    }
    if (await this.blacklist.isListed('IP', ctx.ip || '')) hit('BLACKLIST_MATCH', 'ip');

    // velocity & amounts
    if (ctx.type === RiskEventType.ORDER_CREATE) {
      const lastHour = await this.prisma.order.count({ where: { OR: [{ buyerId: ctx.userId }, { sellerId: ctx.userId }], createdAt: { gt: new Date(now - hours(1)) } } });
      if (lastHour >= 5) hit('VELOCITY_ORDERS', `${lastHour}/h`);
      const deposits = await this.prisma.deposit.count({ where: { userId: ctx.userId, status: 'CREDITED' } });
      if (deposits <= 1 && (ctx.amountUsdt ?? 0) >= largeOrder && user.completedOrders === 0) hit('FIRST_DEPOSIT_LARGE_ORDER', `${ctx.amountUsdt} USDT`);
    }
    if (ctx.type === RiskEventType.WITHDRAWAL) {
      const last24 = await this.prisma.withdrawal.count({ where: { userId: ctx.userId, createdAt: { gt: new Date(now - days(1)) }, status: { notIn: ['CANCELLED', 'REJECTED', 'FAILED'] } } });
      if (last24 >= 3) hit('VELOCITY_WITHDRAWALS', `${last24}/24h`);
      const recentDeposit = await this.prisma.deposit.findFirst({ where: { userId: ctx.userId, status: 'CREDITED', creditedAt: { gt: new Date(now - hours(1)) } } });
      if (recentDeposit) hit('FAST_PASS_THROUGH', `deposit ${dec(recentDeposit.amount)} USDT < 1h ago`);
      if (ctx.withdrawAddress) {
        const known = await this.prisma.withdrawAddress.findFirst({ where: { userId: ctx.userId, address: ctx.withdrawAddress } });
        if (!known) hit('NEW_WITHDRAW_ADDRESS', ctx.withdrawAddress);
        if (await this.blacklist.isListed('WALLET_ADDRESS', ctx.withdrawAddress)) hit('BLACKLIST_MATCH', 'wallet address');
      }
    }
    if (ctx.amountUsdt) {
      const agg = await this.prisma.order.aggregate({
        where: { OR: [{ buyerId: ctx.userId }, { sellerId: ctx.userId }], status: { in: ['RELEASED', 'RESOLVED_RELEASE'] } },
        _avg: { amountUsdt: true },
        _count: true,
      });
      const avg = dec(agg._avg.amountUsdt);
      if (agg._count >= 5 && avg > 0 && ctx.amountUsdt > avg * 5) hit('AMOUNT_ANOMALY', `${ctx.amountUsdt} vs avg ${avg.toFixed(0)}`);
      if (agg._count < 5 && ctx.amountUsdt >= (ctx.type === RiskEventType.WITHDRAWAL ? largeWithdraw : largeOrder) * 3) hit('AMOUNT_ANOMALY', `${ctx.amountUsdt} USDT with little history`);
    }

    // disputes
    const totalOrders = user.completedOrders + user.disputesLost;
    if (totalOrders >= 5 && user.disputesLost / totalOrders > 0.2) hit('DISPUTE_RATE_HIGH', `${user.disputesLost}/${totalOrders}`);

    // counterparty
    if (ctx.counterpartyId) {
      const cp = await this.prisma.user.findUnique({ where: { id: ctx.counterpartyId }, select: { riskScore: true, status: true } });
      if (cp && (cp.riskScore >= 70 || cp.status !== 'ACTIVE')) hit('COUNTERPARTY_HIGH_RISK', `score ${cp.riskScore}, ${cp.status}`);
    }

    for (const s of ctx.extraSignals ?? []) signals.push(s);

    const score = Math.min(100, signals.reduce((a, s) => a + s.weight, 0));
    const [reviewT, blockT] = await Promise.all([this.settings.num('risk.review_threshold'), this.settings.num('risk.block_threshold')]);
    const action = score >= blockT ? RiskAction.BLOCK : score >= reviewT ? RiskAction.REVIEW : RiskAction.ALLOW;

    const ev = await this.prisma.riskEvent.create({
      data: { userId: ctx.userId, type: ctx.type, score, action, signals: signals as unknown as Prisma.InputJsonValue, refType: ctx.refType, refId: ctx.refId, ip: ctx.ip, deviceId: ctx.deviceId },
    });
    // rolling user risk score: EMA of recent events
    const newScore = Math.round(user.riskScore * 0.6 + score * 0.4);
    await this.prisma.user.update({ where: { id: ctx.userId }, data: { riskScore: newScore } });

    if (action === RiskAction.BLOCK && (await this.settings.bool('risk.alert_email_on_block'))) {
      this.notifications
        .adminAlert(`Risk BLOCK: ${ctx.type} user ${user.phone}`, `<p>Score ${score}</p><pre>${JSON.stringify(signals, null, 2)}</pre>`)
        .catch(() => undefined);
    }
    return { score, action, signals, eventId: ev.id };
  }

  /** Linked accounts: share a device fingerprint, an IP (30d), a document or a bank account. */
  async linkedAccounts(userId: string) {
    const devices = await this.prisma.device.findMany({ where: { userId }, select: { fingerprint: true } });
    const ips = await this.prisma.userIp.findMany({ where: { userId, lastSeenAt: { gt: new Date(Date.now() - days(30)) } }, select: { ip: true } });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { documentNumberHash: true } });
    const pms = await this.prisma.paymentMethod.findMany({ where: { userId, deletedAt: null }, select: { accountHash: true } });

    const links = new Map<string, Set<string>>();
    const add = (id: string, reason: string) => {
      if (id === userId) return;
      if (!links.has(id)) links.set(id, new Set());
      links.get(id)!.add(reason);
    };
    if (devices.length) {
      const rows = await this.prisma.device.findMany({ where: { fingerprint: { in: devices.map((d) => d.fingerprint) }, userId: { not: userId } }, select: { userId: true } });
      rows.forEach((r) => add(r.userId, 'device'));
    }
    if (ips.length) {
      const rows = await this.prisma.userIp.findMany({ where: { ip: { in: ips.map((i) => i.ip) }, userId: { not: userId } }, select: { userId: true } });
      rows.forEach((r) => add(r.userId, 'ip'));
    }
    if (user?.documentNumberHash) {
      const rows = await this.prisma.user.findMany({ where: { documentNumberHash: user.documentNumberHash, id: { not: userId } }, select: { id: true } });
      rows.forEach((r) => add(r.id, 'document'));
    }
    if (pms.length) {
      const rows = await this.prisma.paymentMethod.findMany({ where: { accountHash: { in: pms.map((p) => p.accountHash) }, userId: { not: userId } }, select: { userId: true } });
      rows.forEach((r) => add(r.userId, 'bank_account'));
    }
    if (!links.size) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: [...links.keys()] } }, select: { id: true, phone: true, status: true, riskScore: true, kycStatus: true, fullName: true } });
    return users.map((u) => ({ ...u, reasons: [...(links.get(u.id) ?? [])] }));
  }
}
