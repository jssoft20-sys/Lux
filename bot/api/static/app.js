/* LUX dashboard — exchange-style mobile UI. Vanilla JS, no build step. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const S = {
    snap: null, trades: [], stats: null, news: [], sources: [], events: [], equity: [],
    range: 6, tab: "overview", page: { trades: 1, news: 1, signals: 1 }, tradeFilter: "all",
    quote: "USDT", openSig: null, chartDrawn: false, sheet: null, prev: {}, eventKeys: new Set(),
  };
  const PAGE = { trades: 10, news: 10, signals: 8 };
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- formatting ----------
  const nf = (v, d = 2) => (v === null || v === undefined || isNaN(v)) ? "—" : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (v, d = 2, suf = "") => { if (v === null || v === undefined || isNaN(v)) return "—"; const s = v > 0 ? "+" : v < 0 ? "−" : ""; return s + nf(Math.abs(v), d) + suf; };
  const pct = (v, d = 2) => sgn(v, d, "%");
  const px = (p) => { if (!p) return "—"; const d = p >= 1000 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 7; return Number(p).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const qty = (q) => q ? Number(q).toLocaleString("ru-RU", { maximumFractionDigits: q >= 100 ? 1 : q >= 1 ? 3 : 6 }) : "—";
  const tm = (ts) => new Date(ts * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const tms = (ts) => new Date(ts * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dtm = (ts) => new Date(ts * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const ago = (ts) => { const s = Math.max(0, Date.now() / 1000 - ts); return s < 60 ? `${Math.round(s)}с` : s < 3600 ? `${Math.floor(s / 60)}м` : s < 86400 ? `${Math.floor(s / 3600)}ч` : `${Math.floor(s / 86400)}д`; };
  const dur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}ч ${m}м` : m ? `${m}м ${sec}с` : `${sec}с`; };
  const cls = (v) => v > 0 ? "up" : v < 0 ? "down" : "";
  const pair = (s) => s.replace(S.quote, "/" + S.quote);
  const base = (s) => s.replace(S.quote, "");
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids) { if (k === null || k === undefined) continue; e.appendChild(typeof k === "string" ? document.createTextNode(k) : k); }
    return e;
  };
  const flash = (node, dir) => { if (reduced || !dir) return; node.classList.remove("flash-up", "flash-down"); void node.offsetWidth; node.classList.add(dir === "up" ? "flash-up" : "flash-down"); };
  // set text; flash on change (direction from numeric delta when provided)
  const setT = (node, text, num) => {
    if (!node) return;
    if (node.textContent !== text) {
      const prev = num !== undefined ? S.prev[node.id] : undefined;
      node.textContent = text;
      if (num !== undefined && prev !== undefined && prev !== num) flash(node, num > prev ? "up" : "down");
    }
    if (num !== undefined) S.prev[node.id] = num;
  };
  const setCls = (node, baseCls, k) => { if (node) node.className = baseCls + (k ? " " + k : ""); };

  // ---------- REST ----------
  let reloading = false;
  async function api(path, opts) {
    // absolute URL from origin: a page opened as http://user:pass@host would otherwise break relative fetches
    const r = await fetch(location.origin + path, Object.assign({ headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin" }, opts || {}));
    if (r.status === 401) {
      // session lost its credentials: reload once so the browser re-prompts, never loop
      console.warn("401 on", path);
      if (!reloading && !sessionStorage.getItem("lux-reloaded")) { reloading = true; try { sessionStorage.setItem("lux-reloaded", "1"); } catch (e) { /* ignore */ } location.reload(); }
      return null;
    }
    try { sessionStorage.removeItem("lux-reloaded"); } catch (e) { /* ignore */ }
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }
  const post = (p) => api(p, { method: "POST" });

  // ---------- toasts ----------
  function toast(text, kind) {
    const t = el("div", { class: "toast " + (kind || "") }, text);
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  // ---------- sheet ----------
  function openSheet(title, body) {
    const sh = $("sheet"); $("sheet-title").textContent = title; const b = $("sheet-body"); b.innerHTML = ""; b.appendChild(body);
    sh.hidden = false; requestAnimationFrame(() => sh.classList.add("open")); S.sheet = title;
  }
  function closeSheet() { const sh = $("sheet"); sh.classList.remove("open"); S.sheet = null; setTimeout(() => { if (!S.sheet) sh.hidden = true; }, 380); }
  $("sheet-close").onclick = closeSheet; $("sheet-bg").onclick = closeSheet;
  function confirmSheet(title, text, okLabel, onOk, danger) {
    const box = el("div", { class: "confirm" }, el("p", {}, text),
      el("button", { class: "btn block " + (danger ? "danger" : "primary"), on: { click: async () => { closeSheet(); try { await onOk(); } catch (e) { toast("Ошибка: " + e.message, "down"); } } } }, okLabel),
      el("button", { class: "btn block", on: { click: closeSheet } }, "Отмена"));
    openSheet(title, box);
  }

  // ---------- pager ----------
  function pager(container, total, page, size, onPage) {
    container.innerHTML = "";
    const pages = Math.max(1, Math.ceil(total / size)); if (pages <= 1) return;
    const mk = (label, p, on, dis) => el("button", { class: "pg" + (on ? " on" : ""), disabled: dis, on: { click: () => onPage(p) } }, label);
    container.appendChild(mk("‹", page - 1, false, page <= 1));
    const seq = []; for (let p = 1; p <= pages; p++) { if (p === 1 || p === pages || Math.abs(p - page) <= 1) seq.push(p); else if (seq[seq.length - 1] !== "…") seq.push("…"); }
    for (const p of seq) container.appendChild(p === "…" ? el("span", { class: "pg-gap" }, "…") : mk(String(p), p, p === page, false));
    container.appendChild(mk("›", page + 1, false, page >= pages));
  }
  const slice = (arr, key) => { const size = PAGE[key]; const pages = Math.max(1, Math.ceil(arr.length / size)); if (S.page[key] > pages) S.page[key] = pages; const p = S.page[key]; return arr.slice((p - 1) * size, p * size); };

  // keyed list sync: keeps DOM nodes so transitions and taps survive re-renders
  function syncList(container, items, keyOf, create, update) {
    const existing = new Map(); for (const c of Array.from(container.children)) if (c.dataset.key) existing.set(c.dataset.key, c);
    const keep = new Set();
    items.forEach((it, i) => {
      const k = keyOf(it); keep.add(k); let node = existing.get(k);
      if (!node) { node = create(it); node.dataset.key = k; node.classList.add("row-in"); }
      update(node, it);
      if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
    });
    for (const [k, node] of existing) if (!keep.has(k)) node.remove();
    for (const c of Array.from(container.children)) if (!c.dataset.key) c.remove();
  }
  const emptyRow = (container, title, sub) => { container.innerHTML = ""; container.appendChild(el("div", { class: "empty" }, el("b", {}, title), sub || "")); };

  // ---------- header ----------
  let heroCur = null;
  function tweenHero(v) {
    const node = $("hero-value");
    if (heroCur === null || reduced) { heroCur = v; node.textContent = nf(v); return; }
    if (Math.abs(heroCur - v) < 0.0005) return;
    const from = heroCur, to = v, t0 = performance.now(), D = 650; flash(node, to > from ? "up" : "down");
    const step = (t) => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); node.textContent = nf(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); else heroCur = to; };
    requestAnimationFrame(step);
  }
  function chip(text, k, title) { return el("span", { class: "chip " + (k || ""), title: title || "" }, el("i"), text); }
  function renderHeader(snap) {
    const st = snap.status; S.quote = st.quote_asset || "USDT";
    const pill = $("mode-pill"); pill.textContent = st.mode === "live" ? "LIVE" : "PAPER"; pill.className = "pill " + (st.mode === "live" ? "live" : "paper");
    $("hero-unit").textContent = S.quote;
    tweenHero(st.equity);
    setT($("hero-pnl"), sgn(st.realized_today), st.realized_today); setCls($("hero-pnl"), "num", cls(st.realized_today));
    setT($("hero-unreal"), sgn(st.unrealized), st.unrealized); setCls($("hero-unreal"), "num", cls(st.unrealized));
    setT($("hero-free"), nf(st.quote_balance), st.quote_balance);
    const chips = $("chips"); chips.innerHTML = "";
    if (st.halted) chips.appendChild(chip("Стоп · дневной лимит", "bad", st.halt_reason));
    else if (st.paused) chips.appendChild(chip("Пауза", "warn"));
    else chips.appendChild(chip("Торгует", "ok"));
    const m = snap.market; const lat = m.last_msg_age_ms;
    chips.appendChild(chip(m.connected ? `Рынок ${lat === null || lat === undefined ? "" : lat + " мс"}` : "Рынок офлайн", m.connected && lat !== null && lat < 10000 ? "ok" : "bad"));
    const n = snap.news; chips.appendChild(chip(`Лента ${n.sources_ok}/${n.sources}`, n.sources_ok ? (n.sources_ok >= n.sources * 0.6 ? "ok" : "warn") : "bad", `материалов: ${n.items}`));
    const l = snap.llm;
    if (!l.enabled) chips.appendChild(chip("ИИ выкл", "off", l.disabled_reason || ""));
    else chips.appendChild(chip(`ИИ ${l.items}`, l.errors && !l.calls ? "bad" : "ok", l.model));
    chips.appendChild(chip(`${dur(st.uptime_s)} · ${st.tick_ms} мс`, "", "аптайм · длительность тика"));
    const w = snap.warnings || []; const dot = $("sys-dot"); dot.className = "sysdot" + (w.length ? (st.halted ? " bad" : " warn") : "");
    const tb = $("tab-pos-n"); if (st.open_positions) { tb.hidden = false; tb.textContent = st.open_positions; } else tb.hidden = true;
  }

  // ---------- overview ----------
  function statTile(l, v, k, unit) { const t = el("div", { class: "stat" }); t.appendChild(el("div", { class: "l" }, l)); const vv = el("div", { class: "v " + (k || "") }, v); if (unit) vv.appendChild(el("small", {}, unit)); t.appendChild(vv); return t; }
  function renderOverview(snap) {
    const st = snap.status; const a = S.stats && S.stats.all, t = S.stats && S.stats.today;
    const box = $("stats"); box.innerHTML = "";
    box.appendChild(statTile("PnL всего", sgn(st.realized_total), cls(st.realized_total), S.quote));
    box.appendChild(statTile("Винрейт", a && a.closed ? Math.round(a.win_rate * 100) + "%" : "—", "", a && a.closed ? `${a.wins}/${a.closed}` : ""));
    box.appendChild(statTile("Сделок за день", t ? String(t.closed) : "—", "", ""));
    box.appendChild(statTile("Комиссии", a ? nf(a.fees, 3) : "—", "", S.quote));
    box.appendChild(statTile("В рынке", nf(st.exposure), "", S.quote));
    box.appendChild(statTile("Позиций", `${st.open_positions}`, "", `/ ${snap.config ? snap.config.max_positions : "…"}`));
    $("ov-pos-n").textContent = st.open_positions ? `· ${st.open_positions}` : "";
    const pos = snap.positions || [];
    if (!pos.length) emptyRow($("ov-positions"), "Нет открытых позиций", "Бот ждёт сигнал");
    else syncList($("ov-positions"), pos.slice(0, 3), (p) => p.symbol, () => el("div", { class: "row trade" }, el("div"), el("div", { class: "r" })), (node, p) => {
      const l = node.children[0], r = node.children[1]; l.innerHTML = ""; r.innerHTML = "";
      l.appendChild(el("div", { class: "sym" }, pair(p.symbol), el("span", { class: "side buy" }, "LONG")));
      l.appendChild(el("div", { class: "sub" }, `${qty(p.qty)} · вход ${px(p.entry_price)} · ${dur(p.age_s)}`));
      r.appendChild(el("div", { class: "big " + cls(p.pnl) }, sgn(p.pnl, 3))); r.appendChild(el("div", { class: "sub " + cls(p.pnl_pct) }, pct(p.pnl_pct)));
    });
    const sigs = snap.signals || []; const best = sigs.find((s) => !s.in_position) || sigs[0]; const thr = snap.config ? snap.config.buy_threshold : 0.35;
    const bs = $("ov-signal"); bs.innerHTML = "";
    if (!best) bs.appendChild(el("div", { class: "muted" }, "Ждём данные рынка…"));
    else {
      bs.appendChild(el("div", {}, el("div", { class: "sym" }, pair(best.symbol)), el("div", { class: "sub muted" }, best.decision || "")));
      const meter = el("div", { class: "meter" }, el("i", { style: `width:${Math.max(0, Math.min(100, best.composite / (thr * 1.4) * 100)).toFixed(1)}%` }), el("b", { style: `left:${(1 / 1.4 * 100).toFixed(1)}%`, title: `порог ${thr}` }));
      bs.appendChild(meter); bs.appendChild(el("div", { class: "score " + cls(best.composite) }, sgn(best.composite, 2)));
    }
    const nw = S.news.slice(0, 3);
    if (!nw.length) emptyRow($("ov-news"), "Лента пуста", ""); else syncList($("ov-news"), nw, (n) => n.id, newsNode, newsUpdate);
  }

  // ---------- positions ----------
  function posNode() { return el("div", { class: "row pos" }); }
  function posUpdate(node, p) {
    node.innerHTML = "";
    const top = el("div", { class: "pos-top" },
      el("div", {}, el("div", { class: "sym" }, pair(p.symbol), el("span", { class: "side buy" }, "LONG")), el("div", { class: "sub" }, p.entry_reason || "")),
      el("div", { class: "pos-pnl" }, el("div", { class: "big " + cls(p.pnl) }, sgn(p.pnl, 3) + " " + S.quote), el("div", { class: "sub " + cls(p.pnl_pct) }, pct(p.pnl_pct))));
    node.appendChild(top);
    node.appendChild(el("div", { class: "pos-grid" },
      el("div", {}, "Объём", el("b", {}, qty(p.qty))), el("div", {}, "Вход", el("b", {}, px(p.entry_price))), el("div", {}, "Марк", el("b", {}, px(p.current)))));
    const lo = p.stop_loss, hi = p.take_profit, cur = p.current || p.entry_price; const k = hi > lo ? Math.max(0, Math.min(1, (cur - lo) / (hi - lo))) : 0.5;
    const stopLbl = p.trailing_active ? `Трейл ${px(p.trailing_stop)}` : `SL ${px(lo)}`;
    node.appendChild(el("div", { class: "range" }, el("div", { class: "lbl" }, el("span", {}, stopLbl), el("span", {}, `TP ${px(hi)}`)), el("div", { class: "trk" }, el("i", { class: "mk", style: `left:${(k * 100).toFixed(1)}%` }))));
    const b = el("button", { class: "btn danger sm", on: { click: () => confirmSheet("Закрыть позицию", `${pair(p.symbol)} · ${qty(p.qty)} по рынку. PnL сейчас ${sgn(p.pnl, 3)} ${S.quote}.`, "Закрыть по рынку", async () => { const r = await post(`/api/control/close/${p.symbol}`); toast(r && r.ok ? `Закрыто ${pair(p.symbol)}` : "Не удалось закрыть", r && r.ok ? "up" : "down"); await loadTrades(); }, true) } }, "Закрыть");
    node.appendChild(el("div", { class: "pos-foot" }, el("div", { class: "sub" }, `${dur(p.age_s)} · ${nf(p.quote_spent)} ${S.quote}${p.extra && p.extra.headline ? " · " + p.extra.headline.slice(0, 60) : ""}`), b));
  }
  function renderPositions(snap) {
    const pos = snap.positions || []; $("pos-count").textContent = pos.length ? `${pos.length} / ${snap.config ? snap.config.max_positions : "…"}` : "";
    $("btn-close-all").disabled = !pos.length;
    if (!pos.length) { emptyRow($("positions"), "Нет открытых позиций", "Сигналы ниже порога входа"); return; }
    syncList($("positions"), pos, (p) => p.symbol, posNode, posUpdate);
  }

  // ---------- trades ----------
  function renderTrades() {
    const t = S.stats && S.stats.today, a = S.stats && S.stats.all; const ts = $("tstats"); ts.innerHTML = "";
    ts.appendChild(statTile("День", t ? sgn(t.pnl, 2) : "—", t ? cls(t.pnl) : ""));
    ts.appendChild(statTile("Всего", a ? sgn(a.pnl, 2) : "—", a ? cls(a.pnl) : ""));
    ts.appendChild(statTile("Винрейт", a && a.closed ? Math.round(a.win_rate * 100) + "%" : "—"));
    ts.appendChild(statTile("Комиссии", a ? nf(a.fees, 3) : "—"));
    const rows = S.tradeFilter === "all" ? S.trades : S.trades.filter((x) => x.side === S.tradeFilter);
    if (!rows.length) { emptyRow($("trades"), "Сделок нет", "Появятся после первого входа"); $("trades-pager").innerHTML = ""; return; }
    const pageRows = slice(rows, "trades");
    syncList($("trades"), pageRows, (x) => String(x.id), () => el("div", { class: "row trade" }, el("div"), el("div", { class: "r" })), (node, x) => {
      const l = node.children[0], r = node.children[1]; l.innerHTML = ""; r.innerHTML = "";
      l.appendChild(el("div", { class: "sym" }, pair(x.symbol), el("span", { class: "side " + (x.side === "BUY" ? "buy" : "sell") }, x.side)));
      l.appendChild(el("div", { class: "sub" }, `${dtm(x.ts)} · ${qty(x.qty)} @ ${px(x.price)}${x.reason ? " · " + x.reason : ""}`));
      if (x.pnl === null || x.pnl === undefined) { r.appendChild(el("div", { class: "big" }, `${nf(x.quote_qty)} ${S.quote}`)); r.appendChild(el("div", { class: "sub muted" }, "вход")); }
      else { r.appendChild(el("div", { class: "big " + cls(x.pnl) }, sgn(x.pnl, 3))); r.appendChild(el("div", { class: "sub " + cls(x.pnl_pct) }, pct(x.pnl_pct))); }
    });
    pager($("trades-pager"), rows.length, S.page.trades, PAGE.trades, (p) => { S.page.trades = p; renderTrades(); $("view-trades").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); });
  }

  // ---------- signals ----------
  function bars(v) { const b = el("div", { class: "bars" }); const n = Math.min(5, Math.round(Math.abs(v) * 10)); for (let i = 0; i < 5; i++) b.appendChild(el("i", { class: i < n ? (v >= 0 ? "p" : "n") : "" })); return b; }
  function sigNode(s) { const n = el("div", { class: "row sig" }, el("div"), el("div", { class: "r" }), el("div", { class: "sig-det" })); n.addEventListener("click", () => { S.openSig = S.openSig === s.symbol ? null : s.symbol; n.classList.toggle("open", S.openSig === s.symbol); }); return n; }
  function sigUpdate(node, s) {
    node.classList.toggle("inpos", !!s.in_position); node.classList.toggle("open", S.openSig === s.symbol);
    const l = node.children[0], r = node.children[1], d = node.children[2]; l.innerHTML = ""; r.innerHTML = ""; d.innerHTML = "";
    l.appendChild(el("div", { class: "sym" }, pair(s.symbol), s.in_position ? el("span", { class: "side buy" }, "LONG") : null));
    l.appendChild(el("div", { class: "sub" }, `${px(s.price)} · `, el("span", { class: cls(s.mom_5m) }, `${pct(s.mom_5m)} 5м`)));
    l.appendChild(bars(s.composite));
    const thr = S.snap && S.snap.config ? S.snap.config.buy_threshold : 0.35;
    r.appendChild(el("div", { class: "score " + cls(s.composite) }, sgn(s.composite, 2))); r.appendChild(el("div", { class: "thr" }, `порог ${thr}`));
    const cell = (l2, v, k) => el("div", {}, l2, el("b", { class: k || "" }, v));
    d.appendChild(cell("Новости", `${sgn(s.news_score, 2)} · ${s.news_count}`, cls(s.news_score)));
    d.appendChild(cell("Импульс", sgn(s.momentum_score, 2), cls(s.momentum_score)));
    d.appendChild(cell("Стакан", sgn(s.imbalance, 2), cls(s.imbalance)));
    d.appendChild(cell("Поток", sgn(s.flow, 2), cls(s.flow)));
    d.appendChild(cell("Спред", isFinite(s.spread_bps) ? s.spread_bps.toFixed(1) + " б.п." : "—"));
    d.appendChild(cell("1м / 15м", `${pct(s.mom_1m)} / ${pct(s.mom_15m)}`));
    d.appendChild(el("div", { class: "why" }, s.in_position ? "В позиции" : (s.decision || "—"), s.top_news && s.top_news[0] ? ` · ${s.top_news[0].title.slice(0, 90)}` : ""));
  }
  function renderSignals(snap) {
    const rows = snap.signals || []; const thr = snap.config ? snap.config.buy_threshold : 0.35;
    $("sig-note").textContent = rows.length ? `${rows.length} пар · вход ≥ ${thr} · рынок ${sgn(snap.news ? snap.news.market_score : 0, 2)}` : "ждём рынок…";
    if (!rows.length) { emptyRow($("signals"), "Нет данных", "Подключаемся к Binance"); $("signals-pager").innerHTML = ""; return; }
    syncList($("signals"), slice(rows, "signals"), (s) => s.symbol, sigNode, sigUpdate);
    pager($("signals-pager"), rows.length, S.page.signals, PAGE.signals, (p) => { S.page.signals = p; renderSignals(S.snap); });
  }

  // ---------- news ----------
  function newsNode() { return el("div", { class: "row news-row" }, el("div"), el("div")); }
  function newsUpdate(node, n) {
    const c = node.children[0], b = node.children[1]; c.innerHTML = ""; b.innerHTML = "";
    const s = n.effective_score !== undefined ? n.effective_score : n.score;
    c.appendChild(el("div", { class: "score-chip " + cls(s), title: n.llm_score !== null && n.llm_score !== undefined ? `ИИ ${sgn(n.llm_score, 2)}` : "лексика" }, sgn(s, 2)));
    b.appendChild(el("a", { class: "news-t", href: n.url || "#", target: "_blank", rel: "noopener noreferrer" }, n.title));
    const m = el("div", { class: "news-m" }, el("span", {}, `${n.source} · ${ago(n.ts)}`));
    (n.tickers || []).slice(0, 5).forEach((t) => m.appendChild(el("span", { class: "tk" }, t)));
    if (n.market_wide) m.appendChild(el("span", { class: "tk" }, "РЫНОК"));
    b.appendChild(m);
    if (n.llm_reason) b.appendChild(el("div", { class: "news-ai" }, "ИИ: " + n.llm_reason));
  }
  function renderNews() {
    $("news-note").textContent = S.news.length ? `${S.news.length}` : "";
    if (!S.news.length) { emptyRow($("news"), "Лента пуста", "Источники опрашиваются"); $("news-pager").innerHTML = ""; return; }
    syncList($("news"), slice(S.news, "news"), (n) => n.id, newsNode, newsUpdate);
    pager($("news-pager"), S.news.length, S.page.news, PAGE.news, (p) => { S.page.news = p; renderNews(); $("view-news").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); });
  }
  function upsertNews(n) {
    const i = S.news.findIndex((x) => x.id === n.id); if (i >= 0) S.news[i] = n; else S.news.unshift(n);
    S.news.sort((a, b) => b.ts - a.ts); S.news = S.news.slice(0, 200);
    if (S.tab === "news") renderNews(); if (S.tab === "overview" && S.snap) renderOverview(S.snap);
  }

  // ---------- system sheet ----------
  function systemBody() {
    const snap = S.snap; if (!snap) return el("div", {}, "…");
    const st = snap.status, m = snap.market, n = snap.news, l = snap.llm; const body = el("div", { class: "sh-sec" });
    const kv = el("div", { class: "kvs" },
      el("div", {}, "Режим", el("b", {}, st.mode === "live" ? "LIVE · реальные" : "PAPER · виртуальные")),
      el("div", {}, "Аптайм", el("b", {}, dur(st.uptime_s))),
      el("div", {}, "Тик", el("b", {}, `${st.tick_ms} мс / ${st.interval_ms} мс`)),
      el("div", {}, "Рынок", el("b", {}, m.connected ? `${m.last_msg_age_ms} мс · ${m.messages.toLocaleString("ru-RU")} сообщ.` : "офлайн")),
      el("div", {}, "Лента", el("b", {}, `${n.sources_ok}/${n.sources} источников · ${n.items}`)),
      el("div", {}, "ИИ", el("b", {}, l.enabled ? `${l.model} · ${l.items} оценок` : "выкл")),
      el("div", {}, "Страх/жадность", el("b", {}, n.fng === null || n.fng === undefined ? "—" : String(n.fng))),
      el("div", {}, "Тон рынка", el("b", { class: cls(n.market_score) }, sgn(n.market_score, 2))));
    body.appendChild(kv);
    const ctr = el("div", { class: "sh-sec" }, el("h4", {}, "Управление"));
    const cr = el("div", { class: "ctrls" });
    cr.appendChild(st.paused ? el("button", { class: "btn primary", on: { click: () => post("/api/control/resume").then(() => { toast("Торговля возобновлена", "up"); closeSheet(); }) } }, "Продолжить")
      : el("button", { class: "btn", on: { click: () => post("/api/control/pause").then(() => { toast("Пауза: новые входы отключены"); closeSheet(); }) } }, "Пауза"));
    cr.appendChild(el("button", { class: "btn danger", on: { click: () => confirmSheet("Закрыть все", "Все открытые позиции будут проданы по рынку.", "Закрыть все", async () => { const r = await post("/api/control/close_all"); toast(`Закрыто позиций: ${r ? r.closed : 0}`, "up"); loadTrades(); }, true) } }, "Закрыть все"));
    if (st.halted) cr.appendChild(el("button", { class: "btn ok", style: "grid-column:1/-1", on: { click: () => post("/api/control/reset_halt").then(() => { toast("Дневной стоп снят"); closeSheet(); }) } }, "Снять дневной стоп"));
    cr.appendChild(el("button", { class: "btn", style: "grid-column:1/-1", on: { click: toggleTheme } }, "Сменить тему"));
    ctr.appendChild(cr); body.appendChild(ctr);
    const w = snap.warnings || [];
    if (w.length) { const ws = el("div", { class: "sh-sec" }, el("h4", {}, "Внимание")); const wl = el("div", { class: "warnlist" }); w.forEach((x) => wl.appendChild(el("div", {}, x))); ws.appendChild(wl); body.appendChild(ws); }
    if (st.halted) body.appendChild(el("div", { class: "warnlist" }, el("div", {}, "Стоп: " + st.halt_reason)));
    const ss = el("div", { class: "sh-sec" }, el("h4", {}, "Источники")); const sl = el("div", { class: "srcs" });
    S.sources.forEach((s) => sl.appendChild(el("div", { class: s.last_error ? "err" : "" }, el("span", {}, s.name), el("span", {}, s.last_error ? "ошибка" : s.last_ok_age === null ? "…" : `${s.items} · ${Math.round(s.last_ok_age)}с`))));
    ss.appendChild(sl); body.appendChild(ss);
    const lg = el("div", { class: "sh-sec" }, el("h4", {}, "Журнал")); const ll = el("div", { class: "logs" });
    S.events.slice(0, 40).forEach((e) => ll.appendChild(el("div", { class: e.level || "" }, el("span", { class: "t" }, tms(e.ts)), el("span", {}, e.message))));
    lg.appendChild(ll); body.appendChild(lg);
    return body;
  }
  $("btn-system").onclick = () => openSheet("Система", systemBody());
  $("btn-close-all").onclick = () => confirmSheet("Закрыть все", "Все открытые позиции будут проданы по рынку.", "Закрыть все", async () => { const r = await post("/api/control/close_all"); toast(`Закрыто позиций: ${r ? r.closed : 0}`, "up"); loadTrades(); }, true);

  // ---------- chart ----------
  function renderChart() {
    const root = $("chart"); const rows = S.equity; root.innerHTML = "";
    if (rows.length < 2) { root.appendChild(el("div", { class: "empty" }, "Кривая появится через минуту")); $("chart-delta").textContent = ""; $("chart-note").textContent = ""; return; }
    const W = root.clientWidth || 360, H = root.clientHeight || 200, pad = { l: 8, r: 8, t: 12, b: 22 };
    const xs = rows.map((r) => r.ts), ys = rows.map((r) => r.equity);
    const x0 = xs[0], x1 = xs[xs.length - 1] > x0 ? xs[xs.length - 1] : x0 + 1;
    let ymin = Infinity, ymax = -Infinity; for (const y of ys) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    if (ymax - ymin < 1e-9) { ymin -= 0.05; ymax += 0.05; } const padY = (ymax - ymin) * 0.18; ymin -= padY; ymax += padY;
    const sx = (t) => pad.l + (t - x0) / (x1 - x0) * (W - pad.l - pad.r), sy = (v) => pad.t + (ymax - v) / (ymax - ymin) * (H - pad.t - pad.b);
    const NS = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const up = ys[ys.length - 1] >= ys[0]; const color = up ? "var(--up)" : "var(--down)";
    const defs = document.createElementNS(NS, "defs"); const gid = "g" + Math.random().toString(36).slice(2, 7);
    defs.innerHTML = `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${up ? "#0ecb81" : "#f6465d"}" stop-opacity=".28"/><stop offset="100%" stop-color="${up ? "#0ecb81" : "#f6465d"}" stop-opacity="0"/></linearGradient>`;
    svg.appendChild(defs);
    const grid = document.createElementNS(NS, "g"); grid.setAttribute("class", "grid"); const axis = document.createElementNS(NS, "g"); axis.setAttribute("class", "axis");
    for (let i = 0; i <= 3; i++) { const v = ymin + (ymax - ymin) * i / 3; const y = sy(v); const ln = document.createElementNS(NS, "line"); ln.setAttribute("x1", pad.l); ln.setAttribute("x2", W - pad.r); ln.setAttribute("y1", y); ln.setAttribute("y2", y); grid.appendChild(ln); const t = document.createElementNS(NS, "text"); t.setAttribute("x", W - pad.r); t.setAttribute("y", y - 3); t.setAttribute("text-anchor", "end"); t.textContent = nf(v, v >= 100 ? 1 : 2); axis.appendChild(t); }
    svg.appendChild(grid);
    const nx = Math.min(5, Math.max(2, Math.floor(W / 110))); const span = x1 - x0;
    for (let i = 0; i <= nx; i++) { const t = x0 + span * i / nx; const tx = document.createElementNS(NS, "text"); tx.setAttribute("x", sx(t)); tx.setAttribute("y", H - 6); tx.setAttribute("text-anchor", i === 0 ? "start" : i === nx ? "end" : "middle"); tx.textContent = span > 36 * 3600 ? dtm(t) : tm(t); axis.appendChild(tx); }
    const ref = document.createElementNS(NS, "line"); ref.setAttribute("class", "ref"); ref.setAttribute("x1", pad.l); ref.setAttribute("x2", W - pad.r); ref.setAttribute("y1", sy(ys[0])); ref.setAttribute("y2", sy(ys[0])); svg.appendChild(ref);
    let d = ""; rows.forEach((r, i) => { d += (i ? "L" : "M") + sx(r.ts).toFixed(1) + " " + sy(r.equity).toFixed(1) + " "; });
    const area = document.createElementNS(NS, "path"); area.setAttribute("class", "area"); area.setAttribute("fill", `url(#${gid})`); area.setAttribute("d", d + `L${sx(x1).toFixed(1)} ${(H - pad.b).toFixed(1)} L${sx(x0).toFixed(1)} ${(H - pad.b).toFixed(1)} Z`); svg.appendChild(area);
    const line = document.createElementNS(NS, "path"); line.setAttribute("class", "line"); line.setAttribute("stroke", color); line.setAttribute("d", d.trim()); svg.appendChild(line);
    svg.appendChild(axis);
    const cx = sx(x1), cy = sy(ys[ys.length - 1]);
    const halo = document.createElementNS(NS, "circle"); halo.setAttribute("class", "dot live"); halo.setAttribute("r", 4); halo.setAttribute("cx", cx); halo.setAttribute("cy", cy); halo.setAttribute("fill", color); halo.setAttribute("stroke", "none"); svg.appendChild(halo);
    const dot = document.createElementNS(NS, "circle"); dot.setAttribute("class", "dot"); dot.setAttribute("r", 4); dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("fill", color); svg.appendChild(dot);
    const cross = document.createElementNS(NS, "line"); cross.setAttribute("class", "cross"); cross.setAttribute("y1", pad.t); cross.setAttribute("y2", H - pad.b); cross.style.display = "none"; svg.appendChild(cross);
    const hov = document.createElementNS(NS, "circle"); hov.setAttribute("class", "dot"); hov.setAttribute("r", 5); hov.setAttribute("fill", color); hov.style.display = "none"; svg.appendChild(hov);
    root.appendChild(svg);
    if (!S.chartDrawn && !reduced) { const len = line.getTotalLength ? line.getTotalLength() : 0; if (len) { line.style.strokeDasharray = len; line.style.strokeDashoffset = len; line.classList.add("draw"); } S.chartDrawn = true; }
    const tip = el("div", { class: "tip" }); tip.style.display = "none"; root.appendChild(tip);
    const move = (ev) => {
      const rect = svg.getBoundingClientRect(); const pxx = (ev.clientX - rect.left) * W / rect.width; const t = x0 + (pxx - pad.l) / (W - pad.l - pad.r) * (x1 - x0);
      let lo = 0, hi = xs.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < t) lo = mid + 1; else hi = mid; }
      if (lo > 0 && Math.abs(xs[lo - 1] - t) < Math.abs(xs[lo] - t)) lo--;
      const r = rows[lo]; const X = sx(r.ts), Y = sy(r.equity);
      cross.setAttribute("x1", X); cross.setAttribute("x2", X); cross.style.display = ""; hov.setAttribute("cx", X); hov.setAttribute("cy", Y); hov.style.display = "";
      tip.innerHTML = ""; tip.appendChild(el("b", {}, `${nf(r.equity, 3)} ${S.quote}`)); tip.appendChild(el("span", { class: cls(r.equity - ys[0]) }, sgn(r.equity - ys[0], 3))); tip.appendChild(el("span", { class: "muted" }, ` · ${tms(r.ts)}`));
      tip.style.display = ""; const left = X / W * rect.width; tip.style.left = Math.min(rect.width - 70, Math.max(70, left)) + "px"; tip.style.top = Math.max(28, Y / H * rect.height) + "px";
    };
    const hide = () => { cross.style.display = "none"; hov.style.display = "none"; tip.style.display = "none"; };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); svg.addEventListener("pointerleave", hide); svg.addEventListener("pointerup", () => setTimeout(hide, 1200));
    const first = ys[0], last = ys[ys.length - 1], dl = last - first;
    const cd = $("chart-delta"); cd.textContent = `${sgn(dl, 3)} ${S.quote} (${pct(first ? dl / first * 100 : 0)})`; cd.className = "num " + cls(dl);
    $("chart-note").textContent = `${rows.length} точек · ${S.range ? S.range + "ч" : "всё"}`;
  }

  // ---------- loaders ----------
  const warn = (what) => (e) => console.warn(what, e && e.message ? e.message : e);
  async function loadEquity() { try { const rows = await api(`/api/equity?hours=${S.range}`); if (rows) { S.equity = rows; if (S.tab === "overview") renderChart(); } } catch (e) { warn("equity")(e); } }
  async function loadTrades() { try { const d = await api("/api/trades?limit=200"); if (d) { S.trades = d.trades; S.stats = { today: d.today, all: d.all }; if (S.tab === "trades" || S.tab === "overview") renderCurrent(); } } catch (e) { warn("trades")(e); } }
  async function loadNews() { try { const d = await api("/api/news?limit=120"); if (d) { S.news = d; if (S.tab === "news" || S.tab === "overview") renderCurrent(); } } catch (e) { warn("news")(e); } }
  async function loadSources() { try { const d = await api("/api/sources"); if (d) S.sources = d; } catch (e) { warn("sources")(e); } }
  async function loadEvents() { try { const d = await api("/api/events?limit=60"); if (d) S.events = d.map((e) => ({ ts: e.ts, level: e.level, message: e.message.replace(/^log: /, "") })); } catch (e) { warn("events")(e); } }
  async function loadStatus() { const d = await api("/api/status"); if (d) applySnapshot(d); }
  function applySnapshot(d) {
    const cfg = d.config || (S.snap && S.snap.config); S.snap = Object.assign({}, S.snap || {}, d); if (cfg) S.snap.config = cfg;
    renderHeader(S.snap);
    renderCurrent();
    if (S.sheet === "Система") { const b = $("sheet-body"); const y = b.scrollTop; b.innerHTML = ""; b.appendChild(systemBody()); b.scrollTop = y; }
  }
  // render whatever tab is open with whatever data we have (empty states before data arrives)
  function renderCurrent() {
    const t = S.tab;
    if (t === "overview") { if (S.snap) renderOverview(S.snap); else { emptyRow($("ov-positions"), "Загрузка…", ""); emptyRow($("ov-news"), "Загрузка…", ""); } renderChart(); }
    else if (t === "positions") { if (S.snap) renderPositions(S.snap); else emptyRow($("positions"), "Загрузка…", ""); }
    else if (t === "trades") renderTrades();
    else if (t === "signals") { if (S.snap) renderSignals(S.snap); else emptyRow($("signals"), "Загрузка…", ""); }
    else if (t === "news") renderNews();
  }

  // ---------- tabs ----------
  function showTab(name) {
    if (!document.getElementById("view-" + name)) name = "overview";
    S.tab = name;
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "view-" + name));
    document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    renderCurrent();
  }
  $("tabbar").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.go)));
  $("range").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; [...$("range").children].forEach((x) => x.classList.toggle("on", x === b)); S.range = Number(b.dataset.h); S.chartDrawn = false; loadEquity(); });
  $("trade-filter").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; [...$("trade-filter").children].forEach((x) => x.classList.toggle("on", x === b)); S.tradeFilter = b.dataset.f; S.page.trades = 1; renderTrades(); });

  // ---------- theme ----------
  function toggleTheme() { const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light"; document.documentElement.setAttribute("data-theme", cur); document.querySelector('meta[name="theme-color"]').setAttribute("content", cur === "light" ? "#f5f5f5" : "#0b0e11"); try { localStorage.setItem("lux-theme", cur); } catch (e) { /* ignore */ } S.chartDrawn = true; if (S.tab === "overview") renderChart(); }
  $("btn-theme").onclick = toggleTheme;
  try { const t = localStorage.getItem("lux-theme"); if (t) { document.documentElement.setAttribute("data-theme", t); document.querySelector('meta[name="theme-color"]').setAttribute("content", t === "light" ? "#f5f5f5" : "#0b0e11"); } } catch (e) { /* ignore */ }

  // ---------- live connection: WebSocket with polling fallback ----------
  let ws = null, wsBackoff = 1000, wsTimer = null, pollTimer = null, pollFailures = 0;
  const conn = (k, text) => { const c = $("conn"); c.className = "conn " + k; c.querySelector("b").textContent = text; };
  function startPolling() {
    if (pollTimer) return; let n = 0;
    pollTimer = setInterval(async () => {
      try { await loadStatus(); pollFailures = 0; n++; conn("warn", "1с"); if (n % 4 === 0) loadTrades(); }
      catch (e) { if (++pollFailures >= 3) conn("bad", "офлайн"); }
    }, 1000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  async function connectWS() {
    let token = "";
    try { const t = await api("/api/ws-token"); if (t && t.token) token = t.token; } catch (e) { /* browser creds may still work */ }
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws" + (token ? "?token=" + encodeURIComponent(token) : "");
    try { ws = new WebSocket(url); } catch (e) { startPolling(); scheduleWS(); return; }
    ws.onopen = () => { wsBackoff = 1000; stopPolling(); conn("ok", "live"); };
    ws.onclose = () => { startPolling(); scheduleWS(); };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
    ws.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch (e) { return; }
      if (ev.kind === "snapshot") applySnapshot(ev.data);
      else if (ev.kind === "trade") { const d = ev.data; toast(`${d.side === "BUY" ? "Куплено" : "Продано"} ${pair(d.symbol)} @ ${px(d.price)}${d.pnl !== undefined ? ` · ${sgn(d.pnl, 3)} ${S.quote}` : ""}`, d.side === "BUY" ? "" : cls(d.pnl)); loadTrades(); setTimeout(loadEquity, 6000); }
      else if (ev.kind === "news" || ev.kind === "news_update") upsertNews(ev.data);
      else if (ev.kind === "log") { const key = ev.ts + (ev.data && ev.data.message); if (!S.eventKeys.has(key)) { S.eventKeys.add(key); S.events.unshift({ ts: ev.ts, level: ev.level, message: ev.data.message }); S.events = S.events.slice(0, 100); if (ev.level === "error") toast(ev.data.message, "down"); } }
    };
  }
  function scheduleWS() { clearTimeout(wsTimer); wsTimer = setTimeout(connectWS, wsBackoff); wsBackoff = Math.min(wsBackoff * 2, 15000); }

  // ---------- boot ----------
  conn("", "…");
  showTab((location.hash || "#overview").slice(1));
  window.addEventListener("hashchange", () => { const t = (location.hash || "#overview").slice(1); if (t !== S.tab) showTab(t); });
  loadStatus().catch(() => { if (!ws || ws.readyState !== 1) conn("bad", "офлайн"); }); loadTrades(); loadNews(); loadSources(); loadEvents(); loadEquity(); connectWS();
  setInterval(loadEquity, 15000); setInterval(loadSources, 30000); setInterval(loadTrades, 30000); setInterval(loadNews, 60000);
  window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { S.chartDrawn = true; if (S.tab === "overview") renderChart(); }, 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadStatus().catch(() => {}); loadTrades(); } });
})();
