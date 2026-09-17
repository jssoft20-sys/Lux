import { Global, Module } from '@nestjs/common';
import { loadEnv } from './env';

export const ENV = 'ENV';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
