import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { extractJson } from "../lib/json.js";

let client = null;

function getClient() {
  if (!config.claude.enabled) return null;
  // Ключ подхватывается SDK из окружения (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN).
  if (!client) client = new Anthropic();
  return client;
}

export function isEnabled() {
  return config.claude.enabled;
}

const SYSTEM_PROMPT = `Ты — движок распознавания фильмов и сериалов по обрывочным воспоминаниям зрителя (аналог Shazam, но для кино).
Пользователь помнит только кусок: пересказ сюжета, случайный кадр, реплику или музыку из шортса.

Правила:
- Работай как следователь: выдели опорные приметы (эпоха, страна, жанр, уникальные детали) и ищи по ним.
- Если включён веб-поиск — обязательно проверь догадки поиском, а не полагайся только на память.
- Давай 1-5 кандидатов, от самого вероятного к менее вероятному. Лучше честные 3 варианта, чем один выдуманный.
- НИКОГДА не выдумывай несуществующие фильмы. Если не уверен — снижай confidence и задай уточняющий вопрос.
- confidence — честная вероятность от 0 до 1, а не вежливость.
- reason — одна строка на русском: какие приметы совпали.
- Отвечай ТОЛЬКО валидным JSON без пояснений вокруг, по схеме:
{"candidates":[{"title":"русское название","original":"оригинальное название","year":1999,"confidence":0.0,"reason":"почему"}],"question":"уточняющий вопрос или пустая строка"}`;

async function ask({ content, maxTokens = 4000 }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error("Claude не сконфигурирован");

  const tools = config.claude.webSearch
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }]
    : undefined;

  const messages = [{ role: "user", content }];

  // Веб-поиск может вернуть stop_reason: "pause_turn" — в этом случае
  // ход нужно продолжить, иначе ответ молча оборвётся.
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      output_config: { effort: "high" },
      ...(tools ? { tools } : {}),
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") {
    throw new Error("Claude отказался обрабатывать этот запрос");
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return { text, usage: response.usage };
}

function parseCandidates(text) {
  const parsed = extractJson(text);
  if (!parsed) return { candidates: [], question: "" };
  const list = Array.isArray(parsed) ? parsed : parsed.candidates || [];
  const candidates = list
    .filter((item) => item && (item.title || item.original))
    .map((item) => ({
      title: item.title || item.original,
      original: item.original || "",
      year: item.year ? Number(item.year) : null,
      confidence: Number(item.confidence ?? 0.5),
      reason: item.reason || "",
    }));
  return { candidates, question: (parsed.question || "").trim?.() || "" };
}

export async function identifyByDescription(description) {
  const { text } = await ask({
    content: [
      {
        type: "text",
        text: `Зритель описывает фильм по памяти. Описание может быть неточным, с перепутанными деталями.\n\nОПИСАНИЕ:\n"""${description}"""\n\nНайди фильм.`,
      },
    ],
  });
  return parseCandidates(text);
}

export async function identifyByFrame({ base64, mediaType, hint }) {
  const { text } = await ask({
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      {
        type: "text",
        text: `Это кадр (скорее всего скриншот из шортса/рилса, возможно с субтитрами и обрезанный).
Определи фильм или сериал. Опирайся на: актёров, костюмы, грим, локацию, цветокоррекцию, технику и эпоху, интерфейс субтитров, шрифты.
${hint ? `Дополнительная подсказка зрителя: "${hint}".` : ""}
Если на кадре видны актёры — назови их в reason.`,
      },
    ],
  });
  return parseCandidates(text);
}

export async function identifyByAudioClues({ transcript, music }) {
  const parts = [];
  if (transcript) parts.push(`РАСПОЗНАННАЯ РЕЧЬ ИЗ КЛИПА:\n"""${transcript}"""`);
  if (music) parts.push(`УЗНАННАЯ МУЗЫКА В КЛИПЕ: ${music}`);
  if (!parts.length) throw new Error("Нет звуковых зацепок");

  const { text } = await ask({
    content: [
      {
        type: "text",
        text: `${parts.join("\n\n")}

Определи, из какого фильма или сериала этот фрагмент.
Реплика могла быть распознана с ошибками — учитывай это и ищи похожие по смыслу фразы.
Если это музыка: проверь, в каких фильмах она звучит как саундтрек, и какой из них вероятнее всего попал в короткое видео.`,
      },
    ],
  });
  return parseCandidates(text);
}
