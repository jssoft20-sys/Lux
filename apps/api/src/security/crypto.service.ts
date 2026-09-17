import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import * as argon2 from 'argon2';
import { loadEnv } from '../config/env';

/**
 * Central cryptography helper.
 *  - AES-256-GCM field-level encryption (account numbers, TOTP seeds, settings secrets, hot wallet keys)
 *  - HMAC-SHA256 blind indexes (phone / document / account lookups without storing plaintext)
 *  - argon2id password/PIN hashing
 *  - constant-time comparisons
 * The master key comes from MASTER_KEY; production deployments should source it from KMS/HSM.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly hmacKey: Buffer;

  constructor() {
    const env = loadEnv();
    this.key = Buffer.from(env.MASTER_KEY, 'hex');
    this.hmacKey = createHash('sha256').update(Buffer.concat([this.key, Buffer.from('somex-blind-index')])).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [v, ivB, tagB, dataB] = payload.split('.');
    if (v !== 'v1' || !ivB || !tagB || dataB === undefined) throw new Error('Malformed ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** Deterministic keyed hash for lookups (never reversible). */
  blindIndex(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value.trim().toLowerCase()).digest('hex');
  }

  sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  hmac(secret: string, value: string): string {
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }

  async hashSecret(value: string): Promise<string> {
    return argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  async verifySecret(hash: string, value: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, value);
    } catch {
      return false;
    }
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  randomHex(bytes = 16): string {
    return randomBytes(bytes).toString('hex');
  }

  /** Cryptographically secure numeric OTP. */
  otpCode(length = 6): string {
    let s = '';
    for (let i = 0; i < length; i++) s += String(randomInt(0, 10));
    return s;
  }

  maskAccount(value: string): string {
    const d = value.replace(/\s+/g, '');
    if (d.length <= 6) return d.replace(/.(?=.{2})/g, '*');
    return `${d.slice(0, 4)} ${'*'.repeat(Math.max(0, d.length - 8)).replace(/(.{4})/g, '$1 ').trim()} ${d.slice(-4)}`.replace(/\s+/g, ' ');
  }
}
