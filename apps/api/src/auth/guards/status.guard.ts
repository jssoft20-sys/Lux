import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { E } from '../../common/errors';

/** Blocks state-changing operations for FROZEN / RESTRICTED users (read-only access stays available). */
@Injectable()
export class ActiveUserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const u = req.user;
    if (!u) throw E.unauthorized();
    if (u.status === 'FROZEN') throw E.forbidden('Аккаунт заморожен службой безопасности. Обратитесь в поддержку.');
    if (u.status === 'RESTRICTED') throw E.forbidden('Операции временно ограничены. Обратитесь в поддержку.');
    return true;
  }
}
