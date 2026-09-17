import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { UserAuthGuard } from './guards/user-auth.guard';
import { UsersModule } from '../users/users.module';
import { RiskModule } from '../risk/risk.module';

@Global()
@Module({
  imports: [JwtModule.register({}), UsersModule, RiskModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, { provide: APP_GUARD, useClass: UserAuthGuard }],
  exports: [AuthService, OtpService, TokenService],
})
export class AuthModule {}
