import { config } from "../config.js";

export function isEnabled() {
  return config.audd.enabled;
}

/**
 * Аудио-отпечаток музыки в клипе (тот самый «шазам»-слой).
 * Узнанный трек часто и есть саундтрек фильма — дальше Claude
 * проверяет, в каком фильме он звучит.
 */
export async function recognizeMusic({ buffer, filename, mimetype }) {
  if (!config.audd.enabled) return null;

  const form = new FormData();
  form.append("api_token", config.audd.token);
  form.append("return", "apple_music,spotify");
  form.append("file", new Blob([buffer], { type: mimetype || "application/octet-stream" }), filename || "clip.mp4");

  const response = await fetch("https://api.audd.io/", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`AudD ${response.status}`);

  const data = await response.json();
  if (data.status !== "success" || !data.result) return null;

  const { artist, title, album, release_date: releaseDate, song_link: songLink } = data.result;
  return {
    artist,
    title,
    album,
    releaseDate,
    link: songLink,
    label: [artist, title].filter(Boolean).join(" — "),
  };
}
