/* Conversation view — the heart of the app. */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons, Format = window.Format, Emoji = window.Emoji;

  App.registerScreen('chat', {
    render(params) {
      const chatId = params.chatId;
      const root = h('div', { class: 'col chat-screen', style: { height: '100%' } });
      root.appendChild(h('div', { class: 'chat-wallpaper' }));

      let chat = App.getChat(chatId) || { id: chatId, title: '…', members: [] };
      const state = { messages: [], reply: null, edit: null, pickerOpen: false };

      /* ---- header ---- */
      const peerBox = h('div', { class: 'peer', onClick: () => openPeerProfile() });
      const nav = UI.header({ onBack: () => App.pop(), titleEl: peerBox, pillTitle: false,
        rightButtons: [ UI.iconBtn('more', (e) => headerMenu(e)) ], solid: false });
      nav.classList.add('chat-nav', 'solid');
      root.appendChild(nav);

      function renderHeader() {
        UI.clear(peerBox);
        const isSaved = chat.type === 'saved';
        peerBox.appendChild(UI.avatar(isSaved ? { type: 'saved' } : (chat.peer || { id: chat.id, name: chat.title, avatar: chat.avatar }), 36));
        let status = '';
        if (isSaved) status = '';
        else if (chat.type === 'group') status = chat.memberCount + ' участников';
        else if (chat.type === 'channel') status = (chat.memberCount || 0) + ' подписчиков';
        else if (chat.isBot) status = 'бот';
        else status = UI.lastSeen(chat.peer || { online: chat.online, lastSeen: chat.lastSeen });
        const pname = h('div', { class: 'pname' }, h('span', { text: chat.title }));
        if (chat.verified) pname.appendChild(h('span', { class: 'verified badge-verified', html: Icons.verified() }));
        peerBox.appendChild(h('div', { class: 'peer-info' }, pname,
          h('div', { class: 'pstatus' + ((chat.peer && chat.peer.online) ? ' online' : ''), text: status })));
      }
      renderHeader();

      /* ---- pinned bar ---- */
      const pinnedBar = h('div', { class: 'pinned-bar hidden' });
      root.appendChild(pinnedBar);
      function renderPinned() {
        const pid = chat.pinnedMessageId;
        if (!pid) { pinnedBar.classList.add('hidden'); return; }
        const m = state.messages.find((x) => x.id === pid);
        if (!m) { pinnedBar.classList.add('hidden'); return; }
        pinnedBar.classList.remove('hidden');
        UI.clear(pinnedBar);
        pinnedBar.appendChild(h('div', { class: 'bar' }));
        pinnedBar.appendChild(h('div', { class: 'pin-body' },
          h('div', { class: 'pin-title', text: 'Закреплённое сообщение' }),
          h('div', { class: 'pin-text', text: Format.plain(m.text) || '[вложение]' })));
        pinnedBar.appendChild(h('span', { class: 'pin-ic', style: { width: '18px', color: 'var(--accent)' }, html: Icons.pin() }));
        pinnedBar.onclick = () => scrollToMessage(pid);
      }

      /* ---- message list ---- */
      const scroller = h('div', { class: 'chat-scroll scroll' });
      root.appendChild(scroller);
      const typingRow = h('div', { class: 'msg-row typing-row hidden' }, h('div', { class: 'typing-bubble' }, h('i'), h('i'), h('i')));

      function renderMessages() {
        UI.clear(scroller);
        let lastDay = null, lastSender = null;
        state.messages.forEach((m, i) => {
          const day = new Date(m.ts).toDateString();
          if (day !== lastDay) { scroller.appendChild(h('div', { class: 'day-sep', text: UI.daySep(m.ts) })); lastDay = day; lastSender = null; }
          if (m.service) { scroller.appendChild(h('div', { class: 'service-msg', text: serviceLabel(m) })); return; }
          const next = state.messages[i + 1];
          const isTail = !next || next.senderId !== m.senderId || next.service || (new Date(next.ts).toDateString() !== day);
          scroller.appendChild(messageEl(m, isTail));
          lastSender = m.senderId;
        });
        scroller.appendChild(typingRow);
        scrollBottom();
      }

      function messageEl(m, isTail) {
        const out = m.out;
        const showAvatar = !out && (chat.type === 'group' || chat.type === 'channel') && isTail;
        const row = h('div', { class: 'msg-row ' + (out ? 'out' : 'in') + (isTail ? ' tail' : '') + (showAvatar ? ' show-avatar' : ''), dataset: { id: m.id } });
        if (!out && (chat.type === 'group' || chat.type === 'channel')) {
          const av = UI.avatar({ id: m.senderId, name: m.senderName, avatar: m.senderAvatar }, 30);
          av.classList.add('m-avatar'); row.appendChild(av);
        }
        const bubble = h('div', { class: 'bubble' });
        // forward header
        if (m.forwardFrom) bubble.appendChild(h('div', { class: 'fwd-head', html: 'Переслано от <b>' + Format.esc(m.forwardFrom.name || '') + '</b>' }));
        // sender name (groups, incoming)
        if (!out && (chat.type === 'group' || chat.type === 'channel') && isTail) bubble.appendChild(h('div', { class: 'sender', style: { color: m.senderColor }, text: m.senderName }));
        // reply
        if (m.replyPreview) {
          bubble.appendChild(h('div', { class: 'reply-quote', onClick: (e) => { e.stopPropagation(); scrollToMessage(m.replyPreview.id); } },
            h('div', { class: 'rq-name', text: m.replyPreview.senderName }),
            h('div', { class: 'rq-text', text: Format.plain(m.replyPreview.text) })));
        }
        // media
        if (m.media) renderMedia(bubble, m);
        // poll
        if (m.poll) bubble.appendChild(pollEl(m));
        // text
        if (m.text) {
          const t = h('div', { class: 'm-text', html: Format.render(m.text, m.entities) });
          bubble.appendChild(t);
        }
        // inline keyboard (bot)
        if (m.media && m.media.keyboard) bubble.appendChild(keyboardEl(m.media.keyboard, m));
        // meta
        const meta = h('span', { class: 'm-meta' });
        if (m.edited) meta.appendChild(h('span', { class: 'edited', text: 'ред. ' }));
        if (m.views) meta.appendChild(h('span', { class: 'views', html: Icons.eye() + ' ' + formatViews(m.views) }));
        meta.appendChild(h('span', { text: UI.timeShort(m.ts) }));
        if (out) { const seen = (m.seenBy || []).some((u) => u !== App.state.me.id); meta.appendChild(h('span', { class: 'ticks', style: { color: seen ? '#4fae4e' : undefined }, html: seen ? Icons.tickDouble() : Icons.tickSingle() })); }
        // put meta at end of last text/media block
        if (m.text || (m.media && (m.media.kind === 'photo' || m.media.kind === 'video'))) {
          (bubble.querySelector('.m-text') || bubble).appendChild(meta);
        } else bubble.appendChild(meta);
        // reactions
        if (m.reactions && Object.keys(m.reactions).length) bubble.appendChild(reactionsEl(m));
        if (m.media && (m.media.kind === 'sticker')) bubble.classList.add('media-only'), bubble.style.background = 'transparent', bubble.style.boxShadow = 'none';

        row.appendChild(bubble);
        attachLongPress(bubble, (e) => messageMenu(e, m, row));
        bubble.addEventListener('dblclick', () => quickReact(m, '❤️'));
        return row;
      }

      function renderMedia(bubble, m) {
        const md = m.media; const k = md.kind;
        if (k === 'photo') bubble.appendChild(h('img', { class: 'm-photo', src: md.url, loading: 'lazy', onClick: () => openImage(md.url) }));
        else if (k === 'video') { const v = h('video', { class: 'm-video', src: md.url, controls: true }); bubble.appendChild(v); }
        else if (k === 'sticker') bubble.appendChild(h('div', { class: 'm-sticker play', text: md.emoji || '🙂' }));
        else if (k === 'voice') bubble.appendChild(voiceEl(md));
        else if (k === 'file') bubble.appendChild(h('div', { class: 'm-file', onClick: () => window.open(md.url, '_blank') },
          h('div', { class: 'f-ic', html: Icons.file() }), h('div', {}, h('div', { class: 'f-name', text: md.name || 'Файл' }), h('div', { class: 'f-size', text: UI.fileSize(md.size) }))));
        else if (k === 'link') { if (md.image) {} bubble.appendChild(linkPreviewEl(md)); }
      }

      function voiceEl(md) {
        const bars = (md.waveform && md.waveform.length ? md.waveform : Array.from({ length: 28 }, () => 0.3 + Math.random() * 0.7));
        const wave = h('div', { class: 'wave' });
        bars.forEach((v) => wave.appendChild(h('i', { style: { height: Math.max(3, v * 24) + 'px' } })));
        const audio = h('audio', { src: md.url, preload: 'none' });
        const btn = h('div', { class: 'play', html: Icons.play() });
        let playing = false;
        btn.onclick = () => { if (playing) { audio.pause(); } else { audio.play(); } };
        audio.onplay = () => { playing = true; btn.innerHTML = Icons.pause(); };
        audio.onpause = audio.onended = () => { playing = false; btn.innerHTML = Icons.play(); };
        audio.ontimeupdate = () => { const p = audio.currentTime / (audio.duration || md.duration || 1); const on = Math.floor(p * bars.length); wave.querySelectorAll('i').forEach((el, idx) => el.classList.toggle('on', idx <= on)); };
        return h('div', {}, h('div', { class: 'm-voice' }, btn, h('div', { class: 'col', style: { flex: 1 } }, wave, h('div', { class: 'vtime', text: UI.duration(md.duration || 0) }))), audio);
      }

      function linkPreviewEl(md) {
        const lp = h('div', { class: 'link-preview', onClick: () => window.open(md.url, '_blank') },
          h('div', { class: 'lp-site', text: md.site || '' }),
          md.title ? h('div', { class: 'lp-title', text: md.title }) : null,
          md.desc ? h('div', { class: 'lp-desc', text: md.desc }) : null);
        if (md.image) lp.appendChild(h('img', { src: md.image, loading: 'lazy' }));
        return lp;
      }

      function pollEl(m) {
        const p = m.poll;
        const wrap = h('div', { class: 'poll' });
        wrap.appendChild(h('div', { class: 'p-q', text: p.question }));
        wrap.appendChild(h('div', { class: 'p-type', text: (p.quiz ? 'Викторина' : (p.multiple ? 'Опрос — неск. ответов' : 'Анонимный опрос')) }));
        const voted = (p.myVotes || []).length > 0;
        p.options.forEach((opt, i) => {
          const cnt = (p.counts || [])[i] || 0;
          const pct = p.total ? Math.round(cnt / p.total * 100) : 0;
          const mine = (p.myVotes || []).includes(i);
          const optEl = h('div', { class: 'p-opt', onClick: () => votePoll(p, i) });
          const top = h('div', { class: 'p-opt-top' });
          if (voted) top.appendChild(h('div', { class: 'p-pct', text: pct + '%' }));
          else top.appendChild(h('div', { class: 'p-radio' + (mine ? ' on' : '') }));
          top.appendChild(h('div', { class: 'p-opt-text', text: opt }));
          optEl.appendChild(top);
          if (voted) optEl.appendChild(h('div', { class: 'p-bar' }, h('i', { style: { width: pct + '%' } })));
          wrap.appendChild(optEl);
        });
        wrap.appendChild(h('div', { class: 'p-total', text: (p.total || 0) + ' проголосовало' }));
        return wrap;
      }
      function votePoll(p, i) { App.emit('poll:vote', { pollId: p.id, options: [i] }); }

      function keyboardEl(rows, m) {
        const kb = h('div', { class: 'inline-kb' });
        rows.forEach((r) => { const rowEl = h('div', { class: 'kb-row' }); r.forEach((btn) => rowEl.appendChild(h('button', { text: btn.text, onClick: () => sendText(btn.text) }))); kb.appendChild(rowEl); });
        return kb;
      }

      function reactionsEl(m) {
        const wrap = h('div', { class: 'reactions' });
        Object.entries(m.reactions).forEach(([emoji, users]) => {
          const mine = users.includes(App.state.me.id);
          wrap.appendChild(h('div', { class: 'reaction' + (mine ? ' mine' : ''), onClick: () => quickReact(m, emoji) },
            h('span', { class: 'em', text: emoji }), h('span', { text: users.length })));
        });
        return wrap;
      }

      /* ---- message actions ---- */
      function messageMenu(e, m, row) {
        const x = e.clientX || 60, y = e.clientY || 300;
        // reaction picker floating
        showReactionPicker(x, y - 60, m);
        const items = [
          { label: 'Ответить', icon: 'reply', onClick: () => setReply(m) },
          { label: 'Скопировать', icon: 'copy', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(m.text || ''); UI.toast('Скопировано'); } },
          { label: 'Переслать', icon: 'forward', onClick: () => forwardMessage(m) },
          { label: m.pinned ? 'Открепить' : 'Закрепить', icon: 'pin', onClick: () => pinMessage(m) },
        ];
        if (m.out) items.push({ label: 'Изменить', icon: 'edit', onClick: () => setEdit(m) });
        items.push({ label: 'Удалить', icon: 'trash', danger: true, onClick: () => deleteMessage(m) });
        setTimeout(() => UI.contextMenu(x, y, items), 10);
      }
      function showReactionPicker(x, y, m) {
        const picker = h('div', { class: 'reaction-picker' });
        Emoji.reactions.slice(0, 6).forEach((emoji) => picker.appendChild(h('button', { text: emoji, onClick: () => { picker.remove(); quickReact(m, emoji); } })));
        const rect = App.el.phone.getBoundingClientRect();
        picker.style.left = Math.max(8, Math.min(x - rect.left - 100, rect.width - 240)) + 'px';
        picker.style.top = Math.max(60, y - rect.top) + 'px';
        App.el.overlayLayer.appendChild(picker);
        setTimeout(() => picker.remove(), 3000);
        picker.addEventListener('click', () => {}, { once: false });
      }
      function quickReact(m, emoji) {
        const mine = m.reactions && m.reactions[emoji] && m.reactions[emoji].includes(App.state.me.id);
        App.emit('message:react', { messageId: m.id, emoji, remove: mine });
      }
      function pinMessage(m) { App.emit('message:pin', { messageId: m.id, unpin: m.pinned }); }
      async function deleteMessage(m) {
        if (!(await UI.confirm({ title: 'Удалить сообщение?', okLabel: 'Удалить', danger: true }))) return;
        App.emit('message:delete', { messageId: m.id });
      }
      function forwardMessage(m) {
        UI.sheet({ title: 'Переслать в…', actions: App.state.chats.slice(0, 8).map((c) => ({ label: c.title, icon: 'forward',
          onClick: () => { App.emit('message:send', { chatId: c.id, text: m.text, entities: m.entities, media: m.media, forwardFrom: { name: m.senderName } }); UI.toast('Переслано'); } })) });
      }
      function setReply(m) { state.edit = null; state.reply = m; renderComposeContext(); input.focus(); }
      function setEdit(m) { state.reply = null; state.edit = m; input.value = m.text || ''; renderComposeContext(); updateSendBtn(); input.focus(); }

      function scrollToMessage(id) {
        const el = scroller.querySelector('[data-id="' + id + '"]');
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.querySelector('.bubble').style.transition = 'background .4s'; const b = el.querySelector('.bubble'); const orig = b.style.background; b.style.background = 'rgba(51,144,236,.25)'; setTimeout(() => b.style.background = orig, 800); }
      }

      /* ---- composer ---- */
      const composeContext = h('div', { class: 'compose-context hidden' });
      const input = h('textarea', { class: 'msg-input', placeholder: 'Сообщение', rows: 1 });
      const attachBtn = h('button', { class: 'attach', html: Icons.attach(), onClick: () => attachSheet() });
      const emojiBtn = h('button', { class: 'emoji-btn', html: Icons.smile(), onClick: () => togglePicker() });
      const micBtn = h('button', { class: 'mic-btn', html: Icons.mic() });
      const sendBtn = h('button', { class: 'send-btn', html: Icons.send() });
      const composerInner = h('div', { class: 'composer-inner' }, attachBtn, input, emojiBtn);
      const composer = h('div', { class: 'composer' }, composerInner, micBtn, sendBtn);
      const pickerPanel = h('div', { class: 'picker-panel hidden' });
      root.appendChild(composeContext);
      root.appendChild(pickerPanel);
      root.appendChild(composer);

      input.addEventListener('input', () => { autoGrow(); updateSendBtn(); sendTyping(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 600) { e.preventDefault(); doSend(); } });
      function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; }
      function updateSendBtn() { const has = input.value.trim().length > 0 || state.edit; sendBtn.classList.toggle('show', !!has); micBtn.style.display = has ? 'none' : 'flex'; }
      sendBtn.onclick = () => doSend();

      let typingTimer;
      function sendTyping() { App.emit('typing', { chatId, on: true }); clearTimeout(typingTimer); typingTimer = setTimeout(() => App.emit('typing', { chatId, on: false }), 2500); }

      function renderComposeContext() {
        if (!state.reply && !state.edit) { composeContext.classList.add('hidden'); return; }
        composeContext.classList.remove('hidden');
        UI.clear(composeContext);
        const m = state.reply || state.edit;
        composeContext.appendChild(h('div', { class: 'cc-bar' }));
        composeContext.appendChild(h('div', { class: 'cc-body' },
          h('div', { class: 'cc-title', text: state.edit ? 'Редактирование' : ('Ответ ' + (m.senderName || '')) }),
          h('div', { class: 'cc-text', text: Format.plain(m.text) || '[вложение]' })));
        composeContext.appendChild(h('button', { class: 'nav-btn circle', style: { color: 'var(--text-2)' }, html: Icons.close(),
          onClick: () => { state.reply = null; state.edit = null; input.value = ''; renderComposeContext(); updateSendBtn(); } }));
      }

      function doSend() {
        const raw = input.value.trim();
        if (state.edit) {
          if (!raw) return;
          const { text, entities } = Format.parseInput(raw);
          App.emit('message:edit', { messageId: state.edit.id, text, entities });
          state.edit = null; input.value = ''; renderComposeContext(); updateSendBtn(); autoGrow();
          return;
        }
        if (!raw) return;
        sendText(raw);
        input.value = ''; autoGrow(); updateSendBtn();
      }
      function sendText(raw) {
        const { text, entities } = Format.parseInput(raw);
        const payload = { chatId, text, entities };
        if (state.reply) { payload.replyTo = state.reply.id; state.reply = null; renderComposeContext(); }
        App.emit('message:send', payload, () => {});
        detectLinkPreview(text);
      }
      function detectLinkPreview(text) {
        const m = text.match(/https?:\/\/[^\s]+/);
        if (!m) return;
        App.api('GET', '/link-preview?url=' + encodeURIComponent(m[0])).then((p) => {
          if (p && (p.title || p.desc)) App.emit('message:send', { chatId, media: { kind: 'link', url: p.url, title: p.title, desc: p.desc, site: p.site, image: p.image } });
        }).catch(() => {});
      }

      /* ---- attach sheet ---- */
      function attachSheet() {
        const fileInput = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
        const anyInput = h('input', { type: 'file', style: { display: 'none' } });
        document.body.appendChild(fileInput); document.body.appendChild(anyInput);
        fileInput.onchange = () => uploadAndSend(fileInput.files[0]);
        anyInput.onchange = () => uploadAndSend(anyInput.files[0], true);
        UI.sheet({ actions: [
          { label: 'Галерея', icon: 'gallery', onClick: () => fileInput.click() },
          { label: 'Файл', icon: 'file', onClick: () => anyInput.click() },
          { label: 'Опрос', icon: 'poll', onClick: () => window.PollCreator && window.PollCreator.open({ onCreate: (poll) => App.emit('message:send', { chatId, poll }) }) },
          { label: 'Геопозиция', icon: 'location', onClick: () => sendLocation() },
          { label: 'Контакт', icon: 'contact2', onClick: () => shareContact() },
        ] });
      }
      async function uploadAndSend(file, asFile) {
        if (!file) return;
        UI.toast('Загрузка…');
        try {
          const up = await App.upload(file);
          let kind = asFile ? 'file' : (file.type.startsWith('video') ? 'video' : file.type.startsWith('image') ? 'photo' : 'file');
          App.emit('message:send', { chatId, media: { kind, url: up.url, name: up.name, size: up.size } });
        } catch (e) { UI.toast('Ошибка загрузки'); }
      }
      function sendLocation() {
        App.emit('message:send', { chatId, media: { kind: 'link', url: 'https://maps.google.com', title: '📍 Геопозиция', desc: 'Общий доступ к местоположению', site: 'Карты' } });
      }
      function shareContact() {
        UI.sheet({ title: 'Отправить контакт', actions: App.state.contacts.slice(0, 8).map((u) => ({ label: u.name + ' ' + (u.lastName || ''), icon: 'contact2',
          onClick: () => App.emit('message:send', { chatId, text: '👤 ' + u.name + ' ' + (u.lastName || '') + '\n' + (u.phone || '@' + u.username) }) })) });
      }

      /* ---- sticker/emoji picker ---- */
      function togglePicker() {
        state.pickerOpen = !state.pickerOpen;
        if (state.pickerOpen) {
          UI.clear(pickerPanel); pickerPanel.classList.remove('hidden');
          emojiBtn.innerHTML = Icons.keyboard();
          window.StickerPicker.mount(pickerPanel, { onPick: (type, value) => {
            if (type === 'emoji') { insertAtCursor(value); }
            else if (type === 'sticker') { App.emit('message:send', { chatId, media: { kind: 'sticker', emoji: value } }); }
            else if (type === 'gif') { App.emit('message:send', { chatId, media: { kind: 'sticker', emoji: value } }); }
          }, onBackspace: () => { input.value = input.value.slice(0, -1); updateSendBtn(); } });
        } else { pickerPanel.classList.add('hidden'); emojiBtn.innerHTML = Icons.smile(); }
      }
      function insertAtCursor(text) {
        const s = input.selectionStart || input.value.length, e = input.selectionEnd || input.value.length;
        input.value = input.value.slice(0, s) + text + input.value.slice(e);
        input.selectionStart = input.selectionEnd = s + text.length;
        updateSendBtn(); autoGrow();
      }

      /* ---- voice recording ---- */
      let recCtl = null;
      micBtn.addEventListener('click', async () => {
        if (!window.Voice) return UI.toast('Запись не поддерживается');
        startRecording();
      });
      async function startRecording() {
        try {
          const bar = h('div', { class: 'rec-bar' }, h('div', { class: 'rec-dot' }), h('div', { class: 'rec-time', text: '0:00' }),
            h('div', { class: 'rec-slide', text: '‹ Проведите для отмены' }));
          const cancelBtn = h('button', { class: 'nav-btn', style: { color: 'var(--danger)' }, html: Icons.trash() });
          const doneBtn = h('button', { class: 'send-btn show', html: Icons.send() });
          const recRow = h('div', { class: 'composer' }, cancelBtn, bar, doneBtn);
          composer.replaceWith(recRow);
          let sec = 0; const timer = setInterval(() => { sec++; bar.querySelector('.rec-time').textContent = UI.duration(sec); }, 1000);
          recCtl = await window.Voice.start({});
          const finish = async (send) => {
            clearInterval(timer); recRow.replaceWith(composer);
            if (send) { const { blob, duration, waveform } = await recCtl.stop(); const file = new File([blob], 'voice.webm', { type: blob.type });
              try { const up = await App.upload(file); App.emit('message:send', { chatId, media: { kind: 'voice', url: up.url, duration, waveform } }); } catch (e) { UI.toast('Ошибка'); } }
            else recCtl.cancel();
            recCtl = null;
          };
          cancelBtn.onclick = () => finish(false);
          doneBtn.onclick = () => finish(true);
        } catch (e) { UI.toast('Нет доступа к микрофону'); }
      }

      /* ---- misc header/profile ---- */
      function openPeerProfile() { App.openProfile(chat.peer || null, chat); }
      function headerMenu(e) {
        const x = e.clientX || 300, y = e.clientY || 60;
        UI.contextMenu(x, y, [
          { label: 'Профиль', icon: 'contacts', onClick: () => openPeerProfile() },
          { label: chat.muted ? 'Включить звук' : 'Без звука', icon: 'bell', onClick: () => App.api('PATCH', '/chats/' + chatId + '/mute', { muted: !chat.muted }).then(() => { chat.muted = !chat.muted; }) },
          { label: 'Поиск', icon: 'search', onClick: () => UI.toast('Поиск по чату') },
          { label: 'Очистить историю', icon: 'trash', danger: true, onClick: () => clearHistory() },
        ]);
      }
      async function clearHistory() {
        if (!(await UI.confirm({ title: 'Очистить историю?', okLabel: 'Очистить', danger: true }))) return;
        await App.api('DELETE', '/chats/' + chatId); App.pop(); App.loadChats();
      }
      function openImage(url) { const bg = h('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => bg.remove() }, h('img', { src: url, style: { maxWidth: '96%', maxHeight: '90%', borderRadius: '10px' } })); App.el.overlayLayer.appendChild(bg); }

      /* ---- typing indicator ---- */
      function renderTyping() {
        const t = App.state.typing[chatId] || {};
        const names = Object.keys(t).filter((u) => u !== App.state.me.id);
        typingRow.classList.toggle('hidden', names.length === 0);
        if (names.length) scrollBottom();
      }

      function scrollBottom() { requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; }); }

      /* ---- load ---- */
      async function load() {
        try {
          const [{ chat: c }, { messages, pinnedMessageId }] = await Promise.all([
            App.api('GET', '/chats/' + chatId),
            App.api('GET', '/chats/' + chatId + '/messages'),
          ]);
          chat = Object.assign(chat, c); App.upsertChat(chat);
          state.messages = messages; App.state.messages[chatId] = state.messages;
          chat.pinnedMessageId = pinnedMessageId;
          renderHeader(); renderMessages(); renderPinned();
          // mark read
          App.emit('message:read', { chatId }); chat.unread = 0; App.bus.emit('chats:changed'); App.updateTabBadge();
        } catch (e) { console.warn(e); UI.toast('Не удалось загрузить чат'); }
      }
      load();

      App.state.activeChatId = chatId;
      App.bindBus(root, {
        'message:new': (p) => { if (p.chatId !== chatId) return; if (!state.messages.find((m) => m.id === p.message.id)) state.messages.push(p.message); renderMessages(); App.emit('message:read', { chatId }); },
        'message:edit': (p) => { if (p.chatId !== chatId) return; const i = state.messages.findIndex((m) => m.id === p.message.id); if (i >= 0) state.messages[i] = p.message; renderMessages(); },
        'message:delete': (p) => { if (p.chatId !== chatId) return; state.messages = state.messages.filter((m) => m.id !== p.messageId); renderMessages(); },
        'message:react': (p) => { if (p.chatId !== chatId) return; const m = state.messages.find((x) => x.id === p.messageId); if (m) m.reactions = p.reactions; renderMessages(); },
        'message:read': (p) => { if (p.chatId !== chatId) return; state.messages.forEach((m) => { if (m.out && !(m.seenBy || []).includes(p.userId)) m.seenBy = (m.seenBy || []).concat(p.userId); }); renderMessages(); },
        'chat:pin': (p) => { if (p.chatId !== chatId) return; chat.pinnedMessageId = p.pinnedMessageId; state.messages.forEach((m) => m.pinned = (m.id === p.pinnedMessageId)); renderPinned(); },
        'poll:update': (p) => { if (p.chatId !== chatId) return; const m = state.messages.find((x) => x.id === p.messageId); if (m) m.poll = p.poll; renderMessages(); },
        'typing': (p) => { if (p.chatId === chatId) renderTyping(); },
        'presence': () => renderHeader(),
      });
      const prevTeardown = root._teardown;
      root._teardown = () => { App.state.activeChatId = null; clearTimeout(typingTimer); prevTeardown && prevTeardown(); };
      updateSendBtn();
      return root;
    },
  });

  function serviceLabel(m) { const s = m.service; if (!s) return ''; if (s.type === 'group_created') return 'Группа создана'; return ''; }
  function formatViews(n) { if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'; if (n >= 1000) return (n / 1000).toFixed(1) + 'K'; return '' + n; }

  function attachLongPress(el, handler) {
    let timer, moved, sx, sy;
    const start = (e) => { moved = false; const p = e.touches ? e.touches[0] : e; sx = p.clientX; sy = p.clientY; timer = setTimeout(() => { if (!moved) handler(p); }, 420); };
    const move = (e) => { const p = e.touches ? e.touches[0] : e; if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) { moved = true; clearTimeout(timer); } };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(timer));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); handler(e); });
  }
})();
