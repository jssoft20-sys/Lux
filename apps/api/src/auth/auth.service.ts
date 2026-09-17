import { Injectable, Logger } from '@nestjs/common';
import { OtpPurpose, RiskAction, RiskEventType, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { E } from '../common/errors';
import { normalizeKgPhone } from '@somex/shared';
import { DeviceInfoDto } from './dto/auth.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { T } from '../notifications/templates';
import { BlacklistService } from '../risk/blacklist.service';
import { randomUUID } from 'crypto';
import { hours } from '../common/utils/time';
import { UsersService } from '../users/users.service';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface RequestCtx {
  ip?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly blacklist: BlacklistService,
    private readonly users: UsersService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  normalizePhone(input: string): string {
    const phone = normalizeKgPhone(input);
    if (!phone) throw E.bad('INVALID_PHONE', 'Введите номер Кыргызстана в формате +996 XXX XXX XXX');
    return phone;
  }

  async requestOtp(rawPhone: string, ctx: RequestCtx) {
    if (await this.settings.bool('app.maintenance')) throw E.locked('MAINTENANCE', 'Идут технические работы. Попробуйте позже.');
    const phone = this.normalizePhone(rawPhone);

    const existing = await this.prisma.user.findUnique({ where: { phone }, select: { id: true, status: true } });
    if (!existing && !(await this.settings.bool('app.registration_enabled'))) {
      throw E.forbidden('Регистрация новых пользователей временно закрыта');
    }
    if (existing?.status === UserStatus.BANNED) {
      await this.prisma.loginAttempt.create({ data: { phone, ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint, success: false, reason: 'BANNED' } });
      // do not reveal ban at OTP step; the verify step will reject
    }
    if (await this.blacklist.isListed('PHONE', phone)) {
      await this.prisma.loginAttempt.create({ data: { phone, ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint, success: false, reason: 'BLACKLISTED_PHONE' } });
      await this.prisma.riskEvent.create({
        data: { userId: existing?.id, type: RiskEventType.LOGIN, score: 100, action: RiskAction.BLOCK, signals: [{ code: 'BLACKLIST_MATCH', weight: 100, detail: 'phone' }], ip: ctx.ip },
      });
      // identical response shape, but no code is sent
      const resendSec = await this.settings.num('security.otp_resend_sec');
      return { requestId: randomUUID(), channel: 'whatsapp', ttlSec: await this.settings.num('security.otp_ttl_sec'), resendAfterSec: resendSec, maskedPhone: phone.replace(/(\+996\d{3})\d{4}(\d{2})/, '$1 *** *$2') };
    }
    return this.otp.issue(phone, OtpPurpose.LOGIN, { ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint });
  }

  async verifyOtp(rawPhone: string, code: string, device: DeviceInfoDto | undefined, ctx: RequestCtx) {
    const phone = this.normalizePhone(rawPhone);
    try {
      await this.otp.verify(phone, OtpPurpose.LOGIN, code);
    } catch (e) {
      await this.prisma.loginAttempt.create({ data: { phone, ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint, success: false, reason: 'OTP_INVALID' } });
      throw e;
    }

    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;
    if (!user) {
      user = await this.prisma.user.create({ data: { phone, lastIp: ctx.ip, balance: { create: {} } } });
      isNewUser = true;
      await this.audit.log({ actorType: 'USER', actorId: user.id, action: 'user.register', targetType: 'User', targetId: user.id, ip: ctx.ip, userAgent: ctx.userAgent });
    }
    if (user.status === UserStatus.BANNED || user.deletedAt) {
      await this.prisma.loginAttempt.create({ data: { phone, ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint, success: false, reason: 'BANNED' } });
      throw E.forbidden('Аккаунт заблокирован. Обратитесь в поддержку Somex.');
    }

    // device registration + new device detection
    const fingerprint = ctx.deviceFingerprint || this.crypto.sha256(`${ctx.userAgent}|${ctx.ip}`).slice(0, 32);
    const knownDevices = await this.prisma.device.count({ where: { userId: user.id } });
    let deviceRow = await this.prisma.device.findUnique({ where: { userId_fingerprint: { userId: user.id, fingerprint } } });
    let isNewDevice = false;
    if (!deviceRow) {
      isNewDevice = knownDevices > 0;
      deviceRow = await this.prisma.device.create({
        data: {
          userId: user.id,
          fingerprint,
          platform: device?.platform,
          model: device?.model,
          osVersion: device?.osVersion,
          appVersion: device?.appVersion,
          name: device?.name,
          trusted: knownDevices === 0,
          lastIp: ctx.ip,
        },
      });
      const cooldownH = await this.settings.num('security.new_device_cooldown_hours');
      // cooldown disabled (test stands): drop any lock left over from an earlier configuration
      if (cooldownH <= 0 && user.sensitiveOpsLockedUntil) await this.prisma.user.update({ where: { id: user.id }, data: { sensitiveOpsLockedUntil: null } });
      if (isNewDevice) {
        if (cooldownH > 0) await this.prisma.user.update({ where: { id: user.id }, data: { sensitiveOpsLockedUntil: new Date(Date.now() + hours(cooldownH)) } });
        await this.prisma.riskEvent.create({
          data: {
            userId: user.id,
            type: RiskEventType.DEVICE_CHANGE,
            score: 20,
            action: RiskAction.REVIEW,
            signals: [{ code: 'NEW_DEVICE', weight: 20, detail: `${device?.platform || ''} ${device?.model || ''}`.trim() }],
            ip: ctx.ip,
            deviceId: deviceRow.id,
          },
        });
        await this.notifications.notify({
          userId: user.id,
          title: 'Вход с нового устройства',
          body: cooldownH > 0 ? `Выполнен вход с нового устройства ${device?.model || ''}. Вывод и отпуск USDT ограничены на ${cooldownH} ч.` : `Выполнен вход с нового устройства ${device?.model || ''}. Если это не вы — завершите все сессии в разделе Безопасность.`,
          whatsapp: true,
          whatsappText: T.newDevice(device?.model || '', ctx.ip || ''),
        });
      }
    } else {
      if (deviceRow.blocked) throw E.forbidden('Это устройство заблокировано службой безопасности.');
      await this.prisma.device.update({
        where: { id: deviceRow.id },
        data: { lastSeenAt: new Date(), lastIp: ctx.ip, appVersion: device?.appVersion ?? deviceRow.appVersion, model: device?.model ?? deviceRow.model },
      });
    }

    await this.users.touchIp(user.id, ctx.ip);
    const session = await this.createSession(user.id, deviceRow.id, ctx);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastSeenAt: new Date(), lastIp: ctx.ip } });
    await this.prisma.loginAttempt.create({ data: { phone, ip: ctx.ip, deviceFingerprint: fingerprint, success: true } });
    await this.audit.log({ actorType: 'USER', actorId: user.id, action: 'user.login', targetType: 'User', targetId: user.id, meta: { isNewDevice, deviceId: deviceRow.id }, ip: ctx.ip, userAgent: ctx.userAgent });

    const access = this.tokens.signUserAccess({ sub: user.id, sid: session.id, did: deviceRow.id });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: session.refreshToken,
      isNewUser,
      isNewDevice,
      user: await this.users.profile(user.id),
    };
  }

  private async createSession(userId: string, deviceId: string, ctx: RequestCtx, family?: string) {
    const refreshToken = this.crypto.randomToken(48);
    const maxSessions = await this.settings.num('security.max_sessions_per_user');
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId,
        family: family ?? randomUUID(),
        refreshTokenHash: this.crypto.sha256(refreshToken),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs()),
      },
    });
    // keep only N most recent active sessions
    const active = await this.prisma.session.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (active.length > maxSessions) {
      const drop = active.slice(maxSessions).map((s) => s.id);
      await this.prisma.session.updateMany({ where: { id: { in: drop } }, data: { revokedAt: new Date(), revokedReason: 'MAX_SESSIONS' } });
    }
    return { ...session, refreshToken };
  }

  async refresh(refreshToken: string, ctx: RequestCtx) {
    const hash = this.crypto.sha256(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: { select: { status: true, deletedAt: true } } } });
    if (!session) throw E.unauthorized('Сессия недействительна');
    if (session.revokedAt) {
      // token reuse => the family is compromised; revoke everything in it
      await this.prisma.session.updateMany({ where: { family: session.family, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' } });
      await this.audit.log({ actorType: 'SYSTEM', action: 'session.reuse_detected', targetType: 'User', targetId: session.userId, meta: { family: session.family }, ip: ctx.ip });
      throw E.unauthorized('Обнаружено повторное использование токена. Войдите снова.');
    }
    if (session.expiresAt < new Date()) throw E.unauthorized('Сессия истекла');
    if (session.user.status === UserStatus.BANNED || session.user.deletedAt) throw E.forbidden('Аккаунт заблокирован');
    // device binding: a refresh token presented from another device fingerprint is treated as stolen
    if (ctx.deviceFingerprint && session.deviceId) {
      const device = await this.prisma.device.findUnique({ where: { id: session.deviceId }, select: { fingerprint: true, blocked: true } });
      if (device && (device.fingerprint !== ctx.deviceFingerprint || device.blocked)) {
        await this.prisma.session.updateMany({ where: { family: session.family, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'DEVICE_MISMATCH' } });
        await this.audit.log({ actorType: 'SYSTEM', action: 'session.device_mismatch', targetType: 'User', targetId: session.userId, meta: { family: session.family }, ip: ctx.ip });
        throw E.unauthorized('Сессия привязана к другому устройству. Войдите снова.');
      }
    }

    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'ROTATED' } });
    const next = await this.createSession(session.userId, session.deviceId!, ctx, session.family);
    const access = this.tokens.signUserAccess({ sub: session.userId, sid: next.id, did: session.deviceId ?? undefined });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: next.refreshToken };
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'LOGOUT' } });
  }

  async logoutAll(userId: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
    });
  }

  async setPin(userId: string, pin: string) {
    const pinHash = await this.crypto.hashSecret(pin);
    await this.prisma.user.update({ where: { id: userId }, data: { pinHash } });
    await this.audit.log({ actorType: 'USER', actorId: userId, action: 'user.pin_set', targetType: 'User', targetId: userId });
    return { ok: true };
  }

  async verifyPin(userId: string, pin: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pinHash: true, phone: true } });
    if (!user.pinHash) throw E.bad('PIN_NOT_SET', 'PIN-код не установлен');
    const failKey = `pin:fail:${userId}`;
    const fails = Number((await this.redisGet(failKey)) ?? 0);
    if (fails >= 5) throw E.tooMany('PIN заблокирован на 15 минут после 5 неверных попыток', 900);
    const ok = await this.crypto.verifySecret(user.pinHash, pin);
    if (!ok) {
      const n = await this.redisIncr(failKey, 900);
      await this.audit.log({ actorType: 'USER', actorId: userId, action: 'user.pin_failed', targetType: 'User', targetId: userId, meta: { attempts: n } });
      throw E.bad('PIN_INVALID', n >= 5 ? 'PIN заблокирован на 15 минут' : `Неверный PIN-код. Осталось попыток: ${5 - n}`);
    }
    await this.redisDel(failKey);
    return { stepUpToken: this.tokens.signStepUp(userId), expiresIn: 300 };
  }

  private redisGet(key: string) {
    return this.redis.get(key);
  }
  private async redisIncr(key: string, ttlSec: number) {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSec);
    return n;
  }
  private redisDel(key: string) {
    return this.redis.del(key);
  }

  async setBiometric(userId: string, enabled: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { biometricEnabled: enabled } });
    return { ok: true };
  }
}
