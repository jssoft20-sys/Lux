const $ = (selector) => document.querySelector(selector);
const result = $("#result");

/* ---------------------------------------------------------------- вкладки */

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("is-active"));
    document.querySelectorAll(".panel").forEach((item) => item.classList.remove("is-active"));
    tab.classList.add("is-active");
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("is-active");
  });
});

/* ---------------------------------------------------------------- движки */

const enginesBox = $("#engines");
$("#engines-toggle").addEventListener("click", () => {
  enginesBox.hidden = !enginesBox.hidden;
});

fetch("/api/status")
  .then((response) => response.json())
  .then(({ engines, model }) => {
    enginesBox.innerHTML = engines
      .map(
        (engine) => `<div class="engine">
          <span class="dot ${engine.enabled ? "on" : ""}">●</span>
          <div><b>${escapeHtml(engine.title)}</b><br><small>${engine.enabled ? "включён" : `нужен ${escapeHtml(engine.hint)}`}</small></div>
        </div>`,
      )
      .join("");
    enginesBox.insertAdjacentHTML("beforeend", `<div class="engine"><span class="dot on">●</span><div><b>Модель</b><br><small>${escapeHtml(model)}</small></div></div>`);
    if (engines.some((engine) => !engine.enabled)) enginesBox.hidden = false;
  })
  .catch(() => {});

/* ------------------------------------------------------------- отправка */

async function send(url, options, label) {
  result.hidden = false;
  result.innerHTML = `<div class="notice loading"><span class="spinner"></span>${label}</div>`;
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    render(data);
  } catch (error) {
    result.innerHTML = `<div class="notice err">${escapeHtml(error.message)}</div>`;
  }
}

/* ------------------------------------------------------------- описание */

const description = $("#description");

$("#find-text").addEventListener("click", () => {
  const text = description.value.trim();
  if (text.length < 10) {
    result.hidden = false;
    result.innerHTML = `<div class="notice">Добавь хотя бы одно предложение — иначе искать не по чему.</div>`;
    return;
  }
  send(
    "/api/identify/text",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: text }),
    },
    "Разбираю описание и проверяю версии…",
  );
});

description.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") $("#find-text").click();
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    description.value = chip.textContent.trim();
    $("#find-text").click();
  });
});

/* ----------------------------------------------------------------- кадр */

const drop = $("#drop");
const imageInput = $("#image-input");
const preview = $("#preview");
let imageFile = null;

function setImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  imageFile = file;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  $("#drop-label").hidden = true;
  $("#find-frame").disabled = false;
}

drop.addEventListener("click", () => imageInput.click());
drop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") imageInput.click();
});
imageInput.addEventListener("change", () => setImage(imageInput.files[0]));

["dragenter", "dragover"].forEach((type) =>
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  }),
);
["dragleave", "drop"].forEach((type) =>
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
  }),
);
drop.addEventListener("drop", (event) => setImage(event.dataTransfer.files[0]));

window.addEventListener("paste", (event) => {
  const file = [...(event.clipboardData?.files || [])][0];
  if (file) {
    setImage(file);
    document.querySelector('.tab[data-tab="frame"]').click();
  }
});

$("#find-frame").addEventListener("click", () => {
  if (!imageFile) return;
  const form = new FormData();
  form.append("image", imageFile);
  form.append("hint", $("#frame-hint").value.trim());
  send("/api/identify/frame", { method: "POST", body: form }, "Рассматриваю кадр…");
});

/* ----------------------------------------------------------------- звук */

const audioInput = $("#audio-input");
const playback = $("#playback");
const recordButton = $("#record");
const recordState = $("#record-state");
let audioFile = null;
let recorder = null;

function setAudio(file, label) {
  audioFile = file;
  playback.src = URL.createObjectURL(file);
  playback.hidden = false;
  $("#audio-label").textContent = label;
  $("#find-audio").disabled = false;
}

audioInput.addEventListener("change", () => {
  const file = audioInput.files[0];
  if (file) setAudio(file, `Выбрано: ${file.name}`);
});
document.querySelector(".file-row").addEventListener("click", () => audioInput.click());

recordButton.addEventListener("click", async () => {
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      setAudio(new File([blob], "record.webm", { type: blob.type }), "Записано с микрофона");
      recordButton.textContent = "● Записать 15 секунд";
      recordState.textContent = "запись готова";
    };
    recorder.start();
    recordButton.textContent = "■ Остановить";

    let left = 15;
    recordState.textContent = `идёт запись… ${left}`;
    const timer = setInterval(() => {
      left -= 1;
      recordState.textContent = `идёт запись… ${left}`;
      if (left <= 0 || recorder.state !== "recording") {
        clearInterval(timer);
        if (recorder.state === "recording") recorder.stop();
      }
    }, 1000);
  } catch {
    recordState.textContent = "микрофон недоступен — загрузи файл";
  }
});

$("#find-audio").addEventListener("click", () => {
  if (!audioFile) return;
  const form = new FormData();
  form.append("audio", audioFile);
  form.append("hint", $("#audio-hint").value.trim());
  send("/api/identify/audio", { method: "POST", body: form }, "Слушаю дорожку: реплики и музыку…");
});

/* ------------------------------------------------------------ результат */

function render(data) {
  const parts = [];

  if (data.transcript) {
    parts.push(`<div class="notice">Расслышано: «${escapeHtml(data.transcript)}»</div>`);
  }
  if (data.music) {
    parts.push(`<div class="notice">Музыка в клипе: <b>${escapeHtml(data.music.label)}</b></div>`);
  }

  if (!data.candidates?.length) {
    parts.push(
      `<div class="notice">Ничего не нашлось. ${escapeHtml(data.question || "Добавь деталей: эпоха, страна, чем кончилось, во что были одеты герои.")}</div>`,
    );
  } else {
    parts.push(`<h2>Вероятные совпадения</h2>`);
    parts.push(data.candidates.map(card).join(""));
    if (data.question) parts.push(`<div class="notice">Уточнение: ${escapeHtml(data.question)}</div>`);
  }

  if (data.steps?.length) {
    parts.push(
      `<details><summary>Как искали</summary><pre>${escapeHtml(
        data.steps.map((step) => `${step.engine}: ${step.status} — ${step.note}`).join("\n"),
      )}</pre></details>`,
    );
  }

  result.hidden = false;
  result.innerHTML = parts.join("");
}

function card(item, position) {
  const percent = Math.round(item.confidence * 100);
  const title = `${item.title}${item.year ? ` (${item.year})` : ""}`;
  const search = encodeURIComponent(`${item.original || item.title} ${item.year || ""}`.trim());
  const poster = item.poster
    ? `<img class="poster" src="${escapeHtml(item.poster)}" alt="" loading="lazy" />`
    : `<div class="poster"></div>`;

  return `<article class="card ${position === 0 ? "top-hit" : ""}">
    ${poster}
    <div>
      <h3>${escapeHtml(title)}</h3>
      <div class="sub">${escapeHtml(item.original || "")}${item.rating ? ` · TMDB ${item.rating}` : ""}</div>
      <div class="bar"><span style="width:${percent}%"></span></div>
      <div class="sub">уверенность ${percent}%</div>
      ${item.reasons?.length ? `<p>${escapeHtml(item.reasons.join(" · "))}</p>` : ""}
      ${item.overview ? `<p class="sub">${escapeHtml(item.overview.slice(0, 220))}${item.overview.length > 220 ? "…" : ""}</p>` : ""}
      ${item.warning ? `<p class="warn">${escapeHtml(item.warning)}</p>` : ""}
      <div class="links">
        ${item.tmdbUrl ? `<a href="${escapeHtml(item.tmdbUrl)}" target="_blank" rel="noopener">TMDB</a>` : ""}
        <a href="https://www.kinopoisk.ru/index.php?kp_query=${search}" target="_blank" rel="noopener">Кинопоиск</a>
        <a href="https://www.imdb.com/find/?q=${search}" target="_blank" rel="noopener">IMDb</a>
        <a href="https://www.youtube.com/results?search_query=${search}+trailer" target="_blank" rel="noopener">Трейлер</a>
      </div>
      <div class="sources">${(item.sources || []).map((source) => `<span class="source">${escapeHtml(source)}</span>`).join("")}</div>
    </div>
  </article>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}
