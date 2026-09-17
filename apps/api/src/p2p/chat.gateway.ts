import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Realtime channel for order chats and order status updates.
 * Handshake: { auth: { token: <user or admin access token> } }.
 * Clients join rooms `order:<id>` after authorisation as a participant (admins may join any room).
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token as string) || (client.handshake.headers.authorization as string)?.replace('Bearer ', '');
    try {
      try {
        const u = this.tokens.verifyUserAccess(token);
        client.data.userId = u.sub;
      } catch {
        const a = this.tokens.verifyAdminAccess(token);
        client.data.adminId = a.sub;
      }
    } catch {
      client.emit('error', { code: 'UNAUTHORIZED' });
      client.disconnect(true);
      return;
    }
    if (client.data.userId) client.join(`user:${client.data.userId}`);
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId: string }) {
    const orderId = body?.orderId;
    if (!orderId) return { ok: false };
    if (client.data.adminId) {
      client.join(`order:${orderId}`);
      return { ok: true };
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { buyerId: true, sellerId: true } });
    if (!order || (order.buyerId !== client.data.userId && order.sellerId !== client.data.userId)) return { ok: false, code: 'FORBIDDEN' };
    client.join(`order:${orderId}`);
    return { ok: true };
  }

  @SubscribeMessage('leave')
  leave(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId: string }) {
    if (body?.orderId) client.leave(`order:${body.orderId}`);
    return { ok: true };
  }

  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId: string }) {
    if (body?.orderId && client.data.userId) client.to(`order:${body.orderId}`).emit('typing', { orderId: body.orderId, userId: client.data.userId });
  }

  emitMessage(orderId: string, message: unknown) {
    this.server?.to(`order:${orderId}`).emit('message', message);
  }

  emitOrder(orderId: string, payload: { status: string; [k: string]: unknown }, userIds: string[] = []) {
    this.server?.to(`order:${orderId}`).emit('order', { orderId, ...payload });
    for (const u of userIds) this.server?.to(`user:${u}`).emit('order', { orderId, ...payload });
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
}
