import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Network } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { DepositsService } from './deposits.service';
import { WithdrawalsService } from './withdrawals.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ConfirmWithdrawalDto, CreateWithdrawalDto, QuoteWithdrawalDto } from './dto/wallet.dto';
import { ActiveUserGuard } from '../auth/guards/status.guard';
import { clientIp } from '../common/utils/request';
import { PageDto } from '../common/dto/page.dto';
import { PrismaService } from '../prisma/prisma.service';
import { E } from '../common/errors';

@Controller('wallet')
export class WalletController {
  constructor(
    private readonly deposits: DepositsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async overview(@CurrentUser() user: AuthUser) {
    const bal = await this.prisma.balance.findUnique({ where: { userId: user.id } });
    const rate = await this.prisma.rate.findUnique({ where: { asset_fiat: { asset: 'USDT', fiat: 'KGS' } } });
    return { asset: 'USDT', available: bal?.available.toString() ?? '0', locked: bal?.locked.toString() ?? '0', rateKgs: rate?.price.toString() ?? null };
  }

  @UseGuards(ActiveUserGuard)
  @Get('deposit-address')
  depositAddress(@CurrentUser() user: AuthUser, @Query('network') network = 'TRON') {
    return this.deposits.depositInfo(user.id, network as Network);
  }

  @Get('deposits')
  deposits_(@CurrentUser() user: AuthUser, @Query() q: PageDto) {
    return this.deposits.list(user.id, q.page, q.limit);
  }

  /** Test/dev only (DEV_SIMULATE_CHAIN=true): credit a fake TRC20 deposit to yourself. */
  @UseGuards(ActiveUserGuard)
  @Throttle({ short: { limit: 2, ttl: 10_000 } })
  @Post('deposits/simulate')
  @HttpCode(200)
  async simulate(@CurrentUser() user: AuthUser, @Body() body: { amount?: string }) {
    const amount = String(body?.amount ?? '100').replace(/[^\d.]/g, '') || '100';
    if (Number(amount) <= 0 || Number(amount) > 100000) throw E.bad('AMOUNT', 'Сумма от 1 до 100 000 USDT');
    const d = await this.deposits.simulate(user.id, amount);
    return this.deposits.view(d);
  }

  @Get('withdrawals')
  withdrawals_(@CurrentUser() user: AuthUser, @Query() q: PageDto) {
    return this.withdrawals.list(user.id, q.page, q.limit);
  }

  @Get('withdraw-addresses')
  addressBook(@CurrentUser() user: AuthUser) {
    return this.withdrawals.addressBook(user.id);
  }

  @Post('withdrawals/quote')
  @HttpCode(200)
  quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteWithdrawalDto) {
    return this.withdrawals.quote(user.id, dto.amount);
  }

  @UseGuards(ActiveUserGuard)
  @Throttle({ short: { limit: 2, ttl: 10_000 }, medium: { limit: 10, ttl: 60_000 } })
  @Post('withdrawals')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWithdrawalDto, @Req() req: Request, @Headers('x-idempotency-key') idem?: string) {
    return this.withdrawals.create(user.id, dto, { ip: clientIp(req), deviceId: user.deviceId, idempotencyKey: idem?.slice(0, 80) });
  }

  @UseGuards(ActiveUserGuard)
  @Throttle({ short: { limit: 3, ttl: 10_000 } })
  @Post('withdrawals/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmWithdrawalDto) {
    return this.withdrawals.confirm(user.id, id, dto.code);
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.withdrawals.cancel(user.id, id);
  }
}
