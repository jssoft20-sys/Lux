import { Injectable, Logger } from '@nestjs/common';
import { FileKind, ScanStatus } from '@prisma/client';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ClamAvService } from './clamav.service';
import { StorageService } from './storage.service';
import { SettingsService } from '../settings/settings.service';
import { CryptoService } from '../security/crypto.service';
import { E } from '../common/errors';
import { AuditService } from '../audit/audit.service';

interface Detected {
  mime: string;
  ext: string;
  image: boolean;
}

/**
 * Upload pipeline: size limit → magic-byte type detection (extension/MIME from the client are ignored)
 * → ClamAV scan → images re-encoded with sharp (kills polyglot payloads, strips EXIF/GPS) → private storage.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clamav: ClamAvService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  static detect(buf: Buffer): Detected | null {
    if (buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', image: true };
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', image: true };
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp', image: true };
    const ftyp = buf.subarray(4, 8).toString('ascii');
    const brand = buf.subarray(8, 12).toString('ascii');
    if (ftyp === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis|avif)$/.test(brand)) return { mime: 'image/heic', ext: 'heic', image: true };
    if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', image: false };
    return null;
  }

  async upload(ownerId: string | null, kind: FileKind, buf: Buffer, originalName?: string, ip?: string) {
    const maxMb = await this.settings.num('files.max_upload_mb');
    if (!buf?.length) throw E.bad('EMPTY_FILE', 'Файл пуст');
    if (buf.length > maxMb * 1024 * 1024) throw E.bad('FILE_TOO_LARGE', `Максимальный размер файла ${maxMb} MB`);
    const detected = FilesService.detect(buf);
    if (!detected) throw E.bad('FILE_TYPE', 'Разрешены только изображения (JPG, PNG, WEBP, HEIC) и PDF');
    if (kind === FileKind.AVATAR && !detected.image) throw E.bad('FILE_TYPE', 'Аватар должен быть изображением');

    // antivirus
    const scan = await this.clamav.scan(buf);
    let scanStatus: ScanStatus = ScanStatus.PENDING;
    let scanResult: string | undefined;
    if (scan.status === 'INFECTED') {
      await this.audit.log({ actorType: ownerId ? 'USER' : 'SYSTEM', actorId: ownerId, action: 'file.rejected_infected', meta: { signature: scan.signature, originalName, size: buf.length }, ip });
      throw E.bad('FILE_INFECTED', `Файл отклонён антивирусом (${scan.signature})`);
    } else if (scan.status === 'CLEAN') {
      scanStatus = ScanStatus.CLEAN;
    } else {
      const mode = await this.settings.get('clamav.fail_mode');
      if (mode === 'fail_closed') throw E.bad('SCANNER_UNAVAILABLE', 'Антивирус временно недоступен. Попробуйте позже.');
      scanStatus = ScanStatus.SKIPPED;
      scanResult = scan.error?.slice(0, 200);
      this.logger.warn(`ClamAV unavailable, accepting file in fail-open mode: ${scan.error}`);
    }

    // normalise images: re-encode, auto-rotate, strip metadata, cap dimensions
    let data = buf;
    let mime = detected.mime;
    let ext = detected.ext;
    let width: number | undefined;
    let height: number | undefined;
    if (detected.image) {
      try {
        const img = sharp(buf, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
        const out = kind === FileKind.AVATAR ? await img.resize(512, 512, { fit: 'cover' }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true }) : await img.jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        data = out.data;
        mime = kind === FileKind.AVATAR ? 'image/webp' : 'image/jpeg';
        ext = kind === FileKind.AVATAR ? 'webp' : 'jpg';
        width = out.info.width;
        height = out.info.height;
      } catch (e) {
        throw E.bad('IMAGE_INVALID', 'Не удалось обработать изображение. Загрузите другой файл.');
      }
    }

    const id = randomUUID();
    const storageKey = StorageService.key(kind, id, ext);
    await this.storage.put(storageKey, data, mime);
    const file = await this.prisma.fileObject.create({
      data: { id, ownerId, kind, originalName: originalName?.slice(0, 120), mime, size: data.length, sha256: this.crypto.sha256(data), storageKey, scanStatus, scanResult, width, height },
    });
    return { id: file.id, kind: file.kind, mime: file.mime, size: file.size, width, height, scanStatus, originalName: file.originalName, createdAt: file.createdAt };
  }

  async canAccess(fileId: string, userId: string): Promise<boolean> {
    const f = await this.prisma.fileObject.findUnique({ where: { id: fileId }, select: { ownerId: true } });
    if (!f) return false;
    if (f.ownerId === userId) return true;
    const viaChat = await this.prisma.chatMessage.count({ where: { fileId, order: { OR: [{ buyerId: userId }, { sellerId: userId }] } } });
    if (viaChat) return true;
    const viaReceipt = await this.prisma.order.count({ where: { OR: [{ buyerId: userId }, { sellerId: userId }], paymentDeclaration: { path: ['receiptFileId'], equals: fileId } } });
    if (viaReceipt) return true;
    const viaDispute = await this.prisma.dispute.count({ where: { evidenceFileIds: { has: fileId }, order: { OR: [{ buyerId: userId }, { sellerId: userId }] } } });
    if (viaDispute) return true;
    const viaAvatar = await this.prisma.user.count({ where: { avatarFileId: fileId } });
    return viaAvatar > 0; // avatars are public within the app
  }

  async get(fileId: string) {
    const f = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!f) throw E.notFound('Файл');
    return f;
  }

  async stream(fileId: string) {
    const f = await this.get(fileId);
    return { file: f, stream: await this.storage.get(f.storageKey) };
  }

  async setAvatar(userId: string, fileId: string) {
    const f = await this.get(fileId);
    if (f.ownerId !== userId || f.kind !== FileKind.AVATAR) throw E.forbidden();
    await this.prisma.user.update({ where: { id: userId }, data: { avatarFileId: fileId } });
    return { ok: true };
  }
}
