/**
 * Толерантный разбор JSON из текстового ответа модели: сырой JSON,
 * ```json-блок``` или JSON, окружённый пояснениями.
 */
export function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  const direct = tryParse(text);
  if (direct !== null) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed !== null) return parsed;
  }

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ]) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) {
      const parsed = tryParse(text.slice(start, end + 1));
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function tryParse(raw) {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}
