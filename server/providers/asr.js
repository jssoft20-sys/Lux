import { config } from "../config.js";

export function isEnabled() {
  return config.asr.enabled;
}

/**
 * Распознавание речи через любой OpenAI-совместимый эндпоинт
 * /audio/transcriptions (OpenAI, Groq, локальный whisper.cpp-сервер и т.п.).
 * Возвращает текст диалога из клипа — дальше его ищет Claude.
 */
export async function transcribe({ buffer, filename, mimetype }) {
  if (!config.asr.enabled) return null;

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype || "application/octet-stream" }), filename || "clip.mp4");
  form.append("model", config.asr.model);
  form.append("response_format", "json");

  const response = await fetch(config.asr.url, {
    method: "POST",
    headers: config.asr.apiKey ? { Authorization: `Bearer ${config.asr.apiKey}` } : {},
    body: form,
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ASR ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = (data.text || "").trim();
  return text || null;
}
