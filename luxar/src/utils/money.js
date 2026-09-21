export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function fmtMoney(n, symbol = '$', digits = 0) {
  const v = Number(n) || 0;
  const s = v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) });
  return symbol === '$' ? `$${s}` : `${s} ${symbol}`;
}

export function fmtKgs(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} сом`;
}

export function fmtUsdt(n) {
  return `${round2(n).toFixed(2)} USDT`;
}
