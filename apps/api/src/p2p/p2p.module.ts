import { Module } from '@nestjs/common';
import { AdsService } from './ads.service';
import { OrdersService } from './orders.service';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { P2pController } from './p2p.controller';
import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [WalletModule, UsersModule, RiskModule],
  controllers: [P2pController],
  providers: [AdsService, OrdersService, ChatService, ChatGateway],
  exports: [AdsService, OrdersService, ChatService, ChatGateway],
})
export class P2pModule {}
