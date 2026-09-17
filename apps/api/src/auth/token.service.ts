import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '../config/env';
import { parseDuration } from '../common/utils/time';

export interface UserAccessClaims {
  sub: string;
  sid: string;
  did?: string;
  typ: 'user';
}

export interface AdminAccessClaims {
  sub: string;
  sid: string;
  role: string;
  typ: 'admin';
}

export interface StepUpClaims {
  sub: string;
  typ: 'stepup';
  scope: 'pin';
}

@Injectable()
export class TokenService {
  private readonly env = loadEnv();

  constructor(private readonly jwt: JwtService) {}

  signUserAccess(claims: Omit<UserAccessClaims, 'typ'>): { token: string; expiresIn: number } {
    const expiresIn = Math.floor(parseDuration(this.env.JWT_ACCESS_TTL) / 1000);
    return { token: this.jwt.sign({ ...claims, typ: 'user' }, { secret: this.env.JWT_ACCESS_SECRET, expiresIn, issuer: 'somex' }), expiresIn };
  }

  signAdminAccess(claims: Omit<AdminAccessClaims, 'typ'>): { token: string; expiresIn: number } {
    const expiresIn = Math.floor(parseDuration(this.env.ADMIN_JWT_ACCESS_TTL) / 1000);
    return { token: this.jwt.sign({ ...claims, typ: 'admin' }, { secret: this.env.JWT_ACCESS_SECRET, expiresIn, issuer: 'somex-admin' }), expiresIn };
  }

  signStepUp(userId: string): string {
    return this.jwt.sign({ sub: userId, typ: 'stepup', scope: 'pin' } as StepUpClaims, { secret: this.env.JWT_ACCESS_SECRET, expiresIn: 300, issuer: 'somex' });
  }

  verifyUserAccess(token: string): UserAccessClaims {
    const c = this.jwt.verify<UserAccessClaims>(token, { secret: this.env.JWT_ACCESS_SECRET, issuer: 'somex' });
    if (c.typ !== 'user') throw new Error('wrong token type');
    return c;
  }

  verifyAdminAccess(token: string): AdminAccessClaims {
    const c = this.jwt.verify<AdminAccessClaims>(token, { secret: this.env.JWT_ACCESS_SECRET, issuer: 'somex-admin' });
    if (c.typ !== 'admin') throw new Error('wrong token type');
    return c;
  }

  verifyStepUp(token: string, userId: string): boolean {
    try {
      const c = this.jwt.verify<StepUpClaims>(token, { secret: this.env.JWT_ACCESS_SECRET, issuer: 'somex' });
      return c.typ === 'stepup' && c.sub === userId;
    } catch {
      return false;
    }
  }

  refreshTtlMs(): number {
    return parseDuration(this.env.JWT_REFRESH_TTL);
  }

  adminRefreshTtlMs(): number {
    return parseDuration(this.env.ADMIN_JWT_REFRESH_TTL);
  }
}
