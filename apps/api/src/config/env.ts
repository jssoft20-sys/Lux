import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  MASTER_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEY must be 32 bytes hex (64 chars)'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  ADMIN_JWT_ACCESS_TTL: z.string().default('20m'),
  ADMIN_JWT_REFRESH_TTL: z.string().default('12h'),
  OTP_DEV_ECHO: bool.default(false),
  DEV_SIMULATE_CHAIN: bool.default(false),
  /** Test mode: fixed OTP code for every number, no external services required. NEVER enable with real money. */
  TEST_MODE: bool.default(false),
  TEST_OTP_CODE: z.string().regex(/^\d{6}$/).default('000000'),
  /** When set, the API also serves the built web apps (single-port deployment). */
  WEB_MOBILE_DIR: z.string().optional().default(''),
  WEB_ADMIN_DIR: z.string().optional().default(''),

  WAPPI_API_URL: z.string().default('https://wappi.pro'),
  WAPPI_TOKEN: z.string().optional().default(''),
  WAPPI_PROFILE_ID: z.string().optional().default(''),

  DIDIT_API_URL: z.string().default('https://verification.didit.me'),
  DIDIT_API_KEY: z.string().optional().default(''),
  DIDIT_WORKFLOW_ID: z.string().optional().default(''),
  DIDIT_WEBHOOK_SECRET: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().default('Somex <no-reply@somex.kg>'),
  ALERT_EMAILS: z.string().optional().default(''),

  TRON_NETWORK: z.enum(['mainnet', 'nile']).default('mainnet'),
  TRONGRID_API_URL: z.string().default('https://api.trongrid.io'),
  TRONGRID_API_KEY: z.string().optional().default(''),
  TRON_USDT_CONTRACT: z.string().default('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
  TRON_REQUIRED_CONFIRMATIONS: z.coerce.number().default(19),
  DEPOSIT_XPUB: z.string().optional().default(''),
  HOT_WALLET_PRIVATE_KEY: z.string().optional().default(''),
  WITHDRAWAL_FEE_USDT: z.coerce.number().default(1),
  WITHDRAWAL_MIN_USDT: z.coerce.number().default(10),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('somex'),
  S3_ACCESS_KEY: z.string().optional().default(''),
  S3_SECRET_KEY: z.string().optional().default(''),
  MAX_UPLOAD_MB: z.coerce.number().default(10),

  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().default(3310),
  CLAMAV_FAIL_MODE: z.enum(['fail_open', 'fail_closed']).default('fail_open'),

  ADMIN_EMAIL: z.string().default('admin@somex.kg'),
  ADMIN_PASSWORD: z.string().default('ChangeMe!2026'),
  ADMIN_NAME: z.string().default('Superadmin'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.TEST_MODE) {
    if (parsed.data.OTP_DEV_ECHO) throw new Error('OTP_DEV_ECHO must be disabled in production');
    if (parsed.data.DEV_SIMULATE_CHAIN) throw new Error('DEV_SIMULATE_CHAIN must be disabled in production');
  }
  if (parsed.data.NODE_ENV === 'production' && /^0+$/.test(parsed.data.MASTER_KEY)) throw new Error('MASTER_KEY must be a real random key in production');
  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return (loadEnv() as any)[prop];
  },
});
