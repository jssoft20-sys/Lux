/** Format a numeric string/number with thin spaces as thousands separator: 50000 -> "50 000" */
export function formatAmount(value: number | string, decimals = 2): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '0';
  const fixed = n.toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac && Number(frac) !== 0 ? `${grouped}.${frac}` : decimals === 0 ? grouped : `${grouped}.${frac}`;
}

export function formatUsdt(value: number | string): string {
  return `${formatAmount(value, 2)} USDT`;
}

export function formatKgs(value: number | string): string {
  return `${formatAmount(value, 0)} KGS`;
}

/** "5K – 200K" style limit label */
export function compactAmount(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
