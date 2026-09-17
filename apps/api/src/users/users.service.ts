import { Injectable } from '@nestjs/common';
import { KycLevel, KycStatus, PaymentMethodStatus, Prisma, RiskAction, RiskEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { E } from '../common/errors';
import { BANK_MAP, formatKgPhone } from '@somex/shared';
import { AuditService } from '../audit/audit.service';
import { BlacklistService } from '../risk/blacklist.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly blacklist: BlacklistService,
  ) {}

  async limits(level: KycLevel) {
    if (level === KycLevel.BASIC) return { canTrade: false, p2pPerOrder: 0, p2pDaily: 0, withdrawDaily: 0, withdrawSingle: 0 };
    const p = level === KycLevel.ADVANCED ? 'advanced' : 'verified';
    const [p2pPerOrder, p2pDaily, withdrawDaily, withdrawSingle] = await Promise.all([
      this.settings.num(`limits.${p}_p2p_per_order`),
      this.settings.num(`limits.${p}_p2p_daily`),
      this.settings.num(`limits.${p}_withdraw_daily`),
      this.settings.num(`limits.${p}_withdraw_single`),
    ]);
    return { canTrade: true, p2pPerOrder, p2pDaily, withdrawDaily, withdrawSingle };
  }

  async profile(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { balance: true, paymentMethods: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }, _count: { select: { devices: true } } },
    });
    const limits = await this.limits(u.kycLevel);
    const [ordersCount, activeOrders] = await Promise.all([
      this.prisma.order.count({ where: { OR: [{ buyerId: userId }, { sellerId: userId }], status: { in: ['RELEASED', 'RESOLVED_RELEASE'] } } }),
      this.prisma.order.count({ where: { OR: [{ buyerId: userId }, { sellerId: userId }], status: { in: ['CREATED', 'PAID', 'DISPUTED'] } } }),
    ]);
    return {
      id: u.id,
      phone: u.phone,
      phoneFormatted: formatKgPhone(u.phone),
      status: u.status,
      nickname: u.nickname ?? (u.firstName ? `${u.firstName} ${u.lastName?.[0] ?? ''}.`.trim() : null),
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: u.fullName,
      avatarFileId: u.avatarFileId,
      language: u.language,
      kyc: { level: u.kycLevel, status: u.kycStatus },
      security: {
        pinSet: !!u.pinHash,
        biometricEnabled: u.biometricEnabled,
        devices: u._count.devices,
        sensitiveOpsLockedUntil: u.sensitiveOpsLockedUntil && u.sensitiveOpsLockedUntil > new Date() ? u.sensitiveOpsLockedUntil : null,
        withdrawalsFrozen: u.withdrawalsFrozen,
        tradingFrozen: u.tradingFrozen,
      },
      balance: { available: u.balance?.available.toString() ?? '0', locked: u.balance?.locked.toString() ?? '0', asset: 'USDT' },
      stats: {
        completedOrders: Math.max(u.completedOrders, ordersCount),
        activeOrders,
        rating: u.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 20) / 20 : null,
        completionRate: this.completionRate(u.completedOrders, u.disputesLost),
        memberSince: u.createdAt,
      },
      limits,
      paymentMethods: u.paymentMethods.map((pm) => this.pmView(pm)),
      createdAt: u.createdAt,
    };
  }

  completionRate(completed: number, lost: number) {
    const total = completed + lost;
    if (!total) return 100;
    return Math.round((completed / total) * 1000) / 10;
  }

  /** Public counterparty card shown in ads / orders (no PII beyond first name + initial). */
  async publicCard(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, nickname: true, firstName: true, lastName: true, kycLevel: true, kycStatus: true, completedOrders: true, disputesLost: true, ratingSum: true, ratingCount: true, lastSeenAt: true, createdAt: true },
    });
    const online = !!u.lastSeenAt && Date.now() - u.lastSeenAt.getTime() < 5 * 60_000;
    return {
      id: u.id,
      name: u.nickname ?? (u.firstName ? `${u.firstName} ${u.lastName?.[0] ?? ''}.`.trim() : 'Пользователь'),
      verified: u.kycStatus === KycStatus.APPROVED,
      kycLevel: u.kycLevel,
      completedOrders: u.completedOrders,
      completionRate: this.completionRate(u.completedOrders, u.disputesLost),
      rating: u.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 20) / 20 : null,
      online,
      lastSeenAt: u.lastSeenAt,
      memberSince: u.createdAt,
    };
  }

  async update(userId: string, data: { nickname?: string; language?: string }) {
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.profile(userId);
  }

  async touchIp(userId: string, ip?: string) {
    if (!ip) return;
    await this.prisma.userIp.upsert({
      where: { userId_ip: { userId, ip } },
      create: { userId, ip },
      update: { hits: { increment: 1 }, lastSeenAt: new Date() },
    });
  }

  async heartbeat(userId: string, ip?: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date(), lastIp: ip } });
  }

  // ─── devices & sessions ───
  async devices(userId: string, currentDeviceId?: string) {
    const rows = await this.prisma.device.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });
    return rows.map((d) => ({ id: d.id, platform: d.platform, model: d.model, name: d.name, trusted: d.trusted, blocked: d.blocked, firstSeenAt: d.firstSeenAt, lastSeenAt: d.lastSeenAt, lastIp: d.lastIp, current: d.id === currentDeviceId }));
  }

  async removeDevice(userId: string, deviceId: string, currentDeviceId?: string) {
    if (deviceId === currentDeviceId) throw E.bad('CURRENT_DEVICE', 'Нельзя удалить текущее устройство');
    await this.prisma.session.updateMany({ where: { userId, deviceId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'DEVICE_REMOVED' } });
    await this.prisma.device.deleteMany({ where: { id: deviceId, userId } });
    await this.audit.log({ actorType: 'USER', actorId: userId, action: 'user.device_removed', targetType: 'Device', targetId: deviceId });
    return { ok: true };
  }

  async sessions(userId: string, currentSessionId: string) {
    const rows = await this.prisma.session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, include: { device: true }, orderBy: { lastUsedAt: 'desc' } });
    return rows.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, device: s.device ? { model: s.device.model, platform: s.device.platform } : null, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, current: s.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'USER_REVOKED' } });
    return { ok: true };
  }

  // ─── payment methods ───
  pmView(pm: { id: string; bankCode: string; holderName: string; accountMasked: string; status: PaymentMethodStatus; nameMatchesKyc: boolean; createdAt: Date }) {
    const bank = BANK_MAP[pm.bankCode];
    return { id: pm.id, bankCode: pm.bankCode, bankName: bank?.name ?? pm.bankCode, bankShort: bank?.shortName ?? pm.bankCode, showsSenderName: bank?.showsSenderName ?? true, holderName: pm.holderName, accountMasked: pm.accountMasked, status: pm.status, nameMatchesKyc: pm.nameMatchesKyc, createdAt: pm.createdAt };
  }

  async paymentMethods(userId: string) {
    const rows = await this.prisma.paymentMethod.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.pmView(r));
  }

  /**
   * Adds a bank account. The holder name is NOT user input — it is copied from the verified KYC
   * document, which is what makes "sender name must equal KYC name" enforceable.
   */
  async addPaymentMethod(userId: string, bankCode: string, accountNumber: string, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.kycStatus !== KycStatus.APPROVED || !user.fullName) throw E.forbidden('Сначала пройдите верификацию (KYC), чтобы добавить способ оплаты на своё имя');
    const bank = await this.prisma.bank.findUnique({ where: { code: bankCode } });
    if (!bank || !bank.enabled) throw E.bad('BANK_NOT_SUPPORTED', 'Банк не поддерживается');
    const clean = accountNumber.replace(/[\s-]+/g, '');
    if (bank.accountPattern && !new RegExp(bank.accountPattern).test(clean)) throw E.bad('ACCOUNT_FORMAT', `Неверный формат: ${bank.accountHint ?? 'проверьте номер'}`);

    const accountHash = this.crypto.blindIndex(`${bankCode}:${clean}`);
    if (await this.blacklist.isListed('BANK_ACCOUNT', `${bankCode}:${clean}`)) {
      await this.prisma.riskEvent.create({ data: { userId, type: RiskEventType.PAYMENT_METHOD, score: 100, action: RiskAction.BLOCK, signals: [{ code: 'BLACKLIST_MATCH', weight: 100, detail: 'bank account' }], ip } });
      throw E.forbidden('Этот счёт не может быть использован. Обратитесь в поддержку.');
    }
    const usedByOther = await this.prisma.paymentMethod.findFirst({ where: { accountHash, userId: { not: userId }, deletedAt: null } });
    const existing = await this.prisma.paymentMethod.findFirst({ where: { accountHash, userId, deletedAt: null } });
    if (existing) throw E.conflict('DUPLICATE', 'Этот счёт уже добавлен');

    const pm = await this.prisma.paymentMethod.create({
      data: {
        userId,
        bankCode,
        holderName: user.fullName,
        accountNumberEnc: this.crypto.encrypt(clean),
        accountMasked: this.crypto.maskAccount(clean),
        accountHash,
        status: usedByOther ? PaymentMethodStatus.PENDING_REVIEW : PaymentMethodStatus.ACTIVE,
        nameMatchesKyc: true,
      },
    });
    if (usedByOther) {
      await this.prisma.riskEvent.create({
        data: { userId, type: RiskEventType.PAYMENT_METHOD, score: 60, action: RiskAction.REVIEW, signals: [{ code: 'DEVICE_SHARED_ACCOUNTS', weight: 60, detail: `bank account also used by user ${usedByOther.userId}` }], refType: 'PaymentMethod', refId: pm.id, ip },
      });
    }
    await this.audit.log({ actorType: 'USER', actorId: userId, action: 'user.payment_method_added', targetType: 'PaymentMethod', targetId: pm.id, after: { bankCode, accountMasked: pm.accountMasked }, ip });
    return this.pmView(pm);
  }

  async removePaymentMethod(userId: string, id: string) {
    const inUse = await this.prisma.order.count({ where: { OR: [{ buyerPaymentMethodId: id }, { sellerPaymentMethodId: id }], status: { in: ['CREATED', 'PAID', 'DISPUTED'] } } });
    if (inUse) throw E.conflict('IN_USE', 'Способ оплаты используется в активной сделке');
    await this.prisma.paymentMethod.updateMany({ where: { id, userId }, data: { deletedAt: new Date(), status: PaymentMethodStatus.DISABLED } });
    return { ok: true };
  }

  /** Full account number is revealed only inside an order where the caller is the paying counterparty. */
  revealAccount(pm: { accountNumberEnc: string }) {
    return this.crypto.decrypt(pm.accountNumberEnc);
  }

  async notifications(userId: string, page = 1, limit = 30) {
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId, channel: 'INAPP' }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.notification.count({ where: { userId, channel: 'INAPP' } }),
      this.prisma.notification.count({ where: { userId, channel: 'INAPP', readAt: null } }),
    ]);
    return { items, total, unread, page, limit };
  }

  async markRead(userId: string, id?: string) {
    await this.prisma.notification.updateMany({ where: { userId, channel: 'INAPP', readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async createTicket(userId: string, dto: { subject: string; message: string; orderId?: string }) {
    const t = await this.prisma.supportTicket.create({ data: { userId, subject: dto.subject, message: dto.message, orderId: dto.orderId } });
    return t;
  }

  async tickets(userId: string) {
    return this.prisma.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async history(userId: string, page = 1, limit = 30) {
    const [items, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { userId, account: 'USER_AVAILABLE' }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.ledgerEntry.count({ where: { userId, account: 'USER_AVAILABLE' } }),
    ]);
    return { items: items.map((e) => ({ id: e.id, delta: e.delta.toString(), refType: e.refType, refId: e.refId, memo: e.memo, createdAt: e.createdAt })), total, page, limit };
  }
}

export type UserProfile = Prisma.PromiseReturnType<UsersService['profile']>;
