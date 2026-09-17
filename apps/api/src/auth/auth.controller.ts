import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { BiometricDto, OtpRequestDto, OtpVerifyDto, PinDto, RefreshDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { clientIp, deviceFingerprintHeader, userAgent } from '../common/utils/request';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { clearRefreshCookie, csrfCheck, isWebClient, setRefreshCookie, USER_COOKIE_PATH, USER_REFRESH_COOKIE } from '../common/utils/cookies';
import { TokenService } from './token.service';
import { E } from '../common/errors';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  private ctx(req: Request) {
    return { ip: clientIp(req), userAgent: userAgent(req), deviceFingerprint: deviceFingerprintHeader(req) };
  }

  /** Web clients get the refresh token as an httpOnly cookie; native clients get it in the body. */
  private deliver(req: Request, res: Response, result: { refreshToken: string } & Record<string, unknown>) {
    if (isWebClient(req)) {
      setRefreshCookie(req, res, USER_REFRESH_COOKIE, USER_COOKIE_PATH, result.refreshToken, this.tokens.refreshTtlMs());
      const { refreshToken: _omit, ...rest } = result;
      return rest;
    }
    return result;
  }

  /** Step 1 — send a 6-digit code to the user's WhatsApp. KG numbers only. */
  @Public()
  @Throttle({ short: { limit: 3, ttl: 10_000 }, medium: { limit: 20, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: OtpRequestDto, @Req() req: Request) {
    return this.auth.requestOtp(dto.phone, this.ctx(req));
  }

  /** Step 2 — verify code, register on first login, bind device, issue tokens. */
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 }, medium: { limit: 30, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() dto: OtpVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(dto.phone, dto.code, dto.device, this.ctx(req));
    return this.deliver(req, res, result);
  }

  /** Rotates the refresh token. Cookie path requires the CSRF header + origin check. */
  @Public()
  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let token = dto.refreshToken;
    if (!token) {
      const c = csrfCheck(req);
      if (!c.ok) throw E.forbidden('CSRF check failed');
      token = (req as any).cookies?.[USER_REFRESH_COOKIE];
    }
    if (!token) throw E.unauthorized('Сессия не найдена');
    const result = await this.auth.refresh(token, this.ctx(req));
    return this.deliver(req, res, result);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.sessionId);
    clearRefreshCookie(req, res, USER_REFRESH_COOKIE, USER_COOKIE_PATH);
    return { ok: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.logoutAll(user.id, user.sessionId);
    return { ok: true };
  }

  @Post('pin')
  @HttpCode(200)
  setPin(@CurrentUser() user: AuthUser, @Body() dto: PinDto) {
    return this.auth.setPin(user.id, dto.pin);
  }

  /** Returns a 5-minute step-up token required for escrow release / withdrawals. */
  @Throttle({ short: { limit: 3, ttl: 10_000 } })
  @Post('pin/verify')
  @HttpCode(200)
  verifyPin(@CurrentUser() user: AuthUser, @Body() dto: PinDto) {
    return this.auth.verifyPin(user.id, dto.pin);
  }

  @Post('biometric')
  @HttpCode(200)
  biometric(@CurrentUser() user: AuthUser, @Body() dto: BiometricDto) {
    return this.auth.setBiometric(user.id, dto.enabled);
  }
}
