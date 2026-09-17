import { Body, Controller, Get, Headers, HttpCode, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { KycService } from './kyc.service';
import { DiditService } from './didit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SandboxCompleteDto } from './dto/kyc.dto';
import { PrismaService } from '../prisma/prisma.service';
import { loadEnv } from '../config/env';
import { ActiveUserGuard } from '../auth/guards/status.guard';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('kyc')
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly didit: DiditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.kyc.status(user.id);
  }

  @UseGuards(ActiveUserGuard)
  @Post('session')
  start(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const origin = (req.headers.origin as string) || loadEnv().CORS_ORIGINS.split(',')[0];
    return this.kyc.start(user.id, `${origin}/kyc/callback`);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@CurrentUser() user: AuthUser) {
    return this.kyc.refresh(user.id);
  }

  /** Non-production only: simulate a provider decision. */
  @Post('sandbox/complete')
  @HttpCode(200)
  sandbox(@CurrentUser() user: AuthUser, @Body() dto: SandboxCompleteDto) {
    return this.kyc.sandboxComplete(user.id, dto);
  }
}

@Controller('webhooks')
export class KycWebhookController {
  constructor(
    private readonly kyc: KycService,
    private readonly didit: DiditService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('didit')
  @HttpCode(200)
  async didit_(@Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string>) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const check = await this.didit.verifyWebhook(raw, headers);
    const payload = req.body ?? {};
    const eventId = String(payload.event_id ?? `${payload.session_id}:${payload.status}:${payload.timestamp}`);
    const existing = await this.prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: 'didit', eventId } } });
    if (existing?.processedAt) return { ok: true, duplicate: true };
    const row = existing ?? (await this.prisma.webhookEvent.create({ data: { provider: 'didit', eventId, payload, signatureOk: check.ok } }));
    if (!check.ok) {
      await this.prisma.webhookEvent.update({ where: { id: row.id }, data: { error: check.reason } });
      return { ok: false, reason: check.reason };
    }
    try {
      await this.kyc.handleWebhook(payload);
      await this.prisma.webhookEvent.update({ where: { id: row.id }, data: { processedAt: new Date() } });
    } catch (e) {
      await this.prisma.webhookEvent.update({ where: { id: row.id }, data: { error: (e as Error).message } });
      throw e;
    }
    return { ok: true };
  }
}
