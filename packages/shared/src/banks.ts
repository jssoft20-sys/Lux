/**
 * Banks and e-wallets of Kyrgyzstan supported for P2P settlement.
 * The list mirrors the payment options exposed by the Finik QR ecosystem
 * (https://qr.finik.kg) so that users see the same brands they already use.
 *
 * `showsSenderName` is critical for anti-fraud: with these providers the seller
 * can see the payer's full name inside the banking app and match it to the
 * buyer's KYC name. Providers that hide the payer identity are allowed only
 * with an explicit warning (Binance P2P applies the same rule).
 */
export type BankKind = 'BANK' | 'EWALLET' | 'CARD';

export interface BankInfo {
  code: string;
  name: string;
  shortName: string;
  kind: BankKind;
  /** brand colour used for chips/avatars */
  color: string;
  /** logo file served from /banks/<logo> in the web apps */
  logo: string;
  /** deep link template of the mobile app (payload is a Finik/ELQR string) */
  deepLink?: string;
  showsSenderName: boolean;
  /** account identifier format hint */
  accountHint: string;
  accountPattern: string;
  enabledByDefault: boolean;
  order: number;
}

export const BANKS: BankInfo[] = [
  { code: 'MBANK', name: 'MBANK (Айыл Банк)', shortName: 'Mbank', kind: 'BANK', color: '#1DB954', logo: 'mbank.png', deepLink: 'https://app.mbank.kg/qr/#{payload}', showsSenderName: true, accountHint: 'Номер телефона или счёта', accountPattern: '^(\\+?996\\d{9}|\\d{16,20})$', enabledByDefault: true, order: 1 },
  { code: 'OPTIMA', name: 'Optima Bank', shortName: 'Optima', kind: 'BANK', color: '#E3001B', logo: 'optima.png', deepLink: 'https://mobile.optima24.kg/my-qr/confirm-screen?qr-url=#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: true, order: 2 },
  { code: 'BAKAI', name: 'Bakai Bank', shortName: 'Bakai Bank', kind: 'BANK', color: '#0A5BD3', logo: 'bakai.png', deepLink: 'https://bakai.app/#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: true, order: 3 },
  { code: 'DEMIR', name: 'Демир Банк', shortName: 'ДемирБанк', kind: 'BANK', color: '#D81E2C', logo: 'demir.png', deepLink: 'https://retail.demirbank.kg/#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: true, order: 4 },
  { code: 'ELSOM', name: 'Элсом', shortName: 'Элсом', kind: 'EWALLET', color: '#F5B400', logo: 'elsom.svg', showsSenderName: false, accountHint: 'Номер телефона кошелька', accountPattern: '^\\+?996\\d{9}$', enabledByDefault: true, order: 5 },
  { code: 'BALANCE', name: 'Balance.kg', shortName: 'Balance', kind: 'EWALLET', color: '#6B7280', logo: 'balance.png', deepLink: 'https://balance.kg/#{payload}', showsSenderName: false, accountHint: 'Номер телефона кошелька', accountPattern: '^\\+?996\\d{9}$', enabledByDefault: true, order: 6 },
  { code: 'KICB', name: 'KICB', shortName: 'KICB', kind: 'BANK', color: '#0B3D91', logo: 'kicb.png', deepLink: 'https://bank.kicb.net/#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: true, order: 7 },
  { code: 'ELDIK', name: 'Элдик Банк', shortName: 'Элдик', kind: 'BANK', color: '#E4322B', logo: 'eldik.png', deepLink: 'https://app.eldik.kg/#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: true, order: 8 },
  { code: 'RSK', name: 'РСК Банк', shortName: 'РСК24', kind: 'BANK', color: '#0E7C3A', logo: 'rsk.png', deepLink: 'https://qr.rsk.kg/#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: true, order: 9 },
  { code: 'AIYL', name: 'Айыл Банк (АБ24)', shortName: 'АБ24', kind: 'BANK', color: '#0E9F6E', logo: 'aiyl-bank.png', deepLink: 'https://qr.ab.kg/#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: true, order: 10 },
  { code: 'KOMPANION', name: 'Банк Компаньон', shortName: 'Компаньон', kind: 'BANK', color: '#F26A21', logo: 'companion.png', deepLink: 'https://24.kompanion.kg/qr/#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: true, order: 11 },
  { code: 'ODENGI', name: 'О!Деньги', shortName: 'О!Деньги', kind: 'EWALLET', color: '#7B2CBF', logo: 'odengi.png', deepLink: 'https://api.dengi.o.kg/#{payload}', showsSenderName: false, accountHint: 'Номер телефона кошелька', accountPattern: '^\\+?996\\d{9}$', enabledByDefault: true, order: 12 },
  { code: 'MEGAPAY', name: 'MegaPay', shortName: 'MegaPay', kind: 'EWALLET', color: '#00B4D8', logo: 'megapay.png', deepLink: 'https://megapay.kg/get#{payload}', showsSenderName: false, accountHint: 'Номер телефона кошелька', accountPattern: '^\\+?996\\d{9}$', enabledByDefault: true, order: 13 },
  { code: 'FINIK', name: 'Finik', shortName: 'Finik', kind: 'EWALLET', color: '#6C3AF5', logo: 'finik.png', deepLink: 'finik://#{payload}', showsSenderName: false, accountHint: 'Номер телефона', accountPattern: '^\\+?996\\d{9}$', enabledByDefault: true, order: 14 },
  { code: 'NAMBAONE', name: 'NambaOne', shortName: 'NambaOne', kind: 'EWALLET', color: '#FF3D71', logo: 'nambaone.png', deepLink: 'https://nambaone.app/#{payload}', showsSenderName: false, accountHint: 'Номер телефона', accountPattern: '^\\+?996\\d{9}$', enabledByDefault: false, order: 15 },
  { code: 'SIMBANK', name: 'Simbank', shortName: 'Simbank', kind: 'BANK', color: '#111827', logo: 'simbank.png', deepLink: 'https://simbank.kg/scan_to_pay?payload=#{payload}', showsSenderName: true, accountHint: 'Номер карты или счёта', accountPattern: '^\\d{16,20}$', enabledByDefault: false, order: 16 },
  { code: 'ELCART', name: 'Элкарт (карта)', shortName: 'Elcart', kind: 'CARD', color: '#0F766E', logo: 'elcart.png', deepLink: 'https://pay.payqr.kg/#{payload}', showsSenderName: false, accountHint: 'Номер карты Элкарт', accountPattern: '^\\d{16}$', enabledByDefault: false, order: 17 },
];

export const BANK_MAP: Record<string, BankInfo> = Object.fromEntries(BANKS.map((b) => [b.code, b]));

export function getBank(code: string): BankInfo | undefined {
  return BANK_MAP[code];
}
