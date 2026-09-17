import { Injectable } from '@nestjs/common';
import { BlacklistType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';

@Injectable()
export class BlacklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private normalise(type: BlacklistType, value: string) {
    const v = value.trim();
    if (type === 'NAME') return v.toLowerCase().replace(/\s+/g, ' ');
    if (type === 'WALLET_ADDRESS') return v; // case-sensitive base58
    return v.toLowerCase();
  }

  hash(type: BlacklistType, value: string) {
    return this.crypto.blindIndex(`${type}:${this.normalise(type, value)}`);
  }

  async isListed(type: BlacklistType | string, value: string): Promise<boolean> {
    const t = type as BlacklistType;
    const row = await this.prisma.blacklistEntry.findUnique({ where: { type_valueHash: { type: t, valueHash: this.hash(t, value) } } });
    if (!row) return false;
    if (row.expiresAt && row.expiresAt < new Date()) return false;
    return true;
  }

  mask(type: BlacklistType, value: string) {
    const v = value.trim();
    if (v.length <= 6) return v.replace(/.(?=.{2})/g, '*');
    return `${v.slice(0, 4)}…${v.slice(-3)}`;
  }

  async add(type: BlacklistType, value: string, reason: string, addedById?: string, source = 'manual', expiresAt?: Date) {
    return this.prisma.blacklistEntry.upsert({
      where: { type_valueHash: { type, valueHash: this.hash(type, value) } },
      create: { type, valueHash: this.hash(type, value), valueMasked: this.mask(type, value), reason, addedById, source, expiresAt },
      update: { reason, addedById, source, expiresAt },
    });
  }

  async remove(id: string) {
    await this.prisma.blacklistEntry.delete({ where: { id } });
  }
}
