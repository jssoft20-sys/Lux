import { Injectable, Logger } from '@nestjs/common';
import { promises as fs, createReadStream } from 'fs';
import { dirname, join, resolve } from 'path';
import { Client as MinioClient } from 'minio';
import { loadEnv } from '../config/env';
import { Readable } from 'stream';

/** Storage abstraction: local disk (default) or any S3-compatible bucket (MinIO, AWS, Cloudflare R2). */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly env = loadEnv();
  private readonly root = resolve(this.env.STORAGE_LOCAL_DIR);
  private minio?: MinioClient;

  private s3() {
    if (!this.minio) {
      const u = new URL(this.env.S3_ENDPOINT);
      this.minio = new MinioClient({
        endPoint: u.hostname,
        port: u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80,
        useSSL: u.protocol === 'https:',
        accessKey: this.env.S3_ACCESS_KEY,
        secretKey: this.env.S3_SECRET_KEY,
        region: this.env.S3_REGION,
      });
    }
    return this.minio;
  }

  driver() {
    return this.env.STORAGE_DRIVER;
  }

  private localPath(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, data: Buffer, mime: string): Promise<void> {
    if (this.env.STORAGE_DRIVER === 's3') {
      await this.s3().putObject(this.env.S3_BUCKET, key, data, data.length, { 'Content-Type': mime });
      return;
    }
    const p = this.localPath(key);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, data, { mode: 0o600 });
  }

  async get(key: string): Promise<Readable> {
    if (this.env.STORAGE_DRIVER === 's3') return this.s3().getObject(this.env.S3_BUCKET, key);
    return createReadStream(this.localPath(key));
  }

  async remove(key: string): Promise<void> {
    if (this.env.STORAGE_DRIVER === 's3') {
      await this.s3().removeObject(this.env.S3_BUCKET, key);
      return;
    }
    await fs.rm(this.localPath(key), { force: true });
  }

  async check(): Promise<{ ok: boolean; detail: string }> {
    try {
      if (this.env.STORAGE_DRIVER === 's3') {
        const exists = await this.s3().bucketExists(this.env.S3_BUCKET);
        return { ok: exists, detail: exists ? `bucket ${this.env.S3_BUCKET} reachable` : 'bucket missing' };
      }
      await fs.mkdir(this.root, { recursive: true });
      await fs.access(this.root);
      return { ok: true, detail: `local dir ${this.root}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  static key(kind: string, id: string, ext: string) {
    const d = new Date();
    return join(kind.toLowerCase(), String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'), `${id}.${ext}`).replace(/\\/g, '/');
  }
}
