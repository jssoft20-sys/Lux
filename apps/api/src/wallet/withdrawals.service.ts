import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KycStatus, Network, OtpPurpose, Prisma, RiskAction, RiskEventType, UserStatus, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { TronService } from './chain/tron.service';
import { SettingsService } from '../settings/settings.service';
import { RiskEngineService } from '../risk/risk-engine.service';
import { OtpService } from '../auth/otp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { TokenService } from '../auth/token.service';
import { E } from '../common/errors';
import { dec, usdt } from '../common/utils/money';
import { T } from '../notifications/templates';

const ACTIVE: WithdrawalStatus[] = [WithdrawalStatus.AWAITING_OTP, WithdrawalStatus.RISK_REVIEW, WithdrawalStatus.APPROVAL_REQUIRED, WithdrawalStatus.APPROVED, WithdrawalStatus.BROADCASTING, WithdrawalStatus.SENT];

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly tron: TronService,
    private readonly settings: SettingsService,
    private readonly risk: RiskEngineService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  view(w: Prisma.WithdrawalGetPayload<object>) {
    return { id: w.id, network: w.network, toAddress: w.toAddress, amount: w.amount.toString(), fee: w.fee.toString(), netAmount: w.netAmount.toString(), status: w.status, txHash: w.txHash, riskAction: w.riskAction, rejectedReason: w.rejectedReason ?? w.failureReason, createdAt: w.createdAt, broadcastAt: w.broadcastAt, confirmedAt: w.confirmedAt };
  }

  async quote(userId: string, amountStr: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { balance: true } });
    const amount = usdt(amountStr);
    const [fee, min] = await Promise.all([this.settings.num('fees.withdrawal_usdt'), this.settings.num('limits.withdrawal_min_usdt')]);
    const limits = await this.users.limits(user.kycLevel);
    const since = new Date(Date.now() - 86_400_000);
    const todayAgg = await this.prisma.withdrawal.aggregate({ where: { userId, createdAt: { gt: since }, status: { notIn: [WithdrawalStatus.CANCELLED, WithdrawalStatus.REJECTED, WithdrawalStatus.FAILED] } }, _sum: { amount: true } });
    const usedToday = dec(todayAgg._sum.amount);
    const available = dec(user.balance?.available);
    const problems: string[] = [];
    if (user.kycStatus !== KycStatus.APPROVED) problems.push('Требуется верификация (KYC)');
    if (amount.lt(min)) problems.push(`Минимальная сумма ${min} USDT`);
    if (amount.lte(fee)) problems.push('Сумма должна превышать комиссию');
    if (amount.gt(available)) problems.push('Недостаточно средств');
    if (limits.withdrawSingle && amount.gt(limits.withdrawSingle)) problems.push(`Максимум за раз ${limits.withdrawSingle} USDT для вашего уровня`);
    if (limits.withdrawDaily && amount.plus(usedToday).gt(limits.withdrawDaily)) problems.push(`Дневной лимит ${limits.withdrawDaily} USDT (использовано ${usedToday})`);
    if (user.withdrawalsFrozen || (await this.settings.bool('wallet.withdrawals_frozen'))) problems.push('Выводы временно приостановлены');
    if (user.sensitiveOpsLockedUntil && user.sensitiveOpsLockedUntil > new Date()) problems.push(`Вывод ограничен до ${user.sensitiveOpsLockedUntil.toLocaleString('ru-RU')} после входа с нового устройства`);
    return { amount: amount.toString(), fee: fee.toFixed(6), netAmount: amount.minus(fee).toString(), available: available.toFixed(6), usedToday: usedToday.toFixed(2), limits, otpRequired: await this.settings.bool('security.withdraw_requires_otp'), pinRequired: await this.settings.bool('security.release_requires_pin'), ok: problems.length === 0, problems };
  }

  async create(userId: string, dto: { network: 'TRON'; address: string; amount: string; label?: string; stepUpToken?: string }, ctx: { ip?: string; deviceId?: string; idempotencyKey?: string }) {
    if (ctx.idempotencyKey) {
      const dup = await this.prisma.withdrawal.findUnique({ where: { idempotencyKey: ctx.idempotencyKey } });
      if (dup) return { withdrawal: this.view(dup), otpRequired: dup.status === WithdrawalStatus.AWAITING_OTP };
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== UserStatus.ACTIVE) throw E.forbidden('Операции ограничены');
    if (!TronService.isAddress(dto.address)) throw E.bad('ADDRESS', 'Неверный TRON-адрес');
    const depositAddr = await this.prisma.depositAddress.findFirst({ where: { address: dto.address } });
    if (depositAddr) throw E.bad('ADDRESS', 'Это внутренний адрес Somex. Используйте перевод внутри платформы или другой адрес.');
    const q = await this.quote(userId, dto.amount);
    if (!q.ok) throw E.bad('WITHDRAW_NOT_ALLOWED', q.problems[0], { problems: q.problems });
    if (q.pinRequired && user.pinHash) {
      if (!dto.stepUpToken || !this.tokens.verifyStepUp(dto.stepUpToken, userId)) throw E.bad('STEP_UP_REQUIRED', 'Подтвердите операцию PIN-кодом', { stepUp: true });
    }

    const amount = usdt(dto.amount);
    const fee = usdt(q.fee);
    const verdict = await this.risk.evaluate({ userId, type: RiskEventType.WITHDRAWAL, amountUsdt: dec(amount), ip: ctx.ip, deviceId: ctx.deviceId, withdrawAddress: dto.address, network: dto.network });
    const otpRequired = q.otpRequired;

    const w = await this.prisma.$transaction(async (tx) => {
      const row = await tx.withdrawal.create({
        data: {
          userId,
          network: Network.TRON,
          toAddress: dto.address,
          amount,
          fee,
          netAmount: amount.minus(fee),
          status: otpRequired ? WithdrawalStatus.AWAITING_OTP : await this.nextStatusAfterAuth(verdict.action, dec(amount)),
          riskScore: verdict.score,
          riskSignals: verdict.signals as any,
          riskAction: verdict.action,
          otpVerifiedAt: otpRequired ? null : new Date(),
          idempotencyKey: ctx.idempotencyKey,
          deviceId: ctx.deviceId,
          ip: ctx.ip,
        },
      });
      await this.ledger.lock(tx, userId, amount, 'WITHDRAWAL_LOCK', row.id, 'Резерв под вывод');
      await tx.withdrawAddress.upsert({ where: { userId_network_address: { userId, network: Network.TRON, address: dto.address } }, create: { userId, network: Network.TRON, address: dto.address, label: dto.label }, update: { usageCount: { increment: 1 }, label: dto.label ?? undefined } });
      return row;
    });
    await this.prisma.riskEvent.updateMany({ where: { id: verdict.eventId }, data: { refType: 'Withdrawal', refId: w.id } });
    await this.audit.log({ actorType: 'USER', actorId: userId, action: 'withdrawal.created', targetType: 'Withdrawal', targetId: w.id, meta: { amount: amount.toString(), address: dto.address, risk: verdict.score, action: verdict.action }, ip: ctx.ip });

    let otp: unknown;
    if (otpRequired) otp = await this.otp.issue(user.phone, OtpPurpose.WITHDRAW, { ip: ctx.ip, meta: { withdrawalId: w.id } });
    return { withdrawal: this.view(w), otpRequired, otp };
  }

  private async nextStatusAfterAuth(action: RiskAction, amount: number): Promise<WithdrawalStatus> {
    if (action === RiskAction.BLOCK) return WithdrawalStatus.RISK_REVIEW;
    const autoMax = await this.settings.num('limits.withdraw_auto_approve_max_usdt');
    if (action === RiskAction.REVIEW || amount > autoMax) return WithdrawalStatus.APPROVAL_REQUIRED;
    return WithdrawalStatus.APPROVED;
  }

  async confirm(userId: string, id: string, code: string) {
    const w = await this.prisma.withdrawal.findFirst({ where: { id, userId } });
    if (!w) throw E.notFound('Вывод');
    if (w.status !== WithdrawalStatus.AWAITING_OTP) throw E.conflict('STATE', 'Вывод уже подтверждён');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.otp.verify(user.phone, OtpPurpose.WITHDRAW, code);
    const status = await this.nextStatusAfterAuth(w.riskAction, dec(w.amount));
    const updated = await this.prisma.withdrawal.update({ where: { id }, data: { status, otpVerifiedAt: new Date() } });
    if (status !== WithdrawalStatus.APPROVED) {
      await this.notifications.adminAlert(`Вывод требует решения (${status})`, `<p>${w.amount} USDT → ${w.toAddress}</p><p>risk ${w.riskScore} ${w.riskAction}</p>`);
    }
    return { withdrawal: this.view(updated), message: status === WithdrawalStatus.APPROVED ? 'Вывод принят в обработку' : status === WithdrawalStatus.RISK_REVIEW ? 'Вывод отправлен на проверку службой безопасности' : 'Вывод ожидает одобрения' };
  }

  async cancel(userId: string, id: string) {
    const w = await this.prisma.withdrawal.findFirst({ where: { id, userId } });
    if (!w) throw E.notFound('Вывод');
    if (!([WithdrawalStatus.AWAITING_OTP, WithdrawalStatus.APPROVAL_REQUIRED, WithdrawalStatus.RISK_REVIEW] as WithdrawalStatus[]).includes(w.status)) throw E.conflict('STATE', 'Вывод уже нельзя отменить');
    await this.releaseLock(id, WithdrawalStatus.CANCELLED, 'Отменено пользователем');
    return { ok: true };
  }

  private async releaseLock(id: string, status: WithdrawalStatus, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const w = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
      if (!ACTIVE.includes(w.status) || w.status === WithdrawalStatus.SENT) throw E.conflict('STATE', 'Неверное состояние вывода');
      await this.ledger.unlock(tx, w.userId, w.amount, 'WITHDRAWAL_UNLOCK', w.id, reason);
      await tx.withdrawal.update({ where: { id }, data: { status, rejectedReason: status === WithdrawalStatus.REJECTED ? reason : undefined, failureReason: status === WithdrawalStatus.FAILED ? reason : undefined } });
    });
  }

  async list(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.withdrawal.count({ where: { userId } }),
    ]);
    return { items: items.map((w) => this.view(w)), total, page, limit };
  }

  async addressBook(userId: string) {
    return this.prisma.withdrawAddress.findMany({ where: { userId }, orderBy: { firstUsedAt: 'desc' } });
  }

  // ─── admin ───
  async approve(id: string, adminId: string, note?: string) {
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    if (!([WithdrawalStatus.APPROVAL_REQUIRED, WithdrawalStatus.RISK_REVIEW] as WithdrawalStatus[]).includes(w.status)) throw E.conflict('STATE', 'Вывод не ожидает одобрения');
    await this.prisma.withdrawal.update({ where: { id }, data: { status: WithdrawalStatus.APPROVED, approvedById: adminId, approvedAt: new Date() } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'withdrawal.approved', targetType: 'Withdrawal', targetId: id, meta: { note, amount: w.amount.toString() } });
  }

  async reject(id: string, adminId: string, reason: string) {
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    await this.releaseLock(id, WithdrawalStatus.REJECTED, reason);
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'withdrawal.rejected', targetType: 'Withdrawal', targetId: id, meta: { reason } });
    await this.notifications.notify({ userId: w.userId, title: 'Вывод отклонён', body: reason, whatsapp: true, whatsappText: T.withdrawalRejected(w.amount.toString(), reason) });
  }

  async retry(id: string, adminId: string) {
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    if (w.status !== WithdrawalStatus.FAILED) throw E.conflict('STATE', 'Повторить можно только неудавшийся вывод');
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.lock(tx, w.userId, w.amount, 'WITHDRAWAL_LOCK', w.id, 'Повторный резерв под вывод');
      await tx.withdrawal.update({ where: { id }, data: { status: WithdrawalStatus.APPROVED, attempts: 0, failureReason: null, approvedById: adminId } });
    });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'withdrawal.retried', targetType: 'Withdrawal', targetId: id });
  }

  // ─── processor: broadcast approved withdrawals ───
  @Cron(CronExpression.EVERY_10_SECONDS)
  async process() {
    if (this.processing) return;
    this.processing = true;
    try {
      if (await this.settings.bool('wallet.withdrawals_frozen')) return;
      const hot = await this.prisma.hotWallet.findUnique({ where: { network: Network.TRON } });
      if (hot?.frozen) return;
      const approved = await this.prisma.withdrawal.findMany({ where: { status: WithdrawalStatus.APPROVED }, orderBy: { createdAt: 'asc' }, take: 10 });
      for (const w of approved) {
        // hot wallet limits
        if (hot) {
          const today = hot.sentTodayDate && hot.sentTodayDate.toDateString() === new Date().toDateString() ? hot.sentToday : new Prisma.Decimal(0);
          if (w.netAmount.gt(hot.singleLimit) || today.plus(w.netAmount).gt(hot.dailyLimit)) {
            this.logger.warn(`withdrawal ${w.id} exceeds hot wallet limits — needs manual handling`);
            await this.prisma.withdrawal.update({ where: { id: w.id }, data: { status: WithdrawalStatus.APPROVAL_REQUIRED, failureReason: 'Превышен лимит hot wallet — требуется ручная обработка' } });
            continue;
          }
        }
        await this.prisma.withdrawal.update({ where: { id: w.id }, data: { status: WithdrawalStatus.BROADCASTING, attempts: { increment: 1 } } });
        try {
          const txHash = await this.tron.sendUsdt(w.toAddress, w.netAmount.toString());
          await this.prisma.$transaction(async (tx) => {
            await this.ledger.settleWithdrawal(tx, w.userId, w.amount, w.fee, w.id);
            await tx.withdrawal.update({ where: { id: w.id }, data: { status: WithdrawalStatus.SENT, txHash, broadcastAt: new Date() } });
            if (hot) {
              const sameDay = hot.sentTodayDate && hot.sentTodayDate.toDateString() === new Date().toDateString();
              await tx.hotWallet.update({ where: { id: hot.id }, data: { sentToday: sameDay ? hot.sentToday.plus(w.netAmount) : w.netAmount, sentTodayDate: new Date() } });
            }
          });
          await this.notifications.notify({ userId: w.userId, title: 'Вывод отправлен', body: `${w.netAmount} USDT отправлены на ${w.toAddress}`, data: { withdrawalId: w.id, txHash }, whatsapp: true, whatsappText: T.withdrawalSent(w.netAmount.toString(), txHash) });
          await this.audit.log({ actorType: 'SYSTEM', action: 'withdrawal.sent', targetType: 'Withdrawal', targetId: w.id, meta: { txHash } });
        } catch (e) {
          const msg = (e as Error).message?.slice(0, 300);
          this.logger.error(`broadcast ${w.id} failed: ${msg}`);
          const fresh = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
          if (fresh.attempts >= 3) {
            await this.releaseLock(w.id, WithdrawalStatus.FAILED, msg);
            await this.notifications.adminAlert('Вывод не удался', `<p>${w.id}: ${msg}</p>`);
          } else {
            await this.prisma.withdrawal.update({ where: { id: w.id }, data: { status: WithdrawalStatus.APPROVED, failureReason: msg } });
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async confirmSent() {
    const sent = await this.prisma.withdrawal.findMany({ where: { status: WithdrawalStatus.SENT }, take: 50 });
    if (!sent.length) return;
    if (this.tron.simulated()) {
      await this.prisma.withdrawal.updateMany({ where: { id: { in: sent.map((s) => s.id) } }, data: { status: WithdrawalStatus.CONFIRMED, confirmedAt: new Date() } });
      return;
    }
    const latest = await this.tron.latestBlock().catch(() => 0);
    const required = await this.tron.requiredConfirmations();
    for (const w of sent) {
      try {
        const info = await this.tron.txInfo(w.txHash!);
        if (!info.found) continue;
        if (info.success === false) {
          await this.releaseLock(w.id, WithdrawalStatus.FAILED, 'Транзакция отклонена сетью').catch(() => undefined);
          continue;
        }
        if (latest - (info.blockNumber ?? latest) >= required) await this.prisma.withdrawal.update({ where: { id: w.id }, data: { status: WithdrawalStatus.CONFIRMED, confirmedAt: new Date() } });
      } catch (e) {
        this.logger.warn(`confirm ${w.txHash} failed: ${(e as Error).message}`);
      }
    }
  }
}
