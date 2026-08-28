/* Emoji / sticker / GIF picker panel. StickerPicker.mount(container, { onPick, onBackspace }) */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons, Emoji = window.Emoji, Stickers = window.Stickers;

  const StickerPicker = {
    mount(container, opts) {
      UI.clear(container);
      let tab = 'emoji';
      const body = h('div', { class: 'picker-body scroll' });
      const tabsBar = h('div', { class: 'picker-tabs' });

      function renderEmoji() {
        UI.clear(body);
        Emoji.categories.forEach((cat) => {
          body.appendChild(h('div', { class: 'picker-cat-title', text: catTitle(cat.id) }));
          const grid = h('div', { class: 'emoji-grid' });
          cat.emojis.forEach((e) => grid.appendChild(h('button', { class: 'emoji-cell', text: e, onClick: () => opts.onPick('emoji', e) })));
          body.appendChild(grid);
        });
      }
      function renderStickers() {
        UI.clear(body);
        if (Stickers.recent.length) { body.appendChild(h('div', { class: 'picker-cat-title', text: 'НЕДАВНИЕ' })); body.appendChild(stickerGrid(Stickers.recent)); }
        body.appendChild(h('div', { class: 'picker-cat-title', text: 'ИЗБРАННЫЕ' }));
        body.appendChild(stickerGrid(Stickers.favorites));
        Stickers.packs.forEach((p) => { body.appendChild(h('div', { class: 'picker-cat-title', text: p.title.toUpperCase() })); body.appendChild(stickerGrid(p.items)); });
      }
      function stickerGrid(items) {
        const grid = h('div', { class: 'sticker-grid' });
        items.forEach((s) => grid.appendChild(h('button', { class: 'sticker-cell', text: s, onClick: () => { Stickers.addRecent(s); opts.onPick('sticker', s); } })));
        return grid;
      }
      function renderGif() {
        UI.clear(body);
        const grid = h('div', { class: 'sticker-grid' });
        ['🎬','😂','🔥','🎉','👏','💃','🕺','🤩','😎','🚀','⚡','💫','🌈','🎈','🥳','❤️'].forEach((g) =>
          grid.appendChild(h('button', { class: 'sticker-cell gif', text: g, onClick: () => opts.onPick('gif', g) })));
        body.appendChild(h('div', { class: 'picker-cat-title', text: 'GIF' }));
        body.appendChild(grid);
      }

      function setTab(t) { tab = t; tabsBar.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.t === t)); if (t === 'emoji') renderEmoji(); else if (t === 'stickers') renderStickers(); else renderGif(); }

      ['gif:GIF','stickers:Стикеры','emoji:Эмодзи'].forEach((s) => { const [t, label] = s.split(':'); tabsBar.appendChild(h('button', { dataset: { t }, class: t === tab ? 'active' : '', text: label, onClick: () => setTab(t) })); });
      const bs = h('button', { class: 'picker-bs', html: Icons.close(), onClick: () => opts.onBackspace && opts.onBackspace() });

      container.appendChild(body);
      container.appendChild(h('div', { class: 'picker-foot' }, tabsBar, bs));
      setTab('emoji');
    },
  };

  function catTitle(id) { return ({ smileys: 'СМАЙЛЫ', people: 'ЛЮДИ', animals: 'ЖИВОТНЫЕ', food: 'ЕДА', activity: 'АКТИВНОСТЬ', travel: 'ПУТЕШЕСТВИЯ', objects: 'ОБЪЕКТЫ', symbols: 'СИМВОЛЫ' }[id] || id.toUpperCase()); }

  window.StickerPicker = StickerPicker;

  const st = document.createElement('style');
  st.textContent = `
    .picker-panel { height: 46%; min-height: 260px; background: var(--bg-elev); display: flex; flex-direction: column; border-top: .5px solid var(--sep); animation: tabFade .2s; }
    .picker-body { flex: 1; overflow-y: auto; padding: 6px 8px; }
    .picker-cat-title { font-size: 12px; color: var(--text-2); padding: 8px 4px 4px; letter-spacing: .3px; }
    .emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); }
    .emoji-cell { font-size: 27px; padding: 3px 0; border-radius: 8px; }
    .emoji-cell:active { background: rgba(128,128,128,.16); }
    .sticker-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .sticker-cell { font-size: 46px; padding: 6px 0; border-radius: 12px; transition: transform .12s; }
    .sticker-cell:active { transform: scale(1.25); background: rgba(128,128,128,.12); }
    .picker-foot { display: flex; align-items: center; gap: 6px; padding: 6px 10px calc(var(--safe-bottom) + 6px); border-top: .5px solid var(--sep); }
    .picker-tabs { display: flex; gap: 4px; flex: 1; }
    .picker-tabs button { padding: 6px 14px; border-radius: 16px; color: var(--text-2); font-size: 15px; }
    .picker-tabs button.active { background: rgba(128,128,128,.16); color: var(--text); font-weight: 500; }
    .picker-bs { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; color: var(--text-2); }
    .picker-bs svg { width: 20px; height: 20px; }
  `;
  document.head.appendChild(st);
})();
