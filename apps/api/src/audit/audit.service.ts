import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';

export interface AuditInput {
  actorType: 'ADMIN' | 'USER' | 'SYSTEM';
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string;
  userAgent?: string;
}

/** Canonical JSON (recursively sorted keys) so that jsonb key reordering cannot break the hash chain. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/**
 * Append-only audit trail. Each row stores the hash of the previous row so tampering
 * with history breaks the chain (verify with `verifyChain`). Writes are serialised with a
 * Postgres advisory lock, so multiple API instances keep one linear chain.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private payload(r: { actorType: string; actorId: string | null; action: string; targetType: string | null; targetId: string | null; before: unknown; after: unknown; meta: unknown; createdAt: Date; prev: string | null }) {
    return canonicalJson({
      actorType: r.actorType,
      actorId: r.actorId ?? null,
      action: r.action,
      targetType: r.targetType ?? null,
      targetId: r.targetId ?? null,
      before: r.before ?? null,
      after: r.after ?? null,
      meta: r.meta ?? null,
      createdAt: r.createdAt.toISOString(),
      prev: r.prev,
    });
  }

  async log(input: AuditInput): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(4211)`;
        const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
        const createdAt = new Date();
        // round-trip through JSON so what we hash equals what jsonb stores
        const before = input.before === undefined ? null : JSON.parse(JSON.stringify(input.before));
        const after = input.after === undefined ? null : JSON.parse(JSON.stringify(input.after));
        const meta = input.meta === undefined ? null : JSON.parse(JSON.stringify(input.meta));
        const hash = this.crypto.sha256(this.payload({ actorType: input.actorType, actorId: input.actorId ?? null, action: input.action, targetType: input.targetType ?? null, targetId: input.targetId ?? null, before, after, meta, createdAt, prev: last?.hash ?? null }));
        await tx.auditLog.create({
          data: {
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            actorLabel: input.actorLabel ?? null,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            before: before === null ? undefined : before,
            after: after === null ? undefined : after,
            meta: meta === null ? undefined : meta,
            ip: input.ip,
            userAgent: input.userAgent,
            prevHash: last?.hash ?? null,
            hash,
            createdAt,
          },
        });
      });
    } catch (e) {
      this.logger.error(`audit write failed: ${(e as Error).message}`);
    }
  }

  async verifyChain(limit = 20000): Promise<{ ok: boolean; checked: number; brokenAtSeq?: string }> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { seq: 'asc' }, take: limit });
    let prev: string | null = null;
    for (const r of rows) {
      if ((r.prevHash ?? null) !== prev) return { ok: false, checked: rows.length, brokenAtSeq: r.seq.toString() };
      const expected = this.crypto.sha256(this.payload({ actorType: r.actorType, actorId: r.actorId, action: r.action, targetType: r.targetType, targetId: r.targetId, before: r.before ?? null, after: r.after ?? null, meta: r.meta ?? null, createdAt: r.createdAt, prev }));
      if (expected !== r.hash) return { ok: false, checked: rows.length, brokenAtSeq: r.seq.toString() };
      prev = r.hash;
    }
    return { ok: true, checked: rows.length };
  }
}
