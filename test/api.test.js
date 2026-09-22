import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";

async function withServer(run) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
  }
}

test("GET /api/status перечисляет движки", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/status`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.ok(data.engines.some((engine) => engine.id === "local" && engine.enabled));
    assert.ok(data.model);
  });
});

test("POST /api/identify/text работает без ключей — через офлайн-индекс", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/identify/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "девочка и киллер с фикусом в горшке, нью-йорк" }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.candidates[0].title, "Леон");
    assert.ok(data.steps.some((step) => step.engine === "local"));
  });
});

test("слишком короткое описание отклоняется с понятной ошибкой", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/identify/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "кино" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /подробнее/i);
  });
});

test("кадр без файла отклоняется", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/identify/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  });
});

test("статика отдаётся", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Lux/);
  });
});
