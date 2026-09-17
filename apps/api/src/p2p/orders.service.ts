import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActorType, AdSide, AdStatus, DisputeStatus, KycStatus, OrderStatus, OtpPurpose, Prisma, RiskAction, RiskEventType, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallet/ledger.service';
import { UsersService } from '../users/users.service';
import { RiskEngineService } from '../risk/risk-engine.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { TokenService } from '../auth/token.service';
import { OtpService } from '../auth/otp.service';
import { E } from '../common/errors';
import { dec, kgs, usdt } from '../common/utils/money';
import { T } from '../notifications/templates';
import { CreateOrderDto, DeclarePaymentDto, OpenDisputeDto, ReleaseDto } from './dto/p2p.dto';
import { namesMatch } from '../common/utils/names';
import { formatAmount } from '@somex/shared';

const ACTIVE: OrderStatus[] = [OrderStatus.CREATED, OrderStatus.PAID, OrderStatus.DISPUTED];
type FullOrder = Prisma.OrderGetPayload<{ include: { ad: true; buyer: true; seller: true; buyerPaymentMethod: true; sellerPaymentMethod: true; dispute: true } }>;
const INCLUDE = { ad: true, buyer: true, seller: true, buyerPaymentMethod: true, sellerPaymentMethod: true, dispute: true } as const;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly users: UsersService,
    private readonly risk: RiskEngineService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
  ) {}

  private async event(tx: Prisma.TransactionClient | PrismaService, orderId: string, type: string, actorType: ActorType, actorId?: string | null, payload?: unknown) {
    await tx.orderEvent.create({ data: { orderId, type, actorType, actorId: actorId ?? undefined, payload: payload === undefined ? undefined : (payload as any) } });
  }

  private time() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  async load(id: string): Promise<FullOrder> {
    const o = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    if (!o) throw E.notFound('Сделка');
    return o;
  }

  /** Role-aware order representation. Seller requisites are revealed to the buyer only after escrow lock. */
  async view(o: FullOrder, viewerId: string, opts: { admin?: boolean } = {}) {
    const role = o.buyerId === viewerId ? 'BUYER' : o.sellerId === viewerId ? 'SELLER' : opts.admin ? 'ADMIN' : null;
    if (!role) throw E.forbidden();
    const bank = await this.prisma.bank.findUnique({ where: { code: o.bankCode } });
    const [buyerCard, sellerCard] = await Promise.all([this.users.publicCard(o.buyerId), this.users.publicCard(o.sellerId)]);
    const unread = role === 'ADMIN' ? 0 : await this.prisma.chatMessage.count({ where: { orderId: o.id, readAt: null, senderId: { not: viewerId }, type: { not: 'SYSTEM' } } });
    const escrowLocked = ACTIVE.includes(o.status);
    const bankView = bank ? { code: bank.code, name: bank.name, shortName: bank.shortName, color: bank.color, logo: bank.logo, showsSenderName: bank.showsSenderName } : { code: o.bankCode, name: o.bankCode, shortName: o.bankCode, color: '#666', logo: '', showsSenderName: true };
    const base = {
      id: o.id,
      number: o.number,
      status: o.status,
      role,
      side: role === 'BUYER' ? 'BUY' : 'SELL',
      amountUsdt: o.amountUsdt.toString(),
      amountFiat: o.amountFiat.toString(),
      price: o.price.toString(),
      feeUsdt: o.feeUsdt.toString(),
      buyerReceives: o.amountUsdt.minus(o.feeUsdt).toString(),
      bank: bankView,
      paymentWindowMin: o.ad.paymentWindowMin,
      expiresAt: o.expiresAt,
      paidAt: o.paidAt,
      releasedAt: o.releasedAt,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
      createdAt: o.createdAt,
      buyer: { ...buyerCard, fullName: o.buyer.fullName },
      seller: { ...sellerCard, fullName: o.seller.fullName },
      counterparty: role === 'BUYER' ? sellerCard : buyerCard,
      escrow: { locked: escrowLocked, amountUsdt: o.amountUsdt.toString(), state: escrowLocked ? 'LOCKED' : o.status === OrderStatus.RELEASED || o.status === OrderStatus.RESOLVED_RELEASE ? 'RELEASED' : 'REFUNDED' },
      declaration: o.paymentDeclaration,
      releaseConfirmation: role === 'BUYER' ? undefined : o.releaseConfirmation,
      dispute: o.dispute ? { id: o.dispute.id, status: o.dispute.status, reason: o.dispute.reason, description: o.dispute.description, resolution: o.dispute.resolution, resolutionNote: o.dispute.resolutionNote, createdAt: o.dispute.createdAt, resolvedAt: o.dispute.resolvedAt, evidenceFileIds: o.dispute.evidenceFileIds, openedById: o.dispute.openedById } : null,
      unreadMessages: unread,
      riskScore: opts.admin ? o.riskScore : undefined,
      riskSignals: opts.admin ? o.riskSignals : undefined,
      permissions: {
        canCancel: role === 'BUYER' && o.status === OrderStatus.CREATED,
        canDeclare: role === 'BUYER' && o.status === OrderStatus.CREATED,
        canRelease: role === 'SELLER' && o.status === OrderStatus.PAID,
        canDispute: (role === 'BUYER' || role === 'SELLER') && o.status === OrderStatus.PAID,
        canChat: ACTIVE.includes(o.status),
        canRate: ([OrderStatus.RELEASED, OrderStatus.RESOLVED_RELEASE, OrderStatus.RESOLVED_REFUND] as OrderStatus[]).includes(o.status),
      },
    };
    // buyer: where to send money + who must be the sender
    const payment =
      (role === 'BUYER' || role === 'ADMIN') && o.sellerPaymentMethod
        ? {
            holderName: o.sellerPaymentMethod.holderName,
            bank: bankView,
            accountNumber: escrowLocked || role === 'ADMIN' ? this.users.revealAccount(o.sellerPaymentMethod) : null,
            accountMasked: o.sellerPaymentMethod.accountMasked,
            senderMustBe: o.buyer.fullName,
            senderBank: bankView.name,
            amountFiat: o.amountFiat.toString(),
            rules: [
              `Переведите ровно ${formatAmount(dec(o.amountFiat), 0)} KGS со своего счёта ${bankView.shortName}`,
              `Отправитель должен быть: ${o.buyer.fullName ?? 'ваше ФИО по KYC'}`,
              'Не переводите через кассу, терминал, чужую карту или счёт третьего лица',
              'Не пишите «USDT», «крипта», «Somex» в назначении платежа',
              'Не переходите в WhatsApp/Telegram — Somex не защищает сделки вне приложения',
            ],
          }
        : undefined;
    // seller: what to expect
    const expected =
      role === 'SELLER' || role === 'ADMIN'
        ? {
            senderName: o.buyer.fullName,
            senderBank: bankView.name,
            amountFiat: o.amountFiat.toString(),
            buyerAccountMasked: o.buyerPaymentMethod?.accountMasked ?? null,
            receiveTo: o.sellerPaymentMethod ? `${bankView.shortName} ${o.sellerPaymentMethod.accountMasked}` : null,
            checklist: [
              'Откройте приложение банка — не чек, не сообщение покупателя, не SMS',
              `Убедитесь, что ${formatAmount(dec(o.amountFiat), 0)} KGS действительно поступили на счёт`,
              `Отправитель: ${o.buyer.fullName ?? '—'} — принимайте ТОЛЬКО от этого человека`,
              `Банк отправителя: ${bankView.name}`,
            ],
            nameMismatchAction: 'ФИО отправителя не совпадает → НЕ отпускайте USDT → откройте спор',
          }
        : undefined;
    return { ...base, payment, expected };
  }

  async create(takerId: string, dto: CreateOrderDto, ctx: { ip?: string; deviceId?: string }) {
    if (!dto.agreedToRules) throw E.bad('RULES', 'Подтвердите согласие с правилами сделки');
    if (await this.settings.bool('app.maintenance')) throw E.locked('MAINTENANCE', 'Идут технические работы');
    const taker = await this.prisma.user.findUniqueOrThrow({ where: { id: takerId } });
    if (taker.status !== UserStatus.ACTIVE || taker.tradingFrozen) throw E.forbidden('Торговля ограничена для вашего аккаунта');
    if (taker.kycStatus !== KycStatus.APPROVED) throw E.forbidden('Для сделок нужна верификация (KYC)', );
    const ad = await this.prisma.ad.findUnique({ where: { id: dto.adId }, include: { user: true } });
    if (!ad || ad.status !== AdStatus.ACTIVE) throw E.notFound('Объявление');
    if (ad.userId === takerId) throw E.bad('OWN_AD', 'Нельзя торговать со своим объявлением');
    if (ad.user.status !== UserStatus.ACTIVE || ad.user.tradingFrozen) throw E.bad('AD_UNAVAILABLE', 'Объявление временно недоступно');
    if (ad.minCompletedOrders && taker.completedOrders < ad.minCompletedOrders) throw E.forbidden(`Продавец принимает только пользователей с ${ad.minCompletedOrders}+ сделками`);
    const bank = await this.prisma.bank.findUniqueOrThrow({ where: { code: ad.bankCode } });

    // bank → same bank rule: taker must own an account in the ad's bank
    const takerPm = dto.paymentMethodId
      ? await this.prisma.paymentMethod.findFirst({ where: { id: dto.paymentMethodId, userId: takerId, deletedAt: null, status: 'ACTIVE' } })
      : await this.prisma.paymentMethod.findFirst({ where: { userId: takerId, bankCode: ad.bankCode, deletedAt: null, status: 'ACTIVE' } });
    if (!takerPm || takerPm.bankCode !== ad.bankCode) throw E.bad('BANK_METHOD_REQUIRED', `Сделка идёт только ${bank.shortName} → ${bank.shortName}. Добавьте свой счёт ${bank.name} на своё имя.`, { bankCode: ad.bankCode });
    const advertiserPm = await this.prisma.paymentMethod.findFirst({ where: { userId: ad.userId, bankCode: ad.bankCode, deletedAt: null, status: 'ACTIVE' } });
    if (!advertiserPm) throw E.bad('AD_UNAVAILABLE', 'У контрагента нет активного счёта в этом банке');

    // amounts
    let amountFiat: Prisma.Decimal;
    let amountUsdt: Prisma.Decimal;
    if (dto.amountFiat) {
      amountFiat = kgs(dto.amountFiat);
      amountUsdt = usdt(amountFiat.div(ad.price));
    } else if (dto.amountUsdt) {
      amountUsdt = usdt(dto.amountUsdt);
      amountFiat = kgs(amountUsdt.mul(ad.price));
    } else throw E.bad('AMOUNT', 'Укажите сумму');
    if (amountFiat.lt(ad.minAmountFiat) || amountFiat.gt(ad.maxAmountFiat)) throw E.bad('LIMITS', `Сумма должна быть от ${formatAmount(dec(ad.minAmountFiat), 0)} до ${formatAmount(dec(ad.maxAmountFiat), 0)} KGS`);
    if (amountUsdt.gt(ad.availableAmount)) throw E.bad('LIMITS', `Доступно только ${ad.availableAmount} USDT`);
    const limits = await this.users.limits(taker.kycLevel);
    if (limits.p2pPerOrder && amountUsdt.gt(limits.p2pPerOrder)) throw E.bad('LIMITS', `Максимум ${limits.p2pPerOrder} USDT за сделку для вашего уровня`);
    const dayAgg = await this.prisma.order.aggregate({ where: { OR: [{ buyerId: takerId }, { sellerId: takerId }], createdAt: { gt: new Date(Date.now() - 86_400_000) }, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.EXPIRED] } }, _sum: { amountUsdt: true } });
    if (limits.p2pDaily && amountUsdt.plus(dayAgg._sum.amountUsdt ?? 0).gt(limits.p2pDaily)) throw E.bad('LIMITS', `Дневной лимит ${limits.p2pDaily} USDT исчерпан`);

    const sellerId = ad.side === AdSide.SELL ? ad.userId : takerId;
    const buyerId = ad.side === AdSide.SELL ? takerId : ad.userId;
    const sellerPm = ad.side === AdSide.SELL ? advertiserPm : takerPm;
    const buyerPm = ad.side === AdSide.SELL ? takerPm : advertiserPm;

    const verdict = await this.risk.evaluate({ userId: takerId, type: RiskEventType.ORDER_CREATE, amountUsdt: dec(amountUsdt), ip: ctx.ip, deviceId: ctx.deviceId, counterpartyId: ad.userId, refType: 'Ad', refId: ad.id });
    if (verdict.action === RiskAction.BLOCK) throw E.forbidden('Сделка отклонена службой безопасности. Обратитесь в поддержку.');

    const makerFee = await this.settings.num('fees.p2p_maker_percent');
    const takerFee = await this.settings.num('fees.p2p_taker_percent');
    // fee is charged from the buyer's received amount; maker/taker split depends on who buys
    const feePct = buyerId === ad.userId ? makerFee : takerFee;
    const fee = usdt(amountUsdt.mul(feePct).div(100));
    const expiresAt = new Date(Date.now() + ad.paymentWindowMin * 60_000);

    const order = await this.prisma.$transaction(async (tx) => {
      const freshAd = await tx.ad.findUniqueOrThrow({ where: { id: ad.id } });
      if (freshAd.availableAmount.lt(amountUsdt)) throw E.bad('LIMITS', 'Объём объявления изменился, обновите страницу');
      try {
        await this.ledger.lock(tx, sellerId, amountUsdt, 'ORDER_LOCK', 'pending', 'Эскроу по сделке');
      } catch (e) {
        if (sellerId === ad.userId) await tx.ad.update({ where: { id: ad.id }, data: { status: AdStatus.PAUSED } });
        throw E.bad('SELLER_FUNDS', sellerId === takerId ? 'Недостаточно USDT на вашем балансе' : 'У продавца недостаточно средств, объявление приостановлено');
      }
      const o = await tx.order.create({
        data: { adId: ad.id, buyerId, sellerId, amountUsdt, amountFiat, price: ad.price, feeUsdt: fee, bankCode: ad.bankCode, buyerPaymentMethodId: buyerPm.id, sellerPaymentMethodId: sellerPm.id, status: OrderStatus.CREATED, expiresAt, riskScore: verdict.score, riskSignals: verdict.signals as any },
      });
      await tx.ledgerEntry.updateMany({ where: { refType: 'ORDER_LOCK', refId: 'pending', userId: sellerId }, data: { refId: o.id } });
      await tx.ad.update({ where: { id: ad.id }, data: { availableAmount: { decrement: amountUsdt } } });
      await this.event(tx, o.id, 'CREATED', takerId === buyerId ? ActorType.BUYER : ActorType.SELLER, takerId, { amountUsdt: amountUsdt.toString(), amountFiat: amountFiat.toString(), price: ad.price.toString() });
      await this.event(tx, o.id, 'ESCROW_LOCKED', ActorType.SYSTEM, null, { amountUsdt: amountUsdt.toString(), sellerId });
      return o;
    });
    await this.prisma.riskEvent.update({ where: { id: verdict.eventId }, data: { refType: 'Order', refId: order.id } });
    await this.chat.system(order.id, `${this.time()} Сделка #${order.number} создана`);
    await this.chat.system(order.id, `${this.time()} ${amountUsdt} USDT заблокированы на эскроу`);
    if (ad.autoReply) await this.chat.send(order.id, ad.userId, ad.autoReply).catch(() => undefined);
    await this.audit.log({ actorType: 'USER', actorId: takerId, action: 'order.created', targetType: 'Order', targetId: order.id, meta: { number: order.number, amountUsdt: amountUsdt.toString(), amountFiat: amountFiat.toString(), risk: verdict.score }, ip: ctx.ip });
    const buyer = await this.prisma.user.findUniqueOrThrow({ where: { id: buyerId } });
    await this.notifications.notify({ userId: sellerId, title: `Новая сделка #${order.number}`, body: `Ожидайте ${formatAmount(dec(amountFiat), 0)} KGS от ${buyer.fullName} через ${bank.name}`, data: { orderId: order.id }, whatsapp: true, whatsappText: T.orderCreated(order.number, formatAmount(dec(amountFiat), 0), buyer.fullName ?? '', bank.name) });
    if (buyerId !== takerId) await this.notifications.notify({ userId: buyerId, title: `Новая сделка #${order.number}`, body: `Покупатель оформил сделку на ${amountUsdt} USDT. Переведите ${formatAmount(dec(amountFiat), 0)} KGS.`, data: { orderId: order.id }, whatsapp: true });
    this.gateway.emitOrder(order.id, { status: order.status }, [buyerId, sellerId]);
    return this.view(await this.load(order.id), takerId);
  }

  async list(userId: string, filter: 'active' | 'completed' | 'all' = 'all', page = 1, limit = 20) {
    const where: Prisma.OrderWhereInput = { OR: [{ buyerId: userId }, { sellerId: userId }] };
    if (filter === 'active') where.status = { in: ACTIVE };
    if (filter === 'completed') where.status = { notIn: ACTIVE };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({ where, include: INCLUDE, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.order.count({ where }),
    ]);
    const items = [];
    for (const r of rows) items.push(await this.view(r, userId));
    return { items, total, page, limit };
  }

  async get(userId: string, id: string) {
    return this.view(await this.load(id), userId);
  }

  async events(userId: string, id: string) {
    const o = await this.load(id);
    if (o.buyerId !== userId && o.sellerId !== userId) throw E.forbidden();
    return this.prisma.orderEvent.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } });
  }

  /** Protected "I paid" flow: bank ✓, own account ✓, exact amount ✓, receipt (optional but recommended). */
  async declarePayment(buyerId: string, id: string, dto: DeclarePaymentDto, ip?: string) {
    const o = await this.load(id);
    if (o.buyerId !== buyerId) throw E.forbidden();
    if (o.status !== OrderStatus.CREATED) throw E.conflict('STATE', 'Сделка не ожидает оплату');
    if (o.expiresAt < new Date()) throw E.conflict('EXPIRED', 'Время оплаты истекло');
    if (dto.bankCode !== o.bankCode) throw E.bad('BANK_MISMATCH', `Оплата должна быть с вашего счёта в ${o.bankCode}`);
    if (!dto.ownAccountConfirmed || !dto.exactAmountConfirmed || !dto.nameAndBankConfirmed) throw E.bad('CONFIRMATIONS', 'Подтвердите все пункты');
    if (dto.receiptFileId) {
      const f = await this.prisma.fileObject.findUnique({ where: { id: dto.receiptFileId } });
      if (!f || f.ownerId !== buyerId || f.kind !== 'RECEIPT') throw E.bad('RECEIPT', 'Чек не найден');
      if (f.scanStatus === 'INFECTED') throw E.bad('FILE_INFECTED', 'Файл отклонён антивирусом');
    }
    const declaration = { bankCode: dto.bankCode, ownAccountConfirmed: true, exactAmountConfirmed: true, nameAndBankConfirmed: true, receiptFileId: dto.receiptFileId ?? null, declaredAt: new Date().toISOString(), ip };
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: OrderStatus.PAID, paidAt: new Date(), paymentDeclaration: declaration } });
      await this.event(tx, id, 'PAYMENT_DECLARED', ActorType.BUYER, buyerId, declaration);
      if (dto.receiptFileId) await this.event(tx, id, 'RECEIPT_ATTACHED', ActorType.BUYER, buyerId, { fileId: dto.receiptFileId });
    });
    await this.chat.system(id, `${this.time()} Покупатель отметил оплату ${formatAmount(dec(o.amountFiat), 0)} KGS`);
    if (dto.receiptFileId) {
      await this.prisma.chatMessage.create({ data: { orderId: id, senderId: buyerId, type: 'IMAGE', fileId: dto.receiptFileId, text: 'Чек об оплате' } });
      await this.chat.system(id, `${this.time()} Покупатель приложил чек. Чек — не доказательство оплаты: проверьте поступление в приложении банка.`);
    }
    await this.audit.log({ actorType: 'USER', actorId: buyerId, action: 'order.payment_declared', targetType: 'Order', targetId: id, meta: declaration, ip });
    await this.notifications.notify({ userId: o.sellerId, title: `Оплата по сделке #${o.number}`, body: `${o.buyer.fullName} отметил оплату ${formatAmount(dec(o.amountFiat), 0)} KGS. Проверьте приложение банка.`, data: { orderId: id }, whatsapp: true, whatsappText: T.paymentDeclared(o.number, formatAmount(dec(o.amountFiat), 0), o.buyer.fullName ?? '') });
    this.gateway.emitOrder(id, { status: OrderStatus.PAID }, [o.buyerId, o.sellerId]);
    return this.view(await this.load(id), buyerId);
  }

  /** Seller release with explicit checklist, PIN step-up and OTP when the account is in a security cooldown. */
  async release(sellerId: string, id: string, dto: ReleaseDto, ctx: { ip?: string; deviceId?: string }) {
    const o = await this.load(id);
    if (o.sellerId !== sellerId) throw E.forbidden();
    if (o.status !== OrderStatus.PAID) throw E.conflict('STATE', 'Отпустить USDT можно только после отметки оплаты покупателем');
    if (!dto.checkedBankApp || !dto.senderNameMatches || !dto.amountMatches) throw E.bad('CONFIRMATIONS', 'Подтвердите все пункты проверки. Если ФИО или сумма не совпадают — откройте спор.');
    const seller = await this.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
    if (seller.status !== UserStatus.ACTIVE) throw E.forbidden('Операции ограничены');
    if ((await this.settings.bool('security.release_requires_pin')) && seller.pinHash) {
      if (!dto.stepUpToken || !this.tokens.verifyStepUp(dto.stepUpToken, sellerId)) throw E.bad('STEP_UP_REQUIRED', 'Подтвердите отпуск USDT PIN-кодом или Face ID', { stepUp: true });
    }
    const cooldown = seller.sensitiveOpsLockedUntil && seller.sensitiveOpsLockedUntil > new Date();
    const verdict = await this.risk.evaluate({ userId: sellerId, type: RiskEventType.ORDER_RELEASE, amountUsdt: dec(o.amountUsdt), ip: ctx.ip, deviceId: ctx.deviceId, counterpartyId: o.buyerId, refType: 'Order', refId: id });
    if (cooldown || verdict.action !== RiskAction.ALLOW) {
      if (!dto.otpCode) {
        const otp = await this.otp.issue(seller.phone, OtpPurpose.RELEASE, { ip: ctx.ip, meta: { orderId: id } });
        return { otpRequired: true, otp, reason: cooldown ? 'Вход с нового устройства: подтвердите отпуск кодом из WhatsApp' : 'Дополнительная проверка: подтвердите отпуск кодом из WhatsApp' };
      }
      await this.otp.verify(seller.phone, OtpPurpose.RELEASE, dto.otpCode);
    }
    const confirmation = { checkedBankApp: true, senderNameMatches: true, amountMatches: true, method: dto.stepUpToken ? 'PIN' : 'NONE', otp: !!dto.otpCode, at: new Date().toISOString(), ip: ctx.ip };
    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.order.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== OrderStatus.PAID) throw E.conflict('STATE', 'Состояние сделки изменилось');
      await this.ledger.releaseEscrow(tx, o.sellerId, o.buyerId, o.amountUsdt, o.feeUsdt, id);
      await tx.order.update({ where: { id }, data: { status: OrderStatus.RELEASED, releasedAt: new Date(), releaseConfirmation: confirmation } });
      await tx.ad.update({ where: { id: o.adId }, data: { completedCount: { increment: 1 } } });
      await tx.user.update({ where: { id: o.buyerId }, data: { completedOrders: { increment: 1 } } });
      await tx.user.update({ where: { id: o.sellerId }, data: { completedOrders: { increment: 1 } } });
      await this.event(tx, id, 'RELEASED', ActorType.SELLER, sellerId, confirmation);
    });
    await this.chat.system(id, `${this.time()} Продавец подтвердил получение денег`);
    await this.chat.system(id, `${this.time()} ${o.amountUsdt} USDT освобождены из эскроу и зачислены покупателю`);
    await this.audit.log({ actorType: 'USER', actorId: sellerId, action: 'order.released', targetType: 'Order', targetId: id, meta: confirmation, ip: ctx.ip });
    await this.notifications.notify({ userId: o.buyerId, title: `Сделка #${o.number} завершена`, body: `Вы получили ${o.amountUsdt.minus(o.feeUsdt)} USDT.`, data: { orderId: id }, whatsapp: true, whatsappText: T.released(o.number, o.amountUsdt.minus(o.feeUsdt).toString()) });
    this.gateway.emitOrder(id, { status: OrderStatus.RELEASED }, [o.buyerId, o.sellerId]);
    return { otpRequired: false, order: await this.view(await this.load(id), sellerId) };
  }

  async cancel(userId: string, id: string, reason?: string) {
    const o = await this.load(id);
    if (o.buyerId !== userId) throw E.forbidden('Отменить сделку может только покупатель до оплаты');
    if (o.status !== OrderStatus.CREATED) throw E.conflict('STATE', 'Сделку нельзя отменить на этом этапе');
    await this.refundAndClose(id, OrderStatus.CANCELLED, ActorType.BUYER, userId, reason ?? 'Отменено покупателем');
    await this.chat.system(id, `${this.time()} Сделка отменена покупателем. USDT возвращены продавцу.`);
    await this.notifications.notify({ userId: o.sellerId, title: `Сделка #${o.number} отменена`, body: 'Покупатель отменил сделку. USDT возвращены на баланс.', data: { orderId: id }, whatsapp: true, whatsappText: T.cancelled(o.number) });
    return this.view(await this.load(id), userId);
  }

  async refundAndClose(id: string, status: OrderStatus, actorType: ActorType, actorId: string | null, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      if (!ACTIVE.includes(o.status)) throw E.conflict('STATE', 'Сделка уже закрыта');
      await this.ledger.unlock(tx, o.sellerId, o.amountUsdt, status === OrderStatus.RESOLVED_REFUND ? 'ORDER_REFUND' : 'ORDER_UNLOCK', id, reason);
      await tx.order.update({ where: { id }, data: { status, cancelledAt: new Date(), cancelledBy: actorType, cancelReason: reason } });
      await tx.ad.update({ where: { id: o.adId }, data: { availableAmount: { increment: o.amountUsdt } } });
      await this.event(tx, id, status, actorType, actorId, { reason });
    });
    await this.audit.log({ actorType: actorType === ActorType.ADMIN ? 'ADMIN' : actorType === ActorType.SYSTEM ? 'SYSTEM' : 'USER', actorId, action: `order.${status.toLowerCase()}`, targetType: 'Order', targetId: id, meta: { reason } });
    const o = await this.load(id);
    this.gateway.emitOrder(id, { status }, [o.buyerId, o.sellerId]);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async expireOrders() {
    const expired = await this.prisma.order.findMany({ where: { status: OrderStatus.CREATED, expiresAt: { lt: new Date() } }, take: 50 });
    for (const o of expired) {
      try {
        await this.refundAndClose(o.id, OrderStatus.EXPIRED, ActorType.SYSTEM, null, 'Время оплаты истекло');
        await this.chat.system(o.id, `${this.time()} Время оплаты истекло. Сделка закрыта, USDT возвращены продавцу.`);
        await this.notifications.notify({ userId: o.buyerId, title: `Сделка #${o.number} истекла`, body: 'Вы не подтвердили оплату вовремя. Если вы уже перевели деньги — обратитесь в поддержку.', data: { orderId: o.id }, whatsapp: true });
        await this.notifications.notify({ userId: o.sellerId, title: `Сделка #${o.number} истекла`, body: 'USDT возвращены на ваш баланс.', data: { orderId: o.id } });
      } catch (e) {
        this.logger.warn(`expire ${o.id}: ${(e as Error).message}`);
      }
    }
  }

  async openDispute(userId: string, id: string, dto: OpenDisputeDto, ip?: string) {
    const o = await this.load(id);
    if (o.buyerId !== userId && o.sellerId !== userId) throw E.forbidden();
    if (o.status !== OrderStatus.PAID) throw E.conflict('STATE', 'Спор можно открыть после отметки оплаты');
    for (const fid of dto.evidenceFileIds ?? []) {
      const f = await this.prisma.fileObject.findUnique({ where: { id: fid } });
      if (!f || f.ownerId !== userId) throw E.bad('EVIDENCE', 'Файл недоступен');
    }
    const dispute = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.create({ data: { orderId: id, openedById: userId, reason: dto.reason, description: dto.description, evidenceFileIds: dto.evidenceFileIds ?? [] } });
      await tx.order.update({ where: { id }, data: { status: OrderStatus.DISPUTED, disputeId: d.id } });
      await tx.user.update({ where: { id: userId }, data: { disputesOpened: { increment: 1 } } });
      await this.event(tx, id, 'DISPUTE_OPENED', userId === o.buyerId ? ActorType.BUYER : ActorType.SELLER, userId, { reason: dto.reason, description: dto.description });
      return d;
    });
    await this.chat.system(id, `${this.time()} Открыт спор (${dto.reason}). USDT остаются в эскроу до решения арбитража Somex.`);
    await this.audit.log({ actorType: 'USER', actorId: userId, action: 'dispute.opened', targetType: 'Dispute', targetId: dispute.id, meta: { orderId: id, reason: dto.reason }, ip });
    const other = userId === o.buyerId ? o.sellerId : o.buyerId;
    await this.notifications.notify({ userId: other, title: `Спор по сделке #${o.number}`, body: 'Контрагент открыл спор. Ответьте в чате и приложите доказательства.', data: { orderId: id }, whatsapp: true, whatsappText: T.disputeOpened(o.number) });
    await this.notifications.adminAlert(`Новый спор по сделке #${o.number}`, `<p>${dto.reason}: ${dto.description}</p>`);
    this.gateway.emitOrder(id, { status: OrderStatus.DISPUTED }, [o.buyerId, o.sellerId]);
    return this.view(await this.load(id), userId);
  }

  async rate(userId: string, id: string, stars: number, comment?: string) {
    const o = await this.load(id);
    if (o.buyerId !== userId && o.sellerId !== userId) throw E.forbidden();
    if (!([OrderStatus.RELEASED, OrderStatus.RESOLVED_RELEASE, OrderStatus.RESOLVED_REFUND] as OrderStatus[]).includes(o.status)) throw E.conflict('STATE', 'Оценить можно завершённую сделку');
    const toUserId = userId === o.buyerId ? o.sellerId : o.buyerId;
    const existing = await this.prisma.rating.findUnique({ where: { orderId_fromUserId: { orderId: id, fromUserId: userId } } });
    if (existing) throw E.conflict('RATED', 'Вы уже оценили эту сделку');
    await this.prisma.$transaction(async (tx) => {
      await tx.rating.create({ data: { orderId: id, fromUserId: userId, toUserId, stars, comment } });
      await tx.user.update({ where: { id: toUserId }, data: { ratingSum: { increment: stars }, ratingCount: { increment: 1 } } });
    });
    return { ok: true };
  }

  /** Name self-check helper for the seller screen (bank apps show the sender's name). */
  checkSenderName(expected: string, observed: string) {
    return { matches: namesMatch(expected, observed) };
  }

  // ─── admin / arbitration ───
  async adminCancel(id: string, adminId: string, reason: string) {
    await this.refundAndClose(id, OrderStatus.CANCELLED, ActorType.ADMIN, adminId, reason);
    await this.chat.system(id, `${this.time()} Сделка отменена администратором: ${reason}`);
  }

  async resolveDispute(disputeId: string, adminId: string, resolution: 'RELEASE' | 'REFUND' | 'PARTIAL', note: string, buyerAmount?: string) {
    const d = await this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    const o = await this.load(d.orderId);
    if (o.status !== OrderStatus.DISPUTED) throw E.conflict('STATE', 'Сделка не в споре');
    await this.prisma.$transaction(async (tx) => {
      if (resolution === 'RELEASE') {
        await this.ledger.releaseEscrow(tx, o.sellerId, o.buyerId, o.amountUsdt, o.feeUsdt, o.id);
        await tx.order.update({ where: { id: o.id }, data: { status: OrderStatus.RESOLVED_RELEASE, releasedAt: new Date() } });
        await tx.user.update({ where: { id: o.sellerId }, data: { disputesLost: { increment: 1 } } });
        await tx.user.update({ where: { id: o.buyerId }, data: { completedOrders: { increment: 1 } } });
        await tx.dispute.update({ where: { id: disputeId }, data: { status: DisputeStatus.RESOLVED_RELEASE, resolvedById: adminId, resolution, resolutionNote: note, resolvedAt: new Date() } });
      } else if (resolution === 'REFUND') {
        await this.ledger.unlock(tx, o.sellerId, o.amountUsdt, 'ORDER_REFUND', o.id, 'Спор: возврат продавцу');
        await tx.order.update({ where: { id: o.id }, data: { status: OrderStatus.RESOLVED_REFUND, cancelledAt: new Date(), cancelledBy: ActorType.ADMIN, cancelReason: note } });
        await tx.ad.update({ where: { id: o.adId }, data: { availableAmount: { increment: o.amountUsdt } } });
        await tx.user.update({ where: { id: o.buyerId }, data: { disputesLost: { increment: 1 } } });
        await tx.dispute.update({ where: { id: disputeId }, data: { status: DisputeStatus.RESOLVED_REFUND, resolvedById: adminId, resolution, resolutionNote: note, resolvedAt: new Date() } });
      } else {
        const toBuyer = usdt(buyerAmount ?? '0');
        if (toBuyer.lte(0) || toBuyer.gte(o.amountUsdt)) throw E.bad('AMOUNT', 'Сумма покупателю должна быть между 0 и суммой сделки');
        await this.ledger.post(tx, {
          refType: 'ORDER_PARTIAL',
          refId: o.id,
          memo: `Спор: частичное решение (${note})`,
          entries: [
            { userId: o.sellerId, account: 'USER_LOCKED', delta: o.amountUsdt.negated() },
            { userId: o.buyerId, account: 'USER_AVAILABLE', delta: toBuyer },
            { userId: o.sellerId, account: 'USER_AVAILABLE', delta: o.amountUsdt.minus(toBuyer) },
          ],
        });
        await tx.order.update({ where: { id: o.id }, data: { status: OrderStatus.RESOLVED_RELEASE, releasedAt: new Date() } });
        await tx.dispute.update({ where: { id: disputeId }, data: { status: DisputeStatus.RESOLVED_PARTIAL, resolvedById: adminId, resolution, resolutionNote: note, buyerAmount: toBuyer, resolvedAt: new Date() } });
      }
      await this.event(tx, o.id, 'DISPUTE_RESOLVED', ActorType.ADMIN, adminId, { resolution, note, buyerAmount });
    });
    const text = resolution === 'RELEASE' ? 'USDT переданы покупателю.' : resolution === 'REFUND' ? 'USDT возвращены продавцу.' : `Частичное решение: ${buyerAmount} USDT покупателю.`;
    await this.chat.system(o.id, `${this.time()} Арбитраж Somex: ${text} ${note}`);
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'dispute.resolved', targetType: 'Dispute', targetId: disputeId, meta: { resolution, note, buyerAmount, orderId: o.id } });
    for (const uid of [o.buyerId, o.sellerId]) await this.notifications.notify({ userId: uid, title: `Спор по сделке #${o.number} решён`, body: text, data: { orderId: o.id }, whatsapp: true, whatsappText: T.disputeResolved(o.number, text) });
    const status = (await this.load(o.id)).status;
    this.gateway.emitOrder(o.id, { status }, [o.buyerId, o.sellerId]);
  }
}
