import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import Redis from 'ioredis';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule, REDIS } from './redis/redis.module';
import { SecurityModule } from './security/security.module';
import { SettingsModule } from './settings/settings.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { KycModule } from './kyc/kyc.module';
import { WalletModule } from './wallet/wallet.module';
import { P2pModule } from './p2p/p2p.module';
import { RiskModule } from './risk/risk.module';
import { FilesModule } from './files/files.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { CatalogModule } from './catalog/catalog.module';
import { loadEnv } from './config/env';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } } : undefined,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.code',
            'req.body.pin',
            'req.body.password',
            'req.body.refreshToken',
            'req.body.accountNumber',
            'req.body.totp',
          ],
          censor: '[redacted]',
        },
        autoLogging: { ignore: (req) => (req.url || '').startsWith('/api/v1/health') },
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          { name: 'short', ttl: 1000, limit: 10 },
          { name: 'medium', ttl: 60_000, limit: 120 },
        ],
        storage: new ThrottlerStorageRedisService(new Redis(loadEnv().REDIS_URL)),
      }),
    }),
    ConfigModule,
    PrismaModule,
    RedisModule,
    SecurityModule,
    SettingsModule,
    AuditModule,
    NotificationsModule,
    CatalogModule,
    AuthModule,
    UsersModule,
    KycModule,
    WalletModule,
    P2pModule,
    RiskModule,
    FilesModule,
    AdminModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
