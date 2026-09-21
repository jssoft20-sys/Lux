/* Lux dashboard: live state over WebSocket, REST for history. No frameworks. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { snap: null, trades: [], tradeStats: null, news: [], sources: [], equity: [], rangeH: 6, quote: "USDT", tableOpen: false, logSeen: new Set() };

  // ---------- formatting ----------
  const fmtMoney = (v, d = 2) => (v === null || v === undefined || isNaN(v)) ? "—" : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtSigned = (v, d = 2, suffix = "") => { if (v === null || v === undefined || isNaN(v)) return "—"; const s = v > 0 ? "+" : v < 0 ? "−" : ""; return s + fmtMoney(Math.abs(v), d) + suffix; };
  const fmtPct = (v, d = 2) => fmtSigned(v, d, "%");
  const fmtPrice = (p) => { if (!p) return "—"; const d = p >= 1000 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 7; return Number(p).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const fmtQty = (q) => { if (!q) return "—"; return Number(q).toLocaleString("ru-RU", { maximumFractionDigits: q >= 100 ? 1 : q >= 1 ? 3 : 6 }); };
  const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtDateTime = (ts) => new Date(ts * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const fmtDur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}ч ${m}м` : m ? `${m}м ${sec}с` : `${sec}с`; };
  const cls = (v) => v > 0 ? "pos" : v < 0 ? "neg" : "";
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v; else e.setAttribute(k, v); } if (text !== undefined) e.textContent = text; return e; };
  const setText = (id, text, className) => { const e = $(id); if (!e) return; e.textContent = text; if (className !== undefined) e.className = className; };

  // ---------- REST ----------
  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ headers: { "Accept": "application/json" } }, opts || {}));
    if (r.status === 401) { location.reload(); return null; }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }
  const post = (path) => api(path, { method: "POST" });

  // ---------- top bar / tiles ----------
  function renderStatus(snap) {
    const st = snap.status; state.quote = st.quote_asset || "USDT";
    const modeB = $("mode-badge"); modeB.textContent = st.mode === "live" ? "LIVE · реальные сделки" : "PAPER · виртуальные сделки"; modeB.className = "badge " + (st.mode === "live" ? "live" : "paper");
    const sb = $("state-badge");
    if (st.halted) { sb.textContent = "остановлен: " + (st.halt_reason || "дневной лимит"); sb.className = "badge bad"; }
    else if (st.paused) { sb.textContent = "пауза"; sb.className = "badge warn"; }
    else if (st.running) { sb.textContent = "работает"; sb.className = "badge ok"; }
    else { sb.textContent = "запуск…"; sb.className = "badge off"; }
    $("btn-pause").hidden = st.paused; $("btn-resume").hidden = !st.paused; $("btn-reset-halt").hidden = !st.halted;
    $("uptime").textContent = st.uptime_s ? `аптайм ${fmtDur(st.uptime_s)} · тик ${st.tick_ms} мс` : "";
    $("tick-note").textContent = `цикл решений каждые ${st.interval_ms} мс · ${st.ticks.toLocaleString("ru-RU")} тиков`;

    const m = snap.market; const fb = $("feed-badge");
    fb.className = "badge " + (m.connected && m.last_msg_age_ms !== null && m.last_msg_age_ms < 10000 ? "ok" : "bad");
    fb.textContent = m.connected ? `рынок · ${m.last_msg_age_ms ?? "—"} мс` : "рынок: нет связи";
    fb.title = `сообщений: ${m.messages}, переподключений: ${m.reconnects}${m.error ? ", " + m.error : ""}`;
    const n = snap.news; const nb = $("news-badge");
    nb.className = "badge " + (n.sources_ok > 0 ? (n.sources_ok >= n.sources * 0.6 ? "ok" : "warn") : "bad");
    nb.textContent = `новости · ${n.sources_ok}/${n.sources} источников`;
    nb.title = `материалов получено: ${n.items}; в книге: ${n.in_book}; индекс страха/жадности: ${n.fng ?? "—"}; тон рынка: ${n.market_score}`;
    const l = snap.llm; const lb = $("llm-badge");
    if (l.enabled) { lb.className = "badge " + (l.errors && l.last_error && !l.calls ? "bad" : "ok"); lb.textContent = `ИИ · ${l.model} · ${l.items} оценок`; lb.title = `вызовов: ${l.calls}, ошибок: ${l.errors}${l.last_error ? ": " + l.last_error : ""}, очередь: ${l.queue}`; }
    else { lb.className = "badge off"; lb.textContent = "ИИ выкл (нет ANTHROPIC_API_KEY)"; lb.title = "Задайте ANTHROPIC_API_KEY в .env, чтобы включить Claude-анализ новостей"; }

    const w = $("warnings"); w.innerHTML = ""; (snap.warnings || []).forEach(t => w.appendChild(el("div", {}, t))); w.hidden = !(snap.warnings && snap.warnings.length);

    const q = state.quote;
    const money = (id, text, klass) => { const e = $(id); e.textContent = ""; e.appendChild(document.createTextNode(text)); e.appendChild(el("span", { class: "unit" }, " " + q)); if (klass !== undefined) e.className = "value " + klass; };
    money("t-equity", fmtMoney(st.equity));
    const start = state.equity.length ? state.equity[0].equity : null;
    if (start) { const d = st.equity - start; setText("t-equity-delta", `${fmtSigned(d)} ${q} (${fmtPct(d / start * 100)}) за период`, "delta " + cls(d)); } else setText("t-equity-delta", "", "delta");
    money("t-pnl-today", fmtSigned(st.realized_today), cls(st.realized_today));
    money("t-pnl-total", fmtSigned(st.realized_total), cls(st.realized_total));
    money("t-unrealized", fmtSigned(st.unrealized), cls(st.unrealized));
    setText("t-unrealized-sub", `${st.open_positions} откр. позиций · в рынке ${fmtMoney(st.exposure)} ${q}`);
    money("t-free", fmtMoney(st.quote_balance));
    const acc = snap.account || {};
    if (st.mode !== "paper") setText("t-free-sub", "свободно на счёте Binance");
    else if (acc.real_quote_free !== undefined && acc.real_quote_free !== null) setText("t-free-sub", `виртуальный баланс · на счёте Binance ${fmtMoney(acc.real_quote_free)} ${q}`);
    else if (acc.real_error) { setText("t-free-sub", "виртуальный баланс · ключ Binance: ошибка"); $("t-free-sub").title = acc.real_error; }
    else setText("t-free-sub", "виртуальный баланс");
    if (state.tradeStats) {
      const t = state.tradeStats.today, a = state.tradeStats.all;
      setText("t-trades-today", String(t.closed));
      setText("t-trades-sub", t.closed ? `винрейт ${Math.round(t.win_rate * 100)}% · комиссии ${fmtMoney(t.fees, 3)} ${q}` : "закрытых сделок пока нет");
      setText("t-pnl-today-sub", t.closed ? `${t.wins} прибыльных из ${t.closed}` : "");
      setText("t-pnl-total-sub", a.closed ? `${a.closed} сделок · винрейт ${Math.round(a.win_rate * 100)}%` : "");
    }
    if (snap.config) {
      const c = snap.config;
      setText("f-weights", `${c.w_news}·новости + ${c.w_momentum}·импульс + ${c.w_orderbook}·стакан + ${c.w_flow}·поток`);
      setText("f-buy", String(c.buy_threshold)); setText("f-tp", `+${c.take_profit_pct}%`); setText("f-sl", `−${c.stop_loss_pct}%`);
      setText("f-hold", `${c.max_hold_minutes} мин`); setText("f-daily", `${c.daily_loss_limit_usdt} ${q}`);
    }
  }

  // ---------- signals ----------
  function sigBar(v) {
    const wrap = el("span", { class: "sigbar" }); const track = el("span", { class: "track" });
    const fill = el("span", { class: "fill " + (v >= 0 ? "pos" : "neg") }); fill.style.width = `${Math.min(50, Math.abs(v) * 50).toFixed(1)}%`;
    track.appendChild(fill); wrap.appendChild(track); wrap.appendChild(el("span", { class: "v " + cls(v) }, fmtSigned(v, 2))); return wrap;
  }
  function renderSignals(snap) {
    const tb = $("signals").querySelector("tbody"); tb.innerHTML = "";
    const rows = snap.signals || [];
    const best = rows.find(r => !r.in_position);
    $("signals-note").textContent = rows.length ? `${rows.length} пар · порог входа ${snap.config ? snap.config.buy_threshold : ""} · лучший сейчас: ${best ? best.symbol.replace(state.quote, "") + " " + fmtSigned(best.composite, 2) : "—"} · тон рынка ${fmtSigned(snap.news ? snap.news.market_score : 0, 2)}` : "ожидание рыночных данных…";
    if (!rows.length) { tb.appendChild(el("tr", { class: "empty-row" })).appendChild(el("td", { colspan: 11 }, "Ожидание данных Binance…")); return; }
    for (const s of rows) {
      const tr = el("tr", { class: s.in_position ? "inpos" : "" });
      const top = s.top_news && s.top_news[0] ? `Главная новость: ${s.top_news[0].title}` : "новостей по паре нет";
      tr.appendChild(el("td", { class: "sym", title: top }, s.symbol.replace(state.quote, "/" + state.quote)));
      tr.appendChild(el("td", { class: "num" }, fmtPrice(s.price)));
      tr.appendChild(el("td", { class: "num " + cls(s.mom_1m) }, fmtPct(s.mom_1m)));
      tr.appendChild(el("td", { class: "num " + cls(s.mom_5m) }, fmtPct(s.mom_5m)));
      tr.appendChild(el("td", { class: "num " + cls(s.news_score), title: top }, `${fmtSigned(s.news_score, 2)} (${s.news_count})`));
      tr.appendChild(el("td", { class: "num " + cls(s.momentum_score) }, fmtSigned(s.momentum_score, 2)));
      tr.appendChild(el("td", { class: "num " + cls(s.imbalance) }, fmtSigned(s.imbalance, 2)));
      tr.appendChild(el("td", { class: "num " + cls(s.flow) }, fmtSigned(s.flow, 2)));
      tr.appendChild(el("td", { class: "num muted" }, isFinite(s.spread_bps) ? s.spread_bps.toFixed(1) : "—"));
      const td = el("td"); td.appendChild(sigBar(s.composite)); tr.appendChild(td);
      tr.appendChild(el("td", { class: "muted dec", title: s.decision || "" }, s.in_position ? "в позиции" : (s.decision || "—")));
      tb.appendChild(tr);
    }
  }

  // ---------- positions ----------
  function renderPositions(snap) {
    const tb = $("positions").querySelector("tbody"); tb.innerHTML = "";
    const rows = snap.positions || [];
    $("positions-note").textContent = rows.length ? `${rows.length} из ${snap.config ? snap.config.max_positions : "…"}` : "";
    if (!rows.length) { tb.appendChild(el("tr", { class: "empty-row" })).appendChild(el("td", { colspan: 8 }, "Открытых позиций нет — бот ждёт сигнал")); return; }
    for (const p of rows) {
      const tr = el("tr");
      const sym = el("td", { class: "sym" }, p.symbol.replace(state.quote, "/" + state.quote));
      sym.appendChild(el("span", { class: "sub", title: p.entry_reason || "" }, (p.entry_reason || "").slice(0, 60)));
      tr.appendChild(sym);
      tr.appendChild(el("td", { class: "num" }, fmtQty(p.qty)));
      tr.appendChild(el("td", { class: "num" }, fmtPrice(p.entry_price)));
      tr.appendChild(el("td", { class: "num" }, fmtPrice(p.current)));
      const pnl = el("td", { class: "num " + cls(p.pnl) }, `${fmtSigned(p.pnl, 3)} ${state.quote}`); pnl.appendChild(el("span", { class: "sub" }, fmtPct(p.pnl_pct))); tr.appendChild(pnl);
      const sl = el("td", { class: "num" }, `${fmtPrice(p.trailing_active ? p.trailing_stop : p.stop_loss)} / ${fmtPrice(p.take_profit)}`); if (p.trailing_active) sl.appendChild(el("span", { class: "sub" }, "трейлинг активен")); tr.appendChild(sl);
      tr.appendChild(el("td", { class: "num" }, fmtDur(p.age_s)));
      const act = el("td"); const b = el("button", { class: "mini" }, "закрыть"); b.onclick = async () => { b.disabled = true; try { await post(`/api/control/close/${p.symbol}`); } catch (e) { alert("Не удалось закрыть: " + e.message); b.disabled = false; } }; act.appendChild(b); tr.appendChild(act);
      tb.appendChild(tr);
    }
  }

  // ---------- trades ----------
  function renderTrades() {
    const tb = $("trades").querySelector("tbody"); tb.innerHTML = "";
    const rows = state.trades;
    $("trades-note").textContent = rows.length ? `последние ${rows.length}` : "";
    if (!rows.length) { tb.appendChild(el("tr", { class: "empty-row" })).appendChild(el("td", { colspan: 7 }, "Сделок пока нет")); return; }
    for (const t of rows) {
      const tr = el("tr");
      tr.appendChild(el("td", { class: "muted" }, fmtDateTime(t.ts)));
      tr.appendChild(el("td", { class: "sym" }, t.symbol.replace(state.quote, "/" + state.quote)));
      tr.appendChild(el("td", { class: t.side === "BUY" ? "side-buy" : "side-sell" }, t.side === "BUY" ? "покупка" : "продажа"));
      tr.appendChild(el("td", { class: "num" }, fmtPrice(t.price)));
      tr.appendChild(el("td", { class: "num" }, `${fmtMoney(t.quote_qty)} ${state.quote}`));
      const pnl = el("td", { class: "num " + (t.pnl === null ? "" : cls(t.pnl)) }, t.pnl === null || t.pnl === undefined ? "—" : fmtSigned(t.pnl, 3));
      if (t.pnl !== null && t.pnl !== undefined) pnl.appendChild(el("span", { class: "sub" }, fmtPct(t.pnl_pct))); tr.appendChild(pnl);
      tr.appendChild(el("td", { class: "reason", title: t.reason || "" }, (t.reason || "").slice(0, 70)));
      tb.appendChild(tr);
    }
  }

  // ---------- news ----------
  function newsLi(n) {
    const li = el("li", { "data-id": n.id });
    li.appendChild(el("span", { class: "time", title: new Date(n.ts * 1000).toLocaleString("ru-RU") }, fmtTime(n.ts)));
    const body = el("div");
    const a = el("a", { class: "title", href: n.url || "#", target: "_blank", rel: "noopener noreferrer" }, n.title); body.appendChild(a);
    const meta = el("div", { class: "meta" }); meta.appendChild(el("span", {}, n.source));
    (n.tickers || []).slice(0, 6).forEach(t => meta.appendChild(el("span", { class: "chip" }, t)));
    if (n.market_wide) meta.appendChild(el("span", { class: "chip" }, "рынок"));
    body.appendChild(meta);
    if (n.llm_reason) body.appendChild(el("div", { class: "reason" }, "ИИ: " + n.llm_reason + (n.llm_impact ? ` · влияние: ${{ high: "высокое", medium: "среднее", low: "низкое" }[n.llm_impact] || n.llm_impact}` : "")));
    li.appendChild(body);
    const s = n.effective_score !== undefined ? n.effective_score : n.score;
    const sc = el("span", { class: "score " + cls(s), title: `лексика ${fmtSigned(n.score, 2)}${n.llm_score !== null && n.llm_score !== undefined ? ", ИИ " + fmtSigned(n.llm_score, 2) + " (уверенность " + Math.round((n.llm_confidence || 0) * 100) + "%)" : ""}` }, fmtSigned(s, 2));
    if (n.llm_score !== null && n.llm_score !== undefined) sc.appendChild(el("span", { class: "ai" }, "ИИ"));
    li.appendChild(sc);
    return li;
  }
  function renderNews() {
    const ul = $("news"); ul.innerHTML = "";
    const rows = state.news.slice(0, 80);
    $("news-note").textContent = rows.length ? `последние ${rows.length}` : "ожидание…";
    if (!rows.length) { ul.appendChild(el("li", { class: "muted" }, "Новостей пока нет")); return; }
    rows.forEach(n => ul.appendChild(newsLi(n)));
  }
  function upsertNews(n) {
    const i = state.news.findIndex(x => x.id === n.id);
    if (i >= 0) state.news[i] = n; else state.news.unshift(n);
    state.news.sort((a, b) => b.ts - a.ts); state.news = state.news.slice(0, 150);
    const existing = $("news").querySelector(`li[data-id="${CSS.escape(n.id)}"]`);
    if (existing) existing.replaceWith(newsLi(n)); else renderNews();
  }

  // ---------- sources & log ----------
  function renderSources() {
    const tb = $("sources").querySelector("tbody"); tb.innerHTML = "";
    const ok = state.sources.filter(s => s.last_ok_age !== null && !s.last_error).length;
    $("sources-note").textContent = state.sources.length ? `${ok} из ${state.sources.length} отвечают` : "";
    for (const s of state.sources) {
      const tr = el("tr");
      tr.appendChild(el("td", {}, s.name));
      tr.appendChild(el("td", { class: "num" }, String(s.items)));
      tr.appendChild(el("td", { class: "num muted" }, `${s.interval}с`));
      const st = el("td", { class: "st " + (s.last_error ? "neg" : (s.last_ok_age === null ? "muted" : "pos")), title: s.last_error || "" }, s.last_error ? "ошибка: " + s.last_error.slice(0, 60) : (s.last_ok_age === null ? "ожидание" : `ок, ${Math.round(s.last_ok_age)}с назад`));
      tr.appendChild(st); tb.appendChild(tr);
    }
  }
  function addLog(ev) {
    const key = ev.ts + (ev.data && ev.data.message); if (state.logSeen.has(key)) return; state.logSeen.add(key);
    const ul = $("log"); const li = el("li", { class: ev.level || "info" });
    li.appendChild(el("span", { class: "time" }, fmtTime(ev.ts))); li.appendChild(el("span", {}, (ev.data && ev.data.message) || ""));
    ul.prepend(li); while (ul.children.length > 200) ul.lastChild.remove();
  }

  // ---------- equity chart ----------
  function niceTicks(min, max, n) {
    const span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10)); return out;
  }
  let chartRows = [];
  function renderChart() {
    const root = $("equity-chart"); const rows = chartRows; root.innerHTML = "";
    if (rows.length < 2) { root.appendChild(el("div", { class: "empty" }, "Данные накапливаются… кривая появится через минуту")); return; }
    const W = root.clientWidth || 900, H = root.clientHeight || 280, pad = { l: 64, r: 20, t: 14, b: 26 };
    const xs = rows.map(r => r.ts), ys = rows.map(r => r.equity);
    const x0 = xs[0], x1 = xs[xs.length - 1] > x0 ? xs[xs.length - 1] : x0 + 1;
    let ymin = Infinity, ymax = -Infinity; for (const y of ys) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    if (ymax - ymin < 1e-9) { ymin -= 0.05; ymax += 0.05; } const padY = (ymax - ymin) * 0.15; ymin -= padY; ymax += padY;
    const sx = t => pad.l + (t - x0) / (x1 - x0) * (W - pad.l - pad.r), sy = v => pad.t + (ymax - v) / (ymax - ymin) * (H - pad.t - pad.b);
    const NS = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const g = (c) => { const e = document.createElementNS(NS, "g"); e.setAttribute("class", c); svg.appendChild(e); return e; };
    const grid = g("grid"), axis = g("axis");
    for (const v of niceTicks(ymin, ymax, 4)) {
      const y = sy(v); const l = document.createElementNS(NS, "line"); l.setAttribute("x1", pad.l); l.setAttribute("x2", W - pad.r); l.setAttribute("y1", y); l.setAttribute("y2", y); grid.appendChild(l);
      const t = document.createElementNS(NS, "text"); t.setAttribute("x", pad.l - 8); t.setAttribute("y", y + 4); t.setAttribute("text-anchor", "end"); t.textContent = fmtMoney(v, v >= 100 ? 1 : 2); axis.appendChild(t);
    }
    const span = x1 - x0; const nx = Math.min(6, Math.max(2, Math.floor(W / 140)));
    for (let i = 0; i <= nx; i++) { const t = x0 + span * i / nx; const tx = document.createElementNS(NS, "text"); tx.setAttribute("x", sx(t)); tx.setAttribute("y", H - 8); tx.setAttribute("text-anchor", i === 0 ? "start" : i === nx ? "end" : "middle"); tx.textContent = span > 36 * 3600 ? fmtDateTime(t) : fmtTime(t).slice(0, 5); axis.appendChild(tx); }
    // reference: starting equity of the period
    const ref = document.createElementNS(NS, "line"); ref.setAttribute("class", "ref"); ref.setAttribute("x1", pad.l); ref.setAttribute("x2", W - pad.r); ref.setAttribute("y1", sy(ys[0])); ref.setAttribute("y2", sy(ys[0])); svg.appendChild(ref);
    const rl = document.createElementNS(NS, "text"); rl.setAttribute("class", "ref-label"); rl.setAttribute("x", W - pad.r); rl.setAttribute("y", sy(ys[0]) - 4); rl.setAttribute("text-anchor", "end"); rl.textContent = "старт периода"; svg.appendChild(rl);
    let d = ""; rows.forEach((r, i) => { d += (i ? "L" : "M") + sx(r.ts).toFixed(1) + " " + sy(r.equity).toFixed(1) + " "; });
    const area = document.createElementNS(NS, "path"); area.setAttribute("class", "area"); area.setAttribute("d", d + `L${sx(x1).toFixed(1)} ${(H - pad.b).toFixed(1)} L${sx(x0).toFixed(1)} ${(H - pad.b).toFixed(1)} Z`); svg.appendChild(area);
    const line = document.createElementNS(NS, "path"); line.setAttribute("class", "line"); line.setAttribute("d", d.trim()); svg.appendChild(line);
    const cross = document.createElementNS(NS, "line"); cross.setAttribute("class", "cross"); cross.setAttribute("y1", pad.t); cross.setAttribute("y2", H - pad.b); cross.style.display = "none"; svg.appendChild(cross);
    const endM = document.createElementNS(NS, "circle"); endM.setAttribute("class", "marker"); endM.setAttribute("r", 4); endM.setAttribute("cx", sx(x1)); endM.setAttribute("cy", sy(ys[ys.length - 1])); svg.appendChild(endM);
    const hov = document.createElementNS(NS, "circle"); hov.setAttribute("class", "marker"); hov.setAttribute("r", 5); hov.style.display = "none"; svg.appendChild(hov);
    root.appendChild(svg);
    const tip = el("div", { class: "tooltip" }); tip.style.display = "none"; root.appendChild(tip);
    const move = (ev) => {
      const rect = svg.getBoundingClientRect(); const px = (ev.clientX - rect.left) * W / rect.width; const t = x0 + (px - pad.l) / (W - pad.l - pad.r) * (x1 - x0);
      let lo = 0, hi = xs.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < t) lo = mid + 1; else hi = mid; }
      if (lo > 0 && Math.abs(xs[lo - 1] - t) < Math.abs(xs[lo] - t)) lo--;
      const r = rows[lo]; const cx = sx(r.ts), cy = sy(r.equity);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.style.display = ""; hov.setAttribute("cx", cx); hov.setAttribute("cy", cy); hov.style.display = "";
      tip.innerHTML = ""; tip.appendChild(el("div", { class: "muted" }, new Date(r.ts * 1000).toLocaleString("ru-RU")));
      const v = el("div"); v.appendChild(el("span", { class: "key" })); const b = el("b", {}, `${fmtMoney(r.equity, 3)} ${state.quote}`); v.appendChild(b); v.appendChild(el("span", { class: "muted" }, " эквити")); tip.appendChild(v);
      const dlt = r.equity - ys[0]; tip.appendChild(el("div", { class: cls(dlt) }, `${fmtSigned(dlt, 3)} к старту · нереализ. ${fmtSigned(r.unrealized, 3)}`));
      tip.style.display = ""; const left = cx / W * rect.width; tip.style.left = Math.min(rect.width - tip.offsetWidth - 8, Math.max(0, left + 12)) + "px"; tip.style.top = Math.max(0, cy / H * rect.height - tip.offsetHeight - 10) + "px";
    };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerleave", () => { cross.style.display = "none"; hov.style.display = "none"; tip.style.display = "none"; });
    const last = rows[rows.length - 1]; const first = rows[0]; const dl = last.equity - first.equity;
    $("chart-note").textContent = `${rows.length} точек · ${fmtSigned(dl, 3)} ${state.quote} (${fmtPct(first.equity ? dl / first.equity * 100 : 0)}) за период`;
    if (state.tableOpen) renderEquityTable();
  }
  function renderEquityTable() {
    const box = $("equity-table"); box.innerHTML = ""; const t = el("table"); const th = el("thead", { html: "<tr><th>Время</th><th class='num'>Эквити</th><th class='num'>Свободно</th><th class='num'>Нереализ.</th><th class='num'>Реализ. сегодня</th></tr>" }); t.appendChild(th);
    const tb = el("tbody"); chartRows.slice(-60).reverse().forEach(r => { const tr = el("tr"); tr.appendChild(el("td", { class: "muted" }, new Date(r.ts * 1000).toLocaleString("ru-RU"))); tr.appendChild(el("td", { class: "num" }, fmtMoney(r.equity, 3))); tr.appendChild(el("td", { class: "num" }, fmtMoney(r.quote_balance, 3))); tr.appendChild(el("td", { class: "num " + cls(r.unrealized) }, fmtSigned(r.unrealized, 3))); tr.appendChild(el("td", { class: "num " + cls(r.realized_today) }, fmtSigned(r.realized_today, 3))); tb.appendChild(tr); });
    t.appendChild(tb); box.appendChild(t);
  }

  // ---------- loaders ----------
  async function loadEquity() { try { const rows = await api(`/api/equity?hours=${state.rangeH}`); if (rows) { state.equity = rows; chartRows = rows; renderChart(); } } catch (e) { console.warn("equity", e); } }
  async function loadTrades() { try { const d = await api("/api/trades?limit=100"); if (d) { state.trades = d.trades; state.tradeStats = { today: d.today, all: d.all }; renderTrades(); if (state.snap) renderStatus(state.snap); } } catch (e) { console.warn("trades", e); } }
  async function loadNews() { try { const d = await api("/api/news?limit=80"); if (d) { state.news = d; renderNews(); } } catch (e) { console.warn("news", e); } }
  async function loadSources() { try { const d = await api("/api/sources"); if (d) { state.sources = d; renderSources(); } } catch (e) { console.warn("sources", e); } }
  async function loadEvents() { try { const d = await api("/api/events?limit=80"); if (d) d.slice().reverse().forEach(e => addLog({ ts: e.ts, level: e.level, data: { message: e.message.replace(/^log: /, "") } })); } catch (e) { console.warn("events", e); } }
  async function loadStatus() { const d = await api("/api/status"); if (d) { state.snap = d; renderStatus(d); renderSignals(d); renderPositions(d); } }

  // ---------- websocket (with polling fallback) ----------
  let ws = null, wsBackoff = 1000, wsTimer = null, pollTimer = null, pollFailures = 0;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try { await loadStatus(); pollFailures = 0; $("conn-badge").className = "badge warn"; $("conn-badge").textContent = "опрос каждые 3 с"; }
      catch (e) { if (++pollFailures >= 2) { $("conn-badge").className = "badge bad"; $("conn-badge").textContent = "нет связи с ботом"; } }
    }, 3000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  async function connectWS() {
    let token = "";
    try { const t = await api("/api/ws-token"); if (t && t.token) token = t.token; } catch (e) { /* the socket may still work with browser credentials */ }
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws" + (token ? "?token=" + encodeURIComponent(token) : "");
    try { ws = new WebSocket(url); } catch (e) { startPolling(); scheduleWS(); return; }
    ws.onopen = () => { wsBackoff = 1000; stopPolling(); $("conn-badge").className = "badge ok"; $("conn-badge").textContent = "онлайн"; };
    ws.onclose = () => { startPolling(); scheduleWS(); };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
    ws.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch (e) { return; }
      if (ev.kind === "snapshot") { const d = ev.data; d.config = (state.snap && state.snap.config) || d.config; state.snap = Object.assign({}, state.snap || {}, d); renderStatus(state.snap); renderSignals(state.snap); renderPositions(state.snap); }
      else if (ev.kind === "trade") { loadTrades(); setTimeout(loadEquity, 6000); }
      else if (ev.kind === "news" || ev.kind === "news_update") { upsertNews(ev.data); }
      else if (ev.kind === "log") { addLog(ev); }
    };
  }
  function scheduleWS() { clearTimeout(wsTimer); wsTimer = setTimeout(connectWS, wsBackoff); wsBackoff = Math.min(wsBackoff * 2, 15000); }

  // ---------- controls ----------
  $("btn-pause").onclick = () => post("/api/control/pause").catch(e => alert(e.message));
  $("btn-resume").onclick = () => post("/api/control/resume").catch(e => alert(e.message));
  $("btn-reset-halt").onclick = () => { if (confirm("Снять дневной стоп и продолжить торговлю?")) post("/api/control/reset_halt").catch(e => alert(e.message)); };
  $("btn-close-all").onclick = () => { if (confirm("Закрыть ВСЕ открытые позиции по рынку?")) post("/api/control/close_all").then(r => { if (r) addLog({ ts: Date.now() / 1000, level: "warn", data: { message: `закрыто позиций: ${r.closed}` } }); }).catch(e => alert(e.message)); };
  $("btn-table").onclick = () => { state.tableOpen = !state.tableOpen; $("equity-table").hidden = !state.tableOpen; $("btn-table").textContent = state.tableOpen ? "скрыть таблицу" : "таблица"; if (state.tableOpen) renderEquityTable(); };
  $("range-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; [...$("range-seg").children].forEach(x => x.classList.toggle("on", x === b)); state.rangeH = Number(b.dataset.h); loadEquity(); });
  $("btn-theme").onclick = () => { const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light"; document.documentElement.setAttribute("data-theme", cur); try { localStorage.setItem("lux-theme", cur); } catch (e) { /* ignore */ } renderChart(); };
  try { const t = localStorage.getItem("lux-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) { /* ignore */ }
  window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(renderChart, 150); });

  // ---------- boot ----------
  loadStatus().catch(e => console.warn("status", e)); loadTrades(); loadNews(); loadSources(); loadEvents(); loadEquity(); connectWS();
  setInterval(loadEquity, 15000); setInterval(loadSources, 20000); setInterval(loadTrades, 30000); setInterval(loadNews, 60000);
})();
