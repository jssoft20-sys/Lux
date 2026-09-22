import express from "express";
import multer from "multer";
import { config, engineStatus } from "../config.js";
import { identifyByAudio, identifyByFrame, identifyByText } from "../lib/pipeline.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const router = express.Router();

router.get("/status", (req, res) => {
  res.json({ engines: engineStatus(), model: config.claude.model });
});

router.post("/identify/text", async (req, res, next) => {
  try {
    const description = String(req.body?.description || "").trim();
    if (description.length < 10) {
      return res.status(400).json({ error: "Опиши сцену подробнее — хотя бы одно предложение." });
    }
    res.json(await identifyByText(description.slice(0, 4000)));
  } catch (error) {
    next(error);
  }
});

router.post("/identify/frame", upload.single("image"), async (req, res, next) => {
  try {
    const hint = String(req.body?.hint || "").trim().slice(0, 500);
    let base64 = null;
    let mediaType = null;

    if (req.file) {
      mediaType = req.file.mimetype;
      base64 = req.file.buffer.toString("base64");
    } else if (req.body?.imageBase64) {
      const raw = String(req.body.imageBase64);
      const match = raw.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      mediaType = match ? match[1] : req.body.mediaType || "image/png";
      base64 = match ? match[2] : raw;
    }

    if (!base64) return res.status(400).json({ error: "Не пришёл кадр." });
    if (!IMAGE_TYPES.has(mediaType)) {
      return res.status(400).json({ error: `Формат ${mediaType} не поддерживается. Нужен PNG, JPEG, WEBP или GIF.` });
    }

    res.json(await identifyByFrame({ base64, mediaType, hint }));
  } catch (error) {
    next(error);
  }
});

router.post("/identify/audio", upload.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Не пришёл аудиофайл." });
    const hint = String(req.body?.hint || "").trim().slice(0, 500);
    res.json(
      await identifyByAudio({
        buffer: req.file.buffer,
        filename: req.file.originalname || "clip.webm",
        mimetype: req.file.mimetype,
        hint,
      }),
    );
  } catch (error) {
    next(error);
  }
});
