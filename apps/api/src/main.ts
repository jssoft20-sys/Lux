import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
loadDotenv();
loadDotenv({ path: '../.env' });
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express, { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { Logger as PinoLogger } from 'nestjs-pino';

/** Serves the built SPAs from the API process (single-port deployments): admin at /admin, mobile at /. */
function mountWebApps(app: NestExpressApplication, env: ReturnType<typeof loadEnv>) {
  const mobileDir = env.WEB_MOBILE_DIR ? resolve(env.WEB_MOBILE_DIR) : '';
  const adminDir = env.WEB_ADMIN_DIR ? resolve(env.WEB_ADMIN_DIR) : '';
  const isApi = (p: string) => p.startsWith('/api') || p.startsWith('/socket.io');
  if (adminDir && existsSync(join(adminDir, 'index.html'))) {
    app.use('/admin', express.static(adminDir, { index: false, maxAge: '7d' }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && (req.path === '/admin' || req.path.startsWith('/admin/')) && req.accepts('html')) return res.sendFile(join(adminDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } });
      next();
    });
    Logger.log(`Admin panel served from ${adminDir} at /admin`, 'Web');
  }
  if (mobileDir && existsSync(join(mobileDir, 'index.html'))) {
    app.use(express.static(mobileDir, { index: false, maxAge: '7d' }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !isApi(req.path) && !req.path.startsWith('/admin') && req.accepts('html') && !req.path.includes('.')) return res.sendFile(join(mobileDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } });
      next();
    });
    Logger.log(`Mobile app served from ${mobileDir} at /`, 'Web');
  }
}

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(PinoLogger));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // applied per-route below (Swagger UI needs inline scripts in dev)
      crossOriginResourcePolicy: { policy: 'same-origin' },
      crossOriginOpenerPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: { maxAge: 63072000, includeSubDomains: true },
    }),
  );
  // Content-Security-Policy for the served web apps: only our own scripts run in the browser (XSS containment)
  const csp = helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      workerSrc: ["'self'", 'blob:'], // image-compression / QR libraries spawn blob workers from our own scripts
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: null,
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      // API responses carry personal and financial data: never cache them
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      return next();
    }
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    return csp(req, res, next);
  });
  app.use(cookieParser());
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));

  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || origins.includes(origin) || env.NODE_ENV !== 'production' || env.TEST_MODE) return cb(null, true);
      return cb(new Error('CORS: origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Idempotency-Key', 'X-Requested-With', 'X-Client'],
  });

  mountWebApps(app, env);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production' || env.TEST_MODE) {
    const config = new DocumentBuilder()
      .setTitle('Somex API')
      .setDescription('P2P USDT platform for Kyrgyzstan — escrow, KYC, anti-fraud, wallet, admin')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, doc, { swaggerOptions: { persistAuthorization: true } });
  }

  await app.listen(env.API_PORT, '0.0.0.0');
  Logger.log(`Somex API listening on :${env.API_PORT} (${env.NODE_ENV}${env.TEST_MODE ? ', TEST MODE' : ''})`, 'Bootstrap');
  if (env.TEST_MODE) {
    Logger.warn('══════════════════════════════════════════════════════════════', 'TestMode');
    Logger.warn(` TEST MODE: любой номер +996 входит с кодом ${env.TEST_OTP_CODE}, блокчейн симулируется,`, 'TestMode');
    Logger.warn(' 2FA админов не обязателен. Не использовать с реальными деньгами.', 'TestMode');
    Logger.warn('══════════════════════════════════════════════════════════════', 'TestMode');
  }
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
