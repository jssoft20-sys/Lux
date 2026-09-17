import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ChatMessageType, OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { E } from '../common/errors';
import { ChatGateway } from './chat.gateway';

const OFFPLATFORM = /(whats?app|ватсап|вацап|telegram|телеграм|tg:|t\.me|\+?996\s?\d{3}\s?\d{3}\s?\d{3}|\b0\d{9}\b)/i;
const CARD_NUMBER = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
const OTHER_PERSON = /(карт[аы]\s+(жены|мужа|брата|сестры|друга|мамы|папы|родственник)|с\s+чужой|третье\s+лиц|другого\s+человека)/i;
const WRITABLE: OrderStatus[] = [OrderStatus.CREATED, OrderStatus.PAID, OrderStatus.DISPUTED];

/** Order chat. System messages are immutable and become part of the arbitration evidence. */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway)) private readonly gateway: ChatGateway,
  ) {}

  async assertParticipant(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, buyerId: true, sellerId: true, status: true } });
    if (!order) throw E.notFound('Сделка');
    if (order.buyerId !== userId && order.sellerId !== userId) throw E.forbidden();
    return order;
  }

  view(m: { id: string; orderId: string; senderId: string | null; type: ChatMessageType; text: string | null; fileId: string | null; flagged: boolean; flagReason: string | null; readAt: Date | null; createdAt: Date }) {
    return { id: m.id, orderId: m.orderId, senderId: m.senderId, type: m.type, text: m.text, fileId: m.fileId, flagged: m.flagged, flagReason: m.flagReason, readAt: m.readAt, createdAt: m.createdAt };
  }

  async list(orderId: string, userId: string, after?: string) {
    await this.assertParticipant(orderId, userId);
    const rows = await this.prisma.chatMessage.findMany({ where: { orderId, ...(after ? { createdAt: { gt: new Date(after) } } : {}) }, orderBy: { createdAt: 'asc' }, take: 500 });
    await this.prisma.chatMessage.updateMany({ where: { orderId, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() } });
    return rows.map((m) => this.view(m));
  }

  async send(orderId: string, userId: string, text?: string, fileId?: string) {
    const order = await this.assertParticipant(orderId, userId);
    if (!WRITABLE.includes(order.status)) throw E.conflict('CHAT_CLOSED', 'Чат по завершённой сделке закрыт');
    if (!text && !fileId) throw E.bad('EMPTY', 'Пустое сообщение');
    let type: ChatMessageType = ChatMessageType.TEXT;
    if (fileId) {
      const f = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
      if (!f || f.ownerId !== userId) throw E.forbidden('Файл недоступен');
      if (f.scanStatus === 'INFECTED') throw E.bad('FILE_INFECTED', 'Файл отклонён антивирусом');
      type = f.mime.startsWith('image/') ? ChatMessageType.IMAGE : ChatMessageType.FILE;
    }
    let flagged = false;
    let flagReason: string | undefined;
    if (text) {
      if (OFFPLATFORM.test(text)) {
        flagged = true;
        flagReason = 'Попытка увести общение за пределы Somex';
      } else if (CARD_NUMBER.test(text)) {
        flagged = true;
        flagReason = 'Реквизиты в чате — используйте только реквизиты из карточки сделки';
      } else if (OTHER_PERSON.test(text)) {
        flagged = true;
        flagReason = 'Упоминание оплаты с чужого счёта';
      }
    }
    const m = await this.prisma.chatMessage.create({ data: { orderId, senderId: userId, type, text, fileId, flagged, flagReason } });
    this.gateway.emitMessage(orderId, this.view(m));
    if (flagged) {
      await this.system(orderId, `⚠️ ${flagReason}. Somex не защищает сделки вне приложения. Все договорённости — только в этом чате.`);
      await this.prisma.riskEvent.create({ data: { userId, type: 'ORDER_CREATE', score: 15, action: 'ALLOW', signals: [{ code: 'CHAT_FLAG', weight: 15, detail: flagReason }], refType: 'Order', refId: orderId } });
    }
    return this.view(m);
  }

  async system(orderId: string, text: string) {
    const m = await this.prisma.chatMessage.create({ data: { orderId, type: ChatMessageType.SYSTEM, text } });
    this.gateway.emitMessage(orderId, this.view(m));
    return m;
  }

  async unreadCount(userId: string) {
    return this.prisma.chatMessage.count({ where: { readAt: null, senderId: { not: userId }, type: { not: ChatMessageType.SYSTEM }, order: { OR: [{ buyerId: userId }, { sellerId: userId }], status: { in: WRITABLE } } } });
  }
}
