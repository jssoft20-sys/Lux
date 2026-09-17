import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CreatePaymentMethodDto, SupportTicketDto, UpdateMeDto } from './dto/users.dto';
import { clientIp } from '../common/utils/request';
import { ActiveUserGuard } from '../auth/guards/status.guard';
import { PageDto } from '../common/dto/page.dto';

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.users.heartbeat(user.id, clientIp(req));
    return this.users.profile(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.update(user.id, dto);
  }

  @Get('limits')
  async limits(@CurrentUser() user: AuthUser) {
    const p = await this.users.profile(user.id);
    return p.limits;
  }

  @Get('devices')
  devices(@CurrentUser() user: AuthUser) {
    return this.users.devices(user.id, user.deviceId);
  }

  @Delete('devices/:id')
  removeDevice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.removeDevice(user.id, id, user.deviceId);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.users.sessions(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.revokeSession(user.id, id);
  }

  @Get('payment-methods')
  paymentMethods(@CurrentUser() user: AuthUser) {
    return this.users.paymentMethods(user.id);
  }

  @UseGuards(ActiveUserGuard)
  @Post('payment-methods')
  addPaymentMethod(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentMethodDto, @Req() req: Request) {
    return this.users.addPaymentMethod(user.id, dto.bankCode, dto.accountNumber, clientIp(req));
  }

  @Delete('payment-methods/:id')
  removePaymentMethod(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.removePaymentMethod(user.id, id);
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser, @Query() q: PageDto) {
    return this.users.notifications(user.id, q.page, q.limit);
  }

  @Post('notifications/read')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.users.markRead(user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  readOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.markRead(user.id, id);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query() q: PageDto) {
    return this.users.history(user.id, q.page, q.limit);
  }

  @Get('support')
  tickets(@CurrentUser() user: AuthUser) {
    return this.users.tickets(user.id);
  }

  @Post('support')
  createTicket(@CurrentUser() user: AuthUser, @Body() dto: SupportTicketDto) {
    return this.users.createTicket(user.id, dto);
  }
}
