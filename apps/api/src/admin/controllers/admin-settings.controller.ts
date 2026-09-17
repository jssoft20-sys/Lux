import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AdminScope } from '../../common/decorators/admin-scope.decorator';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { Roles } from '../../common/decorators/public.decorator';
import { AuthAdmin, CurrentAdmin } from '../../common/decorators/current-user.decorator';
import { SettingsService } from '../../settings/settings.service';
import { AuditService } from '../../audit/audit.service';
import { WappiService } from '../../notifications/wappi.service';
import { MailService } from '../../notifications/mail.service';
import { DiditService } from '../../kyc/didit.service';
import { TronService } from '../../wallet/chain/tron.service';
import { ClamAvService } from '../../files/clamav.service';
import { StorageService } from '../../files/storage.service';
import { E } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../security/crypto.service';
import { AdminAuthService } from '../admin-auth.service';
import { CreateAdminDto, UpdateAdminDto } from '../dto/admin.dto';
import { loadEnv } from '../../config/env';

@AdminScope()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly wappi: WappiService,
    private readonly mail: MailService,
    private readonly didit: DiditService,
    private readonly tron: TronService,
    private readonly clamav: ClamAvService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @Roles('SUPERADMIN')
  @Get('settings')
  async list() {
    return { groups: this.settings.groups(), items: await this.settings.listForAdmin(), env: loadEnv().NODE_ENV, chainSimulated: this.tron.simulated() };
  }

  @Roles('SUPERADMIN')
  @Put('settings')
  async update(@CurrentAdmin() a: AuthAdmin, @Body() body: { values: Record<string, string> }) {
    const values = body?.values ?? {};
    const defs = this.settings.defs();
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      const def = defs.find((d) => d.key === k);
      if (!def) throw E.bad('UNKNOWN_SETTING', `Неизвестная настройка ${k}`);
      if (def.type === 'number' && !Number.isFinite(Number(v))) throw E.bad('BAD_VALUE', `${def.label}: число`);
      if (def.type === 'boolean' && !['true', 'false'].includes(String(v))) throw E.bad('BAD_VALUE', `${def.label}: true/false`);
      if (def.type === 'select' && def.options && !def.options.includes(String(v))) throw E.bad('BAD_VALUE', `${def.label}: ${def.options.join(' | ')}`);
      before[k] = def.secret ? '***' : await this.settings.get(k);
      after[k] = def.secret ? '***' : String(v);
    }
    await this.settings.setMany(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])), a.id);
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, actorLabel: a.email, action: 'settings.updated', before, after });
    return { ok: true, items: await this.settings.listForAdmin() };
  }

  @Roles('SUPERADMIN')
  @Post('settings/test/:service')
  @HttpCode(200)
  async test(@CurrentAdmin() a: AuthAdmin, @Param('service') service: string, @Body() body: { to?: string }) {
    let result: { ok: boolean; detail: unknown };
    switch (service) {
      case 'wappi':
        result = await this.wappi.status();
        if (result.ok && body?.to) result = { ok: (await this.wappi.sendText(body.to, 'Somex: тестовое сообщение из админки ✅')).ok, detail: 'test message sent' };
        break;
      case 'smtp':
        result = await this.mail.verify();
        if (result.ok && body?.to) result = { ok: await this.mail.send(body.to, 'Somex: тест SMTP', '<p>Письмо из админки Somex ✅</p>'), detail: 'test mail sent' };
        break;
      case 'didit':
        result = (await this.didit.isConfigured()) ? { ok: true, detail: 'API key and workflow configured (a session is created when a user starts KYC)' } : { ok: false, detail: 'DIDIT_NOT_CONFIGURED' };
        break;
      case 'tron':
        result = this.tron.simulated() ? { ok: true, detail: 'DEV_SIMULATE_CHAIN=true (simulated)' } : await this.tron.check();
        break;
      case 'clamav':
        result = await this.clamav.ping();
        if (result.ok) result.detail = await this.clamav.version();
        break;
      case 'storage':
        result = await this.storage.check();
        break;
      default:
        throw E.bad('SERVICE', 'Неизвестный сервис');
    }
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, actorLabel: a.email, action: `settings.test.${service}`, meta: { ok: result.ok } });
    return result;
  }

  @Roles('SUPERADMIN')
  @Get('system')
  async system() {
    const [clam, storage, tron, wappi, smtp, didit] = await Promise.all([this.clamav.ping(), this.storage.check(), this.tron.simulated() ? { ok: true, detail: 'simulated' } : this.tron.check(), this.wappi.isConfigured(), this.mail.isConfigured(), this.didit.isConfigured()]);
    return { env: loadEnv().NODE_ENV, testMode: loadEnv().TEST_MODE, testOtpCode: loadEnv().TEST_MODE ? loadEnv().TEST_OTP_CODE : undefined, chainSimulated: this.tron.simulated(), otpDevEcho: loadEnv().OTP_DEV_ECHO, clamav: clam, storage, tron, wappiConfigured: wappi, smtpConfigured: smtp, diditConfigured: didit, node: process.version, uptimeSec: Math.round(process.uptime()) };
  }

  // ─── admins ───
  @Roles('SUPERADMIN')
  @Get('admins')
  async admins() {
    const rows = await this.prisma.admin.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.adminAuth.view(r));
  }

  @Roles('SUPERADMIN')
  @Post('admins')
  async createAdmin(@CurrentAdmin() a: AuthAdmin, @Body() dto: CreateAdminDto) {
    const row = await this.prisma.admin.create({ data: { email: dto.email.toLowerCase(), name: dto.name, role: dto.role as any, passwordHash: await this.crypto.hashSecret(dto.password), ipAllowlist: dto.ipAllowlist ?? [], mustChangePassword: true } });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, actorLabel: a.email, action: 'admin.created', targetType: 'Admin', targetId: row.id, after: { email: row.email, role: row.role } });
    return this.adminAuth.view(row);
  }

  @Roles('SUPERADMIN')
  @Put('admins/:id')
  async updateAdmin(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string, @Body() dto: UpdateAdminDto) {
    const before = await this.prisma.admin.findUniqueOrThrow({ where: { id } });
    if (id === a.id && dto.status === 'DISABLED') throw E.bad('SELF', 'Нельзя отключить себя');
    const row = await this.prisma.admin.update({ where: { id }, data: { name: dto.name, role: dto.role as any, status: dto.status as any, ipAllowlist: dto.ipAllowlist, ...(dto.password ? { passwordHash: await this.crypto.hashSecret(dto.password), mustChangePassword: true } : {}) } });
    if (dto.status === 'DISABLED' || dto.password) await this.prisma.adminSession.updateMany({ where: { adminId: id }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, actorLabel: a.email, action: 'admin.updated', targetType: 'Admin', targetId: id, before: { role: before.role, status: before.status, name: before.name }, after: { role: row.role, status: row.status, name: row.name, passwordChanged: !!dto.password } });
    return this.adminAuth.view(row);
  }

  @Roles('SUPERADMIN')
  @Post('admins/:id/reset-totp')
  @HttpCode(200)
  async resetTotp(@CurrentAdmin() a: AuthAdmin, @Param('id') id: string) {
    await this.prisma.admin.update({ where: { id }, data: { totpEnabled: false, totpSecretEnc: null } });
    await this.prisma.adminSession.updateMany({ where: { adminId: id }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorType: 'ADMIN', actorId: a.id, actorLabel: a.email, action: 'admin.totp_reset', targetType: 'Admin', targetId: id });
    return { ok: true };
  }
}
