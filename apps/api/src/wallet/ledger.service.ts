import { Injectable, Logger } from '@nestjs/common';
import { LedgerAccount, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { E } from '../common/errors';
import { usdt, ZERO } from '../common/utils/money';

export interface JournalEntry {
  userId?: string;
  account: LedgerAccount;
  delta: Prisma.Decimal.Value;
}

export interface Journal {
  refType: string;
  refId?: string;
  memo?: string;
  entries: JournalEntry[];
}

type Tx = Prisma.TransactionClient;

/**
 * Double-entry ledger. Every money movement is a balanced journal (Σ delta = 0) written atomically
 * together with the cached Balance rows, which are locked with SELECT … FOR UPDATE to serialise
 * concurrent operations on the same user. Convention: user accounts hold positive liabilities,
 * PLATFORM_HOT_WALLET is the external (on-chain) counter-account.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async post(tx: Tx, journal: Journal) {
    const journalId = crypto.randomUUID();
    const entries = journal.entries.map((e) => ({ ...e, delta: usdt(e.delta) }));
    const sum = entries.reduce((a, e) => a.plus(e.delta), ZERO);
    if (!sum.isZero()) throw new Error(`Unbalanced journal ${journal.refType}: ${sum.toString()}`);

    // lock user balances in a deterministic order to avoid deadlocks
    const userIds = [...new Set(entries.filter((e) => e.userId).map((e) => e.userId!))].sort();
    for (const uid of userIds) {
      await tx.$executeRaw`INSERT INTO "Balance" ("userId","asset","available","locked","updatedAt") VALUES (${uid}, 'USDT', 0, 0, NOW()) ON CONFLICT ("userId") DO NOTHING`;
      await tx.$queryRaw`SELECT "userId" FROM "Balance" WHERE "userId" = ${uid} FOR UPDATE`;
    }

    for (const e of entries) {
      if (e.userId) {
        if (e.account !== LedgerAccount.USER_AVAILABLE && e.account !== LedgerAccount.USER_LOCKED) throw new Error('user entries must target USER_* accounts');
        const bal = await tx.balance.findUniqueOrThrow({ where: { userId: e.userId } });
        const field = e.account === LedgerAccount.USER_AVAILABLE ? 'available' : 'locked';
        const next = bal[field].plus(e.delta);
        if (next.isNegative()) throw E.bad('INSUFFICIENT_FUNDS', 'Недостаточно средств на балансе');
        await tx.balance.update({ where: { userId: e.userId }, data: { [field]: next } });
      } else if (e.account === LedgerAccount.USER_AVAILABLE || e.account === LedgerAccount.USER_LOCKED) {
        throw new Error('USER_* accounts require userId');
      }
    }

    await tx.ledgerEntry.createMany({
      data: entries.map((e) => ({ journalId, userId: e.userId, account: e.account, delta: e.delta, refType: journal.refType, refId: journal.refId, memo: journal.memo })),
    });
    return journalId;
  }

  // ─── helpers for the common movements ───

  creditDeposit(tx: Tx, userId: string, amount: Prisma.Decimal.Value, depositId: string) {
    return this.post(tx, {
      refType: 'DEPOSIT',
      refId: depositId,
      memo: 'Пополнение USDT',
      entries: [
        { userId, account: LedgerAccount.USER_AVAILABLE, delta: amount },
        { account: LedgerAccount.PLATFORM_HOT_WALLET, delta: usdt(amount).negated() },
      ],
    });
  }

  lock(tx: Tx, userId: string, amount: Prisma.Decimal.Value, refType: string, refId: string, memo: string) {
    return this.post(tx, {
      refType,
      refId,
      memo,
      entries: [
        { userId, account: LedgerAccount.USER_AVAILABLE, delta: usdt(amount).negated() },
        { userId, account: LedgerAccount.USER_LOCKED, delta: amount },
      ],
    });
  }

  unlock(tx: Tx, userId: string, amount: Prisma.Decimal.Value, refType: string, refId: string, memo: string) {
    return this.post(tx, {
      refType,
      refId,
      memo,
      entries: [
        { userId, account: LedgerAccount.USER_LOCKED, delta: usdt(amount).negated() },
        { userId, account: LedgerAccount.USER_AVAILABLE, delta: amount },
      ],
    });
  }

  /** Escrow release: seller's locked → buyer's available (minus platform fee). */
  releaseEscrow(tx: Tx, sellerId: string, buyerId: string, amount: Prisma.Decimal.Value, fee: Prisma.Decimal.Value, orderId: string) {
    const a = usdt(amount);
    const f = usdt(fee);
    return this.post(tx, {
      refType: 'ORDER_RELEASE',
      refId: orderId,
      memo: 'Сделка завершена',
      entries: [
        { userId: sellerId, account: LedgerAccount.USER_LOCKED, delta: a.negated() },
        { userId: buyerId, account: LedgerAccount.USER_AVAILABLE, delta: a.minus(f) },
        ...(f.isZero() ? [] : [{ account: LedgerAccount.PLATFORM_FEES, delta: f }]),
      ],
    });
  }

  /** Withdrawal settled on-chain: locked funds leave to the external account, fee to platform. */
  settleWithdrawal(tx: Tx, userId: string, amount: Prisma.Decimal.Value, fee: Prisma.Decimal.Value, withdrawalId: string) {
    const a = usdt(amount);
    const f = usdt(fee);
    return this.post(tx, {
      refType: 'WITHDRAWAL',
      refId: withdrawalId,
      memo: 'Вывод USDT',
      entries: [
        { userId, account: LedgerAccount.USER_LOCKED, delta: a.negated() },
        { account: LedgerAccount.PLATFORM_HOT_WALLET, delta: a.minus(f) },
        ...(f.isZero() ? [] : [{ account: LedgerAccount.PLATFORM_FEES, delta: f }]),
      ],
    });
  }

  adjust(tx: Tx, userId: string, delta: Prisma.Decimal.Value, adminId: string, reason: string) {
    return this.post(tx, {
      refType: 'ADJUSTMENT',
      refId: adminId,
      memo: reason,
      entries: [
        { userId, account: LedgerAccount.USER_AVAILABLE, delta },
        { account: LedgerAccount.PLATFORM_ADJUSTMENTS, delta: usdt(delta).negated() },
      ],
    });
  }

  /** Reconciliation: cached balances must equal the ledger, and the ledger must sum to zero. */
  async reconcile() {
    const sums = await this.prisma.ledgerEntry.groupBy({ by: ['userId', 'account'], _sum: { delta: true } });
    const balances = await this.prisma.balance.findMany();
    const mismatches: Array<{ userId: string; field: string; ledger: string; cached: string }> = [];
    for (const b of balances) {
      const av = sums.find((s) => s.userId === b.userId && s.account === LedgerAccount.USER_AVAILABLE)?._sum.delta ?? ZERO;
      const lk = sums.find((s) => s.userId === b.userId && s.account === LedgerAccount.USER_LOCKED)?._sum.delta ?? ZERO;
      if (!usdt(av).equals(b.available)) mismatches.push({ userId: b.userId, field: 'available', ledger: av.toString(), cached: b.available.toString() });
      if (!usdt(lk).equals(b.locked)) mismatches.push({ userId: b.userId, field: 'locked', ledger: lk.toString(), cached: b.locked.toString() });
    }
    const total = sums.reduce((a, s) => a.plus(s._sum.delta ?? ZERO), ZERO);
    const platform = Object.fromEntries(
      Object.values(LedgerAccount)
        .filter((a) => a.startsWith('PLATFORM'))
        .map((a) => [a, sums.filter((s) => s.account === a).reduce((x, s) => x.plus(s._sum.delta ?? ZERO), ZERO).toString()]),
    );
    const userLiabilities = balances.reduce((a, b) => a.plus(b.available).plus(b.locked), ZERO);
    return { ok: mismatches.length === 0 && total.isZero(), ledgerSum: total.toString(), userLiabilities: userLiabilities.toString(), platform, mismatches };
  }
}
