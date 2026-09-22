import { config } from "../config.js";

const BASE = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p/w342";

export function isEnabled() {
  return config.tmdb.enabled;
}

async function tmdbFetch(pathname, params) {
  const url = new URL(BASE + pathname);
  url.searchParams.set("api_key", config.tmdb.apiKey);
  url.searchParams.set("language", config.tmdb.language);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json();
}

function pickBest(results, candidate) {
  if (!results?.length) return null;
  const year = candidate.year ? Number(candidate.year) : null;
  const withYear = year
    ? results.filter((item) => {
        const date = item.release_date || item.first_air_date || "";
        const itemYear = Number(date.slice(0, 4));
        return itemYear && Math.abs(itemYear - year) <= 1;
      })
    : [];
  const pool = withYear.length ? withYear : results;
  return pool.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
}

/**
 * Подтверждает кандидата в базе TMDB и добавляет постер, год, ссылку.
 * Если фильма в TMDB нет — это сигнал, что модель могла его выдумать.
 */
export async function enrich(candidate) {
  if (!config.tmdb.enabled) return null;
  const query = candidate.original || candidate.title;
  if (!query) return null;

  try {
    let data = await tmdbFetch("/search/multi", {
      query,
      year: candidate.year || undefined,
      include_adult: "false",
    });
    let best = pickBest(
      (data.results || []).filter((item) => item.media_type !== "person"),
      candidate,
    );

    if (!best && candidate.title && candidate.title !== query) {
      data = await tmdbFetch("/search/multi", { query: candidate.title, include_adult: "false" });
      best = pickBest(
        (data.results || []).filter((item) => item.media_type !== "person"),
        candidate,
      );
    }
    if (!best) return null;

    const date = best.release_date || best.first_air_date || "";
    const mediaType = best.media_type === "tv" ? "tv" : "movie";
    return {
      tmdbId: best.id,
      mediaType,
      title: best.title || best.name || candidate.title,
      original: best.original_title || best.original_name || candidate.original,
      year: date ? Number(date.slice(0, 4)) : candidate.year,
      overview: best.overview || "",
      poster: best.poster_path ? IMAGE + best.poster_path : null,
      rating: best.vote_average ? Number(best.vote_average.toFixed(1)) : null,
      url: `https://www.themoviedb.org/${mediaType}/${best.id}`,
    };
  } catch {
    return null;
  }
}

export async function enrichAll(candidates) {
  return Promise.all(
    candidates.map(async (candidate) => {
      const info = await enrich(candidate);
      if (!info) return { ...candidate, verified: false };
      return {
        ...candidate,
        title: info.title || candidate.title,
        original: info.original || candidate.original,
        year: info.year || candidate.year,
        verified: true,
        poster: info.poster,
        overview: info.overview,
        rating: info.rating,
        mediaType: info.mediaType,
        tmdbUrl: info.url,
      };
    }),
  );
}
