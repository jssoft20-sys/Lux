import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stem, stemAll, tokenize } from "../lib/text.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(here, "..", "..", "data", "movies.json");

// Поля с разным весом: точная цитата говорит больше, чем слово из пересказа.
const FIELD_WEIGHTS = {
  title: 3,
  original: 3,
  tags: 2.2,
  quotes: 2.6,
  scenes: 2,
  plot: 1.4,
  director: 1.5,
};

let index = null;

export function loadMovies(file = DATA_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function buildIndex(movies) {
  const docs = movies.map((movie) => {
    const weights = new Map();
    const addField = (value, weight) => {
      for (const token of stemAll(value)) {
        weights.set(token, (weights.get(token) || 0) + weight);
      }
    };

    addField(movie.title, FIELD_WEIGHTS.title);
    addField(movie.original, FIELD_WEIGHTS.original);
    addField(movie.director, FIELD_WEIGHTS.director);
    addField(movie.plot, FIELD_WEIGHTS.plot);
    for (const tag of movie.tags || []) addField(tag, FIELD_WEIGHTS.tags);
    for (const quote of movie.quotes || []) addField(quote, FIELD_WEIGHTS.quotes);
    for (const scene of movie.scenes || []) addField(scene, FIELD_WEIGHTS.scenes);
    for (const track of movie.music || []) addField(track, FIELD_WEIGHTS.tags);

    const phrases = [
      ...(movie.tags || []),
      ...(movie.quotes || []),
      ...(movie.scenes || []),
      ...(movie.music || []),
    ].map((phrase) => phrase.toLowerCase().replace(/ё/g, "е"));

    return { movie, weights, phrases };
  });

  const df = new Map();
  for (const doc of docs) {
    for (const token of doc.weights.keys()) df.set(token, (df.get(token) || 0) + 1);
  }
  const idf = new Map();
  for (const [token, count] of df) {
    idf.set(token, Math.log(1 + docs.length / count));
  }

  return { docs, idf };
}

function getIndex() {
  if (!index) index = buildIndex(loadMovies());
  return index;
}

/**
 * Поиск по локальному индексу. Работает без единого API-ключа —
 * это страховка, чтобы приложение всегда что-то отвечало.
 */
export function searchLocal(query, { limit = 5, index: injected } = {}) {
  const { docs, idf } = injected || getIndex();
  const queryTokens = [...new Set(tokenize(query).map(stem))];
  if (!queryTokens.length) return [];

  const normalizedQuery = String(query).toLowerCase().replace(/ё/g, "е");

  const scored = docs.map((doc) => {
    let score = 0;
    const hits = [];
    for (const token of queryTokens) {
      const weight = doc.weights.get(token);
      if (!weight) continue;
      score += weight * (idf.get(token) || 1);
      hits.push(token);
    }
    // Бонус за дословно совпавшую фразу (цитата, описание сцены, трек).
    for (const phrase of doc.phrases) {
      if (phrase.length >= 8 && normalizedQuery.includes(phrase)) {
        score += 12;
        hits.push(phrase);
      }
    }
    return { doc, score, hits };
  });

  const best = Math.max(...scored.map((item) => item.score), 0);
  if (best <= 0) return [];

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, score, hits }) => ({
      title: doc.movie.title,
      original: doc.movie.original,
      year: doc.movie.year,
      // Уверенность локального индекса намеренно скромная: это лексический
      // поиск по маленькой базе, а не понимание смысла.
      confidence: Math.min(0.75, (score / best) * (score / (score + 14))),
      reason: `Совпадения в офлайн-индексе: ${[...new Set(hits)].slice(0, 5).join(", ")}`,
    }))
    .filter((candidate) => candidate.confidence > 0.05);
}

export function resetIndexCache() {
  index = null;
}
