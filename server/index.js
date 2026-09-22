import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { config, engineStatus } from "./config.js";
import { router } from "./routes/identify.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "30mb" }));
  app.use(express.urlencoded({ extended: true, limit: "30mb" }));
  app.use(express.static(path.join(here, "..", "public")));
  app.use("/api", router);

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const tooBig = error.code === "LIMIT_FILE_SIZE";
      return res.status(413).json({
        error: tooBig
          ? `Файл больше ${Math.round(config.maxUploadBytes / 1024 / 1024)} МБ. Вырежи 10–20 секунд.`
          : error.message,
      });
    }
    console.error("[lux]", error);
    res.status(500).json({ error: error.message || "Внутренняя ошибка" });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`\n  Lux — распознавание фильмов`);
    console.log(`  http://localhost:${config.port}\n`);
    for (const engine of engineStatus()) {
      console.log(`  ${engine.enabled ? "✓" : "·"} ${engine.title}${engine.enabled ? "" : `  (нужен ${engine.hint})`}`);
    }
    console.log("");
  });
}
