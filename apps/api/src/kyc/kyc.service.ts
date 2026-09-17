import { Injectable, Logger } from '@nestjs/common';
import { KycLevel, KycStatus, RiskAction, RiskEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DiditDecision, DiditService } from './didit.service';
import { SettingsService } from '../settings/settings.service';
import { CryptoService } from '../security/crypto.service';
import { E } from '../common/errors';
import { loadEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { T } from '../notifications/templates';
import { AuditService } from '../audit/audit.service';
import { BlacklistService } from '../risk/blacklist.service';

const STATUS_MAP: Record<string, KycStatus> = {
  'Not Started': KycStatus.IN_PROGRESS,
  'In Progress': KycStatus.IN_PROGRESS,
  'Awaiting User': KycStatus.IN_PROGRESS,
  Resubmitted: KycStatus.IN_PROGRESS,
  'In Review': KycStatus.IN_REVIEW,
  Approved: KycStatus.APPROVED,
  Declined: KycStatus.DECLINED,
  Abandoned: KycStatus.EXPIRED,
  Expired: KycStatus.EXPIRED,
  'Kyc Expired': KycStatus.EXPIRED,
};

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly didit: DiditService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly blacklist: BlacklistService,
  ) {}

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycLevel: true, kycStatus: true, fullName: true } });
    const last = await this.prisma.kycVerification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const configured = await this.didit.isConfigured();
    return {
      level: user.kycLevel,
      status: user.kycStatus,
      fullName: user.fullName,
      provider: configured ? 'didit' : loadEnv().NODE_ENV !== 'production' ? 'sandbox' : 'none',
      verification: last
        ? { id: last.id, status: last.status, url: last.status === KycStatus.IN_PROGRESS ? last.providerUrl : null, declineReason: last.declineReason, createdAt: last.createdAt, completedAt: last.completedAt }
        : null,
      levels: [
        { code: 'BASIC', title: 'Basic', description: 'Телефон подтверждён. Торговля недоступна.' },
        { code: 'VERIFIED', title: 'Verified', description: 'Документ + лицо + liveness. P2P в пределах лимитов.' },
        { code: 'ADVANCED', title: 'Advanced', description: 'AML и дополнительные проверки. Повышенные лимиты.' },
      ],
    };
  }

  async start(userId: string, appCallbackUrl: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.kycStatus === KycStatus.APPROVED) throw E.conflict('ALREADY_VERIFIED', 'Верификация уже пройдена');
    const active = await this.prisma.kycVerification.findFirst({ where: { userId, status: { in: [KycStatus.IN_PROGRESS, KycStatus.IN_REVIEW] } }, orderBy: { createdAt: 'desc' } });
    if (active?.status === KycStatus.IN_REVIEW) throw E.conflict('IN_REVIEW', 'Ваши документы уже на проверке');

    if (await this.didit.isConfigured()) {
      if (active?.providerUrl && active.createdAt.getTime() > Date.now() - 60 * 60_000) {
        return { mode: 'didit', verificationId: active.id, url: active.providerUrl };
      }
      const session = await this.didit.createSession(userId, appCallbackUrl, { phone: user.phone });
      const v = await this.prisma.kycVerification.create({
        data: { userId, provider: 'didit', providerSessionId: session.sessionId, providerUrl: session.url, status: KycStatus.IN_PROGRESS },
      });
      await this.prisma.user.update({ where: { id: userId }, data: { kycStatus: KycStatus.IN_PROGRESS } });
      await this.audit.log({ actorType: 'USER', actorId: userId, action: 'kyc.started', targetType: 'KycVerification', targetId: v.id });
      return { mode: 'didit', verificationId: v.id, url: session.url };
    }

    if (loadEnv().NODE_ENV === 'production') throw E.bad('KYC_UNAVAILABLE', 'Сервис верификации временно недоступен');
    const v =
      active ??
      (await this.prisma.kycVerification.create({ data: { userId, provider: 'sandbox', status: KycStatus.IN_PROGRESS, providerSessionId: `sandbox-${userId}-${Date.now()}` } }));
    await this.prisma.user.update({ where: { id: userId }, data: { kycStatus: KycStatus.IN_PROGRESS } });
    return { mode: 'sandbox', verificationId: v.id, url: null };
  }

  /** Development-only path that simulates a provider decision (no external calls). */
  async sandboxComplete(userId: string, dto: { fullName: string; documentNumber: string; dateOfBirth: string; documentType?: string; outcome?: 'APPROVED' | 'DECLINED' }) {
    if (loadEnv().NODE_ENV === 'production' || (await this.didit.isConfigured())) throw E.forbidden('Sandbox KYC недоступен');
    const v = await this.prisma.kycVerification.findFirst({ where: { userId, provider: 'sandbox', status: KycStatus.IN_PROGRESS }, orderBy: { createdAt: 'desc' } });
    if (!v) throw E.bad('NO_SESSION', 'Сначала начните верификацию');
    const parts = dto.fullName.trim().split(/\s+/);
    const decision: DiditDecision = {
      status: dto.outcome === 'DECLINED' ? 'Declined' : 'Approved',
      firstName: parts[1] ?? parts[0],
      lastName: parts[0],
      fullName: dto.fullName.trim(),
      dateOfBirth: dto.dateOfBirth,
      documentType: dto.documentType ?? 'Identity Card',
      documentNumber: dto.documentNumber,
      issuingState: 'KGZ',
      faceMatchScore: 0.98,
      livenessScore: 0.99,
      amlHits: 0,
      declineReason: dto.outcome === 'DECLINED' ? 'Sandbox decline' : undefined,
      raw: { sandbox: true },
    };
    await this.applyDecision(v.id, decision);
    return this.status(userId);
  }

  async refresh(userId: string) {
    const v = await this.prisma.kycVerification.findFirst({ where: { userId, provider: 'didit', status: { in: [KycStatus.IN_PROGRESS, KycStatus.IN_REVIEW] } }, orderBy: { createdAt: 'desc' } });
    if (v?.providerSessionId && (await this.didit.isConfigured())) {
      try {
        const decision = await this.didit.getDecision(v.providerSessionId);
        await this.applyDecision(v.id, decision);
      } catch (e) {
        this.logger.warn(`decision poll failed: ${(e as Error).message}`);
      }
    }
    return this.status(userId);
  }

  async handleWebhook(payload: any) {
    const sessionId = payload?.session_id;
    if (!sessionId) return;
    const v = await this.prisma.kycVerification.findUnique({ where: { providerSessionId: sessionId } });
    if (!v) {
      this.logger.warn(`webhook for unknown session ${sessionId}`);
      return;
    }
    await this.applyDecision(v.id, DiditService.mapDecision(payload));
  }

  /** Central place where a provider decision becomes a Somex KYC status. */
  async applyDecision(verificationId: string, d: DiditDecision) {
    const v = await this.prisma.kycVerification.findUniqueOrThrow({ where: { id: verificationId } });
    if (v.status === KycStatus.APPROVED || v.status === KycStatus.DECLINED) return; // terminal, idempotent
    const mapped = STATUS_MAP[d.status] ?? KycStatus.IN_PROGRESS;

    const docHash = d.documentNumber ? this.crypto.blindIndex(`doc:${d.issuingState ?? ''}:${d.documentNumber}`) : undefined;
    const base = {
      firstName: d.firstName,
      lastName: d.lastName,
      fullName: d.fullName,
      dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : undefined,
      documentType: d.documentType,
      documentNumberHash: docHash,
      documentNumberMasked: d.documentNumber ? `${d.documentNumber.slice(0, 2)}•••${d.documentNumber.slice(-2)}` : undefined,
      documentCountry: d.issuingState,
      faceMatchScore: d.faceMatchScore,
      livenessScore: d.livenessScore,
      amlHits: d.amlHits ?? 0,
      rawResult: d.raw,
    };

    if (mapped === KycStatus.IN_PROGRESS || mapped === KycStatus.EXPIRED) {
      await this.prisma.kycVerification.update({ where: { id: v.id }, data: { ...base, status: mapped, completedAt: mapped === KycStatus.EXPIRED ? new Date() : undefined } });
      await this.prisma.user.update({ where: { id: v.userId }, data: { kycStatus: mapped === KycStatus.EXPIRED ? KycStatus.NOT_STARTED : KycStatus.IN_PROGRESS } });
      return;
    }
    if (mapped === KycStatus.DECLINED) {
      await this.decline(v.id, v.userId, d.declineReason || 'Документ или биометрия не прошли проверку.', base);
      return;
    }
    if (mapped === KycStatus.IN_REVIEW) {
      await this.prisma.kycVerification.update({ where: { id: v.id }, data: { ...base, status: KycStatus.IN_REVIEW } });
      await this.prisma.user.update({ where: { id: v.userId }, data: { kycStatus: KycStatus.IN_REVIEW } });
      return;
    }

    // Approved by provider → Somex policy checks
    const problems: string[] = [];
    const allowed = (await this.settings.get('kyc.allowed_countries')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (allowed.length && d.issuingState && !allowed.includes(d.issuingState.toUpperCase())) problems.push(`Документ страны ${d.issuingState} не поддерживается`);
    const minAge = await this.settings.num('kyc.min_age');
    if (d.dateOfBirth) {
      const age = (Date.now() - new Date(d.dateOfBirth).getTime()) / (365.25 * 86_400_000);
      if (age < minAge) problems.push(`Минимальный возраст ${minAge} лет`);
    }
    if (!d.fullName) problems.push('Не удалось распознать ФИО');
    if (docHash) {
      const dup = await this.prisma.user.findFirst({ where: { documentNumberHash: docHash, id: { not: v.userId } }, select: { id: true } });
      if (dup) {
        problems.push('Документ уже использован в другом аккаунте');
        await this.prisma.riskEvent.create({
          data: { userId: v.userId, type: RiskEventType.KYC, score: 80, action: RiskAction.BLOCK, signals: [{ code: 'LINKED_TO_BLACKLISTED', weight: 80, detail: `document already used by ${dup.id}` }], refType: 'KycVerification', refId: v.id },
        });
      }
      if (d.documentNumber && (await this.blacklist.isListed('DOCUMENT', d.documentNumber))) problems.push('Документ в чёрном списке');
    }
    if (d.fullName && (await this.blacklist.isListed('NAME', d.fullName))) problems.push('Совпадение с санкционным/чёрным списком');
    if ((d.amlHits ?? 0) > 0) problems.push(`AML: ${d.amlHits} совпадений`);

    if (problems.length) {
      // never auto-decline on policy checks — a compliance officer decides
      await this.prisma.kycVerification.update({ where: { id: v.id }, data: { ...base, status: KycStatus.IN_REVIEW, reviewNote: problems.join('; ') } });
      await this.prisma.user.update({ where: { id: v.userId }, data: { kycStatus: KycStatus.IN_REVIEW } });
      await this.notifications.adminAlert('KYC требует ручной проверки', `<p>User ${v.userId}</p><ul>${problems.map((p) => `<li>${p}</li>`).join('')}</ul>`);
      return;
    }
    if (await this.settings.bool('kyc.manual_review_all')) {
      await this.prisma.kycVerification.update({ where: { id: v.id }, data: { ...base, status: KycStatus.IN_REVIEW } });
      await this.prisma.user.update({ where: { id: v.userId }, data: { kycStatus: KycStatus.IN_REVIEW } });
      return;
    }
    await this.approve(v.id, v.userId, base, undefined);
  }

  async approve(verificationId: string, userId: string, base: Record<string, unknown> | null, reviewerId?: string, note?: string, level: KycLevel = KycLevel.VERIFIED) {
    const v = await this.prisma.kycVerification.update({
      where: { id: verificationId },
      data: { ...(base ?? {}), status: KycStatus.APPROVED, completedAt: new Date(), reviewerId, reviewNote: note },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const newLevel = user.kycLevel === KycLevel.ADVANCED ? KycLevel.ADVANCED : level;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: KycStatus.APPROVED,
        kycLevel: newLevel,
        firstName: v.firstName ?? user.firstName,
        lastName: v.lastName ?? user.lastName,
        fullName: v.fullName ?? user.fullName,
        dateOfBirth: v.dateOfBirth ?? user.dateOfBirth,
        documentNumberHash: v.documentNumberHash ?? user.documentNumberHash,
        documentCountry: v.documentCountry ?? user.documentCountry,
      },
    });
    // holder names on payment methods must follow the verified name
    if (v.fullName) await this.prisma.paymentMethod.updateMany({ where: { userId }, data: { holderName: v.fullName, nameMatchesKyc: true } });
    await this.audit.log({ actorType: reviewerId ? 'ADMIN' : 'SYSTEM', actorId: reviewerId, action: 'kyc.approved', targetType: 'User', targetId: userId, meta: { verificationId, level: newLevel } });
    await this.notifications.notify({ userId, title: 'Верификация пройдена', body: 'Теперь вам доступны P2P-сделки, пополнение и вывод USDT.', whatsapp: true, whatsappText: T.kycApproved() });
  }

  async decline(verificationId: string, userId: string, reason: string, base?: Record<string, unknown>, reviewerId?: string) {
    await this.prisma.kycVerification.update({ where: { id: verificationId }, data: { ...(base ?? {}), status: KycStatus.DECLINED, declineReason: reason, completedAt: new Date(), reviewerId } });
    await this.prisma.user.update({ where: { id: userId }, data: { kycStatus: KycStatus.DECLINED } });
    await this.audit.log({ actorType: reviewerId ? 'ADMIN' : 'SYSTEM', actorId: reviewerId, action: 'kyc.declined', targetType: 'User', targetId: userId, meta: { verificationId, reason } });
    await this.notifications.notify({ userId, title: 'Верификация не пройдена', body: reason, whatsapp: true, whatsappText: T.kycDeclined(reason) });
  }

  async setLevel(userId: string, level: KycLevel, adminId: string, note?: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycLevel: true } });
    await this.prisma.user.update({ where: { id: userId }, data: { kycLevel: level } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, action: 'kyc.level_changed', targetType: 'User', targetId: userId, before, after: { kycLevel: level }, meta: { note } });
  }
}
