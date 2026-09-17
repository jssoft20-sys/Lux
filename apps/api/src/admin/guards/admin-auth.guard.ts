import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from '../../auth/token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { E } from '../../common/errors';
import { ROLES_KEY } from '../../common/decorators/public.decorator';
import { SettingsService } from '../../settings/settings.service';
import { clientIp } from '../../common/utils/request';
import { ipAllowed } from '../ip-utils';

/** Role hierarchy: SUPERADMIN can do everything; others need an explicit @Roles(). */
const ROLE_RANK: Record<string, number> = { VIEWER: 0, SUPPORT: 1, RISK: 2, FINANCE: 2, COMPLIANCE: 2, SUPERADMIN: 10 };

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { admin?: any }>();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw E.unauthorized();
    let claims;
    try {
      claims = this.tokens.verifyAdminAccess(token);
    } catch {
      throw E.unauthorized('Сессия администратора истекла');
    }
    const session = await this.prisma.adminSession.findUnique({ where: { id: claims.sid }, include: { admin: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.admin.status !== 'ACTIVE') throw E.unauthorized('Сессия завершена');

    const ip = clientIp(req);
    const globalList = (await this.settings.get('security.admin_ip_allowlist')).split(',').map((s) => s.trim()).filter(Boolean);
    if (!ipAllowed(ip, [...globalList, ...session.admin.ipAllowlist])) throw E.forbidden('Доступ с этого IP запрещён');

    req.admin = { id: session.admin.id, email: session.admin.email, role: session.admin.role, name: session.admin.name, sessionId: session.id };

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && session.admin.role !== 'SUPERADMIN' && !roles.includes(session.admin.role)) throw E.forbidden('Недостаточно прав');
    if (req.method !== 'GET' && ROLE_RANK[session.admin.role] === 0) throw E.forbidden('Роль VIEWER — только чтение');
    return true;
  }
}
