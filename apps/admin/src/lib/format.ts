import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);
dayjs.locale('ru');
export { dayjs };

export function fmt(n: number | string | null | undefined, d = 2) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  const [i, f] = v.toFixed(d).split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return d > 0 ? `${g}.${f}` : g;
}
export const dt = (d?: string | Date | null) => (d ? dayjs(d).format('DD.MM.YY HH:mm') : '—');
export const ago = (d?: string | Date | null) => (d ? dayjs(d).fromNow() : '—');
export const short = (s?: string | null, n = 8) => (s ? `${s.slice(0, n)}…` : '—');
export const cn = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(' ');

export const TONE: Record<string, string> = {
  ACTIVE: 'tag-green', RESTRICTED: 'tag-yellow', FROZEN: 'tag-red', BANNED: 'tag-red',
  APPROVED: 'tag-green', IN_REVIEW: 'tag-yellow', IN_PROGRESS: 'tag-blue', DECLINED: 'tag-red', NOT_STARTED: 'tag-gray', EXPIRED: 'tag-gray',
  CREATED: 'tag-yellow', PAID: 'tag-blue', RELEASED: 'tag-green', CANCELLED: 'tag-gray', DISPUTED: 'tag-red', RESOLVED_RELEASE: 'tag-green', RESOLVED_REFUND: 'tag-gray',
  DETECTED: 'tag-blue', CONFIRMING: 'tag-blue', SCREENING: 'tag-yellow', HELD: 'tag-red', CREDITED: 'tag-green', REJECTED: 'tag-red',
  AWAITING_OTP: 'tag-gray', RISK_REVIEW: 'tag-red', APPROVAL_REQUIRED: 'tag-yellow', BROADCASTING: 'tag-blue', SENT: 'tag-green', CONFIRMED: 'tag-green', FAILED: 'tag-red',
  OPEN: 'tag-red', UNDER_REVIEW: 'tag-yellow', RESOLVED_PARTIAL: 'tag-green', CLOSED: 'tag-gray',
  ALLOW: 'tag-green', REVIEW: 'tag-yellow', BLOCK: 'tag-red',
  PENDING: 'tag-yellow', CONFIRMED_FRAUD: 'tag-red', FALSE_POSITIVE: 'tag-gray', NOTED: 'tag-blue',
  PAUSED: 'tag-gray', VERIFIED: 'tag-green', ADVANCED: 'tag-purple', BASIC: 'tag-gray',
  ANSWERED: 'tag-green', CLEAN: 'tag-green', INFECTED: 'tag-red', SKIPPED: 'tag-yellow',
};
