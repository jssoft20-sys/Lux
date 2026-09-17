import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';

export const REDIS = 'REDIS';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const env = loadEnv();
        const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false, enableOfflineQueue: true });
        client.on('error', (e) => console.error('[redis]', e.message));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
