import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from '../admin-auth.service';
import { AdminChangePasswordDto, AdminLoginDto, AdminRefreshDto, AdminTotpDto, AdminTotpEnableDto } from '../dto/admin.dto';
import { AdminScope } from '../../common/decorators/admin-scope.decorator';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AuthAdmin, CurrentAdmin } from '../../common/decorators/current-user.decorator';
import { clientIp, userAgent } from '../../common/utils/request';
import { PrismaService } from '../../prisma/prisma.service';
import { ADMIN_COOKIE_PATH, ADMIN_REFRESH_COOKIE, clearRefreshCookie, csrfCheck, isWebClient, setRefreshCookie } from '../../common/utils/cookies';
import { TokenService } from '../../auth/token.service';
import { E } from '../../common/errors';

@AdminScope()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  private ctx(req: Request) {
    return { ip: clientIp(req), userAgent: userAgent(req) };
  }

  private deliver(req: Request, res: Response, result: any) {
    if (result?.refreshToken && isWebClient(req)) {
      setRefreshCookie(req, res, ADMIN_REFRESH_COOKIE, ADMIN_COOKIE_PATH, result.refreshToken, this.tokens.adminRefreshTtlMs());
      const { refreshToken: _omit, ...rest } = result;
      return rest;
    }
    return result;
  }

  @Throttle({ short: { limit: 3, ttl: 10_000 }, medium: { limit: 15, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: AdminLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.deliver(req, res, await this.auth.login(dto.email, dto.password, this.ctx(req)));
  }

  @Throttle({ short: { limit: 3, ttl: 10_000 } })
  @Post('totp')
  @HttpCode(200)
  async totp(@Body() dto: AdminTotpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.deliver(req, res, await this.auth.verifyTotp(dto.tmpToken, dto.code, this.ctx(req)));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: AdminRefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let token = dto.refreshToken;
    if (!token) {
      const c = csrfCheck(req);
      if (!c.ok) throw E.forbidden('CSRF check failed');
      token = (req as any).cookies?.[ADMIN_REFRESH_COOKIE];
    }
    if (!token) throw E.unauthorized('Сессия не найдена');
    return this.deliver(req, res, await this.auth.refresh(token, this.ctx(req)));
  }

  @UseGuards(AdminAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentAdmin() admin: AuthAdmin, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(admin.sessionId);
    clearRefreshCookie(req, res, ADMIN_REFRESH_COOKIE, ADMIN_COOKIE_PATH);
    return { ok: true };
  }

  @UseGuards(AdminAuthGuard)
  @Get('me')
  async me(@CurrentAdmin() admin: AuthAdmin) {
    const a = await this.prisma.admin.findUniqueOrThrow({ where: { id: admin.id } });
    return this.auth.view(a);
  }

  @UseGuards(AdminAuthGuard)
  @Post('totp/setup')
  @HttpCode(200)
  totpSetup(@CurrentAdmin() admin: AuthAdmin) {
    return this.auth.totpSetup(admin.id);
  }

  @UseGuards(AdminAuthGuard)
  @Post('totp/enable')
  @HttpCode(200)
  totpEnable(@CurrentAdmin() admin: AuthAdmin, @Body() dto: AdminTotpEnableDto) {
    return this.auth.totpEnable(admin.id, dto.code);
  }

  @UseGuards(AdminAuthGuard)
  @Post('password')
  @HttpCode(200)
  password(@CurrentAdmin() admin: AuthAdmin, @Body() dto: AdminChangePasswordDto) {
    return this.auth.changePassword(admin.id, dto.currentPassword, dto.newPassword);
  }
}
