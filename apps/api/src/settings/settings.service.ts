import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { SETTING_DEFS, SETTING_GROUPS, SettingDef } from './settings.defaults';
import { loadEnv } from '../config/env';

/**
 * Database-backed configuration with env fallback and an in-memory cache.
 * Secrets are encrypted at rest with AES-256-GCM and masked when read through the admin API.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, string>();
  private loadedAt = 0;
  private readonly ttlMs = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  defs(): SettingDef[] {
    return SETTING_DEFS;
  }

  groups() {
    return SETTING_GROUPS;
  }

  async reload() {
    const rows = await this.prisma.setting.findMany();
    const next = new Map<string, string>();
    for (const r of rows) {
      try {
        next.set(r.key, r.isSecret ? this.crypto.decrypt(r.value) : r.value);
      } catch (e) {
        this.logger.error(`Cannot decrypt setting ${r.key}: ${(e as Error).message}`);
      }
    }
    this.cache = next;
    this.loadedAt = Date.now();
  }

  private async ensureFresh() {
    if (Date.now() - this.loadedAt > this.ttlMs) await this.reload();
  }

  /** Resolve value: DB → env → default. */
  async get(key: string): Promise<string> {
    await this.ensureFresh();
    if (this.cache.has(key)) return this.cache.get(key)!;
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def) return '';
    if (def.envKey) {
      const v = (loadEnv() as any)[def.envKey];
      if (v !== undefined && v !== null && String(v) !== '') return String(v);
    }
    return def.default;
  }

  getSync(key: string): string {
    if (this.cache.has(key)) return this.cache.get(key)!;
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def) return '';
    if (def.envKey) {
      const v = (loadEnv() as any)[def.envKey];
      if (v !== undefined && v !== null && String(v) !== '') return String(v);
    }
    return def.default;
  }

  async num(key: string): Promise<number> {
    const v = Number(await this.get(key));
    return Number.isFinite(v) ? v : Number(SETTING_DEFS.find((d) => d.key === key)?.default ?? 0);
  }

  async bool(key: string): Promise<boolean> {
    const v = (await this.get(key)).toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(v);
  }

  async set(key: string, value: string, updatedById?: string) {
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def) throw new Error(`Unknown setting ${key}`);
    if (value === '') {
      // empty value = revert to env/default
      await this.prisma.setting.deleteMany({ where: { key } });
      this.cache.delete(key);
      return;
    }
    const stored = def.secret ? this.crypto.encrypt(value) : value;
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: stored, isSecret: !!def.secret, group: def.group, description: def.label, updatedById },
      update: { value: stored, isSecret: !!def.secret, group: def.group, updatedById },
    });
    this.cache.set(key, value);
  }

  async setMany(entries: Record<string, string>, updatedById?: string) {
    for (const [k, v] of Object.entries(entries)) await this.set(k, v, updatedById);
  }

  /** Full listing for the admin UI; secrets are masked, `configured` tells whether a value exists. */
  async listForAdmin() {
    await this.reload();
    return SETTING_DEFS.map((d) => {
      const value = this.getSync(d.key);
      return {
        ...d,
        value: d.secret ? (value ? `••••••${value.slice(-4)}` : '') : value,
        configured: value !== '',
        source: this.cache.has(d.key) ? 'db' : d.envKey && (loadEnv() as any)[d.envKey] ? 'env' : 'default',
      };
    });
  }
}
