/** Supports exact IPs and IPv4 CIDR (e.g. 10.0.0.0/8). Empty list = allow all. */
export function ipAllowed(ip: string, list: string[]): boolean {
  const entries = list.filter(Boolean);
  if (!entries.length) return true;
  const clean = ip.replace(/^::ffff:/, '');
  if (clean === '127.0.0.1' || clean === '::1') return true;
  for (const e of entries) {
    if (e === clean) return true;
    if (e.includes('/')) {
      const [net, bitsS] = e.split('/');
      const bits = Number(bitsS);
      const a = ipv4ToInt(clean);
      const n = ipv4ToInt(net);
      if (a === null || n === null || !Number.isFinite(bits)) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((a & mask) === (n & mask)) return true;
    }
  }
  return false;
}

function ipv4ToInt(ip: string): number | null {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
