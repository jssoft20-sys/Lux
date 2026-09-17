import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminMainController } from './controllers/admin-main.controller';
import { AdminSettingsController } from './controllers/admin-settings.controller';
import { KycModule } from '../kyc/kyc.module';
import { WalletModule } from '../wallet/wallet.module';
import { P2pModule } from '../p2p/p2p.module';
import { RiskModule } from '../risk/risk.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [JwtModule.register({}), KycModule, WalletModule, P2pModule, RiskModule, FilesModule],
  controllers: [AdminAuthController, AdminMainController, AdminSettingsController],
  providers: [AdminService, AdminAuthService],
})
export class AdminModule {}
