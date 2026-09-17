import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);
dayjs.locale('ru');

export { dayjs };

export function fmt(n: number | string | null | undefined, decimals = 2): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(decimals);
  const [i, f] = s.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return f !== undefined && decimals > 0 ? `${grouped}.${f}` : grouped;
}

export const usdt = (n: number | string | null | undefined) => `${fmt(n, 2)} USDT`;
export const kgs = (n: number | string | null | undefined) => `${fmt(n, 0)} KGS`;
export const time = (d: string | Date) => dayjs(d).format('HH:mm');
export const date = (d: string | Date) => dayjs(d).format('D MMM, HH:mm');
export const ago = (d: string | Date) => dayjs(d).fromNow();

export function countdown(until: string | Date): { total: number; label: string } {
  const total = Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return { total, label: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` };
}

export const STATUS_LABEL: Record<string, string> = {
  CREATED: 'Ожидание оплаты',
  PAID: 'Оплачено, ждём продавца',
  RELEASED: 'Завершена',
  CANCELLED: 'Отменена',
  EXPIRED: 'Истекла',
  DISPUTED: 'Спор',
  RESOLVED_RELEASE: 'Решено: USDT покупателю',
  RESOLVED_REFUND: 'Решено: возврат продавцу',
};

export const STATUS_TONE: Record<string, string> = {
  CREATED: 'status-yellow',
  PAID: 'status-blue',
  RELEASED: 'status-green',
  CANCELLED: 'status-gray',
  EXPIRED: 'status-gray',
  DISPUTED: 'status-red',
  RESOLVED_RELEASE: 'status-green',
  RESOLVED_REFUND: 'status-gray',
};

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}
