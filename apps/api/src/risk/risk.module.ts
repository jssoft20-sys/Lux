import { Module } from '@nestjs/common';
import { BlacklistService } from './blacklist.service';
import { RiskEngineService } from './risk-engine.service';

@Module({
  providers: [BlacklistService, RiskEngineService],
  exports: [BlacklistService, RiskEngineService],
})
export class RiskModule {}
