import test from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "../server/lib/json.js";

test("разбирает чистый JSON", () => {
  assert.deepEqual(extractJson('{"candidates":[]}'), { candidates: [] });
});

test("разбирает JSON в markdown-блоке", () => {
  const text = 'Вот ответ:\n```json\n{"candidates":[{"title":"Начало"}]}\n```\nГотово.';
  assert.equal(extractJson(text).candidates[0].title, "Начало");
});

test("вытаскивает JSON из текста вокруг", () => {
  const text = 'Думаю, это {"candidates":[{"title":"Матрица","year":1999}]} — точно она.';
  assert.equal(extractJson(text).candidates[0].year, 1999);
});

test("возвращает null на мусоре", () => {
  assert.equal(extractJson("просто текст без json"), null);
  assert.equal(extractJson(""), null);
  assert.equal(extractJson(undefined), null);
});
