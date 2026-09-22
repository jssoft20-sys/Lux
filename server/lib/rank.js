/**
 * Слияние и ранжирование кандидатов из разных движков.
 *
 * Каждый движок отдаёт свои догадки со своей уверенностью; здесь они
 * склеиваются по названию/году и складываются по формуле «noisy-or»:
 * два независимых слабых сигнала дают более сильный общий,
 * но ни один не может дать 100%.
 */

const ARTICLES = /^(the|a|an|le|la|les|el|los|das|der|die)\s+/i;

export function normalizeTitle(value) {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[`'’"«»„“”]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(ARTICLES, "")
    .replace(/\s+/g, " ");
}

function namesOf(candidate) {
  return [candidate.title, candidate.original]
    .map(normalizeTitle)
    .filter(Boolean);
}

function yearsCompatible(a, b) {
  if (!a || !b) return true;
  return Math.abs(Number(a) - Number(b)) <= 1;
}

function sameMovie(a, b) {
  if (!yearsCompatible(a.year, b.year)) return false;
  const left = namesOf(a);
  const right = namesOf(b);
  return left.some((name) => right.includes(name));
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

/**
 * @param {{source: string, weight?: number, candidates: Array<object>}[]} groups
 * @param {{limit?: number}} [options]
 */
export function mergeCandidates(groups, { limit = 6 } = {}) {
  const merged = [];

  for (const group of groups || []) {
    if (!group || !Array.isArray(group.candidates)) continue;
    const weight = clamp01(group.weight ?? 1);
    if (weight === 0) continue;

    for (const raw of group.candidates) {
      if (!raw || (!raw.title && !raw.original)) continue;
      const candidate = {
        title: raw.title || raw.original,
        original: raw.original || "",
        year: raw.year ? Number(raw.year) : null,
        confidence: clamp01(raw.confidence ?? 0.5),
        reasons: [],
        sources: [],
      };
      const signal = candidate.confidence * weight;
      if (signal <= 0) continue;

      const existing = merged.find((item) => sameMovie(item, candidate));
      const target = existing || candidate;
      if (!existing) merged.push(candidate);

      // noisy-or: 1 - (1-p1)(1-p2)
      target.confidence = existing
        ? 1 - (1 - target.confidence) * (1 - signal)
        : signal;
      target.year = target.year || candidate.year;
      target.original = target.original || candidate.original;
      if (!target.sources.includes(group.source)) target.sources.push(group.source);
      if (raw.reason && !target.reasons.includes(raw.reason)) {
        target.reasons.push(String(raw.reason));
      }
    }
  }

  return merged
    .map((item) => ({ ...item, confidence: Math.min(0.99, Number(item.confidence.toFixed(3))) }))
    .sort((a, b) => b.confidence - a.confidence || (b.sources.length - a.sources.length))
    .slice(0, limit);
}
