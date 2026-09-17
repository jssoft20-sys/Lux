/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient, Prisma, KycLevel, KycStatus, AdSide } from '@prisma/client';
import * as argon2 from 'argon2';
import { createCipheriv, createHash, createHmac, randomBytes } from 'crypto';
import { BANKS, RISK_RULES } from '@somex/shared';

const prisma = new PrismaClient();
const MASTER_KEY = Buffer.from(process.env.MASTER_KEY || '', 'hex');

function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
function blindIndex(value: string) {
  const hmacKey = createHash('sha256').update(Buffer.concat([MASTER_KEY, Buffer.from('somex-blind-index')])).digest();
  return createHmac('sha256', hmacKey).update(value.trim().toLowerCase()).digest('hex');
}
function mask(v: string) {
  return `${v.slice(0, 4)} ${'*'.repeat(Math.max(0, v.length - 8)).replace(/(.{4})/g, '$1 ').trim()} ${v.slice(-4)}`.replace(/\s+/g, ' ');
}

async function seedCatalog() {
  for (const b of BANKS) {
    await prisma.bank.upsert({
      where: { code: b.code },
      create: { code: b.code, name: b.name, shortName: b.shortName, kind: b.kind, color: b.color, logo: b.logo, deepLink: b.deepLink, showsSenderName: b.showsSenderName, accountHint: b.accountHint, accountPattern: b.accountPattern, enabled: b.enabledByDefault, order: b.order },
      update: { name: b.name, shortName: b.shortName, kind: b.kind, color: b.color, logo: b.logo, deepLink: b.deepLink, accountHint: b.accountHint, accountPattern: b.accountPattern, order: b.order },
    });
  }
  for (const r of RISK_RULES) await prisma.riskRule.upsert({ where: { code: r.code }, create: { code: r.code, name: r.name, weight: r.weight }, update: { name: r.name } });
  await prisma.rate.upsert({ where: { asset_fiat: { asset: 'USDT', fiat: 'KGS' } }, create: { asset: 'USDT', fiat: 'KGS', price: '88.60', source: 'manual' }, update: {} });
  await prisma.hotWallet.upsert({ where: { network: 'TRON' }, create: { network: 'TRON', address: 'TSomexHotWalletNotConfigured000000', balanceCached: 0, dailyLimit: 50000, singleLimit: 10000 }, update: {} });
}

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@somex.kg').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe!2026';
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (!existing) {
    await prisma.admin.create({ data: { email, name: process.env.ADMIN_NAME || 'Superadmin', role: 'SUPERADMIN', passwordHash: await argon2.hash(password, { type: argon2.argon2id }), mustChangePassword: true } });
    console.log(`superadmin created: ${email}`);
  }
  for (const [e, name, role] of [
    ['compliance@somex.kg', 'Айгерим (Compliance)', 'COMPLIANCE'],
    ['finance@somex.kg', 'Нурлан (Finance)', 'FINANCE'],
    ['risk@somex.kg', 'Данияр (Risk)', 'RISK'],
    ['support@somex.kg', 'Салтанат (Support)', 'SUPPORT'],
  ] as const) {
    if (!(await prisma.admin.findUnique({ where: { email: e } }))) {
      await prisma.admin.create({ data: { email: e, name, role, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), mustChangePassword: true } });
    }
  }
}

interface DemoUser {
  phone: string;
  firstName: string;
  lastName: string;
  patronymic: string;
  nickname: string;
  balance: string;
  completed: number;
  rating: number;
  banks: Array<[string, string]>;
  daysOld: number;
  doc: string;
}

const DEMO: DemoUser[] = [
  { phone: '+996555123456', firstName: 'Бекжан', lastName: 'Абдыкадыров', patronymic: 'Асанович', nickname: 'Бекжан А.', balance: '1250', completed: 1248, rating: 4.9, banks: [['OPTIMA', '4169585512341234'], ['MBANK', '996555123456']], daysOld: 240, doc: 'ID1234567' },
  { phone: '+996700111222', firstName: 'Мирлан', lastName: 'Асанов', patronymic: 'Талантович', nickname: 'AltynTrade', balance: '18500', completed: 1284, rating: 4.95, banks: [['OPTIMA', '4169580000001234'], ['MBANK', '996700111222']], daysOld: 400, doc: 'ID2234567' },
  { phone: '+996555777888', firstName: 'Азамат', lastName: 'Абдымомунов', patronymic: 'Темирланович', nickname: 'KGS_Exchange', balance: '9400', completed: 892, rating: 4.8, banks: [['OPTIMA', '4169587777001111'], ['BAKAI', '5555444433332222']], daysOld: 300, doc: 'ID3234567' },
  { phone: '+996777333444', firstName: 'Айжан', lastName: 'Сыдыкова', patronymic: 'Бакытовна', nickname: 'Bishkek_Crypto', balance: '6200', completed: 643, rating: 4.85, banks: [['BAKAI', '5555000011112222'], ['DEMIR', '4444333322221111']], daysOld: 210, doc: 'ID4234567' },
  { phone: '+996999555666', firstName: 'Нарын', lastName: 'Токтогулов', patronymic: 'Эмилевич', nickname: 'Naryn_USDT', balance: '3300', completed: 421, rating: 4.7, banks: [['MBANK', '996999555666'], ['OPTIMA', '4169589999005555']], daysOld: 150, doc: 'ID5234567' },
  { phone: '+996550101010', firstName: 'Эльдар', lastName: 'Мамбетов', patronymic: 'Русланович', nickname: 'Eldar_Osh', balance: '2100', completed: 96, rating: 4.6, banks: [['DEMIR', '4444999988887777'], ['MBANK', '996550101010']], daysOld: 60, doc: 'ID6234567' },
  { phone: '+996222444666', firstName: 'Жылдыз', lastName: 'Осмонова', patronymic: 'Канатовна', nickname: 'Jyldyz', balance: '350', completed: 12, rating: 4.4, banks: [['OPTIMA', '4169582222004444']], daysOld: 20, doc: 'ID7234567' },
  { phone: '+996770909090', firstName: 'Тимур', lastName: 'Жумабеков', patronymic: 'Нурланович', nickname: 'Timur_New', balance: '0', completed: 0, rating: 0, banks: [], daysOld: 1, doc: '' },
  // dedicated test account: KYC passed, PIN 0000, accounts in three banks
  { phone: '+996500000000', firstName: 'Тест', lastName: 'Тестов', patronymic: 'Тестович', nickname: 'Tester', balance: '5000', completed: 25, rating: 4.8, banks: [['OPTIMA', '4169580000009999'], ['MBANK', '996500000000'], ['BAKAI', '5555000000009999']], daysOld: 30, doc: 'ID0000001' },
];

async function seedUsers() {
  const created: Record<string, string> = {};
  for (const d of DEMO) {
    let u = await prisma.user.findUnique({ where: { phone: d.phone } });
    if (u) {
      created[d.phone] = u.id;
      // re-seeding a test stand: drop a new-device lock left by an earlier configuration
      if (u.sensitiveOpsLockedUntil) await prisma.user.update({ where: { id: u.id }, data: { sensitiveOpsLockedUntil: null } });
      continue;
    }
    const fullName = `${d.lastName} ${d.firstName} ${d.patronymic}`;
    const createdAt = new Date(Date.now() - d.daysOld * 86_400_000);
    const kyc = d.doc !== '';
    u = await prisma.user.create({
      data: {
        phone: d.phone,
        firstName: d.firstName,
        lastName: d.lastName,
        fullName: kyc ? fullName : null,
        nickname: d.nickname,
        kycLevel: kyc ? (d.completed > 500 ? KycLevel.ADVANCED : KycLevel.VERIFIED) : KycLevel.BASIC,
        kycStatus: kyc ? KycStatus.APPROVED : KycStatus.NOT_STARTED,
        documentNumberHash: kyc ? blindIndex(`doc:KGZ:${d.doc}`) : null,
        documentCountry: kyc ? 'KGZ' : null,
        dateOfBirth: kyc ? new Date('1995-05-12') : null,
        completedOrders: d.completed,
        ratingSum: Math.round(d.rating * Math.max(1, Math.min(d.completed, 200))),
        ratingCount: Math.max(1, Math.min(d.completed, 200)),
        trustScore: 50 + Math.min(45, Math.floor(d.completed / 30)),
        lastSeenAt: new Date(),
        createdAt,
        balance: { create: { available: new Prisma.Decimal(d.balance), locked: 0 } },
        pinHash: d.phone === '+996555123456' ? await argon2.hash('1234', { type: argon2.argon2id }) : d.phone === '+996500000000' ? await argon2.hash('0000', { type: argon2.argon2id }) : null,
      },
    });
    created[d.phone] = u.id;
    if (Number(d.balance) > 0) {
      const journalId = randomBytes(8).toString('hex');
      await prisma.ledgerEntry.createMany({
        data: [
          { journalId, userId: u.id, account: 'USER_AVAILABLE', delta: new Prisma.Decimal(d.balance), refType: 'DEPOSIT', refId: 'seed', memo: 'Стартовый депозит (seed)' },
          { journalId, account: 'PLATFORM_HOT_WALLET', delta: new Prisma.Decimal(d.balance).negated(), refType: 'DEPOSIT', refId: 'seed', memo: 'Стартовый депозит (seed)' },
        ],
      });
      await prisma.deposit.create({ data: { userId: u.id, network: 'TRON', txHash: `seed-${u.id.slice(0, 8)}`, fromAddress: 'TBinanceHotWallet0000000000000000000', toAddress: `TSomex${u.id.slice(0, 28)}`, amount: new Prisma.Decimal(d.balance), confirmations: 19, requiredConfirmations: 19, status: 'CREDITED', screeningRisk: 'LOW', creditedAt: createdAt } });
    }
    if (kyc) {
      await prisma.kycVerification.create({ data: { userId: u.id, provider: 'seed', providerSessionId: `seed-${u.id}`, status: KycStatus.APPROVED, firstName: d.firstName, lastName: d.lastName, fullName, dateOfBirth: new Date('1995-05-12'), documentType: 'Identity Card', documentNumberHash: blindIndex(`doc:KGZ:${d.doc}`), documentNumberMasked: `${d.doc.slice(0, 2)}•••${d.doc.slice(-2)}`, documentCountry: 'KGZ', faceMatchScore: 0.97, livenessScore: 0.99, completedAt: createdAt } });
      for (const [bank, acc] of d.banks) {
        await prisma.paymentMethod.create({ data: { userId: u.id, bankCode: bank, holderName: fullName, accountNumberEnc: encrypt(acc), accountMasked: mask(acc), accountHash: blindIndex(`${bank}:${acc}`), status: 'ACTIVE', nameMatchesKyc: true } });
      }
    }
  }
  return created;
}

async function seedAds(users: Record<string, string>) {
  if ((await prisma.ad.count()) > 0) return;
  const ads: Array<[string, AdSide, string, string, number, number, number, string]> = [
    ['+996700111222', 'SELL', '88.40', 'OPTIMA', 5000, 200000, 12000, 'BISHKEK'],
    ['+996700111222', 'SELL', '88.45', 'MBANK', 5000, 150000, 5000, 'ALL'],
    ['+996555777888', 'SELL', '88.50', 'OPTIMA', 10000, 500000, 8000, 'BISHKEK'],
    ['+996777333444', 'SELL', '88.60', 'BAKAI', 5000, 300000, 3000, 'ALL'],
    ['+996999555666', 'SELL', '88.70', 'MBANK', 20000, 1000000, 3000, 'ALL'],
    ['+996550101010', 'SELL', '88.90', 'DEMIR', 3000, 100000, 1000, 'OSH_CITY'],
    ['+996555777888', 'BUY', '87.90', 'OPTIMA', 5000, 400000, 4000, 'ALL'],
    ['+996777333444', 'BUY', '87.80', 'BAKAI', 5000, 200000, 2000, 'ALL'],
    ['+996999555666', 'BUY', '87.70', 'MBANK', 10000, 300000, 2500, 'ALL'],
  ];
  for (const [phone, side, price, bank, min, max, total, region] of ads) {
    await prisma.ad.create({ data: { userId: users[phone], side, price: new Prisma.Decimal(price), minAmountFiat: min, maxAmountFiat: max, totalAmount: total, availableAmount: total, bankCode: bank, region, terms: 'Оплата только со своего счёта. Перевод от третьих лиц не принимаю. Чек — не доказательство.', paymentWindowMin: 15, completedCount: Math.floor(Math.random() * 300) } });
  }
}

async function main() {
  console.log('seeding catalog…');
  await seedCatalog();
  console.log('seeding admins…');
  await seedAdmin();
  console.log('seeding demo users…');
  const users = await seedUsers();
  console.log('seeding ads…');
  await seedAds(users);
  console.log('done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
