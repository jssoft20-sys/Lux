import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { TokenService } from '../token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { E } from '../../common/errors';
import { ADMIN_SCOPE_KEY } from '../../common/decorators/admin-scope.decorator';

/**
 * Global guard for user routes. Public routes opt out with @Public(); admin controllers are
 * marked with @AdminScope() and protected by AdminAuthGuard instead.
 * The session is re-validated (revocation, user status) with a short Redis cache.
 */
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const adminScope = this.reflector.getAllAndOverride<boolean>(ADMIN_SCOPE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (adminScope) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: any }>();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw E.unauthorized();

    let claims;
    try {
      claims = this.tokens.verifyUserAccess(token);
    } catch {
      throw E.unauthorized('Сессия истекла. Войдите снова.');
    }

    const cacheKey = `sess:${claims.sid}`;
    let cached = await this.redis.get(cacheKey);
    if (!cached) {
      const session = await this.prisma.session.findUnique({
        where: { id: claims.sid },
        include: { user: { select: { id: true, phone: true, status: true, kycLevel: true, deletedAt: true } } },
      });
      if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) throw E.unauthorized('Сессия завершена. Войдите снова.');
      cached = JSON.stringify({ id: session.user.id, phone: session.user.phone, status: session.user.status, kycLevel: session.user.kycLevel, deviceId: session.deviceId });
      await this.redis.set(cacheKey, cached, 'EX', 30);
    }
    const u = JSON.parse(cached);
    if (u.status === 'BANNED') throw E.forbidden('Аккаунт заблокирован');
    req.user = { ...u, sessionId: claims.sid };
    return true;
  }
}
