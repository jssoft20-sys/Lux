import { Injectable } from '@nestjs/common';
import { AdSide, AdStatus, KycStatus, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { E } from '../common/errors';
import { kgs, usdt, dec } from '../common/utils/money';
import { CreateAdDto, ListAdsDto, UpdateAdDto } from './dto/p2p.dto';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { compactAmount } from '@somex/shared';

@Injectable()
export class AdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async view(ad: Prisma.AdGetPayload<{ include: { user: true } }>, banks?: Map<string, any>) {
    const bank = banks?.get(ad.bankCode) ?? (await this.prisma.bank.findUnique({ where: { code: ad.bankCode } }));
    const card = await this.users.publicCard(ad.userId);
    return {
      id: ad.id,
      side: ad.side,
      /** what the viewer can do with this ad */
      action: ad.side === AdSide.SELL ? 'BUY' : 'SELL',
      price: ad.price.toString(),
      fiat: ad.fiat,
      asset: ad.asset,
      minAmountFiat: ad.minAmountFiat.toString(),
      maxAmountFiat: ad.maxAmountFiat.toString(),
      limitsLabel: `${compactAmount(dec(ad.minAmountFiat))} – ${compactAmount(dec(ad.maxAmountFiat))}`,
      availableAmount: ad.availableAmount.toString(),
      availableFiat: kgs(ad.availableAmount.mul(ad.price)).toString(),
      bankCode: ad.bankCode,
      bank: bank ? { code: bank.code, name: bank.name, shortName: bank.shortName, color: bank.color, logo: bank.logo, showsSenderName: bank.showsSenderName } : null,
      region: ad.region,
      terms: ad.terms,
      paymentWindowMin: ad.paymentWindowMin,
      verifiedOnly: ad.verifiedOnly,
      minCompletedOrders: ad.minCompletedOrders,
      status: ad.status,
      completedCount: ad.completedCount,
      advertiser: card,
      createdAt: ad.createdAt,
    };
  }

  async list(q: ListAdsDto, viewerId?: string) {
    const side = q.side === 'SELL' ? AdSide.BUY : AdSide.SELL; // viewer wants to SELL → show BUY ads
    const where: Prisma.AdWhereInput = { side, status: AdStatus.ACTIVE, availableAmount: { gt: 0 }, user: { status: UserStatus.ACTIVE, tradingFrozen: false } };
    if (q.bank) where.bankCode = q.bank;
    if (q.region && q.region !== 'ALL') where.region = { in: [q.region, 'ALL'] };
    if (q.amount) {
      const a = kgs(q.amount);
      where.minAmountFiat = { lte: a };
      where.maxAmountFiat = { gte: a };
    }
    if (q.priceMin) where.price = { ...(where.price as object), gte: new Prisma.Decimal(q.priceMin) };
    if (q.priceMax) where.price = { ...(where.price as object), lte: new Prisma.Decimal(q.priceMax) };
    if (q.online === '1' || q.online === 'true') where.user = { ...(where.user as object), lastSeenAt: { gt: new Date(Date.now() - 5 * 60_000) } };
    if (viewerId) where.userId = { not: viewerId };
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.ad.findMany({ where, include: { user: true }, orderBy: side === AdSide.SELL ? [{ price: 'asc' }, { completedCount: 'desc' }] : [{ price: 'desc' }, { completedCount: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.ad.count({ where }),
    ]);
    const banks = new Map((await this.prisma.bank.findMany()).map((b) => [b.code, b]));
    const items = [];
    for (const r of rows) {
      if (q.amount) {
        const a = kgs(q.amount);
        if (r.availableAmount.mul(r.price).lt(a)) continue;
      }
      items.push(await this.view(r, banks));
    }
    return { items, total, page, limit };
  }

  async get(id: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id }, include: { user: true } });
    if (!ad) throw E.notFound('Объявление');
    return this.view(ad);
  }

  async myAds(userId: string) {
    const rows = await this.prisma.ad.findMany({ where: { userId, status: { not: AdStatus.CLOSED } }, include: { user: true }, orderBy: { createdAt: 'desc' } });
    const banks = new Map((await this.prisma.bank.findMany()).map((b) => [b.code, b]));
    const out = [];
    for (const r of rows) out.push(await this.view(r, banks));
    return out;
  }

  private async assertCanPost(userId: string, bankCode: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== UserStatus.ACTIVE || user.tradingFrozen) throw E.forbidden('Торговля ограничена для вашего аккаунта');
    if (user.kycStatus !== KycStatus.APPROVED) throw E.forbidden('Для размещения объявлений нужна верификация (KYC)');
    const bank = await this.prisma.bank.findUnique({ where: { code: bankCode } });
    if (!bank?.enabled) throw E.bad('BANK', 'Банк не поддерживается');
    const pm = await this.prisma.paymentMethod.findFirst({ where: { userId, bankCode, deletedAt: null, status: 'ACTIVE' } });
    if (!pm) throw E.bad('BANK_METHOD_REQUIRED', `Сначала добавьте свой счёт в ${bank.name} — сделки идут только ${bank.shortName} → ${bank.shortName}`);
    return { user, bank, pm };
  }

  async create(userId: string, dto: CreateAdDto) {
    const { user } = await this.assertCanPost(userId, dto.bankCode);
    const price = new Prisma.Decimal(dto.price);
    const min = kgs(dto.minAmountFiat);
    const max = kgs(dto.maxAmountFiat);
    const total = usdt(dto.totalAmount);
    const orderMin = await this.settings.num('limits.order_min_fiat');
    if (price.lte(0) || price.gt(1000)) throw E.bad('PRICE', 'Некорректная цена');
    if (min.lt(orderMin)) throw E.bad('LIMITS', `Минимальная сумма сделки ${orderMin} KGS`);
    if (max.lt(min)) throw E.bad('LIMITS', 'Максимум должен быть больше минимума');
    if (total.lte(0)) throw E.bad('AMOUNT', 'Укажите объём USDT');
    if (max.gt(total.mul(price))) throw E.bad('LIMITS', 'Максимум сделки превышает объём объявления');
    const limits = await this.users.limits(user.kycLevel);
    if (limits.p2pPerOrder && max.div(price).gt(limits.p2pPerOrder)) throw E.bad('LIMITS', `Максимум сделки для вашего уровня — ${limits.p2pPerOrder} USDT`);
    if (dto.side === 'SELL') {
      const bal = await this.prisma.balance.findUnique({ where: { userId } });
      if (!bal || bal.available.lt(total)) throw E.bad('INSUFFICIENT_FUNDS', 'Недостаточно USDT на балансе для этого объявления');
    }
    const ad = await this.prisma.ad.create({
      data: {
        userId,
        side: dto.side as AdSide,
        price,
        minAmountFiat: min,
        maxAmountFiat: max,
        totalAmount: total,
        availableAmount: total,
        bankCode: dto.bankCode,
        region: dto.region ?? 'ALL',
        terms: dto.terms,
        autoReply: dto.autoReply,
        paymentWindowMin: dto.paymentWindowMin ?? (await this.settings.num('limits.order_payment_window_min')),
        minCompletedOrders: dto.minCompletedOrders ?? 0,
      },
      include: { user: true },
    });
    await this.audit.log({ actorType: 'USER', actorId: userId, action: 'ad.created', targetType: 'Ad', targetId: ad.id, after: { side: ad.side, price: ad.price.toString(), total: ad.totalAmount.toString(), bank: ad.bankCode } });
    return this.view(ad);
  }

  async update(userId: string, id: string, dto: UpdateAdDto) {
    const ad = await this.prisma.ad.findFirst({ where: { id, userId } });
    if (!ad) throw E.notFound('Объявление');
    if (ad.status === AdStatus.CLOSED) throw E.conflict('CLOSED', 'Объявление закрыто');
    const data: Prisma.AdUpdateInput = {};
    if (dto.price) data.price = new Prisma.Decimal(dto.price);
    if (dto.minAmountFiat) data.minAmountFiat = kgs(dto.minAmountFiat);
    if (dto.maxAmountFiat) data.maxAmountFiat = kgs(dto.maxAmountFiat);
    if (dto.totalAmount) {
      const used = ad.totalAmount.minus(ad.availableAmount);
      const total = usdt(dto.totalAmount);
      if (total.lt(used)) throw E.bad('AMOUNT', 'Объём меньше уже проданного');
      data.totalAmount = total;
      data.availableAmount = total.minus(used);
    }
    if (dto.terms !== undefined) data.terms = dto.terms;
    if (dto.autoReply !== undefined) data.autoReply = dto.autoReply;
    if (dto.status) {
      if (dto.status === 'CLOSED') {
        const active = await this.prisma.order.count({ where: { adId: id, status: { in: ['CREATED', 'PAID', 'DISPUTED'] } } });
        if (active) throw E.conflict('ACTIVE_ORDERS', 'Есть активные сделки по объявлению');
      }
      data.status = dto.status as AdStatus;
    }
    const updated = await this.prisma.ad.update({ where: { id }, data, include: { user: true } });
    return this.view(updated);
  }
}
