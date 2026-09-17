import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { TronService } from './chain/tron.service';
import { ScreeningService } from './screening.service';
import { DepositsService } from './deposits.service';
import { WithdrawalsService } from './withdrawals.service';
import { WalletController } from './wallet.controller';
import { RiskModule } from '../risk/risk.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [RiskModule, UsersModule],
  controllers: [WalletController],
  providers: [LedgerService, TronService, ScreeningService, DepositsService, WithdrawalsService],
  exports: [LedgerService, TronService, ScreeningService, DepositsService, WithdrawalsService],
})
export class WalletModule {}
