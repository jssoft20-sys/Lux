import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DepositStatus, Network, Prisma, RiskAction, RiskEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TronService } from './chain/tron.service';
import { LedgerService } from './ledger.service';
import { ScreeningService } from './screening.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { T } from '../notifications/templates';
import { AuditService } from '../audit/audit.service';
import { E } from '../common/errors';
import { dec } from '../common/utils/money';

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);
  private scanning = false;
  private confirming = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tron: TronService,
    private readonly ledger: LedgerService,
    private readonly screening: ScreeningService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async getOrCreateAddress(userId: string, network: Network) {
    const existing = await this.prisma.depositAddress.findUnique({ where: { userId_network: { userId, network } } });
    if (existing) return existing;
    if (network !== Network.TRON) throw E.bad('NETWORK', 'Сеть пока не поддерживается');
    if (!(await this.tron.isConfigured()) && !this.tron.simulated()) throw E.bad('DEPOSITS_UNAVAILABLE', 'Пополнение временно недоступно. Попробуйте позже.');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4210)`; // serialise index allocation
      const last = await tx.depositAddress.findFirst({ where: { network }, orderBy: { derivationIndex: 'desc' } });
      const index = (last?.derivationIndex ?? -1) + 1;
      const address = this.tron.simulated() && !(await this.tron.isConfigured()) ? `TSim${index.toString().padStart(4, '0')}${'x'.repeat(26)}`.slice(0, 34) : await this.tron.deriveDepositAddress(index);
      return tx.depositAddress.create({ data: { userId, network, address, derivationIndex: index } });
    });
  }

  async depositInfo(userId: string, network: Network) {
    const addr = await this.getOrCreateAddress(userId, network);
    const confirmations = await this.tron.requiredConfirmations();
    return {
      network,
      address: addr.address,
      asset: 'USDT',
      standard: 'TRC20',
      requiredConfirmations: confirmations,
      minAmount: '1',
      warning: 'Отправляйте только USDT в сети TRON (TRC20). Другие токены и сети будут утеряны.',
      instructions: [
        'Binance → Вывод → USDT → сеть TRON (TRC20) → вставьте адрес',
        'Trust Wallet / MetaMask (TRON) → Отправить USDT → вставьте адрес',
        `Зачисление после ${confirmations} подтверждений сети (обычно 1–2 минуты)`,
        'Крупные и подозрительные поступления проходят проверку происхождения средств',
      ],
    };
  }

  async list(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.deposit.count({ where: { userId } }),
    ]);
    return { items: items.map((d) => this.view(d)), total, page, limit };
  }

  view(d: Prisma.DepositGetPayload<object>) {
    return { id: d.id, network: d.network, txHash: d.txHash, fromAddress: d.fromAddress, amount: d.amount.toString(), confirmations: d.confirmations, requiredConfirmations: d.requiredConfirmations, status: d.status, heldReason: d.heldReason, creditedAt: d.creditedAt, createdAt: d.createdAt };
  }

  /** Dev only: fake an incoming transfer (DEV_SIMULATE_CHAIN=true). */
  async simulate(userId: string, amount: string, fromAddress = 'TSimulatedSourceAddress0000000000000') {
    if (!this.tron.simulated()) throw E.forbidden('Симуляция отключена');
    const addr = await this.getOrCreateAddress(userId, Network.TRON);
    const required = await this.tron.requiredConfirmations();
    const d = await this.prisma.deposit.create({
      data: { userId, network: Network.TRON, txHash: `sim-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`, fromAddress, toAddress: addr.address, amount: new Prisma.Decimal(amount), confirmations: required, requiredConfirmations: required, status: DepositStatus.CONFIRMING, blockTimestamp: new Date() },
    });
    await this.processConfirmed(d.id);
    return this.prisma.deposit.findUniqueOrThrow({ where: { id: d.id } });
  }

  // ─── watcher: discover new transfers ───
  @Cron(CronExpression.EVERY_30_SECONDS)
  async scan() {
    if (this.scanning) return;
    if (!(await this.tron.isConfigured()) || this.tron.simulated()) return;
    this.scanning = true;
    try {
      const addresses = await this.prisma.depositAddress.findMany({ where: { network: Network.TRON }, orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }], take: 40 });
      const required = await this.tron.requiredConfirmations();
      for (const a of addresses) {
        try {
          const since = (a.lastCheckedAt?.getTime() ?? Date.now() - 24 * 3_600_000) - 3_600_000;
          const transfers = await this.tron.incomingTransfers(a.address, since);
          for (const t of transfers) {
            const exists = await this.prisma.deposit.findUnique({ where: { network_txHash_toAddress: { network: Network.TRON, txHash: t.txHash, toAddress: a.address } } });
            if (exists) continue;
            if (Number(t.amount) <= 0) continue;
            await this.prisma.deposit.create({
              data: { userId: a.userId, network: Network.TRON, txHash: t.txHash, fromAddress: t.from, toAddress: t.to, amount: new Prisma.Decimal(t.amount), blockTimestamp: new Date(t.blockTimestamp), requiredConfirmations: required, status: DepositStatus.DETECTED },
            });
            this.logger.log(`deposit detected ${t.amount} USDT → ${a.address} (${t.txHash})`);
          }
          await this.prisma.depositAddress.update({ where: { id: a.id }, data: { lastCheckedAt: new Date() } });
        } catch (e) {
          this.logger.warn(`scan ${a.address} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  // ─── confirmations → screening → credit ───
  @Cron(CronExpression.EVERY_30_SECONDS)
  async confirm() {
    if (this.confirming) return;
    this.confirming = true;
    try {
      const pending = await this.prisma.deposit.findMany({ where: { status: { in: [DepositStatus.DETECTED, DepositStatus.CONFIRMING] } }, take: 100 });
      if (!pending.length) return;
      const latest = this.tron.simulated() ? 0 : await this.tron.latestBlock();
      for (const d of pending) {
        try {
          let confirmations = d.confirmations;
          if (!this.tron.simulated()) {
            const info = await this.tron.txInfo(d.txHash);
            if (!info.found) continue;
            if (info.success === false) {
              await this.prisma.deposit.update({ where: { id: d.id }, data: { status: DepositStatus.REJECTED, heldReason: 'Транзакция не выполнена в сети' } });
              continue;
            }
            confirmations = Math.max(0, latest - (info.blockNumber ?? latest));
            await this.prisma.deposit.update({ where: { id: d.id }, data: { confirmations, blockNumber: BigInt(info.blockNumber ?? 0), status: DepositStatus.CONFIRMING } });
          }
          if (confirmations >= d.requiredConfirmations) await this.processConfirmed(d.id);
        } catch (e) {
          this.logger.warn(`confirm ${d.txHash} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.confirming = false;
    }
  }

  async processConfirmed(depositId: string) {
    const d = await this.prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    if (d.status === DepositStatus.CREDITED || d.status === DepositStatus.REJECTED || d.status === DepositStatus.HELD) return;
    await this.prisma.deposit.update({ where: { id: d.id }, data: { status: DepositStatus.SCREENING } });
    const screening = await this.screening.screenAddress(d.fromAddress, d.network, { userId: d.userId, amount: dec(d.amount) });
    const holdOnMedium = await this.settings.bool('risk.deposit_hold_on_medium');
    const hold = screening.risk === 'HIGH' || (screening.risk === 'MEDIUM' && holdOnMedium);
    if (hold) {
      await this.prisma.deposit.update({ where: { id: d.id }, data: { status: DepositStatus.HELD, screeningRisk: screening.risk, screeningResult: screening as any, heldReason: screening.reasons.join('; ') || 'Проверка происхождения средств' } });
      await this.prisma.riskEvent.create({
        data: { userId: d.userId, type: RiskEventType.DEPOSIT, score: screening.risk === 'HIGH' ? 80 : 45, action: screening.risk === 'HIGH' ? RiskAction.BLOCK : RiskAction.REVIEW, signals: [{ code: screening.risk === 'HIGH' ? 'WALLET_SCREENING_HIGH' : 'WALLET_SCREENING_MEDIUM', weight: screening.risk === 'HIGH' ? 80 : 45, detail: screening.reasons.join('; ') }], refType: 'Deposit', refId: d.id },
      });
      await this.notifications.notify({ userId: d.userId, title: 'Депозит на проверке', body: `Депозит ${d.amount} USDT получен и проверяется службой комплаенса.`, whatsapp: true, whatsappText: T.depositHeld(d.amount.toString()) });
      await this.notifications.adminAlert(`Депозит удержан (${screening.risk})`, `<p>${d.amount} USDT от ${d.fromAddress}</p><p>${screening.reasons.join('<br>')}</p>`);
      return;
    }
    if (await this.settings.bool('wallet.deposits_paused')) return; // stays in SCREENING until resumed
    await this.credit(d.id, screening);
  }

  async credit(depositId: string, screening?: unknown, adminId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const d = await tx.deposit.findUniqueOrThrow({ where: { id: depositId } });
      if (d.status === DepositStatus.CREDITED) return;
      await this.ledger.creditDeposit(tx, d.userId, d.amount, d.id);
      await tx.deposit.update({ where: { id: d.id }, data: { status: DepositStatus.CREDITED, creditedAt: new Date(), screeningResult: screening === undefined ? undefined : (screening as any), screeningRisk: (screening as any)?.risk, reviewedById: adminId } });
    });
    const d = await this.prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    await this.audit.log({ actorType: adminId ? 'ADMIN' : 'SYSTEM', actorId: adminId, action: 'deposit.credited', targetType: 'Deposit', targetId: d.id, meta: { amount: d.amount.toString(), userId: d.userId } });
    await this.notifications.notify({ userId: d.userId, title: 'Депозит зачислен', body: `${d.amount} USDT зачислены на ваш баланс.`, data: { depositId: d.id }, whatsapp: true, whatsappText: T.depositCredited(d.amount.toString()) });
  }

  async reject(depositId: string, adminId: string, reason: string) {
    const d = await this.prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    if (d.status === DepositStatus.CREDITED) throw E.conflict('ALREADY_CREDITED', 'Депозит уже зачислен');
    await this.prisma.deposit.update({ where: { id: d.id }, data: { status: DepositStatus.REJECTED, heldReason: reason, reviewedById: adminId } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'deposit.rejected', targetType: 'Deposit', targetId: d.id, meta: { reason } });
  }
}
