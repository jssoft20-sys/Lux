import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { TokenService } from '../auth/token.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { E } from '../common/errors';
import { ipAllowed } from './ip-utils';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '../config/env';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly jwt: JwtService,
  ) {}

  /** Step 1: password. Returns tokens directly only when 2FA is not enabled AND not enforced. */
  async login(email: string, password: string, ctx: { ip?: string; userAgent?: string }) {
    const admin = await this.prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
    const genericFail = () => E.unauthorized('Неверный email или пароль');
    if (!admin || admin.status !== 'ACTIVE') throw genericFail();
    if (admin.lockedUntil && admin.lockedUntil > new Date()) throw E.locked('LOCKED', 'Аккаунт временно заблокирован после неудачных попыток');
    const ok = await this.crypto.verifySecret(admin.passwordHash, password);
    if (!ok) {
      const failed = admin.failedAttempts + 1;
      await this.prisma.admin.update({ where: { id: admin.id }, data: { failedAttempts: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
      await this.audit.log({ actorType: 'ADMIN', actorId: admin.id, actorLabel: admin.email, action: 'admin.login_failed', ip: ctx.ip, userAgent: ctx.userAgent });
      throw genericFail();
    }
    const globalList = (await this.settings.get('security.admin_ip_allowlist')).split(',').map((s) => s.trim()).filter(Boolean);
    if (!ipAllowed(ctx.ip || '', [...globalList, ...admin.ipAllowlist])) throw E.forbidden('Доступ с этого IP запрещён');

    const totpRequired = await this.settings.bool('security.admin_totp_required');
    if (admin.totpEnabled) {
      const tmpToken = this.jwt.sign({ sub: admin.id, typ: 'admin-mfa' }, { secret: loadEnv().JWT_ACCESS_SECRET, expiresIn: 300, issuer: 'somex-admin' });
      return { mfaRequired: true, tmpToken };
    }
    if (totpRequired) {
      // enforce enrolment: allow a short-lived setup session only
      const tmpToken = this.jwt.sign({ sub: admin.id, typ: 'admin-mfa-setup' }, { secret: loadEnv().JWT_ACCESS_SECRET, expiresIn: 600, issuer: 'somex-admin' });
      const setup = await this.totpSetup(admin.id);
      return { mfaRequired: true, mfaSetupRequired: true, tmpToken, setup };
    }
    return this.issue(admin.id, ctx);
  }

  async verifyTotp(tmpToken: string, code: string, ctx: { ip?: string; userAgent?: string }) {
    let claims: any;
    try {
      claims = this.jwt.verify(tmpToken, { secret: loadEnv().JWT_ACCESS_SECRET, issuer: 'somex-admin' });
    } catch {
      throw E.unauthorized('Сессия входа истекла');
    }
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: claims.sub } });
    if (claims.typ === 'admin-mfa-setup') {
      if (!admin.totpSecretEnc) throw E.bad('TOTP', 'Сначала запросите настройку 2FA');
      const secret = this.crypto.decrypt(admin.totpSecretEnc);
      if (!authenticator.check(code, secret)) throw E.bad('TOTP_INVALID', 'Неверный код 2FA');
      await this.prisma.admin.update({ where: { id: admin.id }, data: { totpEnabled: true } });
      await this.audit.log({ actorType: 'ADMIN', actorId: admin.id, actorLabel: admin.email, action: 'admin.totp_enabled', ip: ctx.ip });
      return this.issue(admin.id, ctx);
    }
    if (claims.typ !== 'admin-mfa') throw E.unauthorized();
    if (!admin.totpEnabled || !admin.totpSecretEnc) throw E.bad('TOTP', '2FA не настроен');
    const secret = this.crypto.decrypt(admin.totpSecretEnc);
    if (!authenticator.check(code, secret)) {
      await this.audit.log({ actorType: 'ADMIN', actorId: admin.id, actorLabel: admin.email, action: 'admin.totp_failed', ip: ctx.ip });
      throw E.bad('TOTP_INVALID', 'Неверный код 2FA');
    }
    return this.issue(admin.id, ctx);
  }

  private async issue(adminId: string, ctx: { ip?: string; userAgent?: string }) {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
    const refreshToken = this.crypto.randomToken(48);
    const minutes = await this.settings.num('security.admin_session_minutes');
    const session = await this.prisma.adminSession.create({
      data: { adminId, refreshTokenHash: this.crypto.sha256(refreshToken), ip: ctx.ip, userAgent: ctx.userAgent, expiresAt: new Date(Date.now() + Math.min(minutes * 60_000, this.tokens.adminRefreshTtlMs())) },
    });
    await this.prisma.admin.update({ where: { id: adminId }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ctx.ip } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, actorLabel: admin.email, action: 'admin.login', ip: ctx.ip, userAgent: ctx.userAgent });
    const access = this.tokens.signAdminAccess({ sub: adminId, sid: session.id, role: admin.role });
    return { mfaRequired: false, accessToken: access.token, expiresIn: access.expiresIn, refreshToken, admin: this.view(admin) };
  }

  view(a: { id: string; email: string; name: string; role: string; totpEnabled: boolean; status: string; lastLoginAt: Date | null; ipAllowlist: string[]; createdAt: Date; mustChangePassword: boolean }) {
    return { id: a.id, email: a.email, name: a.name, role: a.role, totpEnabled: a.totpEnabled, status: a.status, lastLoginAt: a.lastLoginAt, ipAllowlist: a.ipAllowlist, createdAt: a.createdAt, mustChangePassword: a.mustChangePassword };
  }

  async refresh(refreshToken: string, ctx: { ip?: string; userAgent?: string }) {
    const session = await this.prisma.adminSession.findUnique({ where: { refreshTokenHash: this.crypto.sha256(refreshToken) }, include: { admin: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.admin.status !== 'ACTIVE') throw E.unauthorized('Сессия завершена');
    await this.prisma.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issue(session.adminId, ctx);
  }

  async logout(sessionId: string) {
    await this.prisma.adminSession.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  async totpSetup(adminId: string) {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
    const secret = authenticator.generateSecret();
    const appName = await this.settings.get('app.name');
    const otpauth = authenticator.keyuri(admin.email, `${appName} Admin`, secret);
    await this.prisma.admin.update({ where: { id: adminId }, data: { totpSecretEnc: this.crypto.encrypt(secret), totpEnabled: false } });
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return { secret, otpauth, qrDataUrl };
  }

  async totpEnable(adminId: string, code: string) {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
    if (!admin.totpSecretEnc) throw E.bad('TOTP', 'Сначала запросите настройку');
    if (!authenticator.check(code, this.crypto.decrypt(admin.totpSecretEnc))) throw E.bad('TOTP_INVALID', 'Неверный код');
    await this.prisma.admin.update({ where: { id: adminId }, data: { totpEnabled: true } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, actorLabel: admin.email, action: 'admin.totp_enabled' });
    return { ok: true };
  }

  async changePassword(adminId: string, current: string, next: string) {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
    if (!(await this.crypto.verifySecret(admin.passwordHash, current))) throw E.bad('PASSWORD', 'Неверный текущий пароль');
    await this.prisma.admin.update({ where: { id: adminId }, data: { passwordHash: await this.crypto.hashSecret(next), mustChangePassword: false } });
    await this.prisma.adminSession.updateMany({ where: { adminId }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorType: 'ADMIN', actorId: adminId, actorLabel: admin.email, action: 'admin.password_changed' });
    return { ok: true };
  }
}
