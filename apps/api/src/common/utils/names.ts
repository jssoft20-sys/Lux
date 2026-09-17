/** Normalise a person name for comparison: lower-case, ё→е, collapse spaces, strip punctuation. */
export function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Names match when every token of the shorter name is present in the longer one and at least
 * two tokens coincide (surname + name). Patronymic may be omitted, order does not matter.
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = normalizeName(a).split(' ').filter(Boolean);
  const tb = normalizeName(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const longSet = new Set(long);
  const common = short.filter((t) => longSet.has(t));
  return common.length === short.length && common.length >= Math.min(2, short.length);
}

/** "Абдыкадыров Бекжан Асанович" -> "Абдыкадыров Б. А." */
export function initialsName(fullName: string): string {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[0]} ${parts
    .slice(1)
    .map((p) => `${p[0]}.`)
    .join(' ')}`;
}
