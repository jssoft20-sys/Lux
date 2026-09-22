import test from "node:test";
import assert from "node:assert/strict";
import { mergeCandidates, normalizeTitle } from "../server/lib/rank.js";

test("normalizeTitle убирает регистр, артикли и пунктуацию", () => {
  assert.equal(normalizeTitle("The Matrix"), "matrix");
  assert.equal(normalizeTitle("«Брат»"), "брат");
  assert.equal(normalizeTitle("Léon: The Professional"), "léon the professional");
  assert.equal(normalizeTitle("Зелёная миля"), "зеленая миля");
});

test("два движка про один фильм усиливают друг друга, но не дают 100%", () => {
  const merged = mergeCandidates([
    { source: "claude", weight: 1, candidates: [{ title: "Начало", original: "Inception", year: 2010, confidence: 0.6 }] },
    { source: "local", weight: 0.5, candidates: [{ title: "Начало", year: 2010, confidence: 0.6 }] },
  ]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ["claude", "local"]);
  assert.ok(merged[0].confidence > 0.6, "совместный сигнал сильнее одиночного");
  assert.ok(merged[0].confidence < 1);
});

test("разные фильмы не склеиваются, сортировка по уверенности", () => {
  const merged = mergeCandidates([
    {
      source: "claude",
      weight: 1,
      candidates: [
        { title: "Матрица", year: 1999, confidence: 0.3 },
        { title: "Начало", year: 2010, confidence: 0.8 },
      ],
    },
  ]);

  assert.deepEqual(merged.map((item) => item.title), ["Начало", "Матрица"]);
});

test("ремейк с другим годом остаётся отдельным фильмом", () => {
  const merged = mergeCandidates([
    { source: "a", weight: 1, candidates: [{ title: "Дюна", year: 1984, confidence: 0.5 }] },
    { source: "b", weight: 1, candidates: [{ title: "Дюна", year: 2021, confidence: 0.5 }] },
  ]);

  assert.equal(merged.length, 2);
});

test("кандидат склеивается по оригинальному названию при разном переводе", () => {
  const merged = mergeCandidates([
    { source: "a", weight: 1, candidates: [{ title: "Помни", original: "Memento", year: 2000, confidence: 0.5 }] },
    { source: "b", weight: 1, candidates: [{ title: "Мементо", original: "Memento", year: 2000, confidence: 0.4 }] },
  ]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ["a", "b"]);
});

test("мусорные значения не роняют ранжирование", () => {
  const merged = mergeCandidates([
    { source: "a", weight: 1, candidates: [null, {}, { title: "Чужой", confidence: "не число" }] },
    null,
  ]);

  assert.equal(merged.length, 0, "confidence без числа считается нулевым сигналом");
});
