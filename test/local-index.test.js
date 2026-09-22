import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex, loadMovies, searchLocal } from "../server/providers/local-index.js";

const index = buildIndex(loadMovies());
const top = (query) => searchLocal(query, { index })[0];

test("находит фильм по пересказу сцены", () => {
  assert.equal(top("девочка и киллер который поливает фикус в горшке")?.title, "Леон");
  assert.equal(top("две девочки близняшки в коридоре отеля и топор рубит дверь")?.title, "Сияние");
  assert.equal(top("парень бежит через всю страну с бородой, коробка конфет")?.title, "Форрест Гамп");
});

test("находит фильм по дословной цитате", () => {
  assert.equal(top("на небесах только и разговоров, что о море")?.title, "Достучаться до небес");
  assert.equal(top("в чём сила, брат?")?.title, "Брат");
});

test("находит фильм по саундтреку", () => {
  assert.equal(top("clint mansell lux aeterna")?.title, "Реквием по мечте");
});

test("грубый стеммер переживает падежи", () => {
  assert.equal(top("корабль тонет из-за айсберга, пара на носу корабля")?.title, "Титаник");
});

test("на пустой и бессмысленный запрос отдаёт пустой список", () => {
  assert.deepEqual(searchLocal("", { index }), []);
  assert.deepEqual(searchLocal("щщщ ъъъ", { index }), []);
});

test("уверенность локального поиска честно ограничена", () => {
  for (const candidate of searchLocal("сон во сне волчок", { index })) {
    assert.ok(candidate.confidence <= 0.75);
    assert.ok(candidate.confidence > 0);
  }
});
