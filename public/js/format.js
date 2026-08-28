/* Text formatting: parse markdown-ish input, render entities safely to HTML. */
(function () {
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Parse **bold** __italic__ ~~strike~~ `code` ||spoiler|| and links/@mentions/#tags
  // Returns { text, entities:[{type, offset, length, url?}] } with markers stripped.
  function parseInput(raw) {
    const entities = [];
    let text = '';
    const rules = [
      { re: /\*\*/g, type: 'bold' },
      { re: /__/g, type: 'italic' },
      { re: /~~/g, type: 'strike' },
      { re: /\|\|/g, type: 'spoiler' },
      { re: /`/g, type: 'code' },
    ];
    // simple stack-based scanner
    let i = 0;
    const open = {};
    while (i < raw.length) {
      let matched = false;
      for (const r of rules) {
        const marker = r.type === 'code' ? '`' : raw.substr(i, 2);
        const token = r.type === 'code' ? '`' : marker;
        const isTok = r.type === 'code' ? raw[i] === '`' : (raw.substr(i, 2) === markerFor(r.type));
        if (isTok) {
          if (open[r.type] == null) { open[r.type] = text.length; }
          else { entities.push({ type: r.type, offset: open[r.type], length: text.length - open[r.type] }); open[r.type] = null; }
          i += (r.type === 'code' ? 1 : 2);
          matched = true;
          break;
        }
      }
      if (!matched) { text += raw[i]; i++; }
    }
    detectAuto(text, entities);
    return { text, entities };
  }
  function markerFor(type) { return { bold: '**', italic: '__', strike: '~~', spoiler: '||' }[type]; }

  function detectAuto(text, entities) {
    const urlRe = /(https?:\/\/[^\s]+)|(\bwww\.[^\s]+)|([\w.+-]+@[\w-]+\.[\w.-]+)/g;
    let m;
    while ((m = urlRe.exec(text))) {
      const val = m[0];
      const type = m[3] ? 'email' : 'url';
      entities.push({ type, offset: m.index, length: val.length, url: m[3] ? 'mailto:' + val : (val.startsWith('http') ? val : 'https://' + val) });
    }
    const mentionRe = /@([a-zA-Z0-9_]{3,32})/g;
    while ((m = mentionRe.exec(text))) entities.push({ type: 'mention', offset: m.index, length: m[0].length, username: m[1] });
    const hashRe = /#([a-zA-Zа-яА-Я0-9_]+)/g;
    while ((m = hashRe.exec(text))) entities.push({ type: 'hashtag', offset: m.index, length: m[0].length });
  }

  // Render text + entities to HTML string.
  function render(text, entities) {
    text = text || '';
    entities = (entities || []).slice().filter((e) => e.offset >= 0 && e.length > 0 && e.offset + e.length <= text.length);
    if (!entities.length) return linkifyPlain(text);
    // Build point events
    const points = [];
    entities.forEach((e, idx) => {
      points.push({ pos: e.offset, open: true, e, idx });
      points.push({ pos: e.offset + e.length, open: false, e, idx });
    });
    points.sort((a, b) => a.pos - b.pos || (a.open === b.open ? 0 : a.open ? 1 : -1));
    let html = '';
    let last = 0;
    const stack = [];
    for (const p of points) {
      html += esc(text.slice(last, p.pos));
      last = p.pos;
      if (p.open) { html += openTag(p.e); stack.push(p.e); }
      else { html += closeTag(p.e); }
    }
    html += esc(text.slice(last));
    return html;
  }

  function openTag(e) {
    switch (e.type) {
      case 'bold': return '<b>';
      case 'italic': return '<i>';
      case 'underline': return '<u>';
      case 'strike': return '<s>';
      case 'code': return '<code class="mono">';
      case 'pre': return '<pre class="mono">';
      case 'spoiler': return '<span class="spoiler" onclick="this.classList.add(\'revealed\')">';
      case 'url': return `<a href="${esc(e.url || '')}" target="_blank" rel="noopener">`;
      case 'email': return `<a href="${esc(e.url || '')}">`;
      case 'mention': return `<a class="mention" href="javascript:void(0)" onclick="App.openUsername('${esc(e.username || '')}')">`;
      case 'hashtag': return '<a class="hashtag" href="javascript:void(0)">';
      default: return '<span>';
    }
  }
  function closeTag(e) {
    switch (e.type) {
      case 'bold': return '</b>'; case 'italic': return '</i>'; case 'underline': return '</u>';
      case 'strike': return '</s>'; case 'code': return '</code>'; case 'pre': return '</pre>';
      case 'spoiler': return '</span>'; case 'url': case 'email': case 'mention': case 'hashtag': return '</a>';
      default: return '</span>';
    }
  }

  function linkifyPlain(text) {
    const ents = [];
    detectAuto(text, ents);
    if (!ents.length) return esc(text);
    return render(text, ents);
  }

  // strip formatting for previews
  function plain(text) { return (text || '').replace(/\s+/g, ' ').trim(); }

  window.Format = { parseInput, render, plain, esc };
  // spoiler style injection
  const st = document.createElement('style');
  st.textContent = '.spoiler{background:#8b8d91;border-radius:4px;color:transparent;cursor:pointer;transition:.2s}.spoiler.revealed{background:transparent;color:inherit}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;background:rgba(128,128,128,.12);padding:0 3px;border-radius:4px}pre.mono{display:block;padding:8px;overflow-x:auto}.mention,.hashtag{color:var(--link)}';
  document.head.appendChild(st);
})();
