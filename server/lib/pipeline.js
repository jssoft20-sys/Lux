import * as claude from "../providers/claude.js";
import * as tmdb from "../providers/tmdb.js";
import * as asr from "../providers/asr.js";
import * as audd from "../providers/audd.js";
import { searchLocal } from "../providers/local-index.js";
import { mergeCandidates } from "./rank.js";

const WEIGHT = {
  claude: 1,
  claudeVision: 1,
  claudeAudio: 0.95,
  local: 0.55,
};

function trace(steps, engine, status, note) {
  steps.push({ engine, status, note });
}

/** Непроверенная в TMDB догадка модели подозрительна — понижаем её вес. */
async function verify(candidates, steps) {
  if (!tmdb.isEnabled()) {
    trace(steps, "tmdb", "skipped", "нет TMDB_API_KEY — постеры и проверка выключены");
    return candidates;
  }
  const enriched = await tmdb.enrichAll(candidates);
  const unverified = enriched.filter((item) => !item.verified).length;
  trace(
    steps,
    "tmdb",
    "ok",
    unverified ? `проверено ${enriched.length}, не найдено в базе: ${unverified}` : `проверено ${enriched.length}`,
  );
  return enriched.map((item) =>
    item.verified
      ? item
      : { ...item, confidence: Number((item.confidence * 0.6).toFixed(3)), warning: "Не найден в TMDB — возможна ошибка распознавания" },
  );
}

async function runClaude(steps, label, fn) {
  if (!claude.isEnabled()) {
    trace(steps, label, "skipped", "нет ANTHROPIC_API_KEY — работает только офлайн-индекс");
    return { candidates: [], question: "" };
  }
  try {
    const result = await fn();
    trace(steps, label, "ok", `кандидатов: ${result.candidates.length}`);
    return result;
  } catch (error) {
    trace(steps, label, "error", error.message);
    return { candidates: [], question: "" };
  }
}

function runLocal(steps, query) {
  const candidates = searchLocal(query);
  trace(steps, "local", candidates.length ? "ok" : "empty", `офлайн-индекс: ${candidates.length}`);
  return candidates;
}

export async function identifyByText(description) {
  const steps = [];
  const [modelResult, localCandidates] = await Promise.all([
    runClaude(steps, "claude", () => claude.identifyByDescription(description)),
    Promise.resolve(runLocal(steps, description)),
  ]);

  const merged = mergeCandidates([
    { source: "claude", weight: WEIGHT.claude, candidates: modelResult.candidates },
    { source: "local", weight: WEIGHT.local, candidates: localCandidates },
  ]);

  return { candidates: await verify(merged, steps), question: modelResult.question, steps };
}

export async function identifyByFrame({ base64, mediaType, hint }) {
  const steps = [];
  const modelResult = await runClaude(steps, "claude-vision", () =>
    claude.identifyByFrame({ base64, mediaType, hint }),
  );

  const localCandidates = hint ? runLocal(steps, hint) : [];

  const merged = mergeCandidates([
    { source: "claude-vision", weight: WEIGHT.claudeVision, candidates: modelResult.candidates },
    { source: "local", weight: WEIGHT.local, candidates: localCandidates },
  ]);

  return { candidates: await verify(merged, steps), question: modelResult.question, steps };
}

export async function identifyByAudio({ buffer, filename, mimetype, hint }) {
  const steps = [];
  let transcript = null;
  let music = null;

  const jobs = [];
  if (asr.isEnabled()) {
    jobs.push(
      asr
        .transcribe({ buffer, filename, mimetype })
        .then((text) => {
          transcript = text;
          trace(steps, "asr", text ? "ok" : "empty", text ? `речь: «${text.slice(0, 80)}»` : "речь не распознана");
        })
        .catch((error) => trace(steps, "asr", "error", error.message)),
    );
  } else {
    trace(steps, "asr", "skipped", "нет ASR_API_URL — диалоги из клипа не читаются");
  }

  if (audd.isEnabled()) {
    jobs.push(
      audd
        .recognizeMusic({ buffer, filename, mimetype })
        .then((result) => {
          music = result;
          trace(steps, "audd", result ? "ok" : "empty", result ? `трек: ${result.label}` : "музыка не опознана");
        })
        .catch((error) => trace(steps, "audd", "error", error.message)),
    );
  } else {
    trace(steps, "audd", "skipped", "нет AUDD_API_TOKEN — аудио-отпечаток выключен");
  }

  await Promise.all(jobs);

  const clues = [transcript, music?.label, hint].filter(Boolean).join(" ");
  if (!clues) {
    return {
      candidates: [],
      question:
        "Из звука ничего не удалось извлечь. Включи ASR_API_URL и/или AUDD_API_TOKEN — или опиши сцену словами во вкладке «Описание».",
      steps,
      transcript,
      music,
    };
  }

  const modelResult =
    transcript || music
      ? await runClaude(steps, "claude-audio", () =>
          claude.identifyByAudioClues({ transcript, music: music?.label }),
        )
      : { candidates: [], question: "" };

  const localCandidates = runLocal(steps, clues);

  const merged = mergeCandidates([
    { source: "claude-audio", weight: WEIGHT.claudeAudio, candidates: modelResult.candidates },
    { source: "local", weight: WEIGHT.local, candidates: localCandidates },
  ]);

  return {
    candidates: await verify(merged, steps),
    question: modelResult.question,
    steps,
    transcript,
    music,
  };
}
