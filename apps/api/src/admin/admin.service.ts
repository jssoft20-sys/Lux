import { Injectable } from '@nestjs/common';
import { KycLevel, Prisma, RiskAction, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../wallet/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskEngineService } from '../risk/risk-engine.service';
import { E } from '../common/errors';
import { T } from '../notifications/templates';
import { AdminListQuery } from './dto/admin.dto';
import { usdt, ZERO } from '../common/utils/money';
import { TronService } from '../wallet/chain/tron.service';
import { days } from '../common/utils/time';
import { loadEnv } from '../config/env';
import { normalizeKgPhone } from '@somex/shared';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly risk: RiskEngineService,
    private readonly tron: TronService,
  ) {}

  private page(q: AdminListQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    return { page, limit, skip: (page - 1) * limit, take: limit };
  }

  // ─── dashboard ───
  async stats() {
    const now = Date.now();
    const d1 = new Date(now - days(1));
    const d7 = new Date(now - days(7));
    const [users, usersToday, kycPending, depositsHeld, withdrawalsPending, ordersActive, disputesOpen, riskPending, escrow, balances, fees, volume24, volume7, hot, ordersToday, ordersCompleted7] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { createdAt: { gt: d1 } } }),
      this.prisma.kycVerification.count({ where: { status: 'IN_REVIEW' } }),
      this.prisma.deposit.count({ where: { status: 'HELD' } }),
      this.prisma.withdrawal.count({ where: { status: { in: ['APPROVAL_REQUIRED', 'RISK_REVIEW'] } } }),
      this.prisma.order.count({ where: { status: { in: ['CREATED', 'PAID', 'DISPUTED'] } } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      this.prisma.riskEvent.count({ where: { reviewStatus: 'PENDING', action: { in: ['REVIEW', 'BLOCK'] } } }),
      this.prisma.balance.aggregate({ _sum: { locked: true } }),
      this.prisma.balance.aggregate({ _sum: { available: true } }),
      this.prisma.ledgerEntry.aggregate({ where: { account: 'PLATFORM_FEES' }, _sum: { delta: true } }),
      this.prisma.order.aggregate({ where: { createdAt: { gt: d1 }, status: { in: ['RELEASED', 'RESOLVED_RELEASE'] } }, _sum: { amountUsdt: true, amountFiat: true }, _count: true }),
      this.prisma.order.aggregate({ where: { createdAt: { gt: d7 }, status: { in: ['RELEASED', 'RESOLVED_RELEASE'] } }, _sum: { amountUsdt: true, amountFiat: true }, _count: true }),
      this.prisma.hotWallet.findUnique({ where: { network: 'TRON' } }),
      this.prisma.order.count({ where: { createdAt: { gt: d1 } } }),
      this.prisma.order.count({ where: { createdAt: { gt: d7 }, status: { in: ['RELEASED', 'RESOLVED_RELEASE'] } } }),
    ]);
    const userLiabilities = (balances._sum.available ?? ZERO).plus(escrow._sum.locked ?? ZERO);
    return {
      testMode: loadEnv().TEST_MODE,
      chainSimulated: this.tron.simulated(),
      users: { total: users, today: usersToday },
      queues: { kycPending, depositsHeld, withdrawalsPending, disputesOpen, riskPending, ordersActive },
      money: { escrowLocked: (escrow._sum.locked ?? ZERO).toString(), userAvailable: (balances._sum.available ?? ZERO).toString(), userLiabilities: userLiabilities.toString(), feesCollected: (fees._sum.delta ?? ZERO).toString(), hotWallet: hot ? { address: hot.address, usdt: hot.balanceCached.toString(), trx: hot.nativeBalance.toString(), frozen: hot.frozen, lastSyncAt: hot.lastSyncAt, dailyLimit: hot.dailyLimit.toString(), sentToday: hot.sentToday.toString() } : null },
      volume: { day: { usdt: (volume24._sum.amountUsdt ?? ZERO).toString(), kgs: (volume24._sum.amountFiat ?? ZERO).toString(), orders: volume24._count }, week: { usdt: (volume7._sum.amountUsdt ?? ZERO).toString(), kgs: (volume7._sum.amountFiat ?? ZERO).toString(), orders: volume7._count } },
      orders: { today: ordersToday, completed7d: ordersCompleted7 },
    };
  }

  async charts(daysBack = 14) {
    const since = new Date(Date.now() - days(daysBack));
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; orders: bigint; volume: Prisma.Decimal | null; users: bigint }>>`
      SELECT d::date AS day,
        (SELECT COUNT(*) FROM "Order" o WHERE o."createdAt"::date = d::date) AS orders,
        (SELECT COALESCE(SUM("amountUsdt"),0) FROM "Order" o WHERE o."createdAt"::date = d::date AND o.status IN ('RELEASED','RESOLVED_RELEASE')) AS volume,
        (SELECT COUNT(*) FROM "User" u WHERE u."createdAt"::date = d::date) AS users
      FROM generate_series(${since}::date, NOW()::date, '1 day') d ORDER BY d`;
    const risk = await this.prisma.riskEvent.groupBy({ by: ['action'], where: { createdAt: { gt: since } }, _count: true });
    const statuses = await this.prisma.order.groupBy({ by: ['status'], where: { createdAt: { gt: since } }, _count: true });
    return {
      daily: rows.map((r) => ({ day: r.day, orders: Number(r.orders), volume: Number(r.volume ?? 0), users: Number(r.users) })),
      risk: risk.map((r) => ({ action: r.action, count: r._count })),
      orderStatuses: statuses.map((s) => ({ status: s.status, count: s._count })),
    };
  }

  async activity(limit = 30) {
    const [risk, audit] = await Promise.all([
      this.prisma.riskEvent.findMany({ where: { action: { in: [RiskAction.REVIEW, RiskAction.BLOCK] } }, include: { user: { select: { phone: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, take: limit }),
      this.prisma.auditLog.findMany({ orderBy: { seq: 'desc' }, take: limit }),
    ]);
    return { risk, audit: audit.map((a) => ({ ...a, seq: a.seq.toString() })) };
  }

  // ─── users ───
  async users(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.UserWhereInput = {};
    if (q.q) {
      const phone = normalizeKgPhone(q.q);
      const digits = q.q.replace(/\D+/g, '');
      where.OR = [
        ...(phone ? [{ phone }] : []),
        ...(digits.length >= 4 ? [{ phone: { contains: digits.replace(/^0/, '') } }] : []),
        { fullName: { contains: q.q, mode: 'insensitive' } },
        { nickname: { contains: q.q, mode: 'insensitive' } },
        { id: q.q },
      ];
    }
    if (q.status) where.status = q.status as UserStatus;
    if (q.kyc) where.kycStatus = q.kyc as any;
    if (q.minRisk) where.riskScore = { gte: q.minRisk };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: { balance: true }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map((u) => ({ id: u.id, phone: u.phone, fullName: u.fullName, nickname: u.nickname, status: u.status, kycLevel: u.kycLevel, kycStatus: u.kycStatus, riskScore: u.riskScore, completedOrders: u.completedOrders, balance: u.balance ? { available: u.balance.available.toString(), locked: u.balance.locked.toString() } : null, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })), total, page, limit };
  }

  async user(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { balance: true, devices: { orderBy: { lastSeenAt: 'desc' } }, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: 'desc' } }, kycVerifications: { orderBy: { createdAt: 'desc' } }, paymentMethods: { where: { deletedAt: null } }, ips: { orderBy: { lastSeenAt: 'desc' }, take: 20 }, depositAddresses: true, withdrawAddresses: true } });
    if (!u) throw E.notFound('Пользователь');
    const [orders, deposits, withdrawals, riskEvents, ledger, linked, disputes, ratings] = await Promise.all([
      this.prisma.order.findMany({ where: { OR: [{ buyerId: id }, { sellerId: id }] }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, number: true, status: true, amountUsdt: true, amountFiat: true, buyerId: true, sellerId: true, bankCode: true, createdAt: true, riskScore: true } }),
      this.prisma.deposit.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.withdrawal.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.riskEvent.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.ledgerEntry.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.risk.linkedAccounts(id),
      this.prisma.dispute.findMany({ where: { order: { OR: [{ buyerId: id }, { sellerId: id }] } }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.rating.findMany({ where: { toUserId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const { pinHash, ...safe } = u;
    return {
      ...safe,
      pinSet: !!pinHash,
      balance: u.balance ? { available: u.balance.available.toString(), locked: u.balance.locked.toString() } : null,
      paymentMethods: u.paymentMethods.map((p) => ({ id: p.id, bankCode: p.bankCode, holderName: p.holderName, accountMasked: p.accountMasked, status: p.status, nameMatchesKyc: p.nameMatchesKyc, createdAt: p.createdAt })),
      kycVerifications: u.kycVerifications.map((k) => ({ ...k, rawResult: undefined })),
      orders: orders.map((o) => ({ ...o, role: o.buyerId === id ? 'BUYER' : 'SELLER', amountUsdt: o.amountUsdt.toString(), amountFiat: o.amountFiat.toString() })),
      deposits: deposits.map((d) => ({ ...d, amount: d.amount.toString(), blockNumber: d.blockNumber?.toString() })),
      withdrawals: withdrawals.map((w) => ({ ...w, amount: w.amount.toString(), fee: w.fee.toString(), netAmount: w.netAmount.toString() })),
      riskEvents,
      ledger: ledger.map((l) => ({ ...l, delta: l.delta.toString() })),
      linkedAccounts: linked,
      disputes,
      ratings,
    };
  }

  async setUserStatus(id: string, status: UserStatus, adminId: string, reason: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { status: true } });
    await this.prisma.user.update({ where: { id }, data: { status, restrictionReason: reason, adminNote: reason } });
    if (status !== UserStatus.ACTIVE) {
      await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: `ADMIN_${status}` } });
      if (status === UserStatus.BANNED) {
        await this.prisma.ad.updateMany({ where: { userId: id, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
      }
      if (status === UserStatus.FROZEN) await this.notifications.notify({ userId: id, title: 'Аккаунт заморожен', body: reason, whatsapp: true, whatsappText: T.accountFrozen() });
    }
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: `user.status.${status.toLowerCase()}`, targetType: 'User', targetId: id, before, after: { status }, meta: { reason } });
  }

  async setUserFlags(id: string, adminId: string, dto: { kycLevel?: string; withdrawalsFrozen?: boolean; tradingFrozen?: boolean; reason?: string }) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { kycLevel: true, withdrawalsFrozen: true, tradingFrozen: true } });
    const data: Prisma.UserUpdateInput = {};
    if (dto.kycLevel) data.kycLevel = dto.kycLevel as KycLevel;
    if (dto.withdrawalsFrozen !== undefined) data.withdrawalsFrozen = dto.withdrawalsFrozen;
    if (dto.tradingFrozen !== undefined) data.tradingFrozen = dto.tradingFrozen;
    await this.prisma.user.update({ where: { id }, data });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'user.flags', targetType: 'User', targetId: id, before, after: data, meta: { reason: dto.reason } });
  }

  async forceLogout(id: string, adminId: string) {
    await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'ADMIN_FORCE_LOGOUT' } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'user.force_logout', targetType: 'User', targetId: id });
  }

  async resetDevices(id: string, adminId: string) {
    await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'ADMIN_RESET_DEVICES' } });
    await this.prisma.device.deleteMany({ where: { userId: id } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'user.reset_devices', targetType: 'User', targetId: id });
  }

  async resetPin(id: string, adminId: string) {
    await this.prisma.user.update({ where: { id }, data: { pinHash: null } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'user.reset_pin', targetType: 'User', targetId: id });
  }

  async note(id: string, adminId: string, note: string) {
    await this.prisma.user.update({ where: { id }, data: { adminNote: note } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'user.note', targetType: 'User', targetId: id, after: { note } });
  }

  async adjustBalance(id: string, adminId: string, delta: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.adjust(tx, id, usdt(delta), adminId, reason);
    });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'user.balance_adjust', targetType: 'User', targetId: id, meta: { delta, reason } });
    await this.notifications.notify({ userId: id, title: 'Корректировка баланса', body: `${Number(delta) > 0 ? '+' : ''}${delta} USDT: ${reason}` });
  }

  // ─── generic lists ───
  async kycList(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.KycVerificationWhereInput = {};
    if (q.status) where.status = q.status as any;
    if (q.q) where.user = { OR: [{ phone: { contains: q.q } }, { fullName: { contains: q.q, mode: 'insensitive' } }] };
    const [items, total] = await Promise.all([
      this.prisma.kycVerification.findMany({ where, include: { user: { select: { id: true, phone: true, fullName: true, kycLevel: true, kycStatus: true, riskScore: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.kycVerification.count({ where }),
    ]);
    return { items: items.map((k) => ({ ...k, rawResult: undefined })), total, page, limit };
  }

  async kycDetail(id: string) {
    const k = await this.prisma.kycVerification.findUnique({ where: { id }, include: { user: { select: { id: true, phone: true, fullName: true, kycLevel: true, kycStatus: true, riskScore: true, createdAt: true } } } });
    if (!k) throw E.notFound('Верификация');
    const dupes = k.documentNumberHash ? await this.prisma.user.findMany({ where: { documentNumberHash: k.documentNumberHash, id: { not: k.userId } }, select: { id: true, phone: true, status: true } }) : [];
    return { ...k, duplicates: dupes };
  }

  async deposits(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.DepositWhereInput = {};
    if (q.status) where.status = q.status as any;
    if (q.userId) where.userId = q.userId;
    if (q.q) where.OR = [{ txHash: { contains: q.q } }, { fromAddress: { contains: q.q } }, { toAddress: { contains: q.q } }, { user: { phone: { contains: q.q } } }];
    const [items, total] = await Promise.all([
      this.prisma.deposit.findMany({ where, include: { user: { select: { id: true, phone: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.deposit.count({ where }),
    ]);
    return { items: items.map((d) => ({ ...d, amount: d.amount.toString(), blockNumber: d.blockNumber?.toString() })), total, page, limit };
  }

  async withdrawals(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.WithdrawalWhereInput = {};
    if (q.status) where.status = { in: q.status.split(',') as any };
    if (q.userId) where.userId = q.userId;
    if (q.q) where.OR = [{ toAddress: { contains: q.q } }, { txHash: { contains: q.q } }, { user: { phone: { contains: q.q } } }];
    const [items, total] = await Promise.all([
      this.prisma.withdrawal.findMany({ where, include: { user: { select: { id: true, phone: true, fullName: true, kycLevel: true, riskScore: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.withdrawal.count({ where }),
    ]);
    return { items: items.map((w) => ({ ...w, amount: w.amount.toString(), fee: w.fee.toString(), netAmount: w.netAmount.toString() })), total, page, limit };
  }

  async ads(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.AdWhereInput = {};
    if (q.status) where.status = q.status as any;
    if (q.userId) where.userId = q.userId;
    const [items, total] = await Promise.all([
      this.prisma.ad.findMany({ where, include: { user: { select: { id: true, phone: true, fullName: true, nickname: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.ad.count({ where }),
    ]);
    return { items: items.map((a) => ({ ...a, price: a.price.toString(), minAmountFiat: a.minAmountFiat.toString(), maxAmountFiat: a.maxAmountFiat.toString(), totalAmount: a.totalAmount.toString(), availableAmount: a.availableAmount.toString(), floatingMargin: a.floatingMargin?.toString() })), total, page, limit };
  }

  async orders(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.OrderWhereInput = {};
    if (q.status) where.status = { in: q.status.split(',') as any };
    if (q.userId) where.OR = [{ buyerId: q.userId }, { sellerId: q.userId }];
    if (q.q) where.OR = [...(Array.isArray(where.OR) ? where.OR : []), ...(Number.isInteger(Number(q.q)) ? [{ number: Number(q.q) }] : []), { buyer: { phone: { contains: q.q } } }, { seller: { phone: { contains: q.q } } }];
    if (q.minRisk) where.riskScore = { gte: q.minRisk };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({ where, include: { buyer: { select: { id: true, phone: true, fullName: true } }, seller: { select: { id: true, phone: true, fullName: true } }, dispute: { select: { id: true, status: true, reason: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.order.count({ where }),
    ]);
    return { items: items.map((o) => ({ ...o, amountUsdt: o.amountUsdt.toString(), amountFiat: o.amountFiat.toString(), price: o.price.toString(), feeUsdt: o.feeUsdt.toString() })), total, page, limit };
  }

  async disputes(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.DisputeWhereInput = {};
    if (q.status) where.status = { in: q.status.split(',') as any };
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({ where, include: { order: { select: { id: true, number: true, amountUsdt: true, amountFiat: true, bankCode: true, buyer: { select: { id: true, phone: true, fullName: true } }, seller: { select: { id: true, phone: true, fullName: true } } } }, openedBy: { select: { id: true, phone: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.dispute.count({ where }),
    ]);
    return { items: items.map((d) => ({ ...d, buyerAmount: d.buyerAmount?.toString(), order: d.order ? { ...d.order, amountUsdt: d.order.amountUsdt.toString(), amountFiat: d.order.amountFiat.toString() } : null })), total, page, limit };
  }

  async riskEvents(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.RiskEventWhereInput = {};
    if (q.status) where.reviewStatus = q.status as any;
    if (q.action) where.action = q.action as RiskAction;
    if (q.type) where.type = q.type as any;
    if (q.userId) where.userId = q.userId;
    if (q.minRisk) where.score = { gte: q.minRisk };
    const [items, total] = await Promise.all([
      this.prisma.riskEvent.findMany({ where, include: { user: { select: { id: true, phone: true, fullName: true, status: true, riskScore: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.riskEvent.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async devices(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.DeviceWhereInput = {};
    if (q.q) where.OR = [{ fingerprint: { contains: q.q } }, { model: { contains: q.q, mode: 'insensitive' } }, { user: { phone: { contains: q.q } } }];
    if (q.userId) where.userId = q.userId;
    const [items, total] = await Promise.all([
      this.prisma.device.findMany({ where, include: { user: { select: { id: true, phone: true, fullName: true, status: true } } }, orderBy: { lastSeenAt: 'desc' }, skip, take }),
      this.prisma.device.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** Fingerprints / IPs shared by several accounts. */
  async deviceClusters() {
    const shared = await this.prisma.device.groupBy({ by: ['fingerprint'], _count: { userId: true }, having: { userId: { _count: { gt: 1 } } }, orderBy: { _count: { userId: 'desc' } }, take: 50 });
    const clusters = [];
    for (const s of shared) {
      const devices = await this.prisma.device.findMany({ where: { fingerprint: s.fingerprint }, include: { user: { select: { id: true, phone: true, fullName: true, status: true, riskScore: true } } } });
      clusters.push({ fingerprint: s.fingerprint, accounts: devices.map((d) => ({ ...d.user, deviceId: d.id, model: d.model, lastSeenAt: d.lastSeenAt })) });
    }
    const ips = await this.prisma.userIp.groupBy({ by: ['ip'], _count: { userId: true }, having: { userId: { _count: { gt: 2 } } }, orderBy: { _count: { userId: 'desc' } }, take: 50 });
    const ipClusters = [];
    for (const i of ips) {
      const rows = await this.prisma.userIp.findMany({ where: { ip: i.ip }, include: { user: { select: { id: true, phone: true, fullName: true, status: true, riskScore: true } } } });
      ipClusters.push({ ip: i.ip, accounts: rows.map((r) => ({ ...r.user, hits: r.hits, lastSeenAt: r.lastSeenAt })) });
    }
    return { devices: clusters, ips: ipClusters };
  }

  async blockDevice(id: string, adminId: string, blocked: boolean) {
    const d = await this.prisma.device.update({ where: { id }, data: { blocked } });
    if (blocked) await this.prisma.session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'DEVICE_BLOCKED' } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: blocked ? 'device.blocked' : 'device.unblocked', targetType: 'Device', targetId: id, meta: { userId: d.userId } });
  }

  async audit_(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.AuditLogWhereInput = {};
    if (q.action) where.action = { contains: q.action };
    if (q.userId) where.OR = [{ actorId: q.userId }, { targetId: q.userId }];
    if (q.q) where.OR = [{ actorLabel: { contains: q.q, mode: 'insensitive' } }, { targetId: q.q }, { actorId: q.q }, { action: { contains: q.q } }];
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    const [items, total] = await Promise.all([this.prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip, take }), this.prisma.auditLog.count({ where })]);
    return { items: items.map((a) => ({ ...a, seq: a.seq.toString() })), total, page, limit };
  }

  async ledger_(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.LedgerEntryWhereInput = {};
    if (q.userId) where.userId = q.userId;
    if (q.type) where.refType = q.type;
    const [items, total] = await Promise.all([this.prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }), this.prisma.ledgerEntry.count({ where })]);
    return { items: items.map((l) => ({ ...l, delta: l.delta.toString() })), total, page, limit };
  }

  async walletOverview() {
    const [hot, addresses, escrow, available, reconcile] = await Promise.all([
      this.prisma.hotWallet.findUnique({ where: { network: 'TRON' } }),
      this.prisma.depositAddress.count(),
      this.prisma.balance.aggregate({ _sum: { locked: true } }),
      this.prisma.balance.aggregate({ _sum: { available: true } }),
      this.ledger.reconcile(),
    ]);
    const pendingWithdrawals = await this.prisma.withdrawal.aggregate({ where: { status: { in: ['APPROVED', 'BROADCASTING', 'APPROVAL_REQUIRED', 'RISK_REVIEW', 'AWAITING_OTP'] } }, _sum: { netAmount: true }, _count: true });
    return {
      hotWallet: hot ? { ...hot, balanceCached: hot.balanceCached.toString(), nativeBalance: hot.nativeBalance.toString(), dailyLimit: hot.dailyLimit.toString(), singleLimit: hot.singleLimit.toString(), sentToday: hot.sentToday.toString() } : null,
      depositAddresses: addresses,
      escrowLocked: (escrow._sum.locked ?? ZERO).toString(),
      userAvailable: (available._sum.available ?? ZERO).toString(),
      pendingWithdrawals: { count: pendingWithdrawals._count, amount: (pendingWithdrawals._sum.netAmount ?? ZERO).toString() },
      reconciliation: reconcile,
      chainSimulated: this.tron.simulated(),
    };
  }

  async syncHotWallet(adminId: string) {
    const b = await this.tron.hotWalletBalances();
    if (!b) throw E.bad('HOT_WALLET', 'Hot wallet не настроен (приватный ключ)');
    const hot = await this.prisma.hotWallet.upsert({ where: { network: 'TRON' }, create: { network: 'TRON', address: b.address, balanceCached: b.usdt, nativeBalance: b.trx, lastSyncAt: new Date() }, update: { address: b.address, balanceCached: b.usdt, nativeBalance: b.trx, lastSyncAt: new Date() } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'wallet.hot_synced', meta: b });
    return { ...hot, balanceCached: hot.balanceCached.toString(), nativeBalance: hot.nativeBalance.toString(), dailyLimit: hot.dailyLimit.toString(), singleLimit: hot.singleLimit.toString(), sentToday: hot.sentToday.toString() };
  }

  async setHotWalletLimits(adminId: string, dto: { dailyLimit?: string; singleLimit?: string; frozen?: boolean }) {
    const data: Prisma.HotWalletUpdateInput = {};
    if (dto.dailyLimit) data.dailyLimit = usdt(dto.dailyLimit);
    if (dto.singleLimit) data.singleLimit = usdt(dto.singleLimit);
    if (dto.frozen !== undefined) data.frozen = dto.frozen;
    const address = (await this.tron.hotWalletAddress()) ?? 'not-configured';
    const hot = await this.prisma.hotWallet.upsert({ where: { network: 'TRON' }, create: { network: 'TRON', address, ...(data as any) }, update: data });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'wallet.hot_limits', after: dto });
    return hot;
  }

  async supportTickets(q: AdminListQuery) {
    const { page, limit, skip, take } = this.page(q);
    const where: Prisma.SupportTicketWhereInput = {};
    if (q.status) where.status = q.status as any;
    const [items, total] = await Promise.all([this.prisma.supportTicket.findMany({ where, include: { user: { select: { id: true, phone: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, skip, take }), this.prisma.supportTicket.count({ where })]);
    return { items, total, page, limit };
  }
}
