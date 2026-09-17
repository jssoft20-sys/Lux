import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { BlacklistType, DisputeStatus, KycLevel, UserStatus } from '@prisma/client';
import { AdminScope } from '../../common/decorators/admin-scope.decorator';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { Roles } from '../../common/decorators/public.decorator';
import { AuthAdmin, CurrentAdmin } from '../../common/decorators/current-user.decorator';
import { AdminService } from '../admin.service';
import { AdminListQuery, BalanceAdjustDto, BankUpdateDto, BlacklistDto, KycDecisionDto, KycRejectDto, NoteDto, RateDto, ReasonDto, ResolveDisputeDto, RiskReviewDto, RiskRuleDto, SimulateDepositDto, TicketAnswerDto, UserLimitsDto } from '../dto/admin.dto';
import { KycService } from '../../kyc/kyc.service';
import { DepositsService } from '../../wallet/deposits.service';
import { WithdrawalsService } from '../../wallet/withdrawals.service';
import { OrdersService } from '../../p2p/orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BlacklistService } from '../../risk/blacklist.service';
import { AuditService } from '../../audit/audit.service';
import { E } from '../../common/errors';
import { FilesService } from '../../files/files.service';
import { LedgerService } from '../../wallet/ledger.service';
import { Prisma } from '@prisma/client';
import { normalizeKgPhone } from '@somex/shared';

@AdminScope()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminMainController {
  constructor(
    private readonly admin: AdminService,
    private readonly kyc: KycService,
    private readonly deposits: DepositsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
    private readonly blacklist: BlacklistService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly ledger: LedgerService,
  ) {}

  // ─── dashboard ───
  @Get('dashboard/stats') stats() { return this.admin.stats(); }
  @Get('dashboard/charts') charts(@Query('days') days?: string) { return this.admin.charts(Math.min(90, Number(days) || 14)); }
  @Get('dashboard/activity') activity() { return this.admin.activity(); }

  // ─── users ───
  @Get('users') users(@Query() q: AdminListQuery) { return this.admin.users(q); }
  @Get('users/:id') user(@Param('id') id: string) { return this.admin.user(id); }
  @Roles('COMPLIANCE', 'RISK', 'SUPPORT') @Post('users/:id/freeze') @HttpCode(200) async freeze(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: ReasonDto) { await this.admin.setUserStatus(id, UserStatus.FROZEN, a.id, dto.reason); return { ok: true }; }
  @Roles('COMPLIANCE', 'RISK') @Post('users/:id/restrict') @HttpCode(200) async restrict(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: ReasonDto) { await this.admin.setUserStatus(id, UserStatus.RESTRICTED, a.id, dto.reason); return { ok: true }; }
  @Roles('COMPLIANCE', 'RISK') @Post('users/:id/ban') @HttpCode(200) async ban(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: ReasonDto) { await this.admin.setUserStatus(id, UserStatus.BANNED, a.id, dto.reason); return { ok: true }; }
  @Roles('COMPLIANCE', 'RISK') @Post('users/:id/unfreeze') @HttpCode(200) async unfreeze(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: ReasonDto) { await this.admin.setUserStatus(id, UserStatus.ACTIVE, a.id, dto.reason); return { ok: true }; }
  @Roles('COMPLIANCE', 'RISK') @Post('users/:id/flags') @HttpCode(200) async flags(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: UserLimitsDto) { await this.admin.setUserFlags(id, a.id, dto); return { ok: true }; }
  @Roles('COMPLIANCE', 'RISK', 'SUPPORT') @Post('users/:id/force-logout') @HttpCode(200) async forceLogout(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) { await this.admin.forceLogout(id, a.id); return { ok: true }; }
  @Roles('COMPLIANCE', 'RISK', 'SUPPORT') @Post('users/:id/reset-devices') @HttpCode(200) async resetDevices(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) { await this.admin.resetDevices(id, a.id); return { ok: true }; }
  @Roles('SUPPORT', 'COMPLIANCE', 'RISK') @Post('users/:id/clear-cooldown') @HttpCode(200) async clearCooldown(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) { await this.admin.clearCooldown(id, a.id); return { ok: true }; }
  @Roles('SUPPORT', 'COMPLIANCE') @Post('users/:id/reset-pin') @HttpCode(200) async resetPin(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) { await this.admin.resetPin(id, a.id); return { ok: true }; }
  @Post('users/:id/note') @HttpCode(200) async note(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: NoteDto) { await this.admin.note(id, a.id, dto.note ?? ''); return { ok: true }; }
  @Roles('FINANCE') @Post('users/:id/balance-adjust') @HttpCode(200) async adjust(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: BalanceAdjustDto) { await this.admin.adjustBalance(id, a.id, dto.delta, dto.reason); return { ok: true }; }

  // ─── kyc ───
  @Get('kyc') kycList(@Query() q: AdminListQuery) { return this.admin.kycList(q); }
  @Get('kyc/:id') kycDetail(@Param('id') id: string) { return this.admin.kycDetail(id); }
  @Roles('COMPLIANCE') @Post('kyc/:id/approve') @HttpCode(200) async kycApprove(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: KycDecisionDto) {
    const v = await this.prisma.kycVerification.findUniqueOrThrow({ where: { id } });
    await this.kyc.approve(id, v.userId, null, a.id, dto.note, (dto.level as KycLevel) ?? KycLevel.VERIFIED);
    return { ok: true };
  }
  @Roles('COMPLIANCE') @Post('kyc/:id/reject') @HttpCode(200) async kycReject(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: KycRejectDto) {
    const v = await this.prisma.kycVerification.findUniqueOrThrow({ where: { id } });
    await this.kyc.decline(id, v.userId, dto.reason, undefined, a.id);
    return { ok: true };
  }
  @Roles('COMPLIANCE') @Post('users/:id/kyc-level') @HttpCode(200) async kycLevel(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: KycDecisionDto) { await this.kyc.setLevel(id, (dto.level as KycLevel) ?? KycLevel.VERIFIED, a.id, dto.note); return { ok: true }; }

  // ─── wallet / aml ───
  @Get('wallet') wallet() { return this.admin.walletOverview(); }
  @Get('wallet/ledger') ledger_(@Query() q: AdminListQuery) { return this.admin.ledger_(q); }
  @Get('wallet/reconcile') reconcile() { return this.ledger.reconcile(); }
  @Roles('FINANCE') @Post('wallet/hot/sync') @HttpCode(200) syncHot(@CurrentAdmin() a: AuthAdmin) { return this.admin.syncHotWallet(a.id); }
  @Roles('FINANCE') @Post('wallet/hot/limits') @HttpCode(200) hotLimits(@CurrentAdmin() a: AuthAdmin, @Body() dto: { dailyLimit?: string; singleLimit?: string; frozen?: boolean }) { return this.admin.setHotWalletLimits(a.id, dto); }
  @Get('deposits') deposits_(@Query() q: AdminListQuery) { return this.admin.deposits(q); }
  @Roles('COMPLIANCE', 'FINANCE') @Post('deposits/:id/release') @HttpCode(200) async releaseDeposit(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: NoteDto) {
    await this.deposits.credit(id, { risk: 'REVIEWED', note: dto.note }, a.id);
    return { ok: true };
  }
  @Roles('COMPLIANCE', 'FINANCE') @Post('deposits/:id/reject') @HttpCode(200) async rejectDeposit(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: ReasonDto) { await this.deposits.reject(id, a.id, dto.reason); return { ok: true }; }
  @Get('withdrawals') withdrawals_(@Query() q: AdminListQuery) { return this.admin.withdrawals(q); }
  @Roles('FINANCE', 'RISK', 'COMPLIANCE') @Post('withdrawals/:id/approve') @HttpCode(200) async approveW(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: NoteDto) { await this.withdrawals.approve(id, a.id, dto.note); return { ok: true }; }
  @Roles('FINANCE', 'RISK', 'COMPLIANCE') @Post('withdrawals/:id/reject') @HttpCode(200) async rejectW(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: ReasonDto) { await this.withdrawals.reject(id, a.id, dto.reason); return { ok: true }; }
  @Roles('FINANCE') @Post('withdrawals/:id/retry') @HttpCode(200) async retryW(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) { await this.withdrawals.retry(id, a.id); return { ok: true }; }

  // ─── p2p ───
  @Get('p2p/ads') ads(@Query() q: AdminListQuery) { return this.admin.ads(q); }
  @Roles('COMPLIANCE', 'RISK', 'SUPPORT') @Post('p2p/ads/:id/status') @HttpCode(200) async adStatus(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: { status: 'ACTIVE' | 'PAUSED' | 'CLOSED'; reason?: string }) {
    await this.prisma.ad.update({ where: { id }, data: { status: dto.status } });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: `ad.${dto.status.toLowerCase()}`, targetType: 'Ad', targetId: id, meta: { reason: dto.reason } });
    return { ok: true };
  }
  @Get('p2p/orders') orders_(@Query() q: AdminListQuery) { return this.admin.orders(q); }
  @Get('p2p/orders/:id') async order(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) {
    const o = await this.orders.load(id);
    const [view, events, messages] = await Promise.all([this.orders.view(o, a.id, { admin: true }), this.prisma.orderEvent.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } }), this.prisma.chatMessage.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } })]);
    return { ...view, events, messages, buyerUser: { id: o.buyer.id, phone: o.buyer.phone, fullName: o.buyer.fullName, riskScore: o.buyer.riskScore, status: o.buyer.status }, sellerUser: { id: o.seller.id, phone: o.seller.phone, fullName: o.seller.fullName, riskScore: o.seller.riskScore, status: o.seller.status } };
  }
  @Roles('COMPLIANCE', 'RISK', 'SUPPORT') @Post('p2p/orders/:id/cancel') @HttpCode(200) async cancelOrder(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: ReasonDto) { await this.orders.adminCancel(id, a.id, dto.reason); return { ok: true }; }
  @Get('disputes') disputes(@Query() q: AdminListQuery) { return this.admin.disputes(q); }
  @Get('disputes/:id') async dispute(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) {
    const d = await this.prisma.dispute.findUnique({ where: { id }, include: { openedBy: { select: { id: true, phone: true, fullName: true } } } });
    if (!d) throw E.notFound('Спор');
    const order = await this.order(a, d.orderId);
    return { ...d, buyerAmount: d.buyerAmount?.toString(), order };
  }
  @Roles('COMPLIANCE', 'SUPPORT') @Post('disputes/:id/assign') @HttpCode(200) async assign(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) {
    await this.prisma.dispute.update({ where: { id }, data: { assignedToId: a.id, status: DisputeStatus.UNDER_REVIEW } });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: 'dispute.assigned', targetType: 'Dispute', targetId: id });
    return { ok: true };
  }
  @Roles('COMPLIANCE') @Post('disputes/:id/resolve') @HttpCode(200) async resolve(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: ResolveDisputeDto) { await this.orders.resolveDispute(id, a.id, dto.resolution, dto.note, dto.buyerAmount); return { ok: true }; }

  // ─── risk ───
  @Get('risk/events') riskEvents(@Query() q: AdminListQuery) { return this.admin.riskEvents(q); }
  @Roles('RISK', 'COMPLIANCE') @Post('risk/events/:id/review') @HttpCode(200) async reviewRisk(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: RiskReviewDto) {
    await this.prisma.riskEvent.update({ where: { id }, data: { reviewStatus: dto.status as any, reviewedById: a.id, reviewNote: dto.note, reviewedAt: new Date() } });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: 'risk.reviewed', targetType: 'RiskEvent', targetId: id, after: dto });
    return { ok: true };
  }
  @Get('risk/rules') riskRules() { return this.prisma.riskRule.findMany({ orderBy: { code: 'asc' } }); }
  @Roles('RISK') @Patch('risk/rules/:code') async updateRule(@CurrentAdmin() a: AuthAdmin, @Param('code') code: string, @Body() dto: RiskRuleDto) {
    const before = await this.prisma.riskRule.findUniqueOrThrow({ where: { code } });
    const r = await this.prisma.riskRule.update({ where: { code }, data: { weight: dto.weight, enabled: dto.enabled, params: dto.params as any } });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: 'risk.rule_updated', targetType: 'RiskRule', targetId: code, before: { weight: before.weight, enabled: before.enabled }, after: { weight: r.weight, enabled: r.enabled } });
    return r;
  }
  @Get('devices') devices(@Query() q: AdminListQuery) { return this.admin.devices(q); }
  @Get('devices/clusters') clusters() { return this.admin.deviceClusters(); }
  @Roles('RISK', 'COMPLIANCE') @Post('devices/:id/block') @HttpCode(200) async blockDevice(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: { blocked: boolean }) { await this.admin.blockDevice(id, a.id, !!dto.blocked); return { ok: true }; }
  @Get('blacklist') async blacklist_(@Query() q: AdminListQuery) {
    const where: Prisma.BlacklistEntryWhereInput = q.type ? { type: q.type as BlacklistType } : {};
    const items = await this.prisma.blacklistEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
    return { items, total: items.length };
  }
  @Roles('RISK', 'COMPLIANCE') @Post('blacklist') async addBlacklist(@CurrentAdmin() a: AuthAdmin, @Body() dto: BlacklistDto) {
    const row = await this.blacklist.add(dto.type as BlacklistType, dto.value, dto.reason, a.id, 'manual', dto.expiresAt ? new Date(dto.expiresAt) : undefined);
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: 'blacklist.added', targetType: 'BlacklistEntry', targetId: row.id, after: { type: dto.type, masked: row.valueMasked, reason: dto.reason } });
    return row;
  }
  @Roles('RISK', 'COMPLIANCE') @Delete('blacklist/:id') async removeBlacklist(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) {
    await this.blacklist.remove(id);
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: 'blacklist.removed', targetType: 'BlacklistEntry', targetId: id });
    return { ok: true };
  }
  @Post('blacklist/check') @HttpCode(200) async checkBlacklist(@Body() dto: { type: string; value: string }) { return { listed: await this.blacklist.isListed(dto.type as BlacklistType, dto.value) }; }

  // ─── audit ───
  @Get('audit') auditList(@Query() q: AdminListQuery) { return this.admin.audit_(q); }
  @Get('audit/verify') verifyAudit() { return this.audit.verifyChain(); }

  // ─── catalog ───
  @Get('banks') banks() { return this.prisma.bank.findMany({ orderBy: { order: 'asc' } }); }
  @Patch('banks/:code') async updateBank(@CurrentAdmin() a: AuthAdmin, @Param('code') code: string, @Body() dto: BankUpdateDto) {
    const b = await this.prisma.bank.update({ where: { code }, data: dto });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: 'bank.updated', targetType: 'Bank', targetId: code, after: dto });
    return b;
  }
  @Get('rates') rates() { return this.prisma.rate.findMany(); }
  @Roles('FINANCE') @Post('rates/USDT-KGS') @HttpCode(200) async setRate(@CurrentAdmin() a: AuthAdmin, @Body() dto: RateDto) {
    const r = await this.prisma.rate.upsert({ where: { asset_fiat: { asset: 'USDT', fiat: 'KGS' } }, create: { asset: 'USDT', fiat: 'KGS', price: dto.price, source: 'manual' }, update: { price: dto.price, source: 'manual' } });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: 'rate.updated', after: { price: dto.price } });
    return { ...r, price: r.price.toString() };
  }

  // ─── support ───
  @Get('support') tickets(@Query() q: AdminListQuery) { return this.admin.supportTickets(q); }
  @Roles('SUPPORT', 'COMPLIANCE') @Post('support/:id/answer') @HttpCode(200) async answer(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: TicketAnswerDto) {
    const t = await this.prisma.supportTicket.update({ where: { id }, data: { answer: dto.answer, answeredById: a.id, status: (dto.status as any) ?? 'ANSWERED' } });
    await this.prisma.notification.create({ data: { userId: t.userId, channel: 'INAPP', title: `Ответ поддержки: ${t.subject}`, body: dto.answer, status: 'SENT', sentAt: new Date() } });
    return { ok: true };
  }

  // ─── files ───
  @Get('files/:id') async file(@Param('id') id: string, @Res() res: Response) {
    const { file, stream } = await this.files.stream(id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="${file.id}"`);
    stream.pipe(res);
  }

  // ─── dev helpers (only with DEV_SIMULATE_CHAIN=true) ───
  @Roles('FINANCE') @Post('dev/simulate-deposit') @HttpCode(200) async simulateDeposit(@CurrentAdmin() a: AuthAdmin, @Body() dto: SimulateDepositDto) {
    let userId = dto.userId;
    if (!userId && dto.phone) {
      const phone = normalizeKgPhone(dto.phone);
      const u = phone ? await this.prisma.user.findUnique({ where: { phone }, select: { id: true } }) : null;
      if (!u) throw E.notFound('Пользователь');
      userId = u.id;
    }
    if (!userId) throw E.bad('USER', 'Укажите userId или phone');
    const d = await this.deposits.simulate(userId, dto.amount, dto.fromAddress);
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, action: 'dev.simulate_deposit', targetType: 'Deposit', targetId: d.id, meta: dto });
    return { ...d, amount: d.amount.toString(), blockNumber: d.blockNumber?.toString() };
  }
}
