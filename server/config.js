import "dotenv/config";

const bool = (value, fallback = false) => {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
};

export const config = {
  port: Number(process.env.PORT || 3000),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024,

  claude: {
    // SDK сам подхватит ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / профиль ant auth.
    enabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.CLAUDE_MODEL || "claude-opus-5",
    webSearch: bool(process.env.ENABLE_WEB_SEARCH, true),
  },

  tmdb: {
    enabled: Boolean(process.env.TMDB_API_KEY),
    apiKey: process.env.TMDB_API_KEY || "",
    language: process.env.TMDB_LANGUAGE || "ru-RU",
  },

  asr: {
    enabled: Boolean(process.env.ASR_API_URL),
    url: process.env.ASR_API_URL || "",
    apiKey: process.env.ASR_API_KEY || "",
    model: process.env.ASR_MODEL || "whisper-1",
  },

  audd: {
    enabled: Boolean(process.env.AUDD_API_TOKEN),
    token: process.env.AUDD_API_TOKEN || "",
  },
};

/** Что реально включено — это отдаётся в UI, чтобы не обещать лишнего. */
export function engineStatus() {
  return [
    {
      id: "claude",
      title: "Claude (смысл, кадр, реплики)",
      enabled: config.claude.enabled,
      hint: "ANTHROPIC_API_KEY",
    },
    {
      id: "web",
      title: "Поиск по вебу внутри Claude",
      enabled: config.claude.enabled && config.claude.webSearch,
      hint: "ENABLE_WEB_SEARCH=true",
    },
    {
      id: "tmdb",
      title: "TMDB (постеры, годы, проверка)",
      enabled: config.tmdb.enabled,
      hint: "TMDB_API_KEY",
    },
    {
      id: "asr",
      title: "Речь в текст (диалоги из клипа)",
      enabled: config.asr.enabled,
      hint: "ASR_API_URL",
    },
    {
      id: "audd",
      title: "Аудио-отпечаток музыки/саундтрека",
      enabled: config.audd.enabled,
      hint: "AUDD_API_TOKEN",
    },
    {
      id: "local",
      title: "Офлайн-индекс (работает всегда)",
      enabled: true,
      hint: "data/movies.json",
    },
  ];
}
