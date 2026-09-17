import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AdsService } from './ads.service';
import { OrdersService } from './orders.service';
import { ChatService } from './chat.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ActiveUserGuard } from '../auth/guards/status.guard';
import { CancelOrderDto, CreateAdDto, CreateOrderDto, DeclarePaymentDto, ListAdsDto, OpenDisputeDto, RateDto, ReleaseDto, SendMessageDto, UpdateAdDto, OrdersListDto } from './dto/p2p.dto';
import { clientIp } from '../common/utils/request';
import { PageDto } from '../common/dto/page.dto';
import { IsString, MaxLength } from 'class-validator';

class NameCheckDto {
  @IsString() @MaxLength(120) observedName: string;
}

@Controller('p2p')
export class P2pController {
  constructor(
    private readonly ads: AdsService,
    private readonly orders: OrdersService,
    private readonly chat: ChatService,
  ) {}

  // ─── market ───
  @Public()
  @Get('ads')
  listAds(@Query() q: ListAdsDto, @Req() req: Request & { user?: AuthUser }) {
    return this.ads.list(q, req.user?.id);
  }

  @Public()
  @Get('ads/:id')
  getAd(@Param('id') id: string) {
    return this.ads.get(id);
  }

  @Get('my-ads')
  myAds(@CurrentUser() user: AuthUser) {
    return this.ads.myAds(user.id);
  }

  @UseGuards(ActiveUserGuard)
  @Post('ads')
  createAd(@CurrentUser() user: AuthUser, @Body() dto: CreateAdDto) {
    return this.ads.create(user.id, dto);
  }

  @UseGuards(ActiveUserGuard)
  @Patch('ads/:id')
  updateAd(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAdDto) {
    return this.ads.update(user.id, id, dto);
  }

  @UseGuards(ActiveUserGuard)
  @Delete('ads/:id')
  closeAd(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ads.update(user.id, id, { status: 'CLOSED' });
  }

  // ─── orders ───
  @UseGuards(ActiveUserGuard)
  @Throttle({ short: { limit: 2, ttl: 5_000 }, medium: { limit: 20, ttl: 60_000 } })
  @Post('orders')
  createOrder(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto, @Req() req: Request) {
    return this.orders.create(user.id, dto, { ip: clientIp(req), deviceId: user.deviceId });
  }

  @Get('orders')
  listOrders(@CurrentUser() user: AuthUser, @Query() q: OrdersListDto) {
    return this.orders.list(user.id, q.filter ?? 'all', q.page, q.limit);
  }

  @Get('orders/:id')
  getOrder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.get(user.id, id);
  }

  @Get('orders/:id/events')
  events(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.events(user.id, id);
  }

  @UseGuards(ActiveUserGuard)
  @Post('orders/:id/declare-payment')
  @HttpCode(200)
  declare(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeclarePaymentDto, @Req() req: Request) {
    return this.orders.declarePayment(user.id, id, dto, clientIp(req));
  }

  @UseGuards(ActiveUserGuard)
  @Throttle({ short: { limit: 5, ttl: 10_000 }, medium: { limit: 20, ttl: 60_000 } })
  @Post('orders/:id/release')
  @HttpCode(200)
  release(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReleaseDto, @Req() req: Request) {
    return this.orders.release(user.id, id, dto, { ip: clientIp(req), deviceId: user.deviceId });
  }

  @UseGuards(ActiveUserGuard)
  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(user.id, id, dto.reason);
  }

  @UseGuards(ActiveUserGuard)
  @Post('orders/:id/dispute')
  @HttpCode(200)
  dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: OpenDisputeDto, @Req() req: Request) {
    return this.orders.openDispute(user.id, id, dto, clientIp(req));
  }

  @Post('orders/:id/rate')
  @HttpCode(200)
  rate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RateDto) {
    return this.orders.rate(user.id, id, dto.stars, dto.comment);
  }

  /** Seller helper: compare the sender name seen in the bank app with the buyer's KYC name. */
  @Post('orders/:id/check-sender')
  @HttpCode(200)
  async checkSender(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: NameCheckDto) {
    const o = await this.orders.get(user.id, id);
    return this.orders.checkSenderName(o.buyer.fullName ?? '', dto.observedName);
  }

  // ─── chat ───
  @Get('orders/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('after') after?: string) {
    return this.chat.list(id, user.id, after);
  }

  @UseGuards(ActiveUserGuard)
  @Throttle({ short: { limit: 5, ttl: 5_000 } })
  @Post('orders/:id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(id, user.id, dto.text, dto.fileId);
  }

  @Get('chats/unread')
  async unread(@CurrentUser() user: AuthUser) {
    return { unread: await this.chat.unreadCount(user.id) };
  }
}
