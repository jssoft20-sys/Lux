import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from '../admin-auth.service';
import { AdminChangePasswordDto, AdminLoginDto, AdminRefreshDto, AdminTotpDto, AdminTotpEnableDto } from '../dto/admin.dto';
import { AdminScope } from '../../common/decorators/admin-scope.decorator';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AuthAdmin, CurrentAdmin } from '../../common/decorators/current-user.decorator';
import { clientIp, userAgent } from '../../common/utils/request';
import { PrismaService } from '../../prisma/prisma.service';

@AdminScope()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly prisma: PrismaService,
  ) {}

  private ctx(req: Request) {
    return { ip: clientIp(req), userAgent: userAgent(req) };
  }

  @Throttle({ short: { limit: 3, ttl: 10_000 }, medium: { limit: 15, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, this.ctx(req));
  }

  @Throttle({ short: { limit: 3, ttl: 10_000 } })
  @Post('totp')
  @HttpCode(200)
  totp(@Body() dto: AdminTotpDto, @Req() req: Request) {
    return this.auth.verifyTotp(dto.tmpToken, dto.code, this.ctx(req));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: AdminRefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.ctx(req));
  }

  @UseGuards(AdminAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentAdmin() admin: AuthAdmin) {
    await this.auth.logout(admin.sessionId);
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
