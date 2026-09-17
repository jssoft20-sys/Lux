import { Module } from '@nestjs/common';
import { KycService } from './kyc.service';
import { DiditService } from './didit.service';
import { KycController, KycWebhookController } from './kyc.controller';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [RiskModule],
  controllers: [KycController, KycWebhookController],
  providers: [KycService, DiditService],
  exports: [KycService, DiditService],
})
export class KycModule {}
