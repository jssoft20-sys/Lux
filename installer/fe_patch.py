"""Build app-1.13.9.51.js / styles-1.13.9.42.css from the 1.13.9.39 files (exact-match edits)."""
from pathlib import Path
import sys

STATIC = Path(sys.argv[1])
src = (STATIC / "app-1.13.9.39-ui-fix.js").read_text(encoding="utf-8")
css = (STATIC / "styles-1.13.9.39-ui-fix.css").read_text(encoding="utf-8")
s = src


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:120])
    s = s.replace(old, new)


# ------------------------------------------------------------------ icons (cleaner shapes)
rep("home: 'M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3Z'", "home: 'M3 10.5 12 3l9 7.5M5.5 9v11.5h4.5v-6h4v6h4.5V9'")
rep("chat: 'M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5A8 8 0 1 1 21 15Z'", "chat: 'M7.9 20A9 9 0 1 0 4 16.1L2.5 21.5Z'")
rep("copy: 'M9 9h10v10H9zM5 15H4V5h10v1'", "copy: 'M10 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5'")
rep("settings: 'M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5ZM19 12l2-1-1-3-2 .2-1.4-1.4.2-2-3-1-1 2-2 0-1-2-3 1 .2 2L6.2 8.2 4 8l-1 3 2 1v2l-2 1 1 3 2.2-.2L7.8 19l-.2 2 3 1 1-2h2l1 2 3-1-.2-2 1.4-1.4 2 .2 1-3-2-1Z'",
    "settings: 'M20 7h-9M14 17H4M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'")
rep("wallet: 'M4 7h15v12H4zM4 7l2-3h11l2 3M15 12h4v3h-4z'", "wallet: 'M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6M16 12h5v4h-5a2 2 0 0 1 0-4Z'")
rep("send: 'M22 2 11 13M22 2l-7 20-4-9-9-4Z'", "send: 'M21.5 2.5 10.6 13.4M21.5 2.5l-6.8 19-4.1-8.1L2.5 9.3Z'")

# ------------------------------------------------------------------ PERF_1_13_9_42: keyed list patching
rep("""  function txGroups(list, opts) { opts = opts || {}; const groups = groupByDay(list); return h('div', { class: 'tx-groups' }, groups.map((g) => h('section', { class: 'tx-day' }, h('div', { class: 'tx-day-title' }, g.label), h('div', { class: 'tx-day-list' }, g.items.map((tx, i) => { const card = txCard(tx, opts); card.style.setProperty('--i', Math.min(i, 10)); const sw = opts.swipe && opts.swipe(tx); return sw ? swipeRow(card, sw) : card; }))))); }""",
    """  const txSig = (tx) => JSON.stringify([tx.status, tx.updated_at, tx.error, tx.needs_attention, tx.deferred, tx.operator_name, tx.player_name, tx.user_name, tx.player_id, tx.pay_amount, tx.amount, tx.payment_source, tx.source, tx.bank && tx.bank.key, tx.currency]);
  function txGroups(list, opts) { opts = opts || {}; const groups = groupByDay(list); return h('div', { class: 'tx-groups' }, groups.map((g) => h('section', { class: 'tx-day' }, h('div', { class: 'tx-day-title' }, g.label), h('div', { class: 'tx-day-list' }, g.items.map((tx, i) => { const card = txCard(tx, opts); card.style.setProperty('--i', Math.min(i, 10)); const sw = opts.swipe && opts.swipe(tx); const el = sw ? swipeRow(card, sw) : card; el.dataset.key = (tx.kind || '') + ':' + tx.id; el.dataset.sig = txSig(tx); return el; }))))); }
  /* PERF_1_13_9_42: live lists are patched in place — unchanged cards keep their DOM node (no flash, no
     re-animation, images stay loaded, scroll stays); new cards slide in, changed ones flash softly */
  function patchList(box, fresh, reuse) {
    if (reuse) {
      const old = new Map();
      box.querySelectorAll('[data-key]').forEach((el) => old.set(el.dataset.key, el));
      fresh.querySelectorAll('[data-key]').forEach((el) => {
        const prev = old.get(el.dataset.key);
        if (!prev) { el.classList.add('tx-new'); return; }
        if (prev.dataset.sig === el.dataset.sig && !prev.classList.contains('swiping')) { prev.classList.remove('tx-new', 'tx-upd'); el.replaceWith(prev); }
        else el.classList.add('tx-upd');
      });
    }
    box.classList.toggle('live-patched', !!reuse);
    box.replaceChildren(...Array.from(fresh.childNodes));
  }
  /* SKELETON_1_13_9_42: every page gets its own skeleton instead of one generic list */
  function skel(kind) {
    const b = (cls) => h('i', { class: 'skb ' + (cls || '') });
    const row = () => h('div', { class: 'skx-row' }, b('av'), h('div', { class: 'skx-lines' }, b('w60'), b('w40')), h('div', { class: 'skx-side' }, b('w20'), b('w14')));
    if (kind === 'balance') return h('div', { class: 'skx skx-card' }, h('div', { class: 'skx-head' }, b('dot'), b('w30')), h('div', { class: 'skx-grid' }, b('tile'), b('tile')), b('bar'));
    if (kind === 'detail') return h('div', { class: 'skx' }, h('div', { class: 'skx-card' }, h('div', { class: 'skx-head' }, b('w40'), b('pill')), b('big'), b('w60'), b('bar')), h('div', { class: 'skx-card' }, [1, 2, 3, 4].map(() => h('div', { class: 'skx-kv' }, b('w30'), b('w40')))));
    if (kind === 'chat') return h('div', { class: 'skx skx-chat' }, h('div', { class: 'skx-head' }, b('av'), b('w40')), ['in', 'out', 'in', 'in', 'out'].map((d) => h('div', { class: 'skx-bubble ' + d }, b(d === 'in' ? 'w60' : 'w40'))));
    if (kind === 'chats') return h('div', { class: 'skx' }, [1, 2, 3, 4, 5, 6].map(() => h('div', { class: 'skx-row chat' }, b('av round'), h('div', { class: 'skx-lines' }, b('w40'), b('w70')), b('w10'))));
    if (kind === 'tiles') return h('div', { class: 'skx skx-tiles' }, [1, 2, 3, 4].map(() => b('tile')));
    return h('div', { class: 'skx' }, b('day'), [1, 2, 3, 4].map(row));
  }""")

# ------------------------------------------------------------------ image viewer (dark, download + close, no date)
rep("""  function imageSheet(title, src, caption) { const img = h('img', { src, alt: '', loading: 'eager', onclick: (e) => e.currentTarget.closest('.v39-photo-stage')?.classList.toggle('zoom') }); sheet({ title: title || 'Фото', body: h('div', { class: 'img-sheet v39-photo-viewer' }, h('div', { class: 'v39-photo-stage' }, img), caption ? h('small', { class: 'v39-photo-caption' }, caption) : null) }); }""",
    """  /* PHOTO_VIEWER_1_13_9_42: every photo (receipts, QR, chat media, client avatars) opens the same clean
     dark viewer — the photo, «Скачать» and «Закрыть»; tap to zoom, swipe down or tap outside to close */
  function imageSheet(title, src, caption) {
    const root = $('#modal-root') || document.body;
    const img = h('img', { src, alt: '', decoding: 'async' });
    const stage = h('div', { class: 'pv-stage' }, img);
    let box = null;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { if (!box || !box.isConnected || box.classList.contains('closing')) return; box.classList.add('closing'); document.removeEventListener('keydown', onKey); setTimeout(() => { box.remove(); if (!document.querySelector('.sheet-back:not(.closing),.pv-lightbox')) document.body.style.overflow = ''; }, 170); };
    const dl = h('a', { class: 'pv-btn', href: src, download: '', target: '_blank', rel: 'noopener', 'aria-label': 'Скачать', onclick: (e) => e.stopPropagation() }, svg('download', 22));
    const x = h('button', { class: 'pv-btn', type: 'button', 'aria-label': 'Закрыть', onclick: (e) => { e.stopPropagation(); close(); } }, svg('close', 22));
    box = h('div', { class: 'pv-lightbox', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === box || e.target === stage) close(); } }, h('div', { class: 'pv-bar' }, dl, x), stage);
    img.addEventListener('click', (e) => { e.stopPropagation(); stage.classList.toggle('zoom'); });
    img.addEventListener('error', () => { stage.replaceChildren(h('div', { class: 'pv-error' }, 'Не удалось загрузить фото')); });
    let y0 = null;
    stage.addEventListener('touchstart', (e) => { y0 = e.touches.length === 1 && !stage.classList.contains('zoom') ? e.touches[0].clientY : null; }, { passive: true });
    stage.addEventListener('touchmove', (e) => { if (y0 === null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) { img.style.transform = 'translateY(' + dy + 'px) scale(' + Math.max(0.85, 1 - dy / 1600) + ')'; box.style.backgroundColor = 'rgba(2,6,23,' + Math.max(0.3, 0.96 - dy / 420).toFixed(2) + ')'; } }, { passive: true });
    stage.addEventListener('touchend', (e) => { if (y0 === null) return; const t = e.changedTouches[0]; const dy = t ? t.clientY - y0 : 0; y0 = null; if (dy > 90) close(); else { img.style.transform = ''; box.style.backgroundColor = ''; } });
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'; root.appendChild(box);
    return { close };
  }""")

# ------------------------------------------------------------------ live poll a bit faster (cheap: revision only)
rep("    tick(); state.poll = setInterval(() => { if (!document.hidden) tick(); }, 2500);", "    tick(); state.poll = setInterval(() => { if (!document.hidden) tick(); }, 2000);")

# ------------------------------------------------------------------ home: game account ID + compact USDT
rep("""    const copyText = async (txt) => {
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(txt);""", """    const GAME_ID = '378630535';
    let walletOpen = false;
    const copyText = async (txt, label) => {
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(txt);""")
rep("""        toast('USDT TRC20 адрес скопирован', 'ok', 1400);
      } catch (e) { toast('Не удалось скопировать адрес', 'err', 2200); }""", """        toast(label || 'USDT TRC20 адрес скопирован', 'ok', 1400);
      } catch (e) { toast('Не удалось скопировать', 'err', 2200); }""")
rep("""        const addr=h('span',{class:'ow-wallet-address'},USDT_TRC20); const copyBtn=h('button',{class:'ow-copy',type:'button','aria-label':'Скопировать USDT TRC20',onclick:()=>copyText(USDT_TRC20)},svg('copy',17));
        oneWinBox.appendChild(h('div',{class:'ow-wallet'},h('div',{class:'ow-wallet-label'},h('b',null,'USDT TRC20'),h('small',null,'кошелёк')),h('button',{class:'ow-wallet-main',type:'button',onclick:()=>copyText(USDT_TRC20),title:'Нажмите, чтобы скопировать'},addr),copyBtn));""",
    """        /* WALLET_1_13_9_42: the game account ID is the main, one-tap copy; USDT is a compact button that reveals the address */
        const idBtn=h('button',{class:'ow-game',type:'button',onclick:()=>copyText(GAME_ID,'ID игрового счета скопирован')},h('span',{class:'ow-game-copy'},h('small',null,'ID игрового счета'),h('b',null,GAME_ID)),svg('copy',17));
        const usdtAddr=h('button',{class:'ow-usdt-addr',type:'button',hidden:!walletOpen,onclick:()=>copyText(USDT_TRC20,'USDT TRC20 адрес скопирован')},h('span',null,USDT_TRC20),svg('copy',15));
        const usdtBtn=h('button',{class:'ow-usdt-btn'+(walletOpen?' open':''),type:'button','aria-expanded':String(walletOpen)},'USDT',svg('chevron',13));
        usdtBtn.onclick=()=>{walletOpen=!walletOpen;usdtAddr.hidden=!walletOpen;usdtBtn.classList.toggle('open',walletOpen);usdtBtn.setAttribute('aria-expanded',String(walletOpen));};
        oneWinBox.appendChild(h('div',{class:'ow-wallet2'},h('div',{class:'ow-wallet2-row'},idBtn,usdtBtn),usdtAddr));""")
rep("""    screen.appendChild(top); screen.appendChild(oneWinBox); screen.appendChild(alarmsBox); screen.appendChild(listBox);""",
    """    screen.appendChild(top); screen.appendChild(oneWinBox); screen.appendChild(alarmsBox); screen.appendChild(listBox); oneWinBox.appendChild(skel('balance'));""")

# ------------------------------------------------------------------ home: tab switch never ignored, per-tab cache, keyed patch
rep("""    async function load(manual, background=false) {
      if (homeLoadBusy) return;
      homeLoadBusy=true;
      const oldY=window.scrollY;
      drawTop();
      if(!background){refresh.disabled=true;refresh.classList.add('spin');if(!listBox.children.length)listBox.appendChild(loader());}
      try { let items; if(state.homeTab==='deferred'){const w=await api('/withdrawals?status=deferred&size=100');items=w.items;} else {const[d,w]=await Promise.all([api('/deposits?status=created,processing,failed&size=100'),api('/withdrawals?status=active&size=100')]);items=[...d.items,...w.items];} items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)); const nextSig=JSON.stringify(items.map(x=>[x.kind,x.id,x.status,x.updated_at,x.deferred,x.needs_attention,x.error,x.amount,x.pay_amount])); if(background&&nextSig===homeSig)return; homeSig=nextSig; const fresh=document.createElement('div'); if(!items.length)fresh.appendChild(empty(state.homeTab==='deferred'?'Отложенных нет':'Актуальных заявок нет','','home')); else fresh.appendChild(txGroups(items,{swipe:(tx)=>tx.kind==='withdraw'&&can('operations')&&['created','processing'].includes(tx.status)?{label:tx.deferred?'Вернуть':'Отложить',color:tx.deferred?'blue':'amber',icon:'timer',onAction:async()=>{const r=await txAction('withdraw',tx,tx.deferred?'resume':'defer',{done:tx.deferred?'Возвращено в работу':'Отложено'});if(r)load();}}:null})); listBox.replaceChildren(...fresh.childNodes); if(manual)toast('Обновлено','ok',900); }
      catch(e){if(!background){listBox.innerHTML='';listBox.appendChild(empty('Не удалось загрузить',e.message));}}
      if(!background){refresh.disabled=false;refresh.classList.remove('spin');}
      homeLoadBusy=false;
      if(background&&oldY>120)requestAnimationFrame(()=>window.scrollTo(0,oldY));
    }""", """    /* PERF_1_13_9_42: a tab click is never swallowed by a background refresh (the newest request wins),
       the other tab's last list shows instantly, and live refreshes patch only the changed cards */
    let homeSeq = 0; const homeCache = {};
    const homeSwipe = (tx) => tx.kind==='withdraw'&&can('operations')&&['created','processing'].includes(tx.status)?{label:tx.deferred?'Вернуть':'Отложить',color:tx.deferred?'blue':'amber',icon:'timer',onAction:async()=>{const r=await txAction('withdraw',tx,tx.deferred?'resume':'defer',{done:tx.deferred?'Возвращено в работу':'Отложено'});if(r)load();}}:null;
    function drawHomeList(items, tab) {
      const nextSig = tab + '|' + JSON.stringify(items.map((x) => [x.kind, x.id, txSig(x)]));
      if (nextSig === homeSig && listBox.dataset.tab === tab) return;
      const sameTab = listBox.dataset.tab === tab && !!homeSig;
      homeSig = nextSig; listBox.dataset.tab = tab;
      const fresh = document.createElement('div');
      if (!items.length) fresh.appendChild(empty(tab==='deferred'?'Отложенных нет':'Актуальных заявок нет','','home'));
      else fresh.appendChild(txGroups(items, { swipe: homeSwipe }));
      patchList(listBox, fresh, sameTab);
    }
    async function load(manual, background=false) {
      if (background && homeLoadBusy) return;
      const seq = ++homeSeq; const tab = state.homeTab;
      homeLoadBusy = true;
      drawTop();
      if (!background) {
        refresh.disabled = true; refresh.classList.add('spin');
        if (listBox.dataset.tab !== tab || !listBox.children.length) { if (homeCache[tab]) drawHomeList(homeCache[tab], tab); else { homeSig = ''; listBox.dataset.tab = tab; listBox.replaceChildren(skel('list')); } }
      }
      try {
        let items;
        if (tab === 'deferred') { const w = await api('/withdrawals?status=deferred&size=100'); items = w.items; }
        else { const [d, w] = await Promise.all([api('/deposits?status=created,processing,failed&size=100'), api('/withdrawals?status=active&size=100')]); items = [...d.items, ...w.items]; }
        if (seq !== homeSeq) return;
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        homeCache[tab] = items;
        drawHomeList(items, tab);
        if (manual) toast('Обновлено', 'ok', 900);
      } catch (e) { if (seq === homeSeq && !background) { homeSig = ''; listBox.innerHTML = ''; listBox.appendChild(empty('Не удалось загрузить', e.message)); } }
      finally { if (seq === homeSeq) { homeLoadBusy = false; refresh.disabled = false; refresh.classList.remove('spin'); } }
    }""")
rep("""    homeDataTimer=setInterval(()=>{if(!document.body.contains(screen))return clearInterval(homeDataTimer);if(!document.hidden&&!homeInteracting&&Date.now()-homeLastScroll>900&&!document.querySelector('.sheet,.dialog,.modal')&&!['INPUT','TEXTAREA','SELECT'].includes((document.activeElement||{}).tagName))load(false,true);},2000);""",
    """    /* changes arrive through /live (every 2 s) → paygo:changed; this timer is only a safety net */
    homeDataTimer=setInterval(()=>{if(!document.body.contains(screen))return clearInterval(homeDataTimer);if(!document.hidden&&!homeInteracting&&Date.now()-homeLastScroll>900&&!document.querySelector('.sheet,.dialog,.modal')&&!['INPUT','TEXTAREA','SELECT'].includes((document.activeElement||{}).tagName))load(false,true);},12000);""")

# ------------------------------------------------------------------ history: same treatment
rep("""    async function load(more, background=false) {
      if(historyLoadBusy)return;historyLoadBusy=true;const oldY=window.scrollY;
      const f2 = state.historyFilters; drawTop();
      if (!more && !background) { st.page = 1; listBox.innerHTML = ''; listBox.appendChild(loader()); }
      if (!more && background) st.page = 1;
      try {""", """    let historySeq = 0;
    async function load(more, background=false) {
      if (background && historyLoadBusy) return;
      const seq = ++historySeq; historyLoadBusy = true;
      const f2 = state.historyFilters; drawTop();
      if (!more && !background) { st.page = 1; listBox.classList.remove('live-patched'); listBox.replaceChildren(skel('list')); }
      /* a live refresh re-reads everything already shown (all loaded pages), never drops them */
      const qPage = background ? 1 : st.page; const qSize = background ? Math.min(200, 40 * Math.max(1, st.page)) : 40;
      try {""")
rep("""'&amount_max=' + encodeURIComponent(f2.amax || '') + '&page=' + st.page + '&size=40';""",
    """'&amount_max=' + encodeURIComponent(f2.amax || '') + '&page=' + qPage + '&size=' + qSize;""")
rep("""        const results = await Promise.all(calls);
        let fresh = results.flatMap((r) => r.items); st.total = results.reduce((a, r) => a + r.total, 0);""",
    """        const results = await Promise.all(calls);
        if (seq !== historySeq) return;
        let fresh = results.flatMap((r) => r.items); st.total = results.reduce((a, r) => a + r.total, 0);""")
rep("""        st.items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        listBox.innerHTML = '';
        if (!st.items.length) return listBox.appendChild(empty('Заявок не найдено', 'Измените фильтры.'));
        listBox.appendChild(txGroups(st.items, { noAlert: true }));
        if (st.items.length < st.total) listBox.appendChild(h('button', { class: 'lazy-more', onclick: () => { st.page += 1; load(true); } }, """,
    """        st.items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const sig = state.historyTab + '|' + JSON.stringify(st.items.map((x) => [x.kind, x.id, txSig(x)])) + '|' + st.total;
        if (background && sig === historySig) return;
        historySig = sig;
        const box = document.createElement('div');
        if (!st.items.length) { box.appendChild(empty('Заявок не найдено', 'Измените фильтры.')); patchList(listBox, box, false); return; }
        box.appendChild(txGroups(st.items, { noAlert: true }));
        if (st.items.length < st.total) box.appendChild(h('button', { class: 'lazy-more', onclick: () => { st.page += 1; load(true); } }, """)
# the "Показать ещё" button line continues after this; close the patch after it
rep("""      } catch (e) { if(!background){listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message));} }
      finally{historyLoadBusy=false;if(background&&oldY>120)requestAnimationFrame(()=>window.scrollTo(0,oldY));}""",
    """        patchList(listBox, box, background || more);
      } catch (e) { if(seq === historySeq && !background){listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message));} }
      finally{ if (seq === historySeq) historyLoadBusy=false; }""")
rep("""    historyTimer=setInterval(()=>{if(!document.body.contains(screen))return clearInterval(historyTimer);if(!document.hidden&&!historyInteracting&&Date.now()-historyLastScroll>900&&!document.querySelector('.sheet,.dialog,.modal')&&!['INPUT','TEXTAREA','SELECT'].includes((document.activeElement||{}).tagName))load(false,true);},2400);""",
    """    historyTimer=setInterval(()=>{if(!document.body.contains(screen))return clearInterval(historyTimer);if(!document.hidden&&!historyInteracting&&Date.now()-historyLastScroll>900&&!document.querySelector('.sheet,.dialog,.modal')&&!['INPUT','TEXTAREA','SELECT'].includes((document.activeElement||{}).tagName))load(false,true);},12000);""")


# ================================================================== STAGE 2
# ------------------------------------------------------------------ chats list: data-conv (preview/swipe work), keyed patch, presence
rep("""    return h('button', { class: 'chat-row', type: 'button', style: { '--i': Math.min(i || 0, 12) }, onclick: () => { state.chatReturnHash = location.hash || '#/chats'; go('#/chats/' + cv.id); } },""",
    """    return h('button', { class: 'chat-row', type: 'button', 'data-conv': String(cv.id), 'data-key': 'c' + cv.id, 'data-sig': JSON.stringify([cv.last_message_at, cv.updated_at, cv.unread_count, cv.last_text, cv.status, cv.user_name, cv.user_avatar]), style: { '--i': Math.min(i || 0, 12) }, onclick: () => { state.chatReturnHash = location.hash || '#/chats'; go('#/chats/' + cv.id); } },""")
rep("""    async function load(background=false) {
      if(chatLoadBusy)return;chatLoadBusy=true;const oldY=window.scrollY;
      if(!background){listBox.innerHTML = ''; listBox.appendChild(loader());}""", """    /* CHAT_PRESENCE_1_13_9_42: «oper в чате / печатает…» on the rows, updated from /live without re-rendering */
    const markPresence = () => { const pr = (state.live && state.live.presence) || {}; listBox.querySelectorAll('.chat-row[data-conv]').forEach((row) => { const others = pr[row.dataset.conv] || []; let tag = row.querySelector('.chat-busy'); if (!others.length) { if (tag) tag.remove(); row.classList.remove('occupied'); return; } const typing = others.some((o) => o.typing); const txt = others.map((o) => o.name).join(', ') + (typing ? ' печатает…' : ' в чате'); if (!tag) { tag = h('span', { class: 'chat-busy' }); const copyEl = row.querySelector('.chat-copy'); if (copyEl) copyEl.appendChild(tag); } tag.classList.toggle('typing', typing); tag.textContent = txt; row.classList.add('occupied'); }); };
    let chatSeq = 0;
    async function load(background=false) {
      if (background && chatLoadBusy) return;
      const seq = ++chatSeq; chatLoadBusy = true;
      if(!background){listBox.classList.remove('live-patched'); listBox.replaceChildren(skel('chats'));}""")
rep("""        const r = await api('/support/conversations?status=' + status + '&size=60');
        const c = r.counts || {};""", """        const r = await api('/support/conversations?status=' + status + '&size=60');
        if (seq !== chatSeq) return;
        const c = r.counts || {};""")
rep("""        const chatItems=(r.items||[]).slice().sort((x,y)=>chatSortTs(y)-chatSortTs(x)); const nextChatSig=JSON.stringify(chatItems.map(x=>[x.id,x.last_message_at,x.updated_at,x.unread_count,x.last_text,x.status])); if(background&&nextChatSig===chatSig){return;} chatSig=nextChatSig;
        listBox.innerHTML = '';
        if (!chatItems.length) return listBox.appendChild(empty(state.chatTab === 'closed' ? 'Закрытых обращений нет' : 'Открытых обращений нет', '', 'chat'));
        chatItems.forEach((cv, i) => listBox.appendChild(chatRow(cv, i)));
      } catch (e) { if(!background){listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message));} }
      finally{chatLoadBusy=false;if(background&&oldY>120)requestAnimationFrame(()=>window.scrollTo(0,oldY));}""", """        const chatItems=(r.items||[]).slice().sort((x,y)=>chatSortTs(y)-chatSortTs(x)); const nextChatSig=state.chatTab+'|'+JSON.stringify(chatItems.map(x=>[x.id,x.last_message_at,x.updated_at,x.unread_count,x.last_text,x.status])); if(background&&nextChatSig===chatSig){markPresence();return;} chatSig=nextChatSig;
        const fresh = document.createElement('div');
        if (!chatItems.length) fresh.appendChild(empty(state.chatTab === 'closed' ? 'Закрытых обращений нет' : 'Открытых обращений нет', '', 'chat'));
        else chatItems.forEach((cv, i) => fresh.appendChild(chatRow(cv, i)));
        patchList(listBox, fresh, background);
        markPresence();
      } catch (e) { if(seq === chatSeq && !background){listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message));} }
      finally{ if (seq === chatSeq) chatLoadBusy=false; }""")
rep("""    watchChanges(screen, () => { if (!state.chatQuery) load(true); });
  }""", """    watchChanges(screen, () => { if (!state.chatQuery) load(true); });
    watchLive(screen, markPresence);
  }""")

# ------------------------------------------------------------------ chat thread: skeleton, one poll, faster, presence + typing of operators
rep("""    const screen = h('section', { class: 'chat-screen' }); shell.appendChild(screen); screen.appendChild(loader(2));
    let lastId = 0; let c = null; const known = {}; let composer = null;""", """    const screen = h('section', { class: 'chat-screen' }); shell.appendChild(screen); screen.appendChild(skel('chat'));
    let lastId = 0; let c = null; const known = {}; let composer = null; let chatPoll = 0; let typingAt = 0;
    /* CHAT_PRESENCE_1_13_9_42: other operators see who has this chat open and who is typing */
    const showPresence = (others) => { const el = screen.querySelector('.chat-presence'); if (!el) return; const list = others || []; if (!list.length) { el.hidden = true; return; } const typing = list.filter((o) => o.typing); el.hidden = false; el.classList.toggle('typing', !!typing.length); el.textContent = typing.length ? typing.map((o) => o.name).join(', ') + ' печатает…' : list.map((o) => o.name).join(', ') + ' тоже в этом чате'; };
    const presence = (extra) => { if (!c || !can('support')) return; api('/support/conversations/' + c.id + '/presence', { method: 'POST', body: extra || {} }).then((r) => { if (!extra || !extra.leave) showPresence(r.others); }).catch(() => {}); };
    const presenceTimer = setInterval(() => { if (!document.body.contains(screen)) { clearInterval(presenceTimer); presence({ leave: true }); return; } if (!document.hidden) presence(); }, 5000);
    watchLive(screen, () => { if (c) showPresence(((state.live && state.live.presence) || {})[String(c.id)]); });""")
rep("""        screen.appendChild(head);""", """        screen.appendChild(head);
        screen.appendChild(h('div', { class: 'chat-presence', hidden: true }));
        presence();""")
rep("""        const poll = setInterval(async () => { if (!document.body.contains(feed)) return clearInterval(poll);""",
    """        clearInterval(chatPoll);
        const poll = chatPoll = setInterval(async () => { if (!document.body.contains(feed)) return clearInterval(poll);""")
rep("""if (node) node.replaceWith(bubble(old)); } }); } } catch (e) {} }, 1600);""", """if (node) node.replaceWith(bubble(old)); } }); } } catch (e) {} }, 1200);""")
rep("""      ta.addEventListener('input', grow);""", """      ta.addEventListener('input', grow);
      ta.addEventListener('input', () => { if (ta.value.trim() && Date.now() - typingAt > 3000) { typingAt = Date.now(); presence({ typing: true }); } });""")
# quick replies: only the one-tap bar above the input (the modal button is gone)
rep("""h('div', { class: 'compose-side' }, h('button', { class: 'composer-icon', type: 'button', 'aria-label': 'Быстрые ответы', onclick: () => quickPick((t) => { ta.value = t; grow(); ta.focus(); }, vars()) }, svg('bolt', 26)), h('button', { class: 'composer-icon', type: 'button', 'aria-label': 'Фото или видео', onclick: attach }, svg('paperclip', 26))),""",
    """h('div', { class: 'compose-side' }, h('button', { class: 'composer-icon', type: 'button', 'aria-label': 'Фото или видео', onclick: attach }, svg('paperclip', 26))),""")
rep("""(state.quick || []).slice(0, 20).forEach((q) => quickBar.appendChild(h('button', { class: 'v36-quick-chip', type: 'button', onclick: async () => { ta.value = fillQuick(q.text); grow(); await send(); } }, q.title || fillQuick(q.text).slice(0, 26)))); } catch (e) {} };""",
    """(state.quick || []).slice(0, 30).forEach((q) => quickBar.appendChild(h('button', { class: 'v36-quick-chip', type: 'button', title: fillQuick(q.text), onpointerdown: keepFocus, onmousedown: keepFocus, onclick: async (e) => { const b = e.currentTarget; if (b.dataset.busy) return; b.dataset.busy = '1'; b.classList.add('sent'); const keep = ta.value; ta.value = fillQuick(q.text); grow(); await send(); if (keep && !ta.value) { ta.value = keep; grow(); } setTimeout(() => { delete b.dataset.busy; b.classList.remove('sent'); }, 700); } }, q.title || fillQuick(q.text).slice(0, 26)))); quickBar.hidden = !quickBar.children.length; } catch (e) {} };""")

# ------------------------------------------------------------------ transactions in chat: «Клиенту» sends the status to the client
rep("""  function txmCard(tx, s, c) {""", """  /* SEND_TO_CLIENT_1_13_9_42: one tap tells the client the exact state of their request (in the chat) */
  function txClientText(tx) {
    const dep = tx.kind === 'deposit'; const no = String(tx.public_id || tx.id).replace(/^[DW]-/, ''); const cur = curSign(tx.currency);
    if (dep && tx.status === 'success') return '✅ Пополнение № ' + no + ' зачислено: ' + money(tx.amount) + ' ' + cur + ' на ID ' + tx.player_id + ' (' + fmtDate(tx.credited_at || tx.updated_at || tx.created_at) + '). Обновите баланс в приложении.';
    if (!dep && tx.status === 'success') return '✅ Вывод № ' + no + ' выполнен: ' + money(tx.amount) + ' ' + cur + ' (' + fmtDate(tx.completed_at || tx.updated_at || tx.created_at) + '). Деньги отправлены по вашему QR.';
    return (dep ? 'Пополнение' : 'Вывод') + ' № ' + no + ' на ' + money(dep ? tx.pay_amount : tx.amount) + ' ' + cur + ' (ID ' + tx.player_id + '): ' + txState(tx).label + '.';
  }
  function txmCard(tx, s, c) {""")
rep("""    if (tx.has_receipt) controls.appendChild(h('button', { class: 'txm-btn', type: 'button', onclick: (e) => { e.stopPropagation(); imageSheet(""",
    """    if (c && can('support')) controls.appendChild(h('button', { class: 'txm-btn txm-send', type: 'button', onclick: async (e) => { e.stopPropagation(); const b = e.currentTarget; busy(b, true); try { await api('/support/conversations/' + c.id + '/reply', { method: 'POST', body: { text: txClientText(tx) } }); toast('Отправлено клиенту', 'ok', 1400); b.classList.add('done'); document.dispatchEvent(new CustomEvent('paygo:changed')); } catch (ex) { err(ex); } busy(b, false); } }, svg('send', 16), 'Клиенту'));
    if (tx.has_receipt) controls.appendChild(h('button', { class: 'txm-btn', type: 'button', onclick: (e) => { e.stopPropagation(); imageSheet(""")

# ------------------------------------------------------------------ request page: skeleton, only critical risks on top, compact block at the bottom
rep("""    const headBox = h('div'); const body = h('div'); screen.appendChild(headBox); screen.appendChild(body); body.appendChild(loader(2));""",
    """    const headBox = h('div'); const body = h('div'); screen.appendChild(headBox); screen.appendChild(body); body.appendChild(skel('detail'));""")
rep("""        if (r.risk && r.risk.length) body.appendChild(h('div', { class: 'risk-box' }, r.risk.map((s) => h('div', { class: 'risk-row ' + (s.level || 'info') }, svg(s.level === 'danger' ? 'alert' : s.level === 'warn' ? 'bell' : 'shield', 18), h('div', null, h('b', null, s.title), h('small', null, s.detail))))));
        if (u.note) { const on = String(u.note||''); const op = on.match(/(?:^|\\n)Плательщик Optima:\\s*([^\\n]+)/i); const rest = on.split('\\n').filter(x=>!/^Плательщик Optima:/i.test(x.trim())).join('\\n').trim(); if (op) body.appendChild(h('div',{class:'note green'},h('b',null,'Имя из Optima: '),op[1].trim())); if (rest) body.appendChild(h('div',{class:'note pink'},h('b',null,'Комментарий профиля:'),rest)); }""",
    """        /* DETAIL_1_13_9_42: only critical warnings stay on top; the Optima payer name, the profile note and
           minor antifraud hints go to one compact block under the request card */
        const riskTop = (r.risk || []).filter((s) => s.level === 'danger'); const riskLow = (r.risk || []).filter((s) => s.level !== 'danger');
        if (riskTop.length) body.appendChild(h('div', { class: 'risk-box' }, riskTop.map((s) => h('div', { class: 'risk-row danger' }, svg('alert', 18), h('div', null, h('b', null, s.title), h('small', null, s.detail))))));
        let optimaName = '', profileNote = '';
        if (u.note) { const on = String(u.note||''); const op = on.match(/(?:^|\\n)Плательщик Optima:\\s*([^\\n]+)/i); profileNote = on.split('\\n').filter(x=>!/^Плательщик Optima:/i.test(x.trim())).join('\\n').trim(); optimaName = op ? op[1].trim() : ''; }""")
rep("""        body.appendChild(card);
        if (dep) body.appendChild(relatedBlock(tx));""", """        body.appendChild(card);
        const extras = [];
        if (tx.qr_warning) extras.push(h('div', { class: 'cx-row warn' }, h('small', null, 'QR клиента'), h('span', null, tx.qr_warning)));
        if (optimaName) extras.push(h('div', { class: 'cx-row' }, h('small', null, 'Имя из Optima'), h('b', null, optimaName)));
        if (profileNote) extras.push(h('div', { class: 'cx-row' }, h('small', null, 'Комментарий профиля'), h('span', null, profileNote)));
        riskLow.forEach((s) => extras.push(h('div', { class: 'cx-row ' + (s.level || 'info') }, h('small', null, s.title), h('span', null, s.detail))));
        if (extras.length) body.appendChild(h('div', { class: 'card cx-block' }, extras));
        if (dep) body.appendChild(relatedBlock(tx));""")

# ------------------------------------------------------------------ Optima wallet: «Обновить» logs in again when the session is gone
rep("""h('small',null,(w.account_masked||'счёт определяется')+' · '+(w.status==='online'?'онлайн':'ошибка'))""",
    """h('small',null,(w.account_masked||'счёт определяется')+' · '+(w.status==='online'?'онлайн':(w.status==='connecting'?'подключение…':'ошибка')))""")
rep("""h('button',{class:'outline-btn',type:'button',onclick:async()=>{try{await api('/optima-wallets/'+w.id+'/sync',{method:'POST'});toast('Синхронизация запущена','ok',900);setTimeout(draw,1200);}catch(ex){err(ex);}}},svg('refresh',16),'Обновить')""",
    """h('button',{class:'outline-btn',type:'button',onclick:async(e)=>{const b=e.currentTarget;const relogin=w.status!=='online';busy(b,true);try{await api('/optima-wallets/'+w.id+'/sync',{method:'POST',body:{relogin}});toast(relogin?'Переподключаемся к Optima — до минуты':'Синхронизация запущена','ok',relogin?2600:900);let n=0;const poll=async()=>{n+=1;await draw();const cur=((await api('/optima-wallets').catch(()=>({items:[]}))).items||[]).find((x)=>x.id===w.id);if(cur&&cur.status==='connecting'&&n<30)setTimeout(poll,3000);else if(cur&&relogin)toast(cur.status==='online'?'Optima подключена':'Optima: '+(cur.last_error||'ошибка'),cur.status==='online'?'ok':'err',3000);};setTimeout(poll,1500);}catch(ex){err(ex);}busy(b,false);}},svg('refresh',16),w.status==='online'?'Обновить':'Переподключить')""")

# ------------------------------------------------------------------ broadcasts: chosen weekdays × several times a day × N sends
rep("""({daily:'каждый день',weekly:'каждую неделю',once:'один раз'}[x.repeat] || x.repeat)""",
    """({daily:'каждый день',weekly:'каждую неделю',once:'один раз'}[x.repeat] || (x.repeat==='days' ? schedDaysLabel(x.weekdays, x.times) : x.repeat)) + (x.repeat!=='once' ? ' · осталось ' + x.count_left : '')""")
rep("""    const scheduleBroadcast = () => {
      const repeat = h('select', { class: 'select' },
        h('option', { value: 'once' }, 'Один раз'),
        h('option', { value: 'daily' }, 'Каждый день'),
        h('option', { value: 'weekly' }, 'Каждую неделю'));""", """    const WD = [['1','Пн'],['2','Вт'],['3','Ср'],['4','Чт'],['5','Пт'],['6','Сб'],['0','Вс']];
    const schedDaysLabel = (days, times) => { const d = (days || []).map(String); const names = d.length === 7 ? 'каждый день' : WD.filter(([v]) => d.includes(v)).map(([, l]) => l).join(', '); return names + ' в ' + (times || []).join(', '); };
    const scheduleBroadcast = () => {
      /* BROADCAST_SLOTS_1_13_9_42: «По дням»: any weekdays, several times a day, N sends in total */
      const repeat = h('select', { class: 'select' },
        h('option', { value: 'days' }, 'По дням и времени'),
        h('option', { value: 'once' }, 'Один раз'));
      const days = new Set(['1','2','3','4','5','6','0']); const times = ['12:00'];
      const dayBox = h('div', { class: 'wd-chips' }); const timeBox = h('div', { class: 'time-chips' });
      const newTime = h('input', { class: 'input', type: 'time', value: '18:00' });
      const drawDays = () => { dayBox.innerHTML = ''; WD.forEach(([v, l]) => dayBox.appendChild(h('button', { class: 'wd-chip' + (days.has(v) ? ' on' : ''), type: 'button', onclick: () => { if (days.has(v)) days.delete(v); else days.add(v); drawDays(); drawPlan(); } }, l))); dayBox.appendChild(h('button', { class: 'wd-chip all' + (days.size === 7 ? ' on' : ''), type: 'button', onclick: () => { if (days.size === 7) days.clear(); else WD.forEach(([v]) => days.add(v)); drawDays(); drawPlan(); } }, 'Каждый день')); };
      const drawTimes = () => { timeBox.innerHTML = ''; times.sort().forEach((t, i) => timeBox.appendChild(h('span', { class: 'time-chip' }, t, h('button', { type: 'button', 'aria-label': 'Убрать', onclick: () => { times.splice(i, 1); drawTimes(); drawPlan(); } }, svg('close', 13))))); };
      const addTime = h('button', { class: 'outline-btn blue', type: 'button', onclick: () => { const v = newTime.value; if (!v) return; if (!times.includes(v)) times.push(v); drawTimes(); drawPlan(); } }, svg('plus', 16), 'Добавить время');
      const plan = h('div', { class: 'hint-card sched-plan' });
      const slots = (from, n) => { const out = []; const d = new Date(from); d.setSeconds(0, 0); for (let add = 0; add < 60 && out.length < n; add++) { const day = new Date(d); day.setDate(d.getDate() + add); if (!days.has(String(day.getDay()))) continue; times.slice().sort().forEach((t) => { const [hh, mm] = t.split(':').map(Number); const m = new Date(day); m.setHours(hh, mm, 0, 0); if (m > new Date(Date.now() + 30000) && out.length < n) out.push(m); }); } return out; };
      const drawPlan = () => { if (repeat.value !== 'days') { plan.hidden = true; return; } plan.hidden = false; const next = slots(new Date(), 3); const total = Number(count.value || 1); plan.textContent = !days.size || !times.length ? 'Выберите дни и время' : 'Всего отправок: ' + total + ' · ' + schedDaysLabel([...days], times.slice().sort()) + ' · ближайшие: ' + next.map((m) => m.toLocaleString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })).join('; '); };""")
rep("""      const count = h('input', { class: 'input', type: 'number', min: 1, max: 365, value: 30, inputmode: 'numeric' });
      const modeBox = h('div', { class: 'v39-schedule-mode' });
      const countField = h('label', { class: 'field v39-count-field' }, h('span', null, 'Количество отправок'), count);""",
    """      const count = h('input', { class: 'input', type: 'number', min: 1, max: 1000, value: 30, inputmode: 'numeric', oninput: () => drawPlan() });
      const modeBox = h('div', { class: 'v39-schedule-mode' });
      const countField = h('label', { class: 'field v39-count-field' }, h('span', null, 'Сколько раз отправить всего'), count);""")
rep("""        } else if (repeat.value === 'daily') {
          countField.hidden=false;
          modeBox.appendChild(h('label',{class:'field'},h('span',null,'Время каждый день'),time));
        } else {""", """        } else if (repeat.value === 'days') {
          countField.hidden=false;
          modeBox.appendChild(h('div',{class:'field'},h('span',null,'Дни недели'),dayBox));
          modeBox.appendChild(h('div',{class:'field'},h('span',null,'Время отправки (можно несколько)'),timeBox,h('div',{class:'time-add'},newTime,addTime)));
          drawDays(); drawTimes();
        } else if (repeat.value === 'daily') {
          countField.hidden=false;
          modeBox.appendChild(h('label',{class:'field'},h('span',null,'Время каждый день'),time));
        } else {""")
rep("""      repeat.onchange=redraw;""", """      repeat.onchange=()=>{redraw();drawPlan();};""")
rep("""        if(repeat.value==='once') return onceWhen.value ? new Date(onceWhen.value) : null;""", """        if(repeat.value==='once') return onceWhen.value ? new Date(onceWhen.value) : null;
        if(repeat.value==='days') return slots(new Date(), 1)[0] || null;""")
rep("""      const body=h('div',{class:'v39-schedule-form'},h('label',{class:'field'},h('span',null,'Повтор'),repeat),modeBox,countField,h('div',{class:'hint-card'},'Ежедневно: только время. Еженедельно: день недели и время.'));
      redraw();""", """      const body=h('div',{class:'v39-schedule-form'},h('label',{class:'field'},h('span',null,'Повтор'),repeat),modeBox,countField,plan);
      redraw(); drawPlan();""")
rep("""audience:'all',run_at:run.toISOString(),repeat:repeat.value,count:repeat.value==='once'?1:Number(count.value||1),buttons:[]}}});""",
    """audience:'all',run_at:run.toISOString(),repeat:repeat.value,count:repeat.value==='once'?1:Number(count.value||1),weekdays:[...days].map(Number),times:times.slice().sort(),buttons:[]}}});""")

# ------------------------------------------------------------------ PERF_1_13_9_42: the old whole-document scanners are gone
rep("""  setTimeout(v36RuntimeEnhance, 0);""", """  /* PERF_1_13_9_42: v36RuntimeEnhance scanned every element of the page on every DOM change (the lists
     refresh every few seconds) — the main cause of the freezes. What it patched is now rendered directly. */""")
rep("""      document.querySelectorAll('.chat-composer [aria-label="Быстрые ответы"]').forEach(b=>b.remove());
      document.querySelectorAll('.chat-row[data-conv],.msg-row[data-conv]').forEach(bindRow);
      document.querySelectorAll('.bc-foot').forEach(x=>x.classList.add('v39-bc-foot'));
      compactWallet();""", """      document.querySelectorAll('.chat-row[data-conv]:not([data-v39-gestures]),.msg-row[data-conv]:not([data-v39-gestures])').forEach(bindRow);
      document.querySelectorAll('.bc-foot:not(.v39-bc-foot)').forEach(x=>x.classList.add('v39-bc-foot'));""")
# swipe a chat to the RIGHT to close it (Telegram-like), with a visible «Закрыть» strip and a clear exit animation
rep("""      row.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;x0=e.touches[0].clientX;y0=e.touches[0].clientY;dx=0;swipe=false;clear();timer=setTimeout(()=>{suppress=Date.now()+900;previewChat(row);},430);},{passive:true});
      row.addEventListener('touchmove',e=>{if(e.touches.length!==1)return;const x=e.touches[0].clientX-x0,y=e.touches[0].clientY-y0;if(Math.abs(x)>8||Math.abs(y)>8)clear();if(!swipe&&Math.abs(x)>12&&Math.abs(x)>Math.abs(y)*1.2)swipe=true;if(swipe&&x<0){dx=Math.max(-112,x);if(e.cancelable)e.preventDefault();row.style.transform='translateX('+dx+'px)';row.classList.toggle('v39-swipe-armed',dx<-82);}},{passive:false});
      const finish=async()=>{clear();row.style.transform='';row.classList.remove('v39-swipe-armed');if(!swipe){dx=0;return;}suppress=Date.now()+650;const close=dx<-82;dx=0;swipe=false;if(close&&can('support')){try{await api('/support/conversations/'+row.dataset.conv+'/status',{method:'POST',body:{status:'resolved'}});toast('Чат закрыт','ok',1000);document.dispatchEvent(new CustomEvent('paygo:changed'));}catch(e){err(e);}}};""",
    """      const closable=()=>can('support')&&state.chatTab!=='closed'&&row.classList.contains('chat-row');
      row.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;x0=e.touches[0].clientX;y0=e.touches[0].clientY;dx=0;swipe=false;clear();row.classList.add('pressing');timer=setTimeout(()=>{row.classList.remove('pressing');suppress=Date.now()+900;buzz(12);previewChat(row);},430);},{passive:true});
      row.addEventListener('touchmove',e=>{if(e.touches.length!==1)return;const x=e.touches[0].clientX-x0,y=e.touches[0].clientY-y0;if(Math.abs(x)>8||Math.abs(y)>8){clear();row.classList.remove('pressing');}if(!swipe&&closable()&&Math.abs(x)>12&&Math.abs(x)>Math.abs(y)*1.2&&x>0){swipe=true;row.classList.add('swiping');}if(swipe){dx=Math.max(0,Math.min(150,x));if(e.cancelable)e.preventDefault();row.style.transform='translateX('+dx+'px)';const armed=dx>92;if(armed&&!row.classList.contains('v39-swipe-armed'))buzz(8);row.classList.toggle('v39-swipe-armed',armed);}},{passive:false});
      const finish=async()=>{clear();row.classList.remove('pressing');if(!swipe){dx=0;return;}suppress=Date.now()+650;const close=dx>92;dx=0;swipe=false;
        if(!close){row.style.transition='transform .22s cubic-bezier(.2,.8,.2,1)';row.style.transform='';row.classList.remove('v39-swipe-armed');setTimeout(()=>{row.style.transition='';row.classList.remove('swiping');},230);return;}
        row.style.transition='transform .22s ease, opacity .22s ease';row.style.transform='translateX(110%)';row.style.opacity='0';
        try{await api('/support/conversations/'+row.dataset.conv+'/status',{method:'POST',body:{status:'resolved'}});
          const hgt=row.offsetHeight;row.style.height=hgt+'px';requestAnimationFrame(()=>{row.style.transition='height .2s ease, padding .2s ease';row.style.height='0px';row.style.paddingTop='0px';row.style.paddingBottom='0px';});
          setTimeout(()=>{row.remove();},230);toast('Чат закрыт','ok',1000);document.dispatchEvent(new CustomEvent('paygo:changed'));}
        catch(e){row.style.transform='';row.style.opacity='';row.classList.remove('v39-swipe-armed','swiping');err(e);}};""")


# the photo viewer closes with any navigation, like the sheets
rep("""  function closeSheets() { document.querySelectorAll('.sheet-back').forEach((el) => el.remove()); document.body.style.overflow = ''; closeDropdown(); }""",
    """  function closeSheets() { document.querySelectorAll('.sheet-back,.pv-lightbox').forEach((el) => el.remove()); document.body.style.overflow = ''; closeDropdown(); }""")


# ================================================================== STAGE 3 (1.13.9.43)
# chat: focusing the input no longer shrinks the header, the bubbles and the font (old v39 rules)
rep("'v39-keyboard-open'", "'kb-open'", count=3)
# a wrong-ID alert shows once, without the beep (the client is asked automatically)
rep("beep(n.level === 'critical');", "if (n.level !== 'info') beep(n.level === 'critical');")
# home: one compact balances card — 1W / withdrawals / Optima in one row
rep("""        oneWinBox.appendChild(h('div',{class:'ow-head'},h('div',{class:'ow-title'},h('i',{class:'ow-dot '+(ok?'ok':'bad')}),h('b',null,'1WIN'),h('small',null,statusText)),btn));
        oneWinBox.appendChild(h('div',{class:'ow-grid'},
          h('div',{class:'ow-metric'},h('small',null,'ТЕКУЩИЙ БАЛАНС 1WIN'),h('strong',null,c&&present(c.last_limit)?money(c.last_limit)+' с':'—')),
          h('div',{class:'ow-metric payout'},h('small',null,'БАЛАНС ВЫВОДА 1WIN'),h('strong',null,c&&present(c.last_balance)?money(c.last_balance)+' с':'—'))
        ));
        const optOk = op && op.count > 0 && op.online > 0;
        oneWinBox.appendChild(h('div',{class:'ow-optima'},
          h('div',{class:'ow-optima-title'},h('i',{class:'ow-dot '+(optOk?'ok':'bad')}),h('div',null,h('small',null,'БАЛАНС OPTIMA'),h('span',null,(op.online||0)+'/'+(op.count||0)+' онлайн'))),
          h('strong',null,present(op.balance)?money(op.balance)+' с':'—')
        ));""", """        /* BALANCES_1_13_9_43: one compact card — three tiles in a row */
        const optOk = op && op.count > 0 && op.online > 0;
        const num = (v) => present(v) ? money0(Math.round(Number(v) || 0)) : '—';
        const tile = (label, val, cls, dot) => h('div', { class: 'ow2-tile ' + (cls || '') }, h('small', null, dot === undefined ? null : h('i', { class: 'ow-dot ' + (dot ? 'ok' : 'bad') }), label), h('strong', null, val));
        oneWinBox.appendChild(h('div',{class:'ow2-head'},h('b',null,'Балансы'),h('small',null,statusText),btn));
        oneWinBox.appendChild(h('div',{class:'ow2-grid'},
          tile('1WIN', num(c && c.last_limit), '', ok),
          tile('Вывод 1WIN', num(c && c.last_balance), 'payout'),
          tile('Optima ' + (op.online||0) + '/' + (op.count||0), num(op.balance), 'optima', optOk)));""")
# request page: «ID не найден» right at the ID
rep("""h('div', { class: 'req-date' }, fmtDate(tx.created_at))), h('div', { class: 'req-side' }, statusPill(tx), tx.has_receipt ? h('button', { class: 'doc-btn', type: 'button', 'aria-label': 'Чек', onclick: () => imageSheet('Чек клиента'""",
    """h('div', { class: 'req-date' }, fmtDate(tx.created_at)), tx.player_id_invalid ? h('div', { class: 'id-bad' }, svg('alert', 14), 'ID не найден в 1WIN — клиенту отправлен запрос нового ID') : null), h('div', { class: 'req-side' }, statusPill(tx), tx.has_receipt ? h('button', { class: 'doc-btn', type: 'button', 'aria-label': 'Чек', onclick: () => imageSheet('Чек клиента'""")


# the wrong-ID badge at the ID replaces the same text in a red banner on top
rep("""        if ((tx.status === 'failed' || tx.needs_attention) && tx.error && tx.status !== 'success') body.appendChild(h('div', { class: 'note pink' }, reasonText(tx.error)));""",
    """        if ((tx.status === 'failed' || tx.needs_attention) && tx.error && tx.status !== 'success' && !tx.player_id_invalid) body.appendChild(h('div', { class: 'note pink' }, reasonText(tx.error)));""")


# AUTO_SUPPORT_1_13_9_43: clients are answered by the automatic system; AI only when switched on here
rep("""['support', 'Поддержка', [['Claude', [['assistant_enabled', 'Первым отвечает Claude (ключ ANTHROPIC_API_KEY в .env)', 'bool']""",
    """['support', 'Поддержка', [['Автоответчик', [['support_ai_enabled', 'ИИ-ответы (выключено — клиентам отвечает автоматическая система)', 'bool']""")


# ================================================================== STAGE 4 (1.13.9.45)
# CLIENT_TEXT_1_13_9_45: what goes to the client is never the panel's skin (₽ / Wildberries) — KGS, the bot's own format
rep("""  function txClientText(tx) {
    const dep = tx.kind === 'deposit'; const no = String(tx.public_id || tx.id).replace(/^[DW]-/, ''); const cur = curSign(tx.currency);""",
    """  function txClientText(tx) {
    const dep = tx.kind === 'deposit'; const cur = String(tx.currency || 'KGS').toUpperCase(); const amt = (v) => (Number(v) || 0).toFixed(2);
    if (dep && tx.status === 'success') return '✅ Пополнено\\n💸 ' + amt(tx.amount) + ' ' + cur + '\\n🆔 ' + tx.player_id;
    if (!dep && tx.status === 'success') return '✅ Вывод выполнен\\n💸 ' + amt(tx.amount) + ' ' + cur + '\\n🆔 ' + tx.player_id + '\\n\\nДеньги отправлены на ваш кошелёк.';
    const label = ({ created: dep ? 'ожидает оплаты' : 'в очереди', processing: 'в обработке', failed: dep ? 'ошибка зачисления, проверяем' : 'требует проверки', expired: 'время оплаты истекло', cancelled: 'отменена' })[tx.status] || tx.status;
    return (dep ? '💳 Пополнение' : '💸 Вывод') + '\\n💸 ' + amt(dep ? tx.pay_amount : tx.amount) + ' ' + cur + '\\n🆔 ' + tx.player_id + '\\nСтатус: ' + label;
    const no = String(tx.public_id || tx.id).replace(/^[DW]-/, '');""")

# SEGMENT_1_13_9_45: segmented switch with a sliding thumb — tap or hold and drag it
rep("""  function segEl(items, active, onSelect, cls) { return h('div', { class: 'seg ' + (cls || '') }, items.map(([key, label, count]) => h('button', { class: key === active ? 'active' : '', type: 'button', onclick: () => onSelect(key) }, label, count !== undefined && count !== null && Number(count) > 0 ? h('i', { class: key === active ? '' : 'red' }, count) : null))); }""",
    """  const SEG_LAST = new Map();
  function segEl(items, active, onSelect, cls) {
    const key = items.map((x) => x[0]).join('|');
    let cur = Math.max(0, items.findIndex((x) => x[0] === active));
    const thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true' });
    let seg = null;
    const buttons = items.map(([k, label, count], i) => h('button', { class: k === active ? 'active' : '', type: 'button', onclick: () => { if (seg.dataset.dragged) { delete seg.dataset.dragged; return; } go(i); } }, label, count !== undefined && count !== null && Number(count) > 0 ? h('i', { class: k === active ? '' : 'red' }, count) : null));
    seg = h('div', { class: 'seg seg-anim ' + (cls || '') }, thumb, buttons);
    const place = (i, animate) => { const b = buttons[i]; if (!b || !b.offsetWidth) return false; thumb.style.transition = animate ? '' : 'none'; thumb.style.width = b.offsetWidth + 'px'; thumb.style.transform = 'translateX(' + b.offsetLeft + 'px)'; if (!animate) void thumb.offsetWidth; seg.classList.add('ready'); return true; };
    const go = (i) => { if (i === cur) { place(cur, true); return; } buttons.forEach((b, j) => { b.classList.toggle('active', j === i); const badge = b.querySelector('i'); if (badge) badge.className = j === i ? '' : 'red'; }); cur = i; place(i, true); buzz(6); setTimeout(() => onSelect(items[i][0]), 0); };
    const mount = (tries) => { const prev = SEG_LAST.has(key) ? SEG_LAST.get(key) : cur; if (!place(prev, false)) { if (tries < 20) requestAnimationFrame(() => mount(tries + 1)); return; } if (prev !== cur) requestAnimationFrame(() => place(cur, true)); SEG_LAST.set(key, cur); };
    requestAnimationFrame(() => mount(0));
    let drag = null;
    seg.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); const i = buttons.indexOf(b); if (i < 0 || i !== cur) return; drag = { x0: e.clientX, left: b.offsetLeft, moved: false, id: e.pointerId }; });
    seg.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x0; if (!drag.moved && Math.abs(dx) < 6) return; if (!drag.moved) { drag.moved = true; try { seg.setPointerCapture(drag.id); } catch (_) {} thumb.classList.add('dragging'); } const min = buttons[0].offsetLeft, max = buttons[buttons.length - 1].offsetLeft; thumb.style.transition = 'none'; thumb.style.transform = 'translateX(' + Math.max(min, Math.min(max, drag.left + dx)) + 'px)'; });
    const end = () => { if (!drag) return; const moved = drag.moved; drag = null; thumb.classList.remove('dragging'); if (!moved) return; seg.dataset.dragged = '1'; setTimeout(() => { delete seg.dataset.dragged; }, 350); const m = new DOMMatrixReadOnly(getComputedStyle(thumb).transform); const x = m.m41 + thumb.offsetWidth / 2; let best = cur, bd = 1e9; buttons.forEach((b, i) => { const c = b.offsetLeft + b.offsetWidth / 2; if (Math.abs(c - x) < bd) { bd = Math.abs(c - x); best = i; } }); go(best); };
    seg.addEventListener('pointerup', end); seg.addEventListener('pointercancel', end);
    return seg;
  }""")

# SUPPORT_KB_1_13_9_45: one-tap suggestions for the operator — what operators answered to the same question
rep("""      const quickBar = h('div', { class: 'v36-quick-inline' });""", """      const quickBar = h('div', { class: 'v36-quick-inline' });
      const suggestBar = h('div', { class: 'kb-suggest', hidden: true });
      let suggestAt = 0;
      const drawSuggest = async () => { if (!c || !can('support')) return; const at = ++suggestAt; try { const r = await api('/support/conversations/' + c.id + '/suggest'); if (at !== suggestAt) return; suggestBar.innerHTML = ''; (r.items || []).forEach((sg) => suggestBar.appendChild(h('button', { class: 'kb-chip', type: 'button', title: sg.text, onpointerdown: keepFocus, onmousedown: keepFocus, onclick: async (e) => { const b = e.currentTarget; if (b.dataset.busy) return; b.dataset.busy = '1'; const keep = ta.value; ta.value = sg.text; grow(); await send(); if (keep && !ta.value) { ta.value = keep; grow(); } suggestBar.hidden = true; } }, h('b', null, '💡'), h('span', null, sg.text)))); suggestBar.hidden = !suggestBar.children.length; } catch (_) {} };
      new MutationObserver(() => { const lastB = feed.lastElementChild; if (lastB && lastB.classList.contains('user')) { clearTimeout(drawSuggest.t); drawSuggest.t = setTimeout(drawSuggest, 250); } else if (lastB && lastB.classList.contains('out')) suggestBar.hidden = true; }).observe(feed, { childList: true });
      setTimeout(drawSuggest, 400);""")
rep("""      const el = h('div', { class: 'chat-composer' }, bar, quickBar,""", """      const el = h('div', { class: 'chat-composer' }, bar, suggestBar, quickBar,""")

# learnt answers are visible (and can be rebuilt) on the quick replies page
rep("""  async function quickView(shell) {
    const box = page(shell, 'Быстрые ответы', { right: h('button', { class: 'icon-btn', 'aria-label': 'Добавить', onclick: () => edit(null) }, svg('plus', 26)) });""",
    """  async function quickView(shell) {
    const box = page(shell, 'Быстрые ответы', { right: h('button', { class: 'icon-btn', 'aria-label': 'Добавить', onclick: () => edit(null) }, svg('plus', 26)) });
    /* SUPPORT_KB_1_13_9_45 */
    const kbBox = h('div', { class: 'card kb-card' }); box.appendChild(kbBox);
    const drawKb = (k) => { kbBox.innerHTML = ''; kbBox.appendChild(h('div', { class: 'kb-head' }, h('span', { class: 'kb-ico' }, svg('bolt', 20)), h('div', null, h('b', null, 'Обучение поддержки'), h('small', null, (k.answers || 0) + ' ответов выучено · ' + (k.auto || 0) + ' отправляются сами' + (k.built_at ? ' · ' + ago(k.built_at) + ' назад' : ''))), h('button', { class: 'outline-btn blue', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { const r = await api('/support/kb/rebuild', { method: 'POST' }); drawKb(r); toast('Поддержка переобучена на диалогах операторов', 'ok', 1600); } catch (ex) { err(ex); } busy(b, false); } }, svg('refresh', 16), 'Обучить'))); kbBox.appendChild(h('small', { class: 'kb-hint' }, 'Система запоминает ответы операторов, которые давались разным клиентам, и сама отвечает на такие же вопросы. Ответы о конкретной заявке («пополнено», «выполнено») никогда не отправляются автоматически — только подсказкой оператору 💡.')); (k.top || []).slice(0, 8).forEach((a) => kbBox.appendChild(h('div', { class: 'kb-row' }, h('span', null, a.text), h('i', { class: a.auto ? 'on' : '' }, (a.auto ? 'авто · ' : 'подсказка · ') + a.uses)))); };
    api('/support/kb').then(drawKb).catch(() => {});""")

# PULL_TO_REFRESH_1_13_9_45: pull a page down to refresh it (lists, requests), with a spinning indicator
rep("""  setTimeout(v39UiFixes,0);""", """  setTimeout(v39UiFixes,0);

  (function pullToRefresh() {
    const ind = h('div', { class: 'ptr', 'aria-hidden': 'true' }, h('i', null, svg('refresh', 20)));
    document.body.appendChild(ind);
    let y0 = null, active = false;
    const allowed = () => window.scrollY <= 0 && !document.querySelector('.sheet-back,.pv-lightbox,.chat-screen,.dialog');
    const reset = () => { ind.classList.remove('show', 'armed', 'spin'); ind.style.transform = ''; };
    window.addEventListener('touchstart', (e) => { y0 = e.touches.length === 1 && allowed() ? e.touches[0].clientY : null; active = false; }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (y0 === null) return; const dy = e.touches[0].clientY - y0; if (dy <= 0 || window.scrollY > 0) { if (active) reset(); active = false; if (window.scrollY > 0) y0 = null; return; } active = true; const pull = Math.min(120, dy * 0.5); ind.classList.add('show'); ind.style.transform = 'translate(-50%,' + (pull - 48) + 'px)'; ind.querySelector('svg').style.transform = 'rotate(' + Math.round(dy * 1.8) + 'deg)'; const armed = pull >= 66; if (armed && !ind.classList.contains('armed')) buzz(8); ind.classList.toggle('armed', armed); }, { passive: true });
    window.addEventListener('touchend', () => { if (y0 === null) return; y0 = null; if (!active) return; active = false; if (!ind.classList.contains('armed')) { reset(); return; } ind.classList.add('spin'); ind.style.transform = 'translate(-50%,16px)'; document.dispatchEvent(new CustomEvent('paygo:changed')); document.dispatchEvent(new CustomEvent('paygo:pull')); setTimeout(reset, 900); }, { passive: true });
  })();""")


# drop the old client-text body (unreachable after the KGS format above)
rep("    const no = String(tx.public_id || tx.id).replace(/^[DW]-/, '');\n    if (dep && tx.status === 'success') return '✅ Пополнение № ' + no + ' зачислено: ' + money(tx.amount) + ' ' + cur + ' на ID ' + tx.player_id + ' (' + fmtDate(tx.credited_at || tx.updated_at || tx.created_at) + '). Обновите баланс в приложении.';\n    if (!dep && tx.status === 'success') return '✅ Вывод № ' + no + ' выполнен: ' + money(tx.amount) + ' ' + cur + ' (' + fmtDate(tx.completed_at || tx.updated_at || tx.created_at) + '). Деньги отправлены по вашему QR.';\n    return (dep ? 'Пополнение' : 'Вывод') + ' № ' + no + ' на ' + money(dep ? tx.pay_amount : tx.amount) + ' ' + cur + ' (ID ' + tx.player_id + '): ' + txState(tx).label + '.';\n  }", '  }')


# the quick replies list redraw keeps the learning card on top
rep("""      box.innerHTML = ''; list.innerHTML = ''; box.appendChild(list);
      if (!items.length) return box.appendChild(empty('Ответов нет', 'Нажмите «+»', 'bell'));""",
    """      box.innerHTML = ''; list.innerHTML = ''; box.appendChild(kbBox); box.appendChild(list);
      if (!items.length) return box.appendChild(empty('Ответов нет', 'Нажмите «+»', 'bell'));""")


# ================================================================== STAGE 5 (1.13.9.46) — «Пополнить счет» through the Telegram bot
rep("""        const idBtn=h('button',{class:'ow-game',type:'button',onclick:()=>copyText(GAME_ID,'ID игрового счета скопирован')},h('span',{class:'ow-game-copy'},h('small',null,'ID игрового счета'),h('b',null,GAME_ID)),svg('copy',17));""",
    """        const idBtn=h('button',{class:'ow-game ow-topup',type:'button',onclick:()=>topupSheet()},h('span',{class:'ow-topup-ico'},svg('wallet',20)),h('span',{class:'ow-game-copy'},h('b',null,'Пополнить счет'),h('small',null,'ID '+GAME_ID)),svg('chevron',16));""")
rep("""const rows = MENU.filter((m) => can(m[4]) && (m[0] !== 'security' || String((state.admin || {}).username || '').toLowerCase() === 'admin'));""",
    """const rows = MENU.filter((m) => can(m[4]) && (!['security', 'tg'].includes(m[0]) || String((state.admin || {}).username || '').toLowerCase() === 'admin'));""")
rep("""['security', 'shield', 'Безопасность', 'teal', 'settings']];""", """['security', 'shield', 'Безопасность', 'teal', 'settings'], ['tg', 'send', 'Telegram-аккаунт', 'blue', 'settings']];""")
rep("""security: securityView, quick: quickView,""", """security: securityView, tg: tgView, quick: quickView,""")
rep("""  async function quickView(shell) {""", """  /* TG_AGENT_1_13_9_46 — «Пополнить счет»: the panel drives the Telegram bot and brings its QR here */
  async function topupSheet() {
    const body = h('div', { class: 'tp' });
    let jobId = null, timer = 0, closed = false, lastState = '';
    const s = sheet({ title: 'Пополнить счет', body, onClose: () => { closed = true; clearTimeout(timer); } });
    const logEl = (item) => h('div', { class: 'tp-log' }, (item.log || []).slice(-6).map((l) => h('div', { class: 'tp-line ' + l.from }, h('small', null, l.from === 'bot' ? 'Бот' : 'Панель'), h('span', null, l.text))));
    const poll = (ms) => { clearTimeout(timer); if (!closed) timer = setTimeout(load, ms); };
    const act = async (path, b) => { if (b) busy(b, true); try { const r = await api('/tg-agent/topup/' + jobId + '/' + path, { method: 'POST' }); draw(r.item); } catch (ex) { err(ex); } if (b) busy(b, false); };
    const load = async () => { if (!jobId || closed) return; try { const r = await api('/tg-agent/topup/' + jobId); draw(r.item); } catch (ex) { poll(2500); } };
    const form = (st) => {
      body.innerHTML = '';
      const amount = h('input', { class: 'input tp-amount', type: 'text', inputmode: 'decimal', placeholder: 'Сумма, сом', autocomplete: 'off' });
      const go = async (e) => { const b = e.currentTarget; const v = amount.value.trim(); if (!v) return toast('Введите сумму', 'err'); busy(b, true); try { const r = await api('/tg-agent/topup', { method: 'POST', body: { amount: v } }); jobId = r.item.id; draw(r.item); } catch (ex) { err(ex); } busy(b, false); };
      body.appendChild(h('div', { class: 'tp-to' }, h('span', { class: 'tp-ico' }, svg('wallet', 22)), h('div', null, h('b', null, 'ID ' + st.player_id), h('small', null, 'через @' + st.bot))));
      body.appendChild(h('label', { class: 'field' }, h('span', null, 'Сумма пополнения'), amount));
      body.appendChild(h('div', { class: 'tp-chips' }, [5000, 10000, 20000, 40000].map((v) => h('button', { class: 'tp-chip', type: 'button', onclick: () => { amount.value = String(v); amount.focus(); } }, money0(v)))));
      body.appendChild(h('button', { class: 'primary-btn tp-go', type: 'button', onclick: go }, svg('qr', 18), 'Получить QR'));
      setTimeout(() => amount.focus(), 250);
    };
    const draw = (item) => {
      if (closed || !item) return;
      lastState = item.state; body.innerHTML = '';
      const qrImg = () => h('img', { class: 'tp-qr', alt: 'QR', src: API + '/tg-agent/topup/' + item.id + '/qr.png?t=' + item.age, onclick: (e) => imageSheet('QR', e.currentTarget.src) });
      if (item.state === 'running') {
        body.appendChild(h('div', { class: 'tp-wait' }, h('i', { class: 'tp-spin' }), h('b', null, 'Бот готовит QR…'), h('small', null, money(item.amount) + ' · ID ' + item.player_id)));
        body.appendChild(logEl(item)); return poll(900);
      }
      if (item.state === 'qr' || item.state === 'waiting') {
        body.appendChild(h('div', { class: 'tp-qrbox' }, item.has_qr ? qrImg() : null, h('b', { class: 'tp-sum' }, money(item.qr_amount || item.amount) + ' сом'), h('small', null, 'ID ' + item.player_id + ' · @' + item.bot)));
        if (item.optima_pay_link) body.appendChild(h('a', { class: 'optima-btn tp-optima', href: item.optima_pay_link, target: '_blank', rel: 'noopener' }, h('img', { src: 'brand/banks/optima.png', alt: '' }), 'Оплатить в Optima24'));
        if (item.state === 'waiting') body.appendChild(h('div', { class: 'tp-wait small' }, h('i', { class: 'tp-spin' }), h('b', null, 'Ждём ответ бота…'), h('small', null, 'Окно можно закрыть — ответ придёт сюда при следующем открытии')));
        else body.appendChild(h('div', { class: 'btn-grid' }, h('button', { class: 'action-btn', type: 'button', onclick: async (e) => { if (!(await confirmDialog('Отменить пополнение? В боте заявка тоже отменится.', 'Отменить', true))) return; await act('cancel', e.currentTarget); } }, 'Отмена'), h('button', { class: 'action-btn primary', type: 'button', onclick: (e) => act('paid', e.currentTarget) }, svg('check', 18), 'Оплатил')));
        body.appendChild(logEl(item)); return poll(item.state === 'waiting' ? 1500 : 2500);
      }
      if (item.state === 'done') {
        body.appendChild(h('div', { class: 'tp-done' }, h('span', { class: 'tp-ok' }, svg('check', 28)), h('pre', null, item.final_text)));
        body.appendChild(h('button', { class: 'primary-btn', type: 'button', onclick: () => s.close() }, 'Готово'));
        buzz(20); document.dispatchEvent(new CustomEvent('paygo:changed')); return;
      }
      body.appendChild(h('div', { class: 'tp-err' }, h('b', null, item.state === 'cancelled' ? 'Пополнение отменено' : 'Бот ответил:'), h('span', null, item.error || '')));
      body.appendChild(logEl(item));
      body.appendChild(h('button', { class: 'primary-btn', type: 'button', onclick: () => { jobId = null; api('/tg-agent').then(form).catch(err); } }, 'Попробовать снова'));
    };
    body.appendChild(loader(2));
    try {
      const st = await api('/tg-agent');
      if (!st.installed || !st.authorized) {
        body.innerHTML = '';
        body.appendChild(empty(st.installed ? 'Telegram-аккаунт не подключён' : 'Модуль Telegram не установлен', st.installed ? 'Подключите аккаунт, через который панель будет писать боту @' + st.bot : 'Переустановите обновление PayGo', 'chat'));
        if (st.installed && String((state.admin || {}).username || '').toLowerCase() === 'admin') body.appendChild(h('button', { class: 'primary-btn', type: 'button', onclick: () => { s.close(); go('#/tg'); } }, 'Подключить'));
        return;
      }
      if (st.active) { jobId = st.active.id; draw(st.active); } else form(st);
    } catch (ex) { body.innerHTML = ''; body.appendChild(empty('Ошибка', ex.message)); }
  }
  async function tgView(shell) {
    const box = page(shell, 'Telegram-аккаунт');
    if (String((state.admin || {}).username || '').toLowerCase() !== 'admin') { box.appendChild(empty('Только владелец admin', 'Подключение Telegram-аккаунта доступно только владельцу.', 'shield')); return; }
    /* TG_LOGIN_1_13_9_47: «Получить код» answers at once; the connection runs on the server and this page follows it */
    const form = { api_id: '', api_hash: '', phone: '', proxy: '' };
    let timer = 0;
    const logBox = (lines) => h('div', { class: 'tg-log' }, (lines || []).map((t) => h('div', { class: 'tg-log-line' + (/^✕|^Не получилось|^Telegram ответил/.test(t) ? ' bad' : (/^✓|^Связь есть|^Код отправлен/.test(t) ? ' good' : '')) }, t)));
    const follow = (card) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!box.isConnected) return;
        let st = null; try { st = await api('/tg-agent'); } catch (ex) { return follow(card); }
        if (!box.isConnected) return;
        if ((st.login || {}).state === 'connecting') { connecting(card, st.login); return follow(card); }
        if ((st.login || {}).state === 'code') toast('Код отправлен — проверьте Telegram', 'ok', 1400);
        draw(st);
      }, 1200);
    };
    const connecting = (card, lg) => {
      card.innerHTML = '';
      card.appendChild(h('div', { class: 'tp-wait' }, h('i', { class: 'tp-spin' }), h('b', null, 'Подключаемся к Telegram…'), h('small', null, 'Пробуем все способы сразу, в том числе через HTTPS как Telegram Web — обычно пара секунд, не дольше 20.')));
      card.appendChild(logBox(lg.log));
    };
    const draw = async (st) => {
      clearTimeout(timer);
      box.innerHTML = '';
      if (!st) { box.appendChild(loader(2)); try { st = await api('/tg-agent'); } catch (ex) { box.innerHTML = ''; box.appendChild(empty('Ошибка', ex.message)); return; } box.innerHTML = ''; }
      box.appendChild(h('div', { class: 'card tg-hero' }, h('span', { class: 'tg-ico' }, svg('send', 24)), h('div', null, h('b', null, st.authorized ? (st.me.name || 'Аккаунт подключён') : 'Аккаунт не подключён'), h('small', null, st.authorized ? ((st.me.username ? '@' + st.me.username + ' · ' : '') + (st.me.phone || '') + (st.proxy ? ' · ' + st.proxy : '')) : 'Через этот аккаунт панель пишет боту @' + st.bot + ' и забирает QR')), st.authorized ? h('i', { class: 'tg-on' }, 'онлайн') : null));
      if (!st.installed) box.appendChild(h('div', { class: 'note pink' }, 'Модуль telethon не установлен на сервере — переустановите обновление.'));
      const bot = h('input', { class: 'input', value: '@' + st.bot }); const pid = h('input', { class: 'input', value: st.player_id, inputmode: 'numeric' });
      box.appendChild(h('div', { class: 'card tg-card' }, h('b', { class: 'tg-title' }, 'Куда пополнять'), h('label', { class: 'field' }, h('span', null, 'Бот'), bot), h('label', { class: 'field' }, h('span', null, 'ID игрового счета'), pid), h('button', { class: 'outline-btn blue', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { draw(await api('/tg-agent/config', { method: 'POST', body: { bot: bot.value, player_id: pid.value } })); toast('Сохранено', 'ok', 1000); } catch (ex) { err(ex); } busy(b, false); } }, svg('save', 16), 'Сохранить')));
      if (st.authorized) { box.appendChild(h('button', { class: 'outline-btn danger tg-out', type: 'button', onclick: async () => { if (!(await confirmDialog('Отключить Telegram-аккаунт от панели?', 'Отключить', true))) return; try { draw(await api('/tg-agent/logout', { method: 'POST' })); } catch (ex) { err(ex); } } }, svg('logout', 16), 'Отключить аккаунт')); return; }
      const card = h('div', { class: 'card tg-card' }); box.appendChild(card);
      const lg = st.login || {};
      const input = (key, attrs) => { const el = h('input', Object.assign({ class: 'input', value: form[key] }, attrs)); el.addEventListener('input', () => { form[key] = el.value; }); return el; };
      const step1 = (failed) => {
        card.innerHTML = '';
        const apiId = input('api_id', { inputmode: 'numeric', placeholder: '1234567' }); const apiHash = input('api_hash', { placeholder: '0123456789abcdef…', autocapitalize: 'none', autocomplete: 'off' }); const phone = input('phone', { type: 'tel', placeholder: '+996 555 123 456' });
        const proxy = input('proxy', { placeholder: 'socks5://логин:пароль@хост:порт или ссылка MTProxy', autocapitalize: 'none', autocomplete: 'off' });
        card.appendChild(h('b', { class: 'tg-title' }, 'Подключить аккаунт'));
        if (failed) card.appendChild(h('div', { class: 'tp-err tg-fail' }, h('b', null, 'Не удалось получить код'), h('span', null, failed.error || ''), logBox(failed.log)));
        else card.appendChild(h('div', { class: 'tg-hint' }, '1) Откройте my.telegram.org и войдите этим номером.', h('br'), '2) «API development tools» → создайте приложение (любое название).', h('br'), '3) Скопируйте сюда App api_id и App api_hash.'));
        card.appendChild(h('label', { class: 'field' }, h('span', null, 'api_id'), apiId)); card.appendChild(h('label', { class: 'field' }, h('span', null, 'api_hash'), apiHash)); card.appendChild(h('label', { class: 'field' }, h('span', null, 'Номер телефона'), phone));
        const proxyField = h('label', { class: 'field tg-proxy' + (failed || form.proxy ? '' : ' hidden') }, h('span', null, 'Прокси — если сервер не достаёт до Telegram'), proxy);
        card.appendChild(proxyField);
        const checkBox = h('div', { class: 'tg-check' });
        card.appendChild(h('button', { class: 'primary-btn', type: 'button', onclick: async (e) => {
          const b = e.currentTarget; busy(b, true);
          try { const r = await api('/tg-agent/login/start', { method: 'POST', body: { api_id: apiId.value.trim(), api_hash: apiHash.value.trim(), phone: phone.value, proxy: proxy.value.trim() } }); busy(b, false); if ((r.login || {}).state === 'connecting') { connecting(card, r.login); follow(card); } else draw(r); return; } catch (ex) { err(ex); }
          busy(b, false);
        } }, 'Получить код'));
        card.appendChild(h('div', { class: 'tg-tools' },
          proxyField.classList.contains('hidden') ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => { proxyField.classList.remove('hidden'); e.currentTarget.remove(); proxy.focus(); } }, 'Указать прокси') : null,
          h('button', { class: 'link-btn', type: 'button', onclick: async (e) => {
            const b = e.currentTarget; busy(b, true); checkBox.innerHTML = ''; checkBox.appendChild(h('div', { class: 'tg-log-line' }, 'Проверяем связь с Telegram — до 20 секунд…'));
            try { const r = await api('/tg-agent/check', { method: 'POST', body: { proxy: proxy.value.trim() } }); checkBox.innerHTML = ''; (r.results || []).forEach((x) => checkBox.appendChild(h('div', { class: 'tg-log-line ' + (x.info ? 'info ' : '') + (x.ok ? 'good' : 'bad') }, (x.ok ? '✓ ' : '✕ ') + x.label + ' — ' + (x.ok ? 'работает, ' + (x.ms / 1000).toFixed(1) + ' сек' : x.error)))); if ((r.results || []).length && !(r.results || []).some((x) => x.ok && !x.info)) checkBox.appendChild(h('div', { class: 'tg-hint' }, 'С сервера Telegram недоступен — укажите прокси (SOCKS5 или MTProxy) и проверьте ещё раз.')); } catch (ex) { checkBox.innerHTML = ''; err(ex); }
            busy(b, false);
          } }, 'Проверить связь')));
        card.appendChild(checkBox);
      };
      const step2 = () => {
        card.innerHTML = '';
        const code = h('input', { class: 'input tg-code', inputmode: 'numeric', placeholder: '12345', autocomplete: 'one-time-code' });
        const sent = (lg.log || []).filter((t) => /^Код отправлен/.test(t)).pop() || 'Код отправлен в приложение Telegram';
        card.appendChild(h('b', { class: 'tg-title' }, 'Код из Telegram')); card.appendChild(h('div', { class: 'tg-hint' }, sent + ' (чат «Telegram»). Введите его:'));
        card.appendChild(code);
        card.appendChild(h('button', { class: 'primary-btn', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { const r = await api('/tg-agent/login/code', { method: 'POST', body: { code: code.value } }); if (r.step === 'password') step3(); else { toast('Аккаунт подключён', 'ok'); draw(r); } } catch (ex) { err(ex); } busy(b, false); } }, 'Войти'));
        card.appendChild(h('div', { class: 'tg-tools' }, h('button', { class: 'link-btn', type: 'button', onclick: () => step1(null) }, 'Запросить код заново')));
        setTimeout(() => code.focus(), 200);
      };
      const step3 = () => {
        card.innerHTML = '';
        const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Пароль двухэтапной проверки' });
        card.appendChild(h('b', { class: 'tg-title' }, 'Облачный пароль')); card.appendChild(h('div', { class: 'tg-hint' }, 'У аккаунта включена двухэтапная проверка — введите её пароль.')); card.appendChild(pw);
        card.appendChild(h('button', { class: 'primary-btn', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { const r = await api('/tg-agent/login/password', { method: 'POST', body: { password: pw.value } }); toast('Аккаунт подключён', 'ok'); draw(r); } catch (ex) { err(ex); } busy(b, false); } }, 'Войти'));
      };
      if (lg.state === 'connecting') { connecting(card, lg); follow(card); }
      else if (lg.state === 'code' && st.pending) step2();
      else if (lg.state === 'password' && st.pending) step3();
      else step1(lg.state === 'error' ? lg : null);
    };
    draw(null);
  }
  async function quickView(shell) {""")

# ================================================================== STAGE 6 (1.13.9.49) — Demir Bank: payments from the bank's e-mails + QR
rep("""const SOURCE = { bot: 'Телеграм',""", """const SOURCE = { demir: 'Демир', mail: 'Почта', bot: 'Телеграм',""")
rep("""    const addOptima=h('button',{class:'add-btn optima-add',type:'button',onclick:()=>optimaForm()},svg('plus',20),'Optima');
    screen.appendChild(hero('Кошельки','QR-реквизиты и банковские подключения Optima',{icon:'wallet',tools:[h('button',{class:'round-btn',type:'button','aria-label':'Обновить',onclick:()=>draw()},svg('refresh',24)),addQR,addOptima]}));""",
    """    const addOptima=h('button',{class:'add-btn optima-add',type:'button',onclick:()=>optimaForm()},svg('plus',20),'Optima');
    const addDemir=h('button',{class:'add-btn demir-add',type:'button',onclick:()=>demirForm(null)},svg('plus',20),'Demir');
    let reqs={items:[]};
    screen.appendChild(hero('Кошельки','QR-реквизиты, Optima и Демир Банк',{icon:'wallet',tools:[h('button',{class:'round-btn',type:'button','aria-label':'Обновить',onclick:()=>draw()},svg('refresh',24)),addQR,addOptima,addDemir]}));""")
rep("""        const[rq,cs,ow]=await Promise.all([api('/requisites'),api('/cashes'),api('/optima-wallets').catch(()=>({items:[]}))]); cashes=cs; box.innerHTML='';""",
    """        const[rq,cs,ow,dw]=await Promise.all([api('/requisites'),api('/cashes'),api('/optima-wallets').catch(()=>({items:[]})),api('/demir-wallets').catch(()=>({items:[]}))]); cashes=cs; reqs=rq; box.innerHTML='';""")
rep("""        box.appendChild(h('div',{class:'wallet-section-title qr-title'},h('b',null,'QR КОШЕЛЬКИ'),h('small',null,(rq.items||[]).length+' шт.')));""",
    """        /* DEMIR_MAIL_1_13_9_49 */
        box.appendChild(h('div',{class:'wallet-section-title'},h('b',null,'DEMIR BANK'),h('small',null,(dw.items||[]).length+' подключено')));
        if(!(dw.items||[]).length) box.appendChild(h('div',{class:'card optima-empty'},h('b',null,'Демир ещё не подключён'),h('small',null,'Почта Timeweb, куда приходят письма банка «Входящий QR-перевод», и QR Демир — поступления зачисляются через мгновение после письма.')));
        (dw.items||[]).forEach((w)=>box.appendChild(demirCard(w)));
        box.appendChild(h('div',{class:'wallet-section-title qr-title'},h('b',null,'QR КОШЕЛЬКИ'),h('small',null,(rq.items||[]).length+' шт.')));""")
rep("""    function optimaForm(){""", """    const DM_STATE={online:'онлайн',connecting:'подключение…',error:'ошибка',off:'выключен',worker:'воркер не отвечает'};
    const payWord=(p)=>p.status==='matched'?'зачислено':(p.status==='unmatched'?'без заявки':(p.status==='hold'?'на проверке':(p.status==='duplicate'?'повтор':'в работе')));
    function demirCard(w){
      const toggle=switchEl(!!w.enabled,async(v)=>{try{await api('/demir-wallets/'+w.id,{method:'PATCH',body:{enabled:v}});toast(v?'Демир включён':'Демир выключен','ok',1000);draw();}catch(ex){err(ex);}});
      const live=w.state==='online'?(w.idle===false?'онлайн · проверка каждые 2 сек':'онлайн · письма мгновенно'):(DM_STATE[w.state]||w.state);
      const trust=w.verified?('подпись банка проверена: '+w.verified+(w.unverified?' · без подписи: '+w.unverified:'')):(w.unverified?'писем без подписи: '+w.unverified+' (сервер почты не проверяет подпись)':'писем ещё не было');
      return h('div',{class:'card optima-wallet-card demir-card'+(w.enabled?'':' off')},
        h('div',{class:'optima-wallet-head'},h('span',{class:'optima-bank-logo demir-logo'},bankLogo(bankOf('demir'))),h('div',{class:'optima-wallet-name'},h('b',null,w.name),h('small',null,w.login+(w.host&&w.host!=='imap.timeweb.ru'?' · '+w.host:''))),toggle),
        h('div',{class:'dm-meta'},h('span',{class:'dm-chip'+(w.state==='online'?' on':'')},h('i'),live),h('span',{class:'dm-chip'},svg('qr',14),w.requisite?w.requisite.name+(w.requisite.enabled?'':' (выкл.)'):'QR не привязан'),w.recipient?h('span',{class:'dm-chip'},svg('user',14),w.recipient):null),
        w.last_error?h('div',{class:'ow-status-msg'},w.last_error):null,
        h('div',{class:'dm-trust'},svg('shield',15),trust),
        (w.rejected||[]).length?h('div',{class:'dm-rej'},'Отклонено: '+w.rejected.slice(-1)[0].reason):null,
        (w.payments||[]).length?h('div',{class:'dm-pays'},w.payments.map((p)=>h('div',{class:'dm-pay'},h('b',null,money(p.amount)+' KGS'),h('small',null,fmtDate(p.at)),h('span',{class:'dm-st '+(p.status||'')},payWord(p))))):h('div',{class:'dm-empty'},'Поступлений пока нет — первое письмо банка появится здесь'),
        h('div',{class:'btn-row'},
          h('button',{class:'outline-btn',type:'button',onclick:async(e)=>{const b=e.currentTarget;busy(b,true);try{demirResult(await api('/demir-wallets/check',{method:'POST',body:{id:w.id}}),null,true);}catch(ex){err(ex);}busy(b,false);}},svg('refresh',16),'Проверить'),
          h('button',{class:'outline-btn',type:'button',onclick:()=>demirForm(w)},svg('edit',16),'Изменить'),
          h('button',{class:'outline-btn danger',type:'button',onclick:async()=>{if(!(await confirmDialog('Отключить Демир '+w.name+'? QR-кошелёк останется.','Отключить',true)))return;try{await api('/demir-wallets/'+w.id,{method:'DELETE'});toast('Удалено','ok');draw();}catch(ex){err(ex);}}},svg('trash',16),'Удалить')));
    }
    function demirResult(r,box,asToast){
      const verdict={signed:'подпись банка ✓',spf:'SPF банка ✓',none:'подпись не проверяется'};
      const lines=['✓ Вход в почту за '+(r.ms/1000).toFixed(1)+' сек'+(r.idle?' · мгновенные уведомления (IDLE)':' · без IDLE: проверка каждые 2 сек'),'Писем от банка за 3 дня: '+r.found];
      if(r.sample&&r.sample.ok)lines.push('Последнее: '+money(r.sample.amount)+' KGS · '+fmtDate(r.sample.bank_time)+' · '+(verdict[r.sample.verdict]||'')+(r.sample.recipient?' · '+r.sample.recipient:''));
      else if(r.sample)lines.push('Последнее письмо банка не разобрано: '+r.sample.reason);
      if(asToast||!box){toast(lines.join(' · '),'ok',5200);return;}
      box.innerHTML='';lines.forEach((t)=>box.appendChild(h('div',{class:'tg-log-line good'},t)));
    }
    function demirForm(w){
      const isNew=!w; w=w||{name:'Demir основной',host:'imap.timeweb.ru',folder:'INBOX',sender:'info@demirbank.kg',requisite:null};
      const name=h('input',{class:'input',value:w.name});
      const login=h('input',{class:'input',placeholder:'pay@вашдомен.ru',autocapitalize:'none',autocomplete:'off',value:isNew?'':''});
      const pass=h('input',{class:'input',type:'password',autocomplete:'new-password',placeholder:isNew?'Пароль почты Timeweb':'не менять'});
      const host=h('input',{class:'input',value:w.host||'imap.timeweb.ru',autocapitalize:'none'});const port=h('input',{class:'input',value:String(w.port||993),inputmode:'numeric'});
      const folder=h('input',{class:'input',value:w.folder||'INBOX'});const sender=h('input',{class:'input',value:w.sender||'info@demirbank.kg',autocapitalize:'none'});
      const demirReqs=(reqs.items||[]).filter((q)=>/demir/i.test((q.bank_type||'')+' '+(q.bank_name||'')));
      const reqSel=h('select',{class:'select'},h('option',{value:''},demirReqs.length?'— новый QR ниже —':'— загрузите QR ниже —'),demirReqs.map((q)=>h('option',{value:q.id,selected:w.requisite&&w.requisite.id===q.id},q.name)));
      const src=h('textarea',{class:'textarea',placeholder:'ELQR Демир (000201…) — или выберите изображение'});
      const file=h('input',{type:'file',accept:'image/*',class:'input'});
      file.onchange=async()=>{const fd=new FormData();fd.append('file',file.files[0]);try{const rr=await api('/requisites/upload',{method:'POST',body:fd});src.value=rr.source;toast('QR распознан: '+rr.meta.bank_name,'ok');}catch(ex){err(ex);}};
      const adv=h('div',{class:'dm-adv hidden'},h('div',{class:'stat-grid'},h('label',{class:'field'},h('span',null,'IMAP сервер'),host),h('label',{class:'field'},h('span',null,'Порт'),port)),h('div',{class:'stat-grid'},h('label',{class:'field'},h('span',null,'Папка'),folder),h('label',{class:'field'},h('span',null,'Адрес банка'),sender)));
      const result=h('div',{class:'tg-check'});
      const bodyOf=()=>{const b={name:name.value.trim(),host:host.value.trim(),port:Number(port.value||993),folder:folder.value.trim(),sender:sender.value.trim()};if(login.value.trim())b.login=login.value.trim();if(pass.value)b.password=pass.value;if(reqSel.value)b.requisite_id=Number(reqSel.value);if(src.value.trim())b.qr_source=src.value.trim();return b;};
      const hint=h('div',{class:'hint-card dm-hint'},h('b',null,'Как это работает'),h('span',null,'Панель держит почту открытой (IMAP IDLE): письмо банка «Вам поступил перевод с помощью QR-платежа на сумму 500.61 KGS от 28.09.2026 12:45:00» читается через мгновение и зачисляет заявку с этой суммой.'),h('span',null,'Защита: только адрес банка, без пересланных писем; проверка подписи банка (DKIM/SPF); время платежа берётся из письма — старое или повторное письмо не зачислит новую заявку; одно письмо — одно зачисление.'));
      const sh=sheet({title:isNew?'Подключить Демир Банк':w.name,body:h('div',null,
        h('label',{class:'field'},h('span',null,'Название'),name),
        h('label',{class:'field'},h('span',null,isNew?'Почта Timeweb (логин)':'Почта: '+w.login+' — новый адрес (или пусто)'),login),
        h('label',{class:'field'},h('span',null,'Пароль почты'),pass),
        h('label',{class:'field'},h('span',null,'QR Демир Банка'),reqSel),
        h('label',{class:'field'},h('span',null,isNew?'QR — текст':'Заменить QR — текст'),src),h('label',{class:'field'},h('span',null,'или изображение QR'),file),
        h('button',{class:'link-btn',type:'button',onclick:(e)=>{adv.classList.toggle('hidden');e.currentTarget.textContent=adv.classList.contains('hidden')?'Дополнительно':'Скрыть';}},'Дополнительно'),adv,
        result,hint),
        actions:[h('button',{class:'action-btn',onclick:async(e)=>{const b=e.currentTarget;const body=bodyOf();if(!isNew)body.id=w.id;if(isNew&&(!body.login||!body.password))return toast('Введите почту и пароль','err');busy(b,true);result.innerHTML='';result.appendChild(h('div',{class:'tg-log-line'},'Входим в почту…'));try{demirResult(await api('/demir-wallets/check',{method:'POST',body}),result);}catch(ex){result.innerHTML='';result.appendChild(h('div',{class:'tg-log-line bad'},'✕ '+ex.message));}busy(b,false);}},'Проверить почту'),
          h('button',{class:'action-btn primary',onclick:async(e)=>{const b=e.currentTarget;const body=bodyOf();if(isNew&&(!body.login||!body.password))return toast('Введите почту и пароль','err');if(isNew&&!body.requisite_id&&!body.qr_source&&!(await confirmDialog('QR Демир не указан — клиенты не увидят этот кошелёк, пока QR не добавлен. Подключить почту без QR?','Подключить')))return;busy(b,true);try{if(isNew)await api('/demir-wallets',{method:'POST',body});else await api('/demir-wallets/'+w.id,{method:'PATCH',body});toast(isNew?'Демир подключён — почта откроется в течение пары секунд':'Сохранено','ok',2400);sh.close();draw();}catch(ex){err(ex);}finally{busy(b,false);}}},isNew?'Подключить':'Сохранить')]});
    }
    function optimaForm(){""")

# ================================================================== STAGE 7 (1.13.9.50) — phone layout: header tools, logs, bottom nav
rep("""  function hero(title, sub, opts) { opts = opts || {}; return h('div', { class: 'hero' },""",
    """  function hero(title, sub, opts) { opts = opts || {}; return h('div', { class: 'hero' + (opts.tools && opts.tools.filter(Boolean).length > 2 ? ' hero-wide' : '') },""")
rep("""    const amountOf = (l) => {""", """    const when = (v) => { const d = new Date(v); if (isNaN(d)) return fmtDate(v); const now = new Date(); const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); if (d.toDateString() === now.toDateString()) return t; return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + (d.getFullYear() === now.getFullYear() ? '' : '.' + String(d.getFullYear()).slice(2)) + ' ' + t; };
    const amountOf = (l) => {""")
rep("""h('div', { class: 'side' }, amt ? h('b', { class: cls === 'red' ? 'red' : '' }, amt) : null, h('small', null, fmtDate(l.created_at))))""",
    """h('div', { class: 'side' }, amt ? h('b', { class: cls === 'red' ? 'red' : '' }, amt) : null, h('small', null, when(l.created_at))))""")
rep("""h('div', { class: 'side' }, h('small', null, fmtDate(l.created_at))))""", """h('div', { class: 'side' }, h('small', null, when(l.created_at))))""")

# ================================================================== STAGE 8 (1.13.9.51) — menu, cash refill, second bot + receipt, live case card, skeletons
import re as _re8
rep("""const ICON = { home:""", """const ICON = { phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2', desktop: 'M3 5h18v11H3ZM8 20h8M12 16v4', home:""")
rep("""['payments', 'wallet', 'Платежи без заявки', 'green', 'operations'], """, "")
rep("""['statements', 'note', 'Выписки', 'blue', 'settings'], """, "")
rep("""created: ['Ожидает', 'pending']""", """created: ['Ждем поступление…', 'pending']""")
# menu: account card, then every section as a tile in two columns (as in the reference), «Выйти» among them
rep("""    screen.appendChild(h('div', { class: 'card account' }, avatarEl(a.name || a.username, ''), h('div', null, h('b', null, a.name || a.username), h('small', null, '@' + a.username + ' · ' + (ROLE_LABEL[a.role] || a.role)))));""",
    """    screen.appendChild(h('div', { class: 'card account menu-acc' }, h('span', { class: 'menu-acc-ico' }, svg('user', 22)), h('div', null, h('b', null, 'Мой аккаунт'), h('small', null, (a.name || a.username) + ' · ' + (ROLE_LABEL[a.role] || a.role)))));""")
rep("""    screen.appendChild(h('div', { class: 'card menu-card' }, rows.map((m) => h('button', { class: 'menu-row', type: 'button', onclick: () => go('#/' + m[0]) }, h('span', { class: 'ico menu-color ' + m[3] }, svg(m[1], 22)), m[2], h('span', { class: 'chev' }, svg('chevron', 20))))));
    screen.appendChild(h('div', { class: 'card menu-card' }, h('button', { class: 'menu-row danger', type: 'button', onclick: logout }, h('span', { class: 'ico menu-color red' }, svg('logout', 22)), 'Выйти')));""",
    """    screen.appendChild(h('div', { class: 'menu-grid' }, rows.map((m) => h('button', { class: 'card menu-tile', type: 'button', onclick: () => go('#/' + m[0]) }, h('span', { class: 'ico menu-color ' + m[3] }, svg(m[1], 20)), h('b', null, m[2]))), h('button', { class: 'card menu-tile danger', type: 'button', onclick: logout }, h('span', { class: 'ico menu-color red' }, svg('logout', 20)), h('b', null, 'Выйти'))));""")
# every other section: a block skeleton in the page's shape instead of a list of avatars
rep("""  function loader(n) { return h('div', null, Array.from({ length: n || 3 }).map(() => h('div', { class: 'sk' }, h('i', { class: 'a' }), h('div', null, h('i', { class: 'l1' }), h('i', { class: 'l2' }), h('i', { class: 'l3' })), h('div', null, h('i', { class: 'r1' }), h('i', { class: 'r2' }), h('i', { class: 'r3' }))))); }""",
    """  function loader(n) { const b = (cls) => h('i', { class: 'skb ' + (cls || '') }); return h('div', { class: 'skx sk-blocks' }, Array.from({ length: n || 3 }).map((_, i) => h('div', { class: 'skx-block' }, h('div', { class: 'skx-head' }, b(i % 2 ? 'w30' : 'w45'), b('pill')), b('w80'), b('w55'), i === 0 ? b('bar') : null))); }""")
# pull to refresh: really reload the page's data
rep("""document.dispatchEvent(new CustomEvent('paygo:pull')); setTimeout(reset, 900);""",
    """document.dispatchEvent(new CustomEvent('paygo:pull')); setTimeout(() => { try { if (!document.querySelector('.home-screen,.screen.home')) render(); } catch (_) {} }, 150); setTimeout(reset, 900);""")
# which bot the request came from: a small tag in the second line
rep("""h('b', null, h('span', { class: 'nm' }, clientName(tx)), chip ? h('span', { class: 'tx-chip' }, chip) : null)""", """h('b', null, h('span', { class: 'nm' }, clientName(tx)), chip ? h('span', { class: 'tx-chip' }, chip) : null, tx.bot ? h('span', { class: 'tx-bot' }, tx.bot) : null)""")
# VPN: a clear full-screen notice instead of errors everywhere
rep("""    if (res.status === 401) {""", """    if (res.status === 403 && /VPN_BLOCKED/.test(String(data.error || data.detail || ''))) { vpnBlock(); const e = new Error('Вход через VPN запрещён — отключите VPN'); e.status = 403; throw e; }
    if (res.status === 401) {""")
rep("""  async function api(path, opts) {""", """  /* VPN_BLOCK_1_13_9_51 */
  function vpnBlock() {
    if (document.querySelector('.vpn-block')) return;
    document.body.appendChild(h('div', { class: 'vpn-block' }, h('div', { class: 'vpn-card' }, h('span', { class: 'vpn-ico' }, svg('shield', 34)), h('b', null, 'Вход через VPN запрещён'), h('small', null, 'Админка не открывается через VPN, прокси и серверные адреса. Отключите VPN и нажмите «Обновить».'), h('button', { class: 'primary-btn', type: 'button', onclick: () => location.reload() }, svg('refresh', 18), 'Обновить'))));
  }
  async function api(path, opts) {""")
# sessions: the device in words, where, online now, IP, times
rep("""        s.items.forEach((x) => box.appendChild(h('div', { class: 'card row-card' }, h('div', null, h('b', null, (x.username ? x.username + ' · ' : '') + (x.ip || '—'), x.current ? ' (текущая)' : ''), h('small', null, (x.user_agent || '—').slice(0, 70)), h('small', null, 'создана ' + fmtDate(x.created_at) + ' · активна ' + ago(x.last_seen_at) + ' назад')), !x.current ? h('button', { class: 'outline-btn danger', onclick: async () => { try { await api('/auth/sessions/' + x.id + '/revoke', { method: 'POST' }); draw(); } catch (ex) { err(ex); } } }, 'Выйти') : h('span', { class: 'pill green' }, 'вы'))));""",
    """        s.items.forEach((x) => { const dv = x.device || {}; const mobile = /iPhone|iPad|Android|Samsung|Xiaomi|OPPO|realme|vivo|Google/.test(dv.label || ''); const kv = (k, v) => h('div', { class: 'sess-kv' }, h('small', null, k), h('b', null, v || '—'));
          box.appendChild(h('div', { class: 'card sess-card' + (x.vpn ? ' vpn' : '') + (x.online ? ' online' : '') },
            h('div', { class: 'sess-top' }, h('span', { class: 'sess-ico' }, svg(mobile ? 'phone' : 'desktop', 21)), h('div', { class: 'sess-name' }, h('b', null, dv.label || (x.user_agent || 'Устройство').slice(0, 40)), h('small', null, (x.username ? '@' + x.username + ' · ' : '') + (x.online ? 'онлайн сейчас' : 'был(а) ' + ago(x.last_seen_at) + ' назад'))), x.current ? h('span', { class: 'pill green' }, 'это вы') : (x.online ? h('i', { class: 'sess-dot' }) : null)),
            h('div', { class: 'sess-grid' }, kv('IP-адрес', x.ip), kv('Где', x.place || '—'), kv('Вход', fmtDate(x.created_at)), kv('Активность', fmtDate(x.last_seen_at))),
            x.vpn ? h('div', { class: 'note pink' }, 'Адрес похож на VPN/прокси — с него админка не откроется') : null,
            x.current ? null : h('button', { class: 'outline-btn danger sess-out', type: 'button', onclick: async () => { if (!(await confirmDialog('Завершить сессию на устройстве «' + (dv.label || 'устройство') + '»?', 'Завершить', true))) return; try { await api('/auth/sessions/' + x.id + '/revoke', { method: 'POST' }); toast('Сессия завершена', 'ok'); draw(); } catch (ex) { err(ex); } } }, svg('logout', 16), 'Завершить сессию'))); });""")
# chat: the request card at the top follows the request's status
m8 = _re8.search(r"\n( *)if \(ctx\.deposit \|\| ctx\.withdrawal\) \{ const t = [^\n]*\n", s)
assert m8, "case-card line"
line8 = m8.group(0)
assert line8.count("statusEl(t.status, t.status_label))") == 1
new8 = line8.replace("statusEl(t.status, t.status_label))", "(t._st = statusEl(t.status, t.status_label)))", 1).rstrip("\n") + " if (ctx.deposit || ctx.withdrawal) { const lt = ctx.withdrawal && c.category !== 'deposit' ? ctx.withdrawal : ctx.deposit; caseLive(screen, lt, lt === ctx.deposit); }\n"
s = s.replace(line8, new8, 1)
rep("""  function txCard(tx, opts) {""", """  /* CASE_LIVE_1_13_9_51: the request card in a chat changes the moment the request does (expired, cancelled, credited) */
  function caseLive(screen, t, dep) {
    if (!t || !t.id) return;
    let last = t.status + '|' + (t.status_label || '');
    const tick = async () => {
      if (!screen.isConnected) return;
      try {
        const r = await api('/' + (dep ? 'deposits' : 'withdrawals') + '/' + t.id); const it = r.item || r;
        const sig = (it && it.status) + '|' + ((it && it.status_label) || '');
        if (it && it.status && sig !== last) { last = sig; const fresh = statusEl(it.status, it.status_label); fresh.classList.add('pop'); if (t._st && t._st.parentNode) { t._st.replaceWith(fresh); t._st = fresh; } }
      } catch (_) {}
      if (screen.isConnected && !/^(success|cancelled)\\|/.test(last)) setTimeout(tick, 4000);
    };
    setTimeout(tick, 2000);
  }
  function txCard(tx, opts) {""")
# home: «Пополнить кассу» next to «Пополнить счет»; USDT goes to the card's header
rep("""        oneWinBox.appendChild(h('div',{class:'ow-wallet2'},h('div',{class:'ow-wallet2-row'},idBtn,usdtBtn),usdtAddr));""",
    """        const refillBtn=h('button',{class:'ow-game ow-topup ow-refill',type:'button',onclick:()=>refillSheet()},h('span',{class:'ow-topup-ico refill'},svg('bank',20)),h('span',{class:'ow-game-copy'},h('b',null,'Пополнить кассу'),h('small',null,'касса 1WIN')),svg('chevron',16));
        const owHead=oneWinBox.querySelector('.ow2-head'); if(owHead) owHead.insertBefore(usdtBtn, owHead.lastChild);
        oneWinBox.appendChild(h('div',{class:'ow-wallet2'},h('div',{class:'ow-wallet2-row two'},idBtn,can('cashes')?refillBtn:null),usdtAddr));""")
rep("""  async function topupSheet() {""", """  /* CASH_REFILL_1_13_9_51 — «Пополнить кассу»: amount (the available sum, editable) → confirm «Зачислить» → done */
  async function refillSheet() {
    const body = h('div', { class: 'rf' });
    let info = null, amount = 0, closed = false;
    const s = sheet({ title: 'Пополнить кассу', body, onClose: () => { closed = true; } });
    const n = (v) => Number(String(v == null ? '' : v).replace(/\\s/g, '').replace(',', '.')) || 0;
    const fmt = (v) => money(v) + ' ' + curSign((info && info.currency) || 'KGS');
    const input = () => {
      body.innerHTML = '';
      const avail = n(info.available), min = n(info.min);
      const inp = h('input', { class: 'input rf-amount', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: avail >= min && avail > 0 ? String(avail) : '' , placeholder: '0' });
      const hint = h('small', { class: 'rf-hint' });
      const next = h('button', { class: 'primary-btn', type: 'button' }, 'Продолжить');
      const check = () => { const v = n(inp.value); let msg = ''; if (!v) msg = 'Введите сумму'; else if (v < min) msg = 'Минимум ' + fmt(min); else if (v > avail) msg = 'Доступно только ' + fmt(avail); hint.textContent = msg; hint.classList.toggle('bad', !!msg && !!inp.value); next.disabled = !!msg; return !msg; };
      inp.addEventListener('input', check);
      body.appendChild(h('div', { class: 'rf-avail' }, h('small', null, 'Доступно для пополнения'), h('b', null, fmt(avail)), h('span', null, 'минимум ' + fmt(min))));
      body.appendChild(h('label', { class: 'field' }, h('span', null, 'Сумма пополнения'), h('div', { class: 'rf-inp' }, inp, h('i', null, curSign(info.currency || 'KGS')))));
      body.appendChild(h('div', { class: 'tp-chips' }, avail > 0 ? h('button', { class: 'tp-chip', type: 'button', onclick: () => { inp.value = String(avail); check(); } }, 'Всё: ' + money0(avail)) : null, [5000, 10000, 20000].filter((v) => v <= avail || !avail).map((v) => h('button', { class: 'tp-chip', type: 'button', onclick: () => { inp.value = String(v); check(); } }, money0(v)))));
      body.appendChild(hint);
      next.onclick = () => { if (!check()) return; amount = n(inp.value); confirmStep(); };
      body.appendChild(h('div', { class: 'rf-actions' }, next, h('button', { class: 'action-btn', type: 'button', onclick: () => s.close() }, 'Отменить')));
      check(); setTimeout(() => inp.focus(), 250);
    };
    const confirmStep = () => {
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'rf-confirm' }, h('span', { class: 'rf-ico' }, svg('bank', 26)), h('small', null, 'Пополнить кассу 1WIN на'), h('strong', null, fmt(amount)), h('span', null, 'Сумма спишется из «доступно для пополнения» и зачислится в баланс кассы.')));
      const go = h('button', { class: 'primary-btn rf-go', type: 'button' }, svg('check', 18), 'Зачислить');
      go.onclick = async () => { busy(go, true); try { const r = await api('/cash-refill', { method: 'POST', body: { amount, cash_id: info.cash_id, confirm: true } }); if (!closed) done(r); } catch (ex) { err(ex); busy(go, false); } };
      body.appendChild(h('div', { class: 'rf-actions' }, go, h('button', { class: 'action-btn', type: 'button', onclick: input }, 'Назад')));
    };
    const done = (r) => {
      body.innerHTML = ''; buzz(20);
      const a = r.after || {};
      body.appendChild(h('div', { class: 'tp-done rf-done' }, h('span', { class: 'tp-ok' }, svg('check', 28)), h('b', null, 'Касса пополнена'), h('strong', null, fmt(r.amount)),
        h('div', { class: 'rf-after' }, a.cash_balance != null ? h('div', null, h('small', null, 'Баланс кассы'), h('b', null, fmt(a.cash_balance))) : null, a.available != null ? h('div', null, h('small', null, 'Доступно для пополнения'), h('b', null, fmt(a.available))) : null)));
      body.appendChild(h('button', { class: 'primary-btn', type: 'button', onclick: () => s.close() }, 'Готово'));
      document.dispatchEvent(new CustomEvent('paygo:changed'));
    };
    body.appendChild(loader(1));
    try { info = await api('/cash-refill'); if (!closed) input(); }
    catch (ex) { body.innerHTML = ''; body.appendChild(empty('Касса недоступна', ex.message, 'bank')); }
  }
  async function topupSheet() {""")
# «Пополнить счет»: choose the bot; a bot that wants the receipt gets it from the panel
rep("""    let jobId = null, timer = 0, closed = false, lastState = '';""", """    let jobId = null, timer = 0, closed = false, lastState = '', selBot = '';""")
rep("""      const go = async (e) => { const b = e.currentTarget; const v = amount.value.trim(); if (!v) return toast('Введите сумму', 'err'); busy(b, true); try { const r = await api('/tg-agent/topup', { method: 'POST', body: { amount: v } }); jobId = r.item.id; draw(r.item); } catch (ex) { err(ex); } busy(b, false); };
      body.appendChild(h('div', { class: 'tp-to' }, h('span', { class: 'tp-ico' }, svg('wallet', 22)), h('div', null, h('b', null, 'ID ' + st.player_id), h('small', null, 'через @' + st.bot))));""",
    """      selBot = selBot || st.bot; const bots = (st.bots && st.bots.length ? st.bots : [st.bot]);
      const go = async (e) => { const b = e.currentTarget; const v = amount.value.trim(); if (!v) return toast('Введите сумму', 'err'); busy(b, true); try { const r = await api('/tg-agent/topup', { method: 'POST', body: { amount: v, bot: selBot } }); jobId = r.item.id; draw(r.item); } catch (ex) { err(ex); } busy(b, false); };
      const via = h('small', null, 'через @' + selBot);
      body.appendChild(h('div', { class: 'tp-to' }, h('span', { class: 'tp-ico' }, svg('wallet', 22)), h('div', null, h('b', null, 'ID ' + st.player_id), via)));
      if (bots.length > 1) { const row = h('div', { class: 'tp-bots' }); const paint = () => { row.innerHTML = ''; bots.forEach((b) => row.appendChild(h('button', { class: 'tp-bot' + (b === selBot ? ' on' : ''), type: 'button', onclick: () => { selBot = b; via.textContent = 'через @' + b; paint(); } }, svg('send', 15), '@' + b))); }; paint(); body.appendChild(row); }""")
rep("""        body.appendChild(h('div', { class: 'tp-qrbox' }, item.has_qr ? qrImg() : null, h('b', { class: 'tp-sum' }, money(item.qr_amount || item.amount) + ' сом'), h('small', null, 'ID ' + item.player_id + ' · @' + item.bot)));""",
    """        body.appendChild(h('div', { class: 'tp-qrbox' }, item.has_qr ? qrImg() : null, h('b', { class: 'tp-sum' }, money(item.qr_amount || item.amount) + ' сом'), h('small', null, 'ID ' + item.player_id + ' · @' + item.bot), item.timer ? h('span', { class: 'tp-timer' }, svg('timer', 14), item.timer.replace(/^[^0-9A-Za-zА-Яа-я]+/, '')) : null));""")
rep("""        else body.appendChild(h('div', { class: 'btn-grid' }, h('button', { class: 'action-btn', type: 'button', onclick: async (e) => { if (!(await confirmDialog('Отменить пополнение? В боте заявка тоже отменится.', 'Отменить', true))) return; await act('cancel', e.currentTarget); } }, 'Отмена'), h('button', { class: 'action-btn primary', type: 'button', onclick: (e) => act('paid', e.currentTarget) }, svg('check', 18), 'Оплатил')));""",
    """        else {
          const pick = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
          pick.onchange = async () => { const f = pick.files && pick.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); try { const r = await api('/tg-agent/topup/' + jobId + '/receipt', { method: 'POST', body: fd }); toast('Чек отправлен боту', 'ok', 1400); draw(r.item); } catch (ex) { err(ex); } };
          const cancelBtn = h('button', { class: 'action-btn', type: 'button', onclick: async (e) => { if (!(await confirmDialog('Отменить пополнение? В боте заявка тоже отменится.', 'Отменить', true))) return; await act('cancel', e.currentTarget); } }, 'Отмена');
          if (item.needs_receipt) { body.appendChild(h('div', { class: 'tp-note' }, 'Бот просит чек: оплатите по QR и загрузите скриншот оплаты — панель отправит его боту.')); body.appendChild(h('div', { class: 'btn-grid' }, cancelBtn, h('button', { class: 'action-btn primary', type: 'button', onclick: () => pick.click() }, svg('paperclip', 18), 'Загрузить чек'))); body.appendChild(pick); }
          else body.appendChild(h('div', { class: 'btn-grid' }, cancelBtn, h('button', { class: 'action-btn primary', type: 'button', onclick: (e) => act('paid', e.currentTarget) }, svg('check', 18), 'Оплатил')));
        }""")
# Telegram-аккаунт: the list of bots
rep("""      const bot = h('input', { class: 'input', value: '@' + st.bot }); const pid = h('input', { class: 'input', value: st.player_id, inputmode: 'numeric' });""",
    """      const bot = h('input', { class: 'input', value: (st.bots && st.bots.length ? st.bots : [st.bot]).map((b) => '@' + b).join(', '), autocapitalize: 'none' }); const pid = h('input', { class: 'input', value: st.player_id, inputmode: 'numeric' });""")
rep("""h('label', { class: 'field' }, h('span', null, 'Бот'), bot)""", """h('label', { class: 'field' }, h('span', null, 'Боты — через запятую, первый по умолчанию'), bot)""")
rep("""draw(await api('/tg-agent/config', { method: 'POST', body: { bot: bot.value, player_id: pid.value } }));""", """draw(await api('/tg-agent/config', { method: 'POST', body: { bots: bot.value, player_id: pid.value } }));""")

# ================================================================== STAGE 9 (1.13.9.52) — bot mark on the avatar, PayGo brand skeleton, lighter page, Demir via Gmail / Mail.ru / Yandex
# the bot of a request: a small letter on the avatar for Global / Win only (PayGo is the default and needs no mark); the name row stays clean
rep("""  function skel(kind) {""", """  /* BRAND_1_13_9_52: the PayGo mark, vector (sharp on any screen) */
  let brandSeq = 0;
  function brandMark(size) {
    const id = 'pgm' + (++brandSeq); const box = h('span', { class: 'brand-mark', 'aria-hidden': 'true' });
    box.innerHTML = '<svg viewBox="0 0 64 64" width="' + (size || 64) + '" height="' + (size || 64) + '" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4d8dff"/><stop offset="1" stop-color="#1f4fd8"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#' + id + ')"/><path d="M24 46V18h10.5a9 9 0 0 1 0 18H24" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="43.5" cy="45" r="3.7" fill="#fff"/></svg>';
    return box;
  }
  function botMark(tx) { const k = tx.bot === 'Global' ? 'g' : (tx.bot === 'Win' ? 'w' : ''); return k ? h('i', { class: 'tx-botmark ' + k, title: 'Бот ' + tx.bot }, k.toUpperCase()) : null; }
  function skel(kind) {
    if (kind === 'brand') { const b = (cls) => h('i', { class: 'skb ' + (cls || '') }); return h('div', { class: 'skx brand-skel' }, h('div', { class: 'bs-hero' }, brandMark(64), h('i', { class: 'bs-bar' })), [1, 2, 3].map(() => h('div', { class: 'skx-row' }, b('av'), h('div', { class: 'skx-lines' }, b('w60'), b('w40')), h('div', { class: 'skx-side' }, b('w20'), b('w14'))))); }""")
rep("""h('i', { class: 'tx-flow ' + (dep ? 'deposit' : 'withdraw') }, svg(dep ? 'arrowDL' : 'arrowUR', 12))),""",
    """h('i', { class: 'tx-flow ' + (dep ? 'deposit' : 'withdraw') }, svg(dep ? 'arrowDL' : 'arrowUR', 12)), botMark(tx)),""")
rep("""tx.bot ? h('span', { class: 'tx-bot' }, tx.bot) : null""", """null""")
rep("""        const extras = [];""", """        const extras = [];
        if (dep && tx.bot) extras.push(h('div', { class: 'cx-row' }, h('small', null, 'Бот'), h('b', null, tx.bot)));""")
# the home list's first load: the brand skeleton
rep("""listBox.dataset.tab = tab; listBox.replaceChildren(skel('list'));""", """listBox.dataset.tab = tab; listBox.replaceChildren(skel('brand'));""")
# «Банк подтвердил» — the bank's notice text for the client
rep("""['text_deposit_success', 'Пополнено', 'textarea']""", """['text_deposit_paid', 'Банк подтвердил (зачисляем)', 'textarea'], ['text_deposit_success', 'Пополнено', 'textarea']""")

# Demir: any mailbox — Gmail / Mail.ru / Yandex / Timeweb; the server follows the address; spam folder read too
rep("""Почта Timeweb, куда приходят письма банка «Входящий QR-перевод», и QR Демир — поступления зачисляются через мгновение после письма.""",
    """Почта (Gmail, Mail.ru, Яндекс или Timeweb), куда приходят письма банка «Входящий QR-перевод», и QR Демир — поступления зачисляются через мгновение после письма.""")
rep("""w.login+(w.host&&w.host!=='imap.timeweb.ru'?' · '+w.host:'')""", """w.login+' · '+(w.provider_name||w.host||'')""")
rep("""        h('div',{class:'dm-trust'},svg('shield',15),trust),""",
    """        h('div',{class:'dm-trust'},svg('shield',15),trust),
        w.spam&&w.spam.on?h('div',{class:'dm-spam'+(w.spam.connected?' on':'')},svg('filter',14),w.spam.connected?('Папка «'+(w.spam.folder||'Спам')+'» тоже читается'+(w.spam.found?' · писем банка оттуда: '+w.spam.found+' — отметьте «Не спам»':'')):('«Спам»: '+(w.spam.error||'подключение…'))):null,""")
rep("""const lines=['✓ Вход в почту за '+(r.ms/1000).toFixed(1)+' сек'+(r.idle?' · мгновенные уведомления (IDLE)':' · без IDLE: проверка каждые 2 сек'),'Писем от банка за 3 дня: '+r.found];""",
    """const lines=['✓ '+(r.provider_name?r.provider_name+': вход':'Вход в почту')+' за '+(r.ms/1000).toFixed(1)+' сек'+(r.idle?' · мгновенные уведомления (IDLE)':' · без IDLE: проверка каждые 2 сек'),'Писем от банка за 3 дня: '+r.found];
      if(r.spam&&r.spam.folder)lines.push(r.spam.found?('⚠ В папке «'+r.spam.folder+'» писем банка: '+r.spam.found+' — панель читает и её, но отметьте их «Не спам»'):('Папка «'+r.spam.folder+'» — писем банка нет (её панель тоже читает)'));""")
rep("""      const isNew=!w; w=w||{name:'Demir основной',host:'imap.timeweb.ru',folder:'INBOX',sender:'info@demirbank.kg',requisite:null};""",
    """      const isNew=!w; w=w||{name:'Demir основной',host:'',folder:'INBOX',sender:'info@demirbank.kg',requisite:null,watch_spam:true};
      const MAILS={gmail:['Gmail','imap.gmail.com','Пароль приложения Google (16 букв)','Gmail пускает только по «паролю приложения»: включите двухэтапную аутентификацию в аккаунте Google → myaccount.google.com/apppasswords → создайте пароль и вставьте сюда.'],
        mailru:['Mail.ru','imap.mail.ru','Пароль для внешних приложений','Mail.ru: Настройки → Безопасность → «Пароли для внешних приложений» → «Добавить» (доступ IMAP) и вставьте этот пароль сюда.'],
        yandex:['Яндекс','imap.yandex.ru','Пароль приложения Яндекса','Яндекс: Почта → Настройки → «Почтовые программы» → разрешите IMAP; id.yandex.ru → Безопасность → «Пароли приложений» → «Почта».'],
        timeweb:['Timeweb','imap.timeweb.ru','Пароль от ящика','Своя почта на Timeweb: логин — полный адрес ящика, пароль — от этого ящика.']};
      const DOMAINS={'gmail.com':'gmail','googlemail.com':'gmail','mail.ru':'mailru','inbox.ru':'mailru','list.ru':'mailru','bk.ru':'mailru','internet.ru':'mailru','yandex.ru':'yandex','ya.ru':'yandex','yandex.com':'yandex','yandex.kz':'yandex','narod.ru':'yandex'};
      const mailOf=(addr,hostV)=>{const hv=(hostV||'').toLowerCase();if(hv){if(/gmail|google/.test(hv))return'gmail';if(/mail\\.ru$/.test(hv))return'mailru';if(/yandex/.test(hv))return'yandex';if(/timeweb/.test(hv))return'timeweb';return'';}const d=(addr||'').toLowerCase().split('@')[1]||'';return DOMAINS[d]||(d?'timeweb':'');};""")
rep("""      const login=h('input',{class:'input',placeholder:'pay@вашдомен.ru',autocapitalize:'none',autocomplete:'off',value:isNew?'':''});
      const pass=h('input',{class:'input',type:'password',autocomplete:'new-password',placeholder:isNew?'Пароль почты Timeweb':'не менять'});
      const host=h('input',{class:'input',value:w.host||'imap.timeweb.ru',autocapitalize:'none'});""",
    """      const login=h('input',{class:'input',type:'email',placeholder:'pay@gmail.com, pay@mail.ru или pay@вашдомен.ru',autocapitalize:'none',autocomplete:'off',value:isNew?'':''});
      const pass=h('input',{class:'input',type:'password',autocomplete:'new-password',placeholder:isNew?'Пароль почты':'не менять'});
      const host=h('input',{class:'input',value:isNew?'':(w.host||''),placeholder:'авто — по адресу почты',autocapitalize:'none'});
      const spamChk=h('input',{type:'checkbox',checked:w.watch_spam!==false});
      const prov=h('div',{class:'dm-prov hidden'});
      const paintProv=()=>{const k=mailOf(login.value.trim()||(isNew?'':w.login||''),host.value.trim()||(isNew?'':w.host));const m=MAILS[k];prov.innerHTML='';prov.classList.toggle('hidden',!m);if(!m)return;prov.appendChild(h('div',{class:'dm-prov-top'},h('b',null,m[0]),h('small',null,host.value.trim()||m[1])));prov.appendChild(h('span',null,m[3]));if(isNew||!pass.value)pass.placeholder=isNew?m[2]:'не менять · '+m[2];};
      login.addEventListener('input',paintProv);host.addEventListener('input',paintProv);""")
rep("""h('div',{class:'stat-grid'},h('label',{class:'field'},h('span',null,'Папка'),folder),h('label',{class:'field'},h('span',null,'Адрес банка'),sender)));""",
    """h('div',{class:'stat-grid'},h('label',{class:'field'},h('span',null,'Папка'),folder),h('label',{class:'field'},h('span',null,'Адрес банка'),sender)),h('label',{class:'dm-check'},spamChk,h('span',null,'Читать и папку «Спам» — вдруг почта убрала туда письмо банка')));""")
rep("""const bodyOf=()=>{const b={name:name.value.trim(),host:host.value.trim(),port:Number(port.value||993),folder:folder.value.trim(),sender:sender.value.trim()};""",
    """const bodyOf=()=>{const b={name:name.value.trim(),host:host.value.trim(),port:Number(port.value||993),folder:folder.value.trim(),sender:sender.value.trim(),watch_spam:!!spamChk.checked};""")
rep("""h('span',null,'Панель держит почту открытой (IMAP IDLE): письмо банка «Вам поступил перевод с помощью QR-платежа на сумму 500.61 KGS от 28.09.2026 12:45:00» читается через мгновение и зачисляет заявку с этой суммой.')""",
    """h('span',null,'Подходит Gmail, Mail.ru, Яндекс или своя почта на Timeweb — сервер определяется по адресу. Панель держит почту открытой (IMAP IDLE): письмо банка «Вам поступил перевод с помощью QR-платежа на сумму 500.61 KGS от 28.09.2026 12:45:00» читается через мгновение и зачисляет заявку с этой суммой.')""")
rep("""h('label',{class:'field'},h('span',null,isNew?'Почта Timeweb (логин)':'Почта: '+w.login+' — новый адрес (или пусто)'),login),""",
    """h('label',{class:'field'},h('span',null,isNew?'Почта (логин)':'Почта: '+w.login+' — новый адрес (или пусто)'),login),prov,""")
rep("""      const result=h('div',{class:'tg-check'});""", """      const result=h('div',{class:'tg-check'});
      setTimeout(paintProv,0);""")

# ================================================================== STAGE 10 (1.13.9.53) — Optima's instant notices
rep("""  const srcLabel = (v) => (v ? (SOURCE[String(v).toLowerCase()] || v) : 'Телеграм');""",
    """  const srcLabel = (v) => { const k = String(v || '').toLowerCase(); if (!k) return 'Телеграм'; if (k.startsWith('optima-push') || k === 'optima_push') return 'Optima · мгновенно'; if (k.startsWith('optima')) return 'Optima · история'; return SOURCE[k] || v; };
  /* OPTIMA_PUSH_1_13_9_53: Optima's live channel on the wallet card */
  const opPush = (w) => { const p = w.push; if (!p || !w.enabled) return null; const on = p.state === 'online'; return h('div', { class: 'op-push' + (on ? ' on' : (p.state === 'error' ? ' bad' : '')) }, svg('bolt', 14), on ? ('Мгновенные уведомления: подключено' + (p.pushes ? ' · платежей ' + p.pushes : '')) : ('Мгновенные уведомления: ' + (p.detail || (p.state === 'off' ? 'нет связи — платежи идут по истории (~20 сек)' : 'подключение…')))); };""")
rep("""h('small',null,(w.account_masked||'счёт определяется')+' · '+(w.status==='online'?'онлайн':(w.status==='connecting'?'подключение…':'ошибка')))),toggle),""",
    """h('small',null,(w.account_masked||'счёт определяется')+' · '+(w.status==='online'?'онлайн':(w.status==='connecting'?'подключение…':'ошибка')))),toggle),
            opPush(w),""")

# ================================================================== STAGE 11 (1.13.9.54) — processing time, premium emoji per bot
rep("""['text_deposit_paid', 'Банк подтвердил (зачисляем)', 'textarea'], ['text_deposit_success', 'Пополнено', 'textarea']""",
    """['text_deposit_paid', 'Банк подтвердил (зачисляем)', 'textarea'], ['text_deposit_success', 'Пополнено', 'textarea'], ['show_processing_time', '«⚡ Время обработки» в «Пополнено» и «Вывод выполнен»', 'bool'], ['text_processing_time', 'Строка времени обработки ({time})']""")
rep("""const rr = await api('/settings/premium-test', { method: 'POST', body: { chat_id: chat.trim() || null } }); if (rr.sent) toast('Отправлено — проверьте чат с ботом', 'ok', 5000); else toast('Telegram отказал: ' + rr.description + (rr.hint ? ' — ' + rr.hint : ''), 'err', 10000);""",
    """const rr = await api('/settings/premium-test', { method: 'POST', body: { chat_id: chat.trim() || null } }); premiumReport(rr);""")
rep("""promptDialog('Проверить premium-эмодзи', 'Ваш Telegram ID (сначала напишите боту /start)'""",
    """promptDialog('Проверить premium-эмодзи', 'Ваш Telegram ID (сначала напишите /start каждому боту: PayGo, Global, Win)'""")
rep("""  async function advancedSettingsView(shell, forcedTab) {""", """  /* PREMIUM_CHECK_1_13_9_54: the answer of every client bot */
  function premiumReport(rr) {
    const items = rr.results || [{ label: 'PayGo', sent: rr.sent, premium: rr.sent, description: rr.description, hint: rr.hint }];
    sheet({ title: 'Premium-эмодзи по ботам', body: h('div', { class: 'pm-report' }, items.map((x) => h('div', { class: 'pm-row ' + (x.premium ? 'ok' : (x.sent ? 'warn' : 'bad')) },
      h('b', null, (x.premium ? '✓ ' : '✕ ') + x.label),
      h('span', null, x.premium ? 'работают — в чате с ботом анимированная рука' : (x.sent ? 'Telegram убрал premium-эмодзи: бот показывает обычные' : 'не отправлено: ' + (x.description || 'ошибка'))),
      x.hint ? h('small', null, x.hint) : null))) });
  }
  async function advancedSettingsView(shell, forcedTab) {""")

# ================================================================== STAGE 12 (1.13.9.55) — «Банк подтвердил» for clients is optional (off)
rep("""['text_deposit_paid', 'Банк подтвердил (зачисляем)', 'textarea'],""", """['notify_client_bank_confirmed', 'Показывать клиенту «Банк подтвердил» до «Пополнено»', 'bool'], ['text_deposit_paid', 'Банк подтвердил (зачисляем)', 'textarea'],""")

# ================================================================== STAGE 13 (1.13.9.56) — chat like Telegram, fresh request card, toasts, empty home
rep("""card: 'M3 6h18v12H3zM3 10h18M7 15h3' };""", """card: 'M3 6h18v12H3zM3 10h18M7 15h3', reply: 'M9 14 4 9l5-5M4 9h10.5A5.5 5.5 0 0 1 20 14.5V20' };""")
rep("""  async function chatThreadView(shell, id) {""", """  /* CHAT_SWIPE_1_13_9_56: a message slides left under the finger (like Telegram) — past the mark it is answered */
  function swipeReply(b, onReply) {
    let s = null;
    b.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { s = null; return; } s = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, lock: null, armed: false }; }, { passive: true });
    b.addEventListener('touchmove', (e) => {
      if (!s) return; const dx = e.touches[0].clientX - s.x0, dy = e.touches[0].clientY - s.y0;
      if (s.lock === null) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; s.lock = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'; if (s.lock === 'x') { b.classList.add('swiping'); b.style.transition = 'none'; } }
      if (s.lock !== 'x') return; if (e.cancelable) e.preventDefault();
      s.dx = Math.max(-96, Math.min(0, dx)); const p = Math.min(1, -s.dx / 64);
      b.style.transform = 'translateX(' + s.dx + 'px)'; b.style.setProperty('--rp', p.toFixed(3));
      if (p >= 1 && !s.armed) { s.armed = true; buzz(10); } else if (p < 1) s.armed = false;
    }, { passive: false });
    const end = () => { if (!s) return; const fire = s.lock === 'x' && s.armed; s = null; b.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1)'; b.style.transform = ''; b.style.removeProperty('--rp'); setTimeout(() => { b.classList.remove('swiping'); b.style.transition = ''; }, 300); if (fire) onReply(); };
    b.addEventListener('touchend', end); b.addEventListener('touchcancel', end);
  }
  /* a small menu right at the message (instead of the bottom sheet) */
  function bubbleMenu(node, items) {
    const list = items.filter(Boolean); if (!list.length) return;
    const back = h('div', { class: 'bm-back' }); const menu = h('div', { class: 'bm-menu' }, list.map((it) => h('button', { class: 'bm-item ' + (it.cls || ''), type: 'button', onclick: (e) => { e.stopPropagation(); close(); it.onclick(); } }, svg(it.icon, 18), h('span', null, it.label))));
    const close = () => { back.remove(); node.classList.remove('picked'); menu.classList.add('closing'); setTimeout(() => menu.remove(), 140); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    back.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
    document.body.appendChild(back); document.body.appendChild(menu); document.addEventListener('keydown', onKey); node.classList.add('picked'); buzz(8);
    const r = node.getBoundingClientRect(); const mh = menu.offsetHeight, mw = menu.offsetWidth; const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    let top = r.bottom + 8; if (top + mh > vh - 12) top = Math.max(12, r.top - mh - 8);
    let left = node.classList.contains('out') ? r.right - mw : r.left; left = Math.max(12, Math.min(left, window.innerWidth - mw - 12));
    menu.style.top = top + 'px'; menu.style.left = left + 'px'; menu.style.transformOrigin = (node.classList.contains('out') ? 'right ' : 'left ') + (top > r.top ? 'top' : 'bottom');
  }
  /* CHAT_CASE_1_13_9_56: the client's freshest request on top of the chat — compact, live, can be tucked away */
  function caseCard(screen, c, ctx) {
    const box = h('div', { class: 'case2-box' }); const key = 'case-hide-' + c.id; let sig = '';
    const paint = (cx) => {
      const kind = cx.latest || (cx.deposit ? 'deposit' : (cx.withdrawal ? 'withdrawal' : '')); const t = kind === 'withdrawal' ? cx.withdrawal : (kind === 'deposit' ? cx.deposit : null);
      const s = t ? [kind, t.id, t.status, t.status_label, t.error].join('|') : ''; if (s === sig) return; sig = s; box.innerHTML = ''; if (!t) return;
      const dep = kind === 'deposit'; let hidden = false; try { hidden = sessionStorage.getItem(key) === s; } catch (e) {}
      const title = (dep ? 'Пополнение ' : 'Вывод ') + money0(t.amount) + ' ' + curSign(t.currency);
      if (hidden) { box.appendChild(h('button', { class: 'case2-mini ' + (dep ? 'dep' : 'wd'), type: 'button', onclick: () => { try { sessionStorage.removeItem(key); } catch (e) {} sig = ''; paint(cx); } }, svg(dep ? 'arrowDL' : 'arrowUR', 13), title)); return; }
      const a = ago(t.created_at); const when = a ? (a === 'только что' ? a : a + ' назад') : '';
      box.appendChild(h('div', { class: 'case2 ' + (dep ? 'dep' : 'wd'), role: 'button', tabindex: '0', onclick: () => go('#/' + (dep ? 'deposit' : 'withdrawal') + '/' + t.id) },
        h('span', { class: 'case2-ico' }, svg(dep ? 'arrowDL' : 'arrowUR', 17)),
        h('div', { class: 'case2-main' }, h('div', { class: 'case2-top' }, h('b', null, title), statusEl(t.status, t.status_label)), h('small', null, [t.cash, t.player_id ? 'ID ' + t.player_id : '', when].filter(Boolean).join(' · ')), t.error && t.status !== 'success' ? h('small', { class: 'case2-err' }, reasonText(t.error)) : null),
        h('button', { class: 'case2-x', type: 'button', 'aria-label': 'Скрыть', onclick: (e) => { e.stopPropagation(); try { sessionStorage.setItem(key, s); } catch (er) {} sig = ''; paint(cx); } }, svg('close', 14))));
    };
    paint(ctx || {}); screen.appendChild(box);
    const tick = async () => { if (!box.isConnected) return; if (!document.hidden) { try { const r = await api('/support/conversations/' + c.id + '/case'); paint(r.context || {}); } catch (_) {} } setTimeout(tick, 6000); };
    setTimeout(tick, 4000);
  }
  /* EMPTY_HOME_1_13_9_56: nobody pays right now — a sad man watches his money fly away */
  const IDLE_SVG = '<svg viewBox="0 0 240 170" xmlns="http://www.w3.org/2000/svg"><path class="i-trend" d="M22 40l20 12 14-7 22 24"/><path class="i-trend" d="M70 69h9v-9"/><ellipse class="i-shadow" cx="114" cy="157" rx="66" ry="6"/><rect class="i-seat" x="80" y="116" width="46" height="7" rx="3.5"/><path class="i-leg" d="M88 123l-2 31M118 123l2 31"/><path class="i-pants" d="M92 104h44a7 7 0 0 1 0 14H92z"/><path class="i-pants" d="M130 112h12v36h-12z"/><ellipse class="i-shoe" cx="141" cy="151" rx="10" ry="4"/><g class="i-upper"><path class="i-shirt" d="M90 110c-3-15-1-29 8-39l15 2c6 10 7 24 4 37z"/><path class="i-arm" d="M106 80c7 10 13 13 21 12"/><g class="i-phone-g"><rect class="i-phone" x="123" y="82" width="10" height="16" rx="2.2"/><rect class="i-screen" x="124.6" y="84" width="6.8" height="11.5" rx="1.2"/></g><circle class="i-skin" cx="125" cy="93.5" r="3.4"/><circle class="i-skin" cx="110" cy="57" r="13"/><path class="i-hair" d="M97 55c0-9 7-15 15-14 6 1 10 4 11 9-6-2-12-1-17 3-3 2-6 4-9 2z"/><path class="i-face" d="M113 56q2 1.4 4 0"/><path class="i-face" d="M111 51l5-1.2"/><path class="i-face" d="M113 64q2.6-2.2 5.2 0"/><path class="i-drop" d="M100 44c-2 3-3 4.5-3 6a3 3 0 0 0 6 0c0-1.5-1-3-3-6z"/></g><g class="i-fly" style="--dx:62px;--dy:-78px;--r:38deg;animation-delay:0s"><rect class="i-bill" x="128" y="78" width="17" height="10" rx="2"/><circle class="i-bill-c" cx="136.5" cy="83" r="2.4"/></g><g class="i-fly" style="--dx:88px;--dy:-52px;--r:-28deg;animation-delay:1.1s"><rect class="i-bill" x="128" y="78" width="17" height="10" rx="2"/><circle class="i-bill-c" cx="136.5" cy="83" r="2.4"/></g><g class="i-fly" style="--dx:40px;--dy:-96px;--r:60deg;animation-delay:2.2s"><rect class="i-bill" x="128" y="78" width="17" height="10" rx="2"/><circle class="i-bill-c" cx="136.5" cy="83" r="2.4"/></g><g class="i-fly coin" style="--dx:76px;--dy:-30px;--r:180deg;animation-delay:.6s"><circle class="i-coin" cx="132" cy="86" r="5"/><circle class="i-coin-c" cx="132" cy="86" r="2.6"/></g><g class="i-fly coin" style="--dx:96px;--dy:-84px;--r:-200deg;animation-delay:1.7s"><circle class="i-coin" cx="132" cy="86" r="5"/><circle class="i-coin-c" cx="132" cy="86" r="2.6"/></g></svg>';
  function idleEmpty() { const art = h('div', { class: 'idle-art', 'aria-hidden': 'true' }); art.innerHTML = IDLE_SVG; return h('div', { class: 'empty idle-empty' }, art, h('b', null, 'Актуальных заявок нет'), h('span', null, 'Как только клиент создаст заявку, она появится здесь')); }
  async function chatThreadView(shell, id) {""")
rep("""      if (!m.deleted_at) holdMenu(b, () => messageMenu(m, mine, b));
      return b;""", """      if (!m.deleted_at) holdMenu(b, () => messageMenu(m, mine, b));
      if (!m.deleted_at && m.sender !== 'system' && can('support')) {
        b.appendChild(h('button', { class: 'rp-btn', type: 'button', 'aria-label': 'Ответить', onclick: (e) => { e.stopPropagation(); if (composer) composer.reply(m); } }, svg('reply', 15)));
        swipeReply(b, () => { if (composer) composer.reply(m); });
        if (mine) b.addEventListener('click', (e) => { if (e.target.closest('img,a,audio,video,.quote,button')) return; const sel = window.getSelection && String(window.getSelection()); if (sel) return; messageMenu(m, mine, b); });
      }
      return b;""")
rep("""      actionSheet('Сообщение', [
        { label: 'Ответить', icon: 'send', onclick: () => composer.reply(m) },""", """      bubbleMenu(node, [
        { label: 'Ответить', icon: 'reply', onclick: () => composer.reply(m) },
        m.text ? { label: 'Копировать', icon: 'copy', onclick: () => copy(m.text) } : null,""")
rep("""if (ctx.deposit || ctx.withdrawal) { const t = ctx.withdrawal && c.category !== 'deposit' ? ctx.withdrawal : ctx.deposit; const dep = t === ctx.deposit; screen.appendChild(h('button', { class: 'case-card', onclick: () => go('#/' + (dep ? 'deposit' : 'withdrawal') + '/' + t.id) }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('b', null, (dep ? 'Пополнение # ' : 'Вывод # ') + String(t.public_id || t.id).replace(/^[DW]-/, '')), h('span', { style: { flex: 1 } }), (t._st = statusEl(t.status, t.status_label))), h('small', null, t.cash + ' • ID ' + t.player_id + ' • ' + money(t.amount) + ' ' + curSign(t.currency) + ' • ' + fmtDate(t.created_at)), t.error ? h('small', { style: { color: 'var(--red)' } }, reasonText(t.error)) : null)); } if (ctx.deposit || ctx.withdrawal) { const lt = ctx.withdrawal && c.category !== 'deposit' ? ctx.withdrawal : ctx.deposit; caseLive(screen, lt, lt === ctx.deposit); }""", """caseCard(screen, c, ctx);""")
rep("""if (!items.length) fresh.appendChild(empty(tab==='deferred'?'Отложенных нет':'Актуальных заявок нет','','home'));""",
    """if (!items.length) fresh.appendChild(tab==='deferred'?empty('Отложенных нет','','home'):idleEmpty());""")

# ================================================================== STAGE 14 (1.13.9.57) — «Сверка 1WIN», guarded credit confirmations
rep("""const MENU = [['stats', 'stats', 'Аналитика', 'blue', 'view'], """, """const MENU = [['audit', 'shield', 'Сверка 1WIN', 'red', 'cashes'], ['stats', 'stats', 'Аналитика', 'blue', 'view'], """)
rep("""statements: statementsView, deposit:""", """statements: statementsView, audit: auditView, deposit:""")
rep("""      const text = String(ex.message || '') + ' — Подтвердите: вы проверили историю кассы и этого зачисления там НЕТ. Отправить деньги ещё раз?';
      if (!(await confirmDialog(text, 'Зачисления нет — отправить', true))) { const c = new Error('Отменено: сначала проверьте историю кассы'); c.cancelled = true; throw c; }""",
"""      /* CREDIT_SHIELD_1_13_9_57: a hold of the shield (another request's payment, paid less, a burst to one ID…) */
      const shield = /^(PAYMENT_LINKED_ELSEWHERE|PAYMENT_BEFORE_REQUEST|PAYMENT_TOO_SMALL|PLAYER_VELOCITY|CREDITS_PAUSED|NO_BANK_PAYMENT)$/.test(String(ex.data.code || ''));
      const text = String(ex.message || '') + (shield ? ' — Подтвердите: вы проверили платёж в банке и зачисляете эту сумму осознанно.' : ' — Подтвердите: вы проверили историю кассы и этого зачисления там НЕТ. Отправить деньги ещё раз?');
      if (!(await confirmDialog(text, shield ? 'Проверено — зачислить' : 'Зачисления нет — отправить', true))) { const c = new Error(shield ? 'Отменено: сначала проверьте платёж в банке' : 'Отменено: сначала проверьте историю кассы'); c.cancelled = true; throw c; }""")
rep("""  async function statementsView(shell) {""", """  /* ONEWIN_AUDIT_1_13_9_57 — «Сверка 1WIN»: every desk operation (1win.win/history) against PayGo's credits and the bank */
  async function auditView(shell) {
    const box = page(shell, 'Сверка 1WIN');
    const st = { hours: 24, from: '', to: '', label: '24 часа' };
    try { const saved = JSON.parse(localStorage.getItem('audit-period') || 'null'); if (saved && saved.hours) Object.assign(st, saved); } catch (e) {}
    const cur = (c) => ' ' + curSign(c || 'KGS');
    const FLAGS = [
      ['foreign', 'red', 'Не из PayGo', 'Пополнение в 1WIN, которого PayGo не делал: кабинет 1win, чужой ключ или другой сервис'],
      ['double', 'red', 'Двойное зачисление в 1WIN', 'Одна заявка PayGo — две операции в кассе'],
      ['rejected_credited', 'red', 'Ошибка, но зачислено', 'Касса ответила ошибкой, но деньги ушли игроку'],
      ['multi_credit', 'red', 'Несколько зачислений', 'Одна заявка или один банковский платёж зачислены больше одного раза'],
      ['underpaid', 'amber', 'Оплачено меньше', 'Банк получил меньше, чем зачислено игроку'],
      ['no_bank', 'amber', 'Без банковского платежа', 'Зачислено оператором вручную — проверьте, что деньги пришли в банк'],
      ['unknown', 'amber', 'Неясные попытки', 'Касса не ответила однозначно — здесь видно, есть ли операция в 1WIN'],
      ['missing', 'blue', 'Нет в истории 1WIN', 'PayGo записал зачисление, а в истории кассы его нет'],
      ['foreign_withdrawals', 'blue', 'Выводы не через PayGo', 'Вывод в кассу без заявки PayGo'],
    ];
    const pick = () => {
      const from = h('input', { class: 'input', type: 'date', value: st.from }); const to = h('input', { class: 'input', type: 'date', value: st.to });
      const quick = (hours, label) => h('button', { class: 'action-btn' + (st.hours === hours && !st.from ? ' primary' : ''), type: 'button', onclick: () => { Object.assign(st, { hours, from: '', to: '', label }); s.close(); draw(); } }, label);
      const s = sheet({ title: 'Период сверки', body: h('div', null, h('div', { class: 'btn-grid' }, quick(3, '3 часа'), quick(12, '12 часов'), quick(24, '24 часа'), quick(72, '3 дня'), quick(168, '7 дней'), quick(720, '30 дней')), h('span', { class: 'lbl' }, 'Свой период'), h('div', { class: 'date-grid' }, from, to)),
        actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: () => { if (!from.value) return toast('Укажите начало', 'err'); Object.assign(st, { from: from.value, to: to.value, label: from.value + ' — ' + (to.value || 'сейчас') }); s.close(); draw(); } }, 'Применить')] });
    };
    const opRow = (x, color) => {
      const head = 'ID ' + (x.player_id || '—') + ' · ' + money(x.amount) + cur(x.currency);
      const bits = [x.at_local, x.request ? 'заявка ' + x.request : '', x.source ? (x.source + (x.actor ? ' / ' + x.actor : '')) : '', x.bank ? 'банк ' + money(x.bank) + cur(x.currency) + (x.bank_at ? ' в ' + x.bank_at : '') : '', x.op_id ? '1win #' + x.op_id : '', x.twin_request ? 'рядом ' + x.twin_request : '', x.desk || '', x.note || '', x.count ? x.count + ' зачисл. · ' + (x.why || '') : '', x.status && x.status !== 'выполнено' ? x.status : ''].filter(Boolean);
      const open = x.deposit_id ? () => go('#/deposit/' + x.deposit_id) : null;
      return h(open ? 'button' : 'div', { class: 'row-card audit-row', type: open ? 'button' : null, onclick: open }, h('span', { class: 'dot ' + color }), h('div', null, h('b', null, head), h('small', { class: 'audit-wrap' }, bits.join(' · '))), open ? svg('chevron', 18) : null);
    };
    const guardCard = (g) => {
      const card = h('div', { class: 'card section-card audit-guard' + (g.credit_hold_all ? ' paused' : '') }, h('h2', null, 'Защита зачислений'));
      const row = (title, sub, on, key, danger) => h('div', { class: 'setting-row' }, h('div', null, h('b', null, title), h('small', null, sub)), switchEl(on, async (v) => {
        if (danger && v && !(await confirmDialog('Все автоматические зачисления будут ждать подтверждения оператора. Включить паузу?', 'Включить паузу', true))) throw new Error('__cancel__');
        const r = await api('/onewin-audit/guard', { method: 'POST', body: { [key]: v } }); toast(v ? 'Включено' : 'Выключено', 'ok'); card.classList.toggle('paused', !!r.guard.credit_hold_all);
      }));
      card.appendChild(row('Пауза автозачислений', 'Каждое зачисление подтверждает оператор (банк проверен вручную)', g.credit_hold_all, 'credit_hold_all', true));
      card.appendChild(row('Автопауза при чужой операции', 'Сторож нашёл пополнение не из PayGo → автозачисления на паузу', g.autopause, 'autopause'));
      card.appendChild(row('Сторож 1WIN', 'Сверка каждые 5 минут, тревога операторам в Telegram', g.watchdog, 'watchdog'));
      const last = g.last || null;
      card.appendChild(h('small', { class: 'muted audit-note' }, 'Всегда включено: один платёж — одно зачисление; платёж другой заявки, платёж раньше заявки и оплата меньше суммы не зачисляются; больше ' + (g.velocity_max || 3) + ' зачислений на один ID за ' + (g.velocity_minutes || 10) + ' мин ждут оператора; без платежа банка автозачисления нет.' + (last ? ' Последняя проверка сторожа: ' + fmtDate(last.at) + (Number(last.critical) ? ' — найдено: ' + last.critical : ' — чисто') + '.' : '')));
      return card;
    };
    const draw = async () => {
      try { localStorage.setItem('audit-period', JSON.stringify({ hours: st.hours, from: st.from, to: st.to, label: st.label })); } catch (e) {}
      box.innerHTML = '';
      const periodBtn = h('button', { class: 'period-btn', type: 'button', onclick: pick }, svg('calendar', 24), st.label);
      box.appendChild(periodBtn); box.appendChild(loader(3));
      let r;
      try {
        const qs = st.from ? '?date_from=' + st.from + 'T00:00:00' + (st.to ? '&date_to=' + st.to + 'T23:59:59' : '') : '?hours=' + st.hours;
        r = await api('/onewin-audit' + qs);
      } catch (ex) { box.innerHTML = ''; box.appendChild(periodBtn); box.appendChild(empty('Сверка не выполнена', ex.message, 'alert')); return; }
      box.innerHTML = ''; box.appendChild(periodBtn);
      if (r.guard) box.appendChild(guardCard(r.guard));
      if (!r.ok) { box.appendChild(empty('Сверка не выполнена', r.error || 'Нет ответа 1WIN', 'alert')); return; }
      if (r.warning) box.appendChild(h('div', { class: 'card audit-warn' }, svg('alert', 18), h('span', null, r.warning)));
      const t = r.totals || {};
      const chip = (v, l, cls) => h('div', { class: 'card stat-card ' + (cls || '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
      box.appendChild(h('div', { class: 'stat-grid audit-grid' },
        chip('−' + money0(t.desk_deposits) + cur(), 'Пополнения игрокам в 1WIN · ' + (t.desk_deposits_count || 0), 'red'),
        chip('+' + money0(t.desk_withdrawals) + cur(), 'Выводы в кассу · ' + (t.desk_withdrawals_count || 0), 'green'),
        chip(money0(t.paygo_credited) + cur(), 'Зачислено PayGo · ' + (t.paygo_credited_count || 0), 'blue'),
        chip(money0(t.bank_credited) + cur(), 'Получено банком по заявкам · ' + (t.bank_credited_count || 0), 'green'),
        chip((r.cash && r.cash.limit !== null && r.cash.limit !== undefined) ? money0(r.cash.limit) + cur() : '—', 'Касса 1WIN сейчас'),
        chip((Number(t.desk_net) > 0 ? '+' : '') + money0(t.desk_net) + cur(), 'Итог кассы за период', Number(t.desk_net) < 0 ? 'red' : 'green')));
      const explain = 'Касса 1WIN уменьшается на каждое пополнение игроку и растёт на каждый вывод. За период: −' + money(t.desk_deposits) + ' пополнений, +' + money(t.desk_withdrawals) + ' выводов' + (Number(t.refills) ? ', +' + money(t.refills) + ' пополнений кассы из панели' : '') + '. Из ' + (t.desk_deposits_count || 0) + ' пополнений ' + (t.matched || 0) + ' совпали с заявками PayGo (' + money(t.matched_amount) + '). PayGo зачислил по банку ' + money(t.paygo_with_bank) + ', вручную ' + money(t.paygo_manual) + '.';
      box.appendChild(h('div', { class: 'card audit-explain' }, h('small', null, explain)));
      const flags = r.flags || {};
      if (!Number(r.critical)) box.appendChild(h('div', { class: 'card audit-ok' }, svg('check', 20), h('div', null, h('b', null, 'Чужих и двойных операций нет'), h('small', null, 'Каждое пополнение в 1WIN за период сделано PayGo'))));
      FLAGS.forEach(([key, color, title, sub]) => {
        const rows = flags[key] || []; if (!rows.length) return;
        const total = rows.reduce((a, x) => a + Number(x.amount || 0), 0);
        const card = h('div', { class: 'card section-card audit-flag ' + color }, h('div', { class: 'audit-head' }, h('h2', null, title + ' · ' + rows.length), h('b', { class: 'audit-sum' }, money(total) + cur())), h('small', { class: 'muted audit-sub' }, sub));
        rows.slice(0, 60).forEach((x) => card.appendChild(opRow(x, color)));
        if (rows.length > 60) card.appendChild(h('small', { class: 'muted' }, 'и ещё ' + (rows.length - 60)));
        box.appendChild(card);
      });
      const matched = r.matched || [];
      if (matched.length) {
        const list = h('div', { class: 'audit-list', hidden: true });
        const toggle = h('button', { class: 'action-btn', type: 'button', onclick: () => { list.hidden = !list.hidden; if (!list.childNodes.length) matched.forEach((x) => list.appendChild(opRow(x, x.bank ? 'green' : 'amber'))); toggle.textContent = uiText((list.hidden ? 'Показать' : 'Скрыть') + ' совпавшие операции (' + matched.length + ')'); } }, 'Показать совпавшие операции (' + matched.length + ')');
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Совпали с заявками'), toggle, list));
      }
      box.appendChild(h('small', { class: 'muted audit-foot' }, 'Время 1WIN: ' + (r.tz === 'local' ? 'Бишкек' : 'UTC') + ' · ' + (r.period ? r.period.from_local + ' — ' + r.period.to_local : '') + ' · данные из 1win.win/history'));
    };
    draw();
  }
  async function statementsView(shell) {""")

# ================================================================== STAGE 15 (1.13.9.58) — the auto support is removed; one transfer reported twice
rep("          /* умный ответчик: видно сразу, отвечает ли клиентам ИИ или только правила бота */\n          if (ai) box.appendChild(sect('bolt', 'Умный ответчик клиентам',\n            h('div', { class: 'toggle-pill' }, h('div', null, ai.enabled ? 'Отвечает ИИ' : 'Отвечают правила бота', h('small', null, ai.enabled ? 'Модель ' + ai.model : (ai.has_key ? 'Выключен в расширенных настройках → Поддержка' : 'Ключ ANTHROPIC_API_KEY не задан в .env'))), h('span', { class: 'status ' + (ai.enabled ? 'success' : 'pending') }, h('i'), ai.enabled ? 'вкл' : 'выкл')),\n            ai.hint ? h('div', { class: 'hint-card warn' }, ai.hint) : null,\n            h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn blue', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { const t = await api('/support/assistant/test', { method: 'POST' }); toast(t.message, t.ok ? 'ok' : 'err', 7000); } catch (ex) { err(ex); } busy(b, false); } }, svg('bolt', 16), 'Проверить связь'))));\n", "          /* AUTO_SUPPORT_REMOVED_1_13_9_58: the support never moves money; clients are answered by operators */\n          box.appendChild(sect('shield', 'Поддержка', h('div', { class: 'toggle-pill' }, h('div', null, 'Автоподдержка удалена', h('small', null, 'Поддержка не зачисляет деньги и не ищет платежи — чеки, ID и «оплатил, не пришло» сразу у оператора')), h('span', { class: 'status success' }, h('i'), 'защита'))));\n")
rep("['Автоответчик', [['support_ai_enabled', 'ИИ-ответы (выключено — клиентам отвечает автоматическая система)', 'bool']]], ", "")
rep("      ['multi_credit', 'red', 'Несколько зачислений', 'Одна заявка или один банковский платёж зачислены больше одного раза'],", "      ['multi_credit', 'red', 'Несколько зачислений', 'Одна заявка или один банковский платёж зачислены больше одного раза'],\n      ['same_payment', 'red', 'Один перевод — две заявки?', 'Две заявки оплачены уведомлениями банка на одну и ту же сумму с разницей до 10 минут — проверьте в выписке, что переводов было два'],\n      ['repeat', 'amber', 'Повтор на один ID', 'Одна и та же сумма одному игроку дважды за 10 минут — у каждой свой платёж банка'],")

# ================================================================== STAGE 16 (1.13.9.59) — «Расходы»: a button above the bottom bar, two-tap entry, Optima balance history
rep("""reply: 'M9 14 4 9l5-5M4 9h10.5A5.5 5.5 0 0 1 20 14.5V20' };""", """reply: 'M9 14 4 9l5-5M4 9h10.5A5.5 5.5 0 0 1 20 14.5V20', receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6M9 16h3' };""")
rep("""const MENU = [['audit', 'shield', 'Сверка 1WIN', 'red', 'cashes'], """, """const MENU = [['audit', 'shield', 'Сверка 1WIN', 'red', 'cashes'], ['expenses', 'receipt', 'Расходы', 'yellow', 'cashes'], """)
rep("""statements: statementsView, audit: auditView, deposit:""", """statements: statementsView, audit: auditView, expenses: expensesView, deposit:""")
rep("""    screen.appendChild(top); screen.appendChild(oneWinBox); screen.appendChild(alarmsBox); screen.appendChild(listBox); oneWinBox.appendChild(skel('balance'));""",
    """    screen.appendChild(top); screen.appendChild(oneWinBox); screen.appendChild(alarmsBox); screen.appendChild(listBox); oneWinBox.appendChild(skel('balance'));
    if (can('cashes')) { screen.classList.add('has-fab'); expFab(); }""")
rep("""  async function statementsView(shell) {""", r"""  /* EXPENSES_1_13_9_59 — «Расходы»: a small button above the bottom bar of the home screen; a spend is written in
     two taps (sum → за что → Записать) and the Optima Business balance writes its own history (drops, «мало»). */
  const EXP_CATS = ['Зарплата', 'Реклама', 'Связь и SIM', 'Сервисы', 'Комиссии', 'Прочее'];
  const EXP_ICON = { 'Зарплата': 'users', 'Реклама': 'send', 'Связь и SIM': 'phone', 'Сервисы': 'layers', 'Комиссии': 'bank', 'Прочее': 'receipt' };
  const expIcon = (c) => EXP_ICON[c] || 'receipt';
  const expCur = () => ' ' + curSign('KGS');
  let EXP_META = null;
  async function expMeta(force) { if (EXP_META && !force) return EXP_META; try { EXP_META = await api('/expenses?period=today'); } catch (e) { EXP_META = EXP_META || { suggestions: [], categories: EXP_CATS, totals: {} }; } return EXP_META; }
  function countUp(el, to, fmt) { const from = Number(el.dataset.v || 0); el.dataset.v = String(to); if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = uiText(fmt(to)); return; } const t0 = performance.now(); const step = (t) => { const k = Math.min(1, (t - t0) / 560); const e = 1 - Math.pow(1 - k, 3); el.textContent = uiText(fmt(from + (to - from) * e)); if (k < 1 && el.isConnected) requestAnimationFrame(step); }; requestAnimationFrame(step); }
  function expFab() {
    const old = document.getElementById('exp-fab'); if (old) old.remove();
    const b = h('button', { id: 'exp-fab', class: 'exp-fab', type: 'button', 'aria-label': 'Записать расход', title: 'Расходы', onclick: () => expenseQuick() }, h('span', { class: 'exp-fab-ico' }, svg('receipt', 22)), h('span', { class: 'exp-fab-ok' }, svg('check', 22)));
    document.body.appendChild(b);
    let lastY = window.scrollY, idle = null;
    const onScroll = () => {
      if (!b.isConnected) { window.removeEventListener('scroll', onScroll); return; }
      const y = window.scrollY; if (y > lastY + 6 && y > 60) b.classList.add('tuck'); else if (y < lastY - 6) b.classList.remove('tuck');
      lastY = y; clearTimeout(idle); idle = setTimeout(() => b.classList.remove('tuck'), 1100);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    expMeta();
    return b;
  }
  window.addEventListener('hashchange', () => { if (parseHash().page !== 'home') { const f = document.getElementById('exp-fab'); if (f) f.remove(); } });
  function expenseQuick(pre) {
    pre = pre || {};
    const meta = EXP_META || { suggestions: [], categories: EXP_CATS };
    const st = { cat: pre.category || '' };
    const amount = h('input', { class: 'exp-amount-in', type: 'text', inputmode: 'decimal', enterkeyhint: 'next', placeholder: '0', autocomplete: 'off', 'aria-label': 'Сумма', value: pre.amount ? String(Number(pre.amount)) : '' });
    const sum = h('label', { class: 'exp-amount' }, amount, h('span', { class: 'exp-cur' }, curSign('KGS')));
    const title = h('input', { class: 'input exp-title-in', type: 'text', enterkeyhint: 'done', placeholder: 'За что', maxlength: 160, autocomplete: 'off', 'aria-label': 'За что', value: pre.title || '' });
    const catRow = h('div', { class: 'exp-chips', 'data-hscroll': '' });
    const drawCats = () => { catRow.innerHTML = ''; (meta.categories || EXP_CATS).forEach((c) => catRow.appendChild(h('button', { class: 'exp-chip' + (st.cat === c ? ' on' : ''), type: 'button', onclick: () => { st.cat = st.cat === c ? '' : c; drawCats(); buzz(6); } }, svg(expIcon(c), 15), c))); };
    drawCats();
    const sugg = pre.id ? [] : (meta.suggestions || []).slice(0, 6);
    const suggRow = sugg.length ? h('div', { class: 'exp-sugg', 'data-hscroll': '' }, sugg.map((x) => h('button', { class: 'exp-sugg-btn', type: 'button', onclick: () => { title.value = x.title; if (x.category) { st.cat = x.category; drawCats(); } title.classList.remove('flash'); void title.offsetWidth; title.classList.add('flash'); if (!amount.value) amount.focus(); } }, x.title))) : null;
    const save = h('button', { class: 'primary-btn exp-save', type: 'button' }, svg('check', 18), pre.id ? 'Сохранить' : 'Записать');
    const all = pre.id || pre.balance_log_id ? null : h('button', { class: 'exp-all', type: 'button', onclick: () => { s.close(); go('#/expenses'); } }, 'Все расходы', svg('chevron', 14));
    const from = pre.balance_log_id ? h('div', { class: 'exp-from' }, svg('bank', 15), 'Списание с Optima' + (pre.when ? ' · ' + pre.when : '')) : null;
    const s = sheet({ form: true, title: pre.id ? 'Изменить расход' : (pre.balance_log_id ? 'Списание в расходы' : 'Новый расход'), body: h('div', { class: 'exp-quick' }, from, sum, title, suggRow, catRow, save, all) });
    const shake = (el) => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); buzz(14); };
    const submit = async () => {
      const v = amount.value.replace(/\s/g, '').replace(',', '.');
      if (!(Number(v) > 0)) { shake(sum); amount.focus(); return; }
      if (!title.value.trim()) { shake(title); title.focus(); return; }
      busy(save, true);
      try {
        const body = { amount: v, title: title.value.trim(), category: st.cat };
        if (pre.balance_log_id) body.balance_log_id = pre.balance_log_id;
        const r = await api(pre.id ? '/expenses/' + pre.id : '/expenses', { method: pre.id ? 'PATCH' : 'POST', body });
        s.close(); buzz(12);
        toast((pre.id ? 'Сохранено: ' : 'Записано: ') + money0(r.item.amount) + expCur() + ' — ' + r.item.title, 'ok', 2200);
        const fab = document.getElementById('exp-fab'); if (fab) { fab.classList.remove('done'); void fab.offsetWidth; fab.classList.add('done'); setTimeout(() => fab.classList.remove('done'), 1500); }
        expMeta(true); if (pre.onSaved) pre.onSaved(r.item);
      } catch (ex) { err(ex); busy(save, false); }
    };
    save.onclick = submit;
    amount.addEventListener('input', () => { const c = amount.value.replace(/[^\d.,\s]/g, ''); if (c !== amount.value) amount.value = c; sum.classList.toggle('filled', !!c); });
    amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.focus(); } });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    sum.classList.toggle('filled', !!amount.value);
    const first = amount.value ? title : amount; try { first.focus({ preventScroll: true }); } catch (e) {} requestAnimationFrame(() => { if (document.activeElement !== first) first.focus(); });
    if (!EXP_META && !pre.id) expMeta().then((m) => { if (!s.el.isConnected || suggRow) return; const list = (m.suggestions || []).slice(0, 6); if (!list.length) return; const row = h('div', { class: 'exp-sugg in', 'data-hscroll': '' }, list.map((x) => h('button', { class: 'exp-sugg-btn', type: 'button', onclick: () => { title.value = x.title; if (x.category) { st.cat = x.category; drawCats(); } } }, x.title))); title.after(row); });
  }
  async function expensesView(shell) {
    const tab = state.route.id === 'optima' ? 'optima' : 'list';
    const addBtn = h('button', { class: 'icon-btn exp-add-top', 'aria-label': 'Записать расход', onclick: () => expenseQuick({ onSaved: () => draw() }) }, svg('plus', 24));
    const box = page(shell, 'Расходы', { right: addBtn });
    const st = { period: 'month', days: 7, onlyDown: false };
    try { const sv = JSON.parse(localStorage.getItem('exp-view') || 'null'); if (sv) Object.assign(st, sv); } catch (e) {}
    const keep = () => { try { localStorage.setItem('exp-view', JSON.stringify(st)); } catch (e) {} };
    const tabs = segEl([['list', 'Записи'], ['optima', 'Баланс Optima']], tab, (k) => go(k === 'optima' ? '#/expenses/optima' : '#/expenses'), 'exp-tabs');
    const content = h('div', { class: 'exp-content' });
    box.innerHTML = ''; box.appendChild(tabs); box.appendChild(content); content.appendChild(loader(3));
    const dayName = (d) => { const k = dayKey(d); const t = dayKey(new Date()); const y = dayKey(new Date(Date.now() - 86400000)); return k === t ? 'Сегодня' : (k === y ? 'Вчера' : new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })); };
    const hm = (d) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const rowMenu = (it) => actionSheet(it.title, [
      { label: 'Изменить', icon: 'edit', onclick: () => expenseQuick({ id: it.id, amount: it.amount, title: it.title, category: it.category, onSaved: () => draw() }) },
      { label: 'Удалить', icon: 'trash', cls: 'danger', onclick: async () => { if (!(await confirmDialog('Удалить расход «' + it.title + '» на ' + money0(it.amount) + expCur() + '?', 'Удалить', true))) return; try { await api('/expenses/' + it.id, { method: 'DELETE' }); toast('Удалено', 'ok'); draw(); } catch (ex) { err(ex); } } },
    ]);
    const drawList = async () => {
      const r = await api('/expenses?period=' + st.period);
      if (!box.isConnected) return;
      content.innerHTML = '';
      const t = r.totals || {}; const cur = (t[st.period] || {});
      content.appendChild(segEl([['today', 'Сегодня'], ['week', '7 дней'], ['month', '30 дней'], ['all', 'Всё']], st.period, (k) => { st.period = k; keep(); draw(); }, 'exp-period'));
      const big = h('b', { class: 'exp-total-v' }, '0');
      content.appendChild(h('div', { class: 'card exp-hero' }, h('small', null, { today: 'Потрачено сегодня', week: 'Потрачено за 7 дней', month: 'Потрачено за 30 дней', all: 'Потрачено всего' }[st.period]), big, h('span', { class: 'exp-hero-n' }, (cur.count || 0) + ' ' + ((n) => n % 10 === 1 && n % 100 !== 11 ? 'запись' : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'записи' : 'записей'))(cur.count || 0)),
        h('div', { class: 'exp-mini' }, [['Сегодня', t.today], ['7 дней', t.week], ['30 дней', t.month]].map(([l, v]) => h('div', null, h('small', null, l), h('b', null, money0((v || {}).sum || 0) + expCur()))))));
      countUp(big, Number(cur.sum || 0), (v) => money0(Math.round(v)) + expCur());
      const cats = r.by_category || [];
      if (cats.length > 1) {
        const max = Math.max(...cats.map((c) => Number(c.sum) || 0), 1);
        const card = h('div', { class: 'card section-card exp-cats' }, h('h2', null, 'По категориям'));
        cats.forEach((c, i) => { const bar = h('i', { style: { width: '0%' } }); card.appendChild(h('div', { class: 'exp-cat' }, h('span', { class: 'exp-cat-ico' }, svg(expIcon(c.category), 16)), h('div', null, h('div', { class: 'exp-cat-top' }, h('b', null, c.category), h('span', null, money0(c.sum) + expCur())), h('div', { class: 'exp-bar' }, bar)))); setTimeout(() => { bar.style.width = Math.max(3, (Number(c.sum) || 0) / max * 100) + '%'; }, 60 + i * 50); });
        content.appendChild(card);
      }
      const items = r.items || [];
      if (!items.length) { content.appendChild(empty('Расходов пока нет', 'Нажмите «+» вверху или кнопку на главном экране', 'note')); return; }
      const groups = []; items.forEach((it) => { const k = dayKey(it.spent_at); let g = groups.find((x) => x.k === k); if (!g) { g = { k, d: it.spent_at, items: [], sum: 0 }; groups.push(g); } g.items.push(it); g.sum += Number(it.amount) || 0; });
      groups.forEach((g) => {
        content.appendChild(h('div', { class: 'exp-day' }, h('span', null, dayName(g.d)), h('b', null, '−' + money0(g.sum) + expCur())));
        const list = h('div', { class: 'card exp-list' });
        g.items.forEach((it, i) => list.appendChild(h('button', { class: 'exp-row', type: 'button', style: { '--i': Math.min(i, 10) }, onclick: () => rowMenu(it) },
          h('span', { class: 'exp-row-ico' + (it.source === 'optima' ? ' opt' : '') }, svg(it.source === 'optima' ? 'bank' : expIcon(it.category), 18)),
          h('div', null, h('b', null, it.title), h('small', null, [it.category, hm(it.spent_at), it.created_by, it.source === 'optima' ? 'из Optima' : ''].filter(Boolean).join(' · '))),
          h('strong', null, '−' + money0(it.amount) + expCur()))));
        content.appendChild(list);
      });
    };
    const drawOptima = async () => {
      const r = await api('/expenses/optima?days=' + st.days + (st.onlyDown ? '&only_down=true' : ''));
      if (!box.isConnected) return;
      content.innerHTML = '';
      content.appendChild(segEl([['1', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней']], String(st.days), (k) => { st.days = Number(k); keep(); draw(); }, 'exp-period'));
      const t = r.totals || {}; const low = Number(r.threshold) > 0 && Number(r.balance) < Number(r.threshold);
      const big = h('b', { class: 'exp-total-v' }, '0');
      content.appendChild(h('div', { class: 'card exp-hero opt' + (low ? ' low' : '') }, h('small', null, 'Баланс Optima Business'), big,
        h('span', { class: 'exp-hero-n' }, low ? 'Мало — ниже ' + money0(r.threshold) + expCur() : ((r.wallets || []).length ? (r.wallets || []).map((w) => w.name).join(' · ') : 'кошелёк не подключён')),
        h('div', { class: 'exp-mini' }, h('div', null, h('small', null, 'Списано'), h('b', null, money0(t.down || 0) + expCur())), h('div', null, h('small', null, 'Выплаты клиентам'), h('b', null, money0(t.payouts || 0) + expCur())), h('div', null, h('small', null, 'Прочее'), h('b', { class: Number(t.other) > 0 ? 'red' : '' }, money0(t.other || 0) + expCur())))));
      countUp(big, Number(r.balance || 0), (v) => money0(Math.round(v)) + expCur());
      content.appendChild(h('div', { class: 'card exp-switch' }, h('div', null, h('b', null, 'Только списания'), h('small', null, 'Скрыть поступления')), switchEl(st.onlyDown, async (v) => { st.onlyDown = v; keep(); setTimeout(draw, 160); })));
      const items = r.items || [];
      if (!items.length) { content.appendChild(empty('Записей пока нет', 'История пишется сама каждые 30 секунд, пока работает Optima', 'calendar')); return; }
      const list = h('div', { class: 'card exp-list' });
      items.forEach((x, i) => {
        const down = x.kind === 'down', up = x.kind === 'up';
        const head = down ? '−' + money0(-Number(x.delta)) + expCur() : (up ? '+' + money0(x.delta) + expCur() : 'Начало записи');
        const sub = down ? 'было ' + money0(x.prev_balance) + ' → стало ' + money0(x.balance) + ' · ' + hm(x.at)
          : (up ? (x.changes > 1 ? x.changes + ' поступл. · ' : '') + hm(x.started_at) + '–' + hm(x.at) + ' · баланс ' + money0(x.balance) : 'баланс ' + money0(x.balance) + ' · ' + hm(x.at));
        const tags = down ? h('div', { class: 'exp-tags' }, Number(x.payouts) > 0 ? h('span', { class: 'exp-tag' }, 'выплаты клиентам ' + money0(x.payouts) + (x.payouts_count ? ' (' + x.payouts_count + ')' : '')) : null, Number(x.other) > 0 ? h('span', { class: 'exp-tag red' }, 'прочее ' + money0(x.other)) : null, x.low ? h('span', { class: 'exp-tag amber' }, 'мало') : null) : null;
        const act = down && Number(x.other) > 0 ? (x.expense_id ? h('span', { class: 'exp-in' }, svg('check', 14), 'в расходах') : h('button', { class: 'exp-to', type: 'button', onclick: (e) => { e.stopPropagation(); expenseQuick({ amount: x.other, balance_log_id: x.id, when: dayName(x.at) + ' ' + hm(x.at), onSaved: () => draw() }); } }, svg('plus', 14), 'в расходы')) : null;
        list.appendChild(h('div', { class: 'exp-row bal ' + x.kind, style: { '--i': Math.min(i, 10) } },
          h('span', { class: 'exp-row-ico ' + (down ? 'down' : (up ? 'up' : '')) }, svg(down ? 'arrowUR' : (up ? 'arrowDL' : 'clock'), 18)),
          h('div', null, h('b', null, head), h('small', null, (st.days > 1 ? dayName(x.at) + ' · ' : '') + sub), tags, act ? h('div', { class: 'exp-act' }, act) : null)));
      });
      content.appendChild(list);
    };
    let timer = null;
    const draw = async () => {
      try { await (tab === 'optima' ? drawOptima() : drawList()); } catch (ex) { content.innerHTML = ''; content.appendChild(empty('Не загрузилось', ex.message, 'alert')); }
      clearTimeout(timer); if (tab === 'optima') timer = setTimeout(() => { if (box.isConnected && !document.hidden && !document.querySelector('.sheet-back')) draw(); else if (box.isConnected) timer = setTimeout(draw, 30000); }, 30000);
    };
    draw();
  }
  async function statementsView(shell) {""")

# ================================================================== STAGE 17 (1.13.9.60) — sheets stand on the keyboard; scrolling never closes them
rep("    const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back && Date.now() - openedAt > 450) api_.close(); } }, box);", "    /* SHEET_KEYBOARD_1_13_9_60: a tap outside while typing only hides the keyboard; the sheet stays */\n    const typing = () => { const a = document.activeElement; return !!(a && box.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };\n    let downTyping = false;  // read at the press: the browser blurs the field before the click arrives\n    const back = h('div', { class: 'sheet-back', onpointerdown: (e) => { downTyping = e.target === back && typing(); }, onclick: (e) => { if (e.target !== back || Date.now() - openedAt <= 450) return; if (downTyping || typing()) { downTyping = false; if (typing()) document.activeElement.blur(); return; } api_.close(); } }, box);")
rep('    let closed = false, drag = null;\n    const api_ = {', "    let closed = false, drag = null;\n    /* the sheet stands on the keyboard (visualViewport): the field being typed in is never under it */\n    function fit() { const vv = window.visualViewport; if (!vv || !back.isConnected) return; const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop); back.style.top = Math.round(vv.offsetTop) + 'px'; back.style.height = Math.round(vv.height) + 'px'; back.style.bottom = 'auto'; back.classList.toggle('kb', kb > 80); box.style.maxHeight = kb > 80 ? Math.round(vv.height - 6) + 'px' : ''; }\n    function unfit() { if (window.visualViewport) { window.visualViewport.removeEventListener('resize', fit); window.visualViewport.removeEventListener('scroll', fit); } }\n    const api_ = {")
rep("      close() { if (closed) return; closed = true; box.classList.add('closing');", "      close() { if (closed) return; closed = true; unfit(); if (typing()) document.activeElement.blur(); box.classList.add('closing');")
rep("    const start = (y, fromBody) => { drag = { y0: y, y, t0: Date.now(), fromBody, moved: false, dead: false }; box.style.transition = 'none'; };", "    const start = (y, fromBody, x) => { drag = { y0: y, y, x0: x || 0, t0: Date.now(), fromBody, moved: false, dead: false }; box.style.transition = 'none'; };")
rep("    const move = (y, e) => {\n      if (!drag || drag.dead) return; const dy = y - drag.y0; drag.y = y;\n      if (!drag.moved) { if (Math.abs(dy) < 6) return; if (drag.fromBody && (bodyEl.scrollTop > 0 || dy < 0)) { drag.dead = true; box.style.transition = ''; return; } drag.moved = true; }", "    const move = (y, e, x) => {\n      if (!drag || drag.dead) return; const dy = y - drag.y0; const dx = (x || 0) - drag.x0; drag.y = y;\n      /* a scroll, a sideways swipe or a swipe while typing never closes the sheet — only a clear pull down from the top */\n      if (!drag.moved) { if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return; if (drag.fromBody && (bodyEl.scrollTop > 0 || dy < 0 || typing() || Math.abs(dx) > Math.abs(dy) * 0.7)) { drag.dead = true; box.style.transition = ''; return; } drag.moved = true; }")
rep("const moved = drag.moved; box.style.transition = ''; drag = null;", "const moved = drag.moved, fromBody = drag.fromBody; box.style.transition = ''; drag = null;")
rep('      if (dy > 100 || (dy > 24 && v > 0.5)) { api_.close(); return; }', '      if (fromBody ? (dy > 170 || (dy > 80 && v > 0.9)) : (dy > 100 || (dy > 24 && v > 0.5))) { api_.close(); return; }')
rep("    bodyEl.addEventListener('touchstart', (e) => { if (e.touches.length === 1 && !drag) start(e.touches[0].clientY, true); }, { passive: true });\n    bodyEl.addEventListener('touchmove', (e) => { if (drag && drag.fromBody) move(e.touches[0].clientY, e); }, { passive: false });", "    bodyEl.addEventListener('touchstart', (e) => { if (e.touches.length === 1 && !drag && !opts.form && !typing() && !e.target.closest('input,textarea,select,[data-hscroll]')) start(e.touches[0].clientY, true, e.touches[0].clientX); }, { passive: true });\n    bodyEl.addEventListener('touchmove', (e) => { if (drag && drag.fromBody) move(e.touches[0].clientY, e, e.touches[0].clientX); }, { passive: false });")
rep("    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'; root.appendChild(back);\n    return api_;", "    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'; root.appendChild(back);\n    fit(); if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); }\n    return api_;")

# ================================================================== STAGE 18 (1.13.9.61) — «Топ пополнения» and vouchers for the top
rep("""receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6M9 16h3' };""", """receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6M9 16h3', trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3', gift: 'M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8S10.5 3 8 3a2 2 0 0 0 0 5M12 8s1.5-5 4-5a2 2 0 0 1 0 5' };""")
rep("""['expenses', 'receipt', 'Расходы', 'yellow', 'cashes'], """, """['expenses', 'receipt', 'Расходы', 'yellow', 'cashes'], ['top', 'trophy', 'Топ пополнения', 'purple', 'cashes'], """)
rep("""expenses: expensesView, deposit:""", """expenses: expensesView, top: topView, deposit:""")
rep("""  async function statementsView(shell) {""", r"""  /* VOUCHERS_1_13_9_61 — «Топ пополнения»: who deposits most (payouts beside, a chat button), and vouchers for the top:
     paste the codes as they come — the system counts them and gives #1 to #1, #2 to #2 … through the bot and the support */
  const TOP_PERIODS = [['today', 'Сегодня'], ['week', '7 дней'], ['month', '30 дней'], ['all', 'Всё время']];
  const VOUCHER_RE = /^[A-Z0-9][A-Z0-9-]{4,62}[A-Z0-9]$/;
  const parseVouchers = (text) => { const codes = [], bad = []; String(text || '').split(/[\s,;]+/).forEach((p) => { const t = p.trim().replace(/^\.+|\.+$/g, '').toUpperCase(); if (!t) return; if (!VOUCHER_RE.test(t)) bad.push(p.trim()); else if (!codes.includes(t)) codes.push(t); }); return { codes, bad }; };
  const BOT_TAG = { global: 'Global', win: 'Win' };
  const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c));
  async function topView(shell) {
    const st = { period: 'month' }; try { const v = localStorage.getItem('top-period'); if (v) st.period = v; } catch (e) {}
    const gift = h('button', { class: 'icon-btn top-gift-top', 'aria-label': 'Раздать ваучеры', onclick: () => voucherSheet(st.period, () => draw()) }, svg('gift', 23));
    const box = page(shell, 'Топ пополнения', { right: gift });
    const content = h('div');
    const draw = async () => {
      box.innerHTML = '';
      box.appendChild(segEl(TOP_PERIODS, st.period, (k) => { st.period = k; try { localStorage.setItem('top-period', k); } catch (e) {} draw(); }, 'top-period'));
      box.appendChild(h('button', { class: 'top-voucher-card', type: 'button', onclick: () => voucherSheet(st.period, () => draw()) },
        h('span', { class: 'top-vc-ico' }, svg('gift', 24)), h('span', { class: 'top-vc-txt' }, h('b', null, 'Раздать ваучеры'), h('small', null, 'Вставьте коды — система сама раздаст топу по порядку')), svg('chevron', 18)));
      box.appendChild(content); content.innerHTML = ''; content.appendChild(loader(4));
      let r; try { r = await api('/top-clients?period=' + st.period + '&limit=100'); } catch (ex) { content.innerHTML = ''; content.appendChild(empty('Не загрузилось', ex.message, 'alert')); return; }
      if (!box.isConnected) return;
      content.innerHTML = '';
      const items = r.items || [];
      if (!items.length) { content.appendChild(empty('Пополнений за период нет', 'Выберите другой период', 'history')); return; }
      const total = items.reduce((a, x) => a + Number(x.deposits_sum || 0), 0);
      content.appendChild(h('div', { class: 'top-sum' }, h('span', null, items.length + ' ' + plural(items.length, 'клиент', 'клиента', 'клиентов')), h('b', null, money0(total) + ' ' + curSign('KGS')),
        h('button', { class: 'top-hist', type: 'button', onclick: () => voucherHistory() }, svg('history', 15), 'Ваучеры')));
      const podium = h('div', { class: 'top-podium' });
      [1, 0, 2].forEach((i, k) => { const x = items[i]; if (!x) return; podium.appendChild(h('button', { class: 'top-pod p' + (i + 1), type: 'button', style: { '--d': (k * 90) + 'ms' }, onclick: () => clientSheet(x) },
        h('span', { class: 'top-pod-av' }, avatarEl(x.name, x.avatar), h('i', { class: 'top-medal' }, String(i + 1))),
        h('b', null, x.name), h('strong', null, money0(x.deposits_sum) + ' ' + curSign('KGS')), h('small', null, x.deposits_count + ' ' + plural(x.deposits_count, 'пополнение', 'пополнения', 'пополнений')),
        h('span', { class: 'top-pod-step' }, h('em', null, String(i + 1))))); });
      content.appendChild(podium);
      const list = h('div', { class: 'card top-list' });
      items.forEach((x, i) => {
        const row = h('div', { class: 'top-row' + (x.blocked ? ' blocked' : ''), style: { '--i': Math.min(i, 14) } },
          h('span', { class: 'top-rank r' + Math.min(x.rank, 4) }, String(x.rank)),
          h('button', { class: 'top-who', type: 'button', onclick: () => clientSheet(x) }, avatarEl(x.name, x.avatar),
            h('span', { class: 'top-who-txt' }, h('b', null, x.name, BOT_TAG[x.bot] ? h('em', { class: 'top-bot ' + x.bot }, BOT_TAG[x.bot]) : null, x.vouchers ? h('em', { class: 'top-gifted', title: 'Получал ваучеры' }, svg('gift', 11), String(x.vouchers)) : null),
              h('span', { class: 'top-nums' }, h('span', { class: 'in' }, svg('arrowDL', 12), money0(x.deposits_sum), h('i', null, '· ' + x.deposits_count)), h('span', { class: 'out' }, svg('arrowUR', 12), money0(x.withdrawals_sum), h('i', null, '· ' + x.withdrawals_count))))),
          can('support') ? h('button', { class: 'top-chat', type: 'button', 'aria-label': 'Написать клиенту', onclick: () => openChat(x.user_id) }, svg('chat', 19)) : null);
        list.appendChild(row);
      });
      content.appendChild(list);
    };
    draw();
  }
  function clientSheet(x) {
    const cur = ' ' + curSign('KGS');
    const s = sheet({ title: x.name, body: h('div', { class: 'top-client' },
      h('div', { class: 'top-client-head' }, avatarEl(x.name, x.avatar), h('div', null, h('b', null, '#' + x.rank + ' в топе'), h('small', null, [x.username ? '@' + x.username : '', 'TG ' + x.telegram_id, BOT_TAG[x.bot] || 'PayGo'].filter(Boolean).join(' · ')))),
      h('div', { class: 'top-client-grid' },
        h('div', { class: 'in' }, h('small', null, 'Пополнения'), h('b', null, money0(x.deposits_sum) + cur), h('span', null, x.deposits_count + ' ' + plural(x.deposits_count, 'раз', 'раза', 'раз'))),
        h('div', { class: 'out' }, h('small', null, 'Выводы'), h('b', null, money0(x.withdrawals_sum) + cur), h('span', null, x.withdrawals_count + ' ' + plural(x.withdrawals_count, 'раз', 'раза', 'раз')))),
      x.vouchers ? h('div', { class: 'top-client-note' }, svg('gift', 15), 'Ваучеров получено: ' + x.vouchers + (x.last_voucher_at ? ' · последний ' + fmtDate(x.last_voucher_at) : '')) : null,
      h('div', { class: 'btn-row' }, can('support') ? h('button', { class: 'primary-btn', type: 'button', onclick: () => { s.close(); openChat(x.user_id); } }, svg('chat', 18), 'Написать') : null,
        h('button', { class: 'outline-btn', type: 'button', onclick: () => { s.close(); go('#/users/' + x.user_id); } }, svg('user', 18), 'Профиль'))) });
  }
  function voucherSheet(period, onDone) {
    const st = { period: period || 'month', skip: 0, text: '' };
    const s = sheet({ title: 'Ваучеры для топа', full: true, form: true, body: h('div') });
    const step1 = () => {
      const area = h('textarea', { class: 'input vch-area', rows: 7, placeholder: 'Вставьте коды — по одному в строке\nMGAUYOU07H\nSK0DQSKE5J\n…', spellcheck: 'false', autocapitalize: 'characters', value: st.text });
      const count = h('div', { class: 'vch-count' });
      const next = h('button', { class: 'primary-btn', type: 'button' }, svg('eye', 18), 'Показать, кому уйдёт');
      const recount = () => { st.text = area.value; const p = parseVouchers(area.value); count.innerHTML = ''; count.appendChild(h('b', { class: p.codes.length ? 'ok' : '' }, String(p.codes.length))); count.appendChild(h('span', null, ' ' + plural(p.codes.length, 'код найден', 'кода найдено', 'кодов найдено') + (p.bad.length ? ' · не код: ' + p.bad.slice(0, 3).join(', ') + (p.bad.length > 3 ? '…' : '') : ''))); next.disabled = !p.codes.length; count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop'); };
      area.addEventListener('input', recount);
      const per = segEl(TOP_PERIODS, st.period, (k) => { st.period = k; }, 'vch-period');
      const skip = h('div', { class: 'setting-row vch-skip' }, h('div', null, h('b', null, 'Не повторять'), h('small', null, 'Пропустить тех, кто уже получал ваучер за 7 дней')), switchEl(st.skip > 0, async (v) => { st.skip = v ? 7 : 0; }));
      next.onclick = async () => { busy(next, true); try { const r = await api('/vouchers/preview', { method: 'POST', body: { text: area.value, period: st.period, skip_days: st.skip } }); step2(r); } catch (ex) { err(ex); busy(next, false); } };
      s.setBody(h('div', { class: 'vch' }, h('span', { class: 'lbl' }, 'Коды ваучеров'), area, count, h('span', { class: 'lbl' }, 'Топ за период'), per, skip, next));
      recount(); setTimeout(() => area.focus(), 80);
    };
    const step2 = (r) => {
      const list = r.assignments || [];
      const head = h('div', { class: 'vch-plan' }, h('div', null, h('b', null, String(list.length)), h('small', null, plural(list.length, 'клиент получит', 'клиента получат', 'клиентов получат'))), h('div', null, h('b', null, String(r.fresh)), h('small', null, 'новых кодов')), h('div', null, h('b', { class: r.left ? 'warn' : '' }, String(r.left)), h('small', null, 'останется')));
      const warn = [r.used && r.used.length ? 'Уже выдавались: ' + r.used.slice(0, 4).join(', ') + (r.used.length > 4 ? '…' : '') + ' — их не отправим' : '', r.bad_count ? 'Не похоже на код: ' + r.bad.slice(0, 3).join(', ') : ''].filter(Boolean);
      const rows = h('div', { class: 'card vch-list' }, list.map((a, i) => h('div', { class: 'vch-row', style: { '--i': Math.min(i, 14) } }, h('span', { class: 'top-rank r' + Math.min(a.rank, 4) }, String(a.rank)), avatarEl(a.name, a.avatar), h('div', null, h('b', null, a.name), h('small', null, money0(a.deposits_sum) + ' ' + curSign('KGS') + ' · ' + (BOT_TAG[a.bot] || 'PayGo'))), h('code', { class: 'vch-code' }, a.code))));
      const sample = list[0] ? list[0].code : 'MGAUYOU07H';
      const bubble = h('div', { class: 'vch-bubble' }, h('b', null, '🎉 Уважаемый клиент, вы выиграли ваучер!'), h('span', null, 'Спасибо, что пополняете через нас — вы среди самых активных наших клиентов.'), h('span', null, '🎁 Ваш ваучер: ', h('code', null, sample)), h('small', null, 'Нажмите на код, чтобы скопировать. Ваучер одноразовый — никому его не передавайте.'));
      const back = h('button', { class: 'outline-btn', type: 'button', onclick: step1 }, svg('back', 18), 'Назад');
      const send = h('button', { class: 'primary-btn vch-send', type: 'button', disabled: !list.length }, svg('send', 18), 'Отправить ' + list.length);
      send.onclick = async () => {
        if (!(await confirmDialog('Отправить ' + list.length + ' ' + plural(list.length, 'ваучер', 'ваучера', 'ваучеров') + ' топ-клиентам? Каждый получит свой код в бот и в поддержку, чат закроется.', 'Отправить', false))) return;
        busy(send, true);
        try { const out = await api('/vouchers/send', { method: 'POST', body: { text: st.text, period: st.period, skip_days: st.skip, confirm: true } }); buzz(20); done(out); if (onDone) onDone(); } catch (ex) { err(ex); busy(send, false); }
      };
      s.setBody(h('div', { class: 'vch' }, head, warn.length ? h('div', { class: 'vch-warn' }, svg('alert', 16), h('span', null, warn.join(' · '))) : null, h('span', { class: 'lbl' }, 'Так увидит клиент'), bubble, h('span', { class: 'lbl' }, 'Кому какой код'), list.length ? rows : empty('Некому отправить', 'Нет клиентов в топе за период или все уже получали', 'gift'), h('div', { class: 'btn-row vch-actions' }, back, send)));
    };
    const done = (out) => {
      const burst = h('div', { class: 'vch-burst', 'aria-hidden': 'true' }, Array.from({ length: 14 }).map((_, i) => h('i', { style: { '--a': (i * 360 / 14) + 'deg', '--d': (i % 3) * 60 + 'ms' } })));
      const rows = h('div', { class: 'card vch-list' }, (out.sent || []).map((x, i) => h('div', { class: 'vch-row done', style: { '--i': Math.min(i, 14) } }, h('span', { class: 'vch-ok' }, svg('check', 15)), h('div', null, h('b', null, x.name), h('small', null, 'бот ' + (BOT_TAG[x.bot] || 'PayGo') + (x.support !== x.bot ? ' + поддержка' : '') + (x.chat_closed ? ' · чат закрыт' : ' · чат открыт (ждёт ответа)'))), h('code', { class: 'vch-code' }, x.code))));
      s.setBody(h('div', { class: 'vch' }, h('div', { class: 'vch-done' }, burst, h('span', { class: 'vch-done-ico' }, svg('gift', 34)), h('b', null, 'Отправлено: ' + out.count), h('small', null, out.left ? 'Неиспользованных кодов: ' + out.left + ' — сохраните их' : 'Все коды розданы')), rows,
        h('button', { class: 'primary-btn', type: 'button', onclick: () => s.close() }, 'Готово')));
    };
    step1();
  }
  async function voucherHistory() {
    const s = sheet({ title: 'Выданные ваучеры', full: true, body: loader(3) });
    try {
      const r = await api('/vouchers/history');
      const batches = r.batches || [];
      if (!batches.length) { s.setBody(empty('Ваучеры ещё не выдавались', 'Нажмите «Раздать ваучеры»', 'gift')); return; }
      s.setBody(h('div', { class: 'vch' }, batches.map((b) => h('div', null, h('div', { class: 'exp-day' }, h('span', null, fmtDate(b.at) + ' · ' + (b.sent_by || '')), h('b', null, b.count + ' шт.')),
        h('div', { class: 'card vch-list' }, b.items.map((x, i) => h('div', { class: 'vch-row', style: { '--i': Math.min(i, 14) } }, h('span', { class: 'top-rank r' + Math.min(x.rank, 4) }, String(x.rank)), avatarEl(x.name, x.avatar), h('div', null, h('b', null, x.name), h('small', null, money0(x.deposits_sum) + ' ' + curSign('KGS'))), h('code', { class: 'vch-code' }, x.code))))))));
    } catch (ex) { s.setBody(empty('Не загрузилось', ex.message, 'alert')); }
  }
  async function statementsView(shell) {""")

# ================================================================== STAGE 19 (1.13.9.62) — 1xBet via Mobcash: a status tile on the home balances (no live number from the cashbox API)
rep("""          tile('Optima ' + (op.online||0) + '/' + (op.count||0), num(op.balance), 'optima', optOk)));""",
    """          tile('Optima ' + (op.online||0) + '/' + (op.count||0), num(op.balance), 'optima', optOk)));
        /* MOBCASH_1_13_9_64: 1xBet (Mobcash) — статус показываем иконкой-точкой; лимит/баланс числами, если каб��нет их отдаёт */
        const x1 = (cs.items || []).find((x)=>String(x.provider_type||'').toLowerCase()==='mobcash' || String(x.key||'').toLowerCase()==='1xbet');
        if (x1) { const xok = x1.last_check_ok !== false && !!x1.last_check_at; const hasNum = present(x1.last_limit) || present(x1.last_balance);
          oneWinBox.appendChild(h('div',{class:'ow-x1'},
            h('span',{class:'ow-x1-ico'},svg('card',16)),
            h('span',{class:'ow-x1-dot '+(x1.enabled?(xok?'ok':'bad'):'off'),title:(x1.enabled?(xok?'На связи':'Нет связи'):'Выключена')}),
            h('b',null,'1xBet'),
            hasNum
              ? h('span',{class:'ow-x1-nums'},h('span',null,'Касса ',h('b',null,num(x1.last_limit))),h('span',null,'Вывод ',h('b',null,num(x1.last_balance))))
              : h('small',{class:'ow-x1-note'},x1.last_check_at?('проверено '+ago(x1.last_check_at)+' назад'):'не проверялась'))); }""")

# ================================================================== STAGE 20 (1.13.9.63) — Mobcash касса: статус вместо несуществующего баланса
rep("""        card.appendChild(h('div', { style: { fontSize: '26px', fontWeight: 700 } }, c.last_balance !== null && c.last_balance !== undefined ? money(c.last_balance) + ' ' + curSign(c.currency) : '—'));""",
    """        if (String(c.provider_type).toLowerCase() === 'mobcash') {
          const mcOk = c.last_check_ok !== false && !!c.last_check_at; const hv = (v) => v !== null && v !== undefined && v !== '';
          card.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '2px 0' } },
            h('span', { class: 'ow-x1-dot ' + (c.enabled ? (mcOk ? 'ok' : 'bad') : 'off') }),
            h('b', { style: { fontSize: '16px', color: c.enabled ? (mcOk ? 'var(--green)' : 'var(--red)') : 'var(--muted)' } }, c.enabled ? (mcOk ? 'На связи' : 'Нет связи') : 'Выключена')));
          if (hv(c.last_limit) || hv(c.last_balance)) card.appendChild(h('div', { class: 'mc-nums' }, h('div', null, h('small', null, 'Касса (пополнения)'), h('b', null, hv(c.last_limit) ? money(c.last_limit) + ' ' + curSign(c.currency) : '—')), h('div', null, h('small', null, 'Лимит вывода'), h('b', null, hv(c.last_balance) ? money(c.last_balance) + ' ' + curSign(c.currency) : '—'))));
        } else {
          card.appendChild(h('div', { style: { fontSize: '26px', fontWeight: 700 } }, c.last_balance !== null && c.last_balance !== undefined ? money(c.last_balance) + ' ' + curSign(c.currency) : '—'));
        }""")

# ================================================================== STAGE 21 (1.13.9.71) — 1xBet: показываем реальный оборот смены (баланс недоступен без входа в кабинет)
rep("""            hasNum
              ? h('span',{class:'ow-x1-nums'},h('span',null,'Касса ',h('b',null,num(x1.last_limit))),h('span',null,'Вывод ',h('b',null,num(x1.last_balance))))""",
    """            hasNum
              ? (function(){var tn=/оборот/i.test(x1.last_check_message||'');return h('span',{class:'ow-x1-nums'+(tn?' turn':'')},h('span',null,(tn?'↓ Пополнено ':'Касса '),h('b',null,num(x1.last_limit))),h('span',null,(tn?'↑ Вывод ':'Вывод '),h('b',null,num(x1.last_balance))));})()""")

rep("""          if (hv(c.last_limit) || hv(c.last_balance)) card.appendChild(h('div', { class: 'mc-nums' }, h('div', null, h('small', null, 'Касса (пополнения)'), h('b', null, hv(c.last_limit) ? money(c.last_limit) + ' ' + curSign(c.currency) : '—')), h('div', null, h('small', null, 'Лимит вывода'), h('b', null, hv(c.last_balance) ? money(c.last_balance) + ' ' + curSign(c.currency) : '—'))));""",
    """          var tn = /оборот/i.test(c.last_check_message || '');
          if (hv(c.last_limit) || hv(c.last_balance)) card.appendChild(h('div', { class: 'mc-nums' }, h('div', null, h('small', null, tn ? 'Пополнено за смену' : 'Касса (пополнения)'), h('b', null, hv(c.last_limit) ? money(c.last_limit) + ' ' + curSign(c.currency) : '—')), h('div', null, h('small', null, tn ? 'Выплачено за смену' : 'Лимит вывода'), h('b', null, hv(c.last_balance) ? money(c.last_balance) + ' ' + curSign(c.currency) : '—'))));""")

# ================================================================== STAGE 22 (1.13.9.73) — «WB контора» в заявке: нажать и сменить букмекера (не зачисленные заявки)
rep("""      line('Букмекерская контора', h('span', { class: 'chip-plain' }, (tx.cash_name || '—').toUpperCase())),""",
    """      line('Букмекерская контора', (function () {
        var tappable = dep && tx.status !== 'success' && can('operations');
        var chip = h('span', { class: 'chip-plain' + (tappable ? ' chip-tap' : '') }, (tx.cash_name || '—').toUpperCase());
        if (tappable) {
          chip.title = 'Сменить букмекера';
          chip.onclick = async function () {
            var list = (state.cashes || []).filter(function (c) { return ['1win_win', '1win_global'].indexOf(String(c.key).toLowerCase()) < 0; });
            if (!list.length) { try { var r = await api('/cashes'); state.cashes = r.items || []; state.types = r.types || state.types; list = (state.cashes || []).filter(function (c) { return ['1win_win', '1win_global'].indexOf(String(c.key).toLowerCase()) < 0; }); } catch (e) {} }
            var sh;
            var rows = list.map(function (c) { return h('button', { class: 'action-btn' + (c.id === tx.cash_id ? ' primary' : ''), onclick: async function () { if (c.id !== tx.cash_id) { try { await api('/deposits/' + tx.id + '/edit', { method: 'POST', body: { fields: { cash_id: c.id } } }); toast('Букмекер изменён · ' + c.name, 'ok'); } catch (ex) { return err(ex); } } sh.close(); ctx.refresh(); } }, c.name.toUpperCase() + (c.enabled ? '' : ' · выключен') + (c.id === tx.cash_id ? ' ✓' : '')); });
            sh = sheet({ title: 'Сменить букмекера · # ' + txNo(tx), body: h('div', { class: 'cash-pick' }, rows.length ? rows : h('div', { class: 'muted' }, 'Нет касс')), actions: [h('button', { class: 'action-btn', onclick: function () { sh.close(); } }, 'Отмена')] });
          };
        }
        return chip;
      })()),""")

# ================================================================== STAGE 23 (1.13.9.74) — «Сайты» (кассы/крипта по ботам) + раздел «Крипта» (USDT через Crypto Pay)
# 23a. two new views injected right before cashesView
rep("  async function cashesView(shell) {", """  async function sitesView(shell) {
    const box = page(shell, 'Сайты');
    const toggle = (bot, target, on) => api('/sites/toggle', { method: 'POST', body: { bot: bot, target: target, on: on } });
    const render = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      let r; try { r = await api('/sites'); } catch (e) { box.innerHTML = ''; box.appendChild(empty('Не удалось загрузить', e.message)); return; }
      const frag = h('div', { class: 'sites' });
      frag.appendChild(h('div', { class: 'card setting-row' }, h('div', null, h('b', null, '🪙 Криптовалюта (USDT)'), h('small', null, r.crypto_configured ? 'Токен подключён · вкладка «Крипта»' : 'Токен не задан — вкладка «Крипта»')), switchEl(!!r.crypto_master, (val) => toggle('all', 'crypto_master', val))));
      (r.bots || []).forEach((b) => {
        const card = h('div', { class: 'card site-card' });
        card.appendChild(h('div', { class: 'site-head' }, h('b', null, b.label), switchEl(!!b.master, (val) => toggle(b.bot, 'bot', val))));
        const row = (label, target, on, sub) => h('div', { class: 'setting-row' }, h('div', null, h('span', null, label), sub ? h('small', { class: 'muted' }, ' ' + sub) : null), switchEl(!!on, (val) => toggle(b.bot, target, val)));
        card.appendChild(row('Пополнения', 'deposits', b.deposits));
        card.appendChild(row('Выводы', 'withdrawals', b.withdrawals));
        card.appendChild(row('🪙 Крипта (USDT)', 'crypto', b.crypto_toggle, b.crypto ? '' : (r.crypto_configured ? '' : '· нет токена')));
        if ((b.cashes || []).length) { card.appendChild(h('div', { class: 'site-sub' }, 'Букмекеры')); (b.cashes || []).forEach((c) => card.appendChild(row((c.emoji ? c.emoji + ' ' : '') + c.name, 'cash:' + c.key, c.on, c.global_enabled ? '' : '· выключена глобально'))); }
        frag.appendChild(card);
      });
      box.innerHTML = ''; box.appendChild(frag);
    };
    render();
  }
  async function cryptoView(shell) {
    const box = page(shell, 'Крипта');
    const render = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      let r; try { r = await api('/crypto'); } catch (e) { box.innerHTML = ''; box.appendChild(empty('Не удалось загрузить', e.message)); return; }
      const v = r.settings || {}, t = r.totals || {};
      const frag = h('div', { class: 'crypto' });
      frag.appendChild(h('div', { class: 'card setting-row' }, h('div', null, h('b', null, 'Crypto Pay (CryptoBot)'), h('small', null, r.configured ? '✅ токен подключён' : '❌ токен не задан')), can('settings') ? h('button', { class: 'outline-btn', onclick: async () => { const val = await promptDialog('Токен Crypto Pay', 'Вставьте API Token приложения из @CryptoBot', '642440:AA...'); if (!val) return; try { await api('/crypto/token', { method: 'POST', body: { token: String(val).trim() } }); toast('Токен сохранён', 'ok'); render(); } catch (ex) { err(ex); } } }, r.configured ? 'Сменить' : 'Задать токен') : null));
      frag.appendChild(h('div', { class: 'card crypto-tot' },
        h('div', { class: 'ct-row' }, h('div', null, h('small', null, 'Пополнения'), h('b', null, (t.deposit_usdt || '0') + ' USDT')), h('div', null, h('small', null, 'в сомах'), h('b', null, money0(t.deposit_som || 0)))),
        h('div', { class: 'ct-row' }, h('div', null, h('small', null, 'Выводы'), h('b', null, (t.withdraw_usdt || '0') + ' USDT')), h('div', null, h('small', null, 'в сомах'), h('b', null, money0(t.withdraw_som || 0)))),
        h('div', { class: 'ct-row' }, h('div', null, h('small', null, 'Чистыми'), h('b', null, (t.net_usdt || '0') + ' USDT')), h('div', null, h('small', null, 'ожидают (поп/выв)'), h('b', null, (t.pending_deposit || 0) + ' / ' + (t.pending_withdraw || 0))))));
      if (can('settings')) {
        const inp = (key) => h('input', { class: 'input', value: (v[key] == null ? '' : String(v[key])) });
        const dr = inp('crypto_deposit_rate'), wr = inp('crypto_withdraw_rate'), fee = inp('crypto_fee_pct'), nets = inp('crypto_networks');
        frag.appendChild(h('div', { class: 'card crypto-cfg' },
          h('label', { class: 'field' }, h('span', null, 'Курс пополнения (сом за 1 USDT)'), dr),
          h('label', { class: 'field' }, h('span', null, 'Курс вывода (сом за 1 USDT)'), wr),
          h('label', { class: 'field' }, h('span', null, 'Комиссия клиента, %'), fee),
          h('label', { class: 'field' }, h('span', null, 'Сети (через запятую)'), nets),
          h('button', { class: 'primary-btn', onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; try { await api('/crypto/settings', { method: 'POST', body: { values: { crypto_deposit_rate: parseFloat(dr.value) || 0, crypto_withdraw_rate: parseFloat(wr.value) || 0, crypto_fee_pct: parseFloat(fee.value) || 0, crypto_networks: nets.value } } }); toast('Сохранено', 'ok'); } catch (ex) { err(ex); } btn.disabled = false; } }, 'Сохранить курсы')));
      }
      const badge = { created: ['amber', 'ожидает оплаты'], paid: ['blue', 'оплачено'], credited: ['green', 'зачислено'], completed: ['green', 'выплачено'], cancelled: ['red', 'отменено'], failed: ['red', 'ошибка'], expired: ['', 'истекло'] };
      const orderCard = (o) => {
        const st = badge[o.status] || ['', o.status];
        const card = h('div', { class: 'card crypto-ord' },
          h('div', { class: 'co-head' }, h('b', null, o.usdt + ' USDT'), h('span', { class: 'co-badge ' + st[0] }, st[1])),
          h('div', { class: 'co-sub' }, money0(o.som) + ' ' + curSign('KGS') + ' · ' + (o.network || '') + ' · ' + (o.cash_name || '') + ' · ID ' + (o.player_id || '—')),
          h('div', { class: 'co-sub muted' }, (o.client || '') + ' · ' + fmtDate(o.created_at) + (o.error ? ' · ' + o.error : '')));
        if (o.address) card.appendChild(h('div', { class: 'co-addr', title: 'Копировать', onclick: () => copyText(o.address) }, svg('copy', 13), o.address));
        if (o.code) card.appendChild(h('div', { class: 'co-sub' }, 'Код кассы: ', h('b', null, o.code)));
        if (o.kind === 'withdraw' && o.status === 'created' && can('operations')) card.appendChild(h('div', { class: 'btn-row' },
          h('button', { class: 'outline-btn green', onclick: async () => { const tx = await promptDialog('Выплата USDT', 'Хэш транзакции (необязательно)', '0x...'); try { await api('/crypto/' + o.id + '/action', { method: 'POST', body: { action: 'complete', tx_hash: tx ? String(tx).trim() : '' } }); toast('Отмечено выплаченным', 'ok'); render(); } catch (ex) { err(ex); } } }, 'Выплатил'),
          h('button', { class: 'outline-btn danger', onclick: async () => { if (!(await confirmDialog('Отклонить заявку на вывод?', 'Отклонить', true))) return; try { await api('/crypto/' + o.id + '/action', { method: 'POST', body: { action: 'reject' } }); toast('Отклонено', 'ok'); render(); } catch (ex) { err(ex); } } }, 'Отклонить')));
        if (o.kind === 'deposit' && o.status === 'paid' && can('operations')) card.appendChild(h('button', { class: 'outline-btn blue', onclick: async () => { try { const rr = await api('/crypto/' + o.id + '/action', { method: 'POST', body: { action: 'recredit' } }); toast(rr.ok ? 'Зачислено' : 'Не удалось — проверьте кассу', rr.ok ? 'ok' : 'err'); render(); } catch (ex) { err(ex); } } }, 'Зачислить ещё раз'));
        return card;
      };
      const deps = r.deposits || [], wds = r.withdrawals || [];
      frag.appendChild(h('div', { class: 'crypto-sec' }, 'Пополнения криптой'));
      if (deps.length) deps.forEach((o) => frag.appendChild(orderCard(o))); else frag.appendChild(empty('Пока нет', '', 'wallet'));
      frag.appendChild(h('div', { class: 'crypto-sec' }, 'Выводы криптой'));
      if (wds.length) wds.forEach((o) => frag.appendChild(orderCard(o))); else frag.appendChild(empty('Пока нет', '', 'wallet'));
      box.innerHTML = ''; box.appendChild(frag);
    };
    render();
  }
  async function cashesView(shell) {""")
# 23b. register the two new routes
rep("cashes: cashesView, events: eventsView,", "cashes: cashesView, sites: sitesView, crypto: cryptoView, events: eventsView,")
# 23c. two entries in the Меню grid
rep("['cashes', 'wallet', 'Кассы', 'green', 'cashes'], ['security', 'shield', 'Безопасность', 'teal', 'settings']",
    "['cashes', 'wallet', 'Кассы', 'green', 'cashes'], ['sites', 'settings', 'Сайты', 'teal', 'settings'], ['crypto', 'wallet', 'Крипта', 'yellow', 'cashes'], ['security', 'shield', 'Безопасность', 'teal', 'settings']")

# ================================================================== STAGE 24 (1.13.9.76) — «Фриспин»: раздел в админке, тумблеры в «Сайтах», баннер выигрыша в чате поддержки
# 24a. wheelView + wheelWinBanner injected before cryptoView
rep("  async function cryptoView(shell) {", """  async function wheelView(shell) {
    const box = page(shell, 'Фриспин');
    const render = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      let r; try { r = await api('/wheel'); } catch (e) { box.innerHTML = ''; box.appendChild(empty('Не удалось загрузить', e.message)); return; }
      const v = r.settings || {}, t = r.stats || {};
      const frag = h('div', { class: 'wheel-adm' });
      frag.appendChild(h('div', { class: 'card crypto-tot' },
        h('div', { class: 'ct-row' }, h('div', null, h('small', null, 'Прокрутов сегодня'), h('b', null, String(t.spins_today || 0))), h('div', null, h('small', null, 'Выигрышей'), h('b', null, (t.wins_today || 0) + ' / ' + (t.win_cap || 0)))),
        h('div', { class: 'ct-row' }, h('div', null, h('small', null, 'Выплачено сегодня'), h('b', null, money0(t.paid_today || 0) + ' ' + curSign('KGS'))), h('div', null, h('small', null, 'Ждут выплаты'), h('b', null, String(t.pending || 0)))),
        h('div', { class: 'ct-row' }, h('div', null, h('small', null, 'Бюджет в сутки'), h('b', null, t.budget_today ? money0(t.budget_today) + ' ' + curSign('KGS') : '—')), h('div', null, h('small', null, 'Осталось сегодня'), h('b', null, t.left_today == null ? '∞' : String(t.left_today))))));
      if (can('settings')) {
        const inp = (k) => h('input', { class: 'input', value: (v[k] == null ? '' : String(v[k])) });
        const amt = inp('wheel_win_amount'), cap = inp('wheel_daily_win_cap'), ch = inp('wheel_win_chance_pct'), nd = inp('wheel_new_client_days'), nc = inp('wheel_new_client_chance_pct'), bm = inp('wheel_big_client_min'), bc = inp('wheel_big_client_chance_pct');
        frag.appendChild(h('div', { class: 'card crypto-cfg' },
          h('label', { class: 'field' }, h('span', null, 'Приз (пополнение), сом'), amt),
          h('label', { class: 'field' }, h('span', null, 'Лимит выигрышей в сутки'), cap),
          h('label', { class: 'field' }, h('span', null, 'Базовый шанс выигрыша, %'), ch),
          h('label', { class: 'field' }, h('span', null, 'Новый клиент: дней с регистрации'), nd),
          h('label', { class: 'field' }, h('span', null, 'Шанс для новых клиентов, %'), nc),
          h('label', { class: 'field' }, h('span', null, 'Крупный клиент: пополнений от, сом'), bm),
          h('label', { class: 'field' }, h('span', null, 'Шанс для крупных клиентов, %'), bc),
          h('button', { class: 'primary-btn', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await api('/wheel/settings', { method: 'POST', body: { values: { wheel_win_amount: parseInt(amt.value) || 0, wheel_daily_win_cap: parseInt(cap.value) || 0, wheel_win_chance_pct: parseInt(ch.value) || 0, wheel_new_client_days: parseInt(nd.value) || 0, wheel_new_client_chance_pct: parseInt(nc.value) || 0, wheel_big_client_min: parseInt(bm.value) || 0, wheel_big_client_chance_pct: parseInt(bc.value) || 0 } } }); toast('Сохранено', 'ok'); } catch (ex) { err(ex); } b.disabled = false; } }, 'Сохранить')));
      }
      frag.appendChild(h('div', { class: 'crypto-sec' }, 'Выигрыши'));
      const wins = r.wins || [];
      if (!wins.length) frag.appendChild(empty('Пока нет выигрышей', '', 'gift'));
      else wins.forEach((w) => {
        const st = { claimable: ['amber', 'ждёт пополнения'], claimed: ['blue', 'в работе'], credited: ['green', 'выплачено'], rejected: ['red', 'отклонено'] }[w.status] || ['', w.status];
        frag.appendChild(h('div', { class: 'card crypto-ord' },
          h('div', { class: 'co-head' }, h('b', null, money0(w.amount) + ' ' + curSign('KGS')), h('span', { class: 'co-badge ' + st[0] }, st[1])),
          h('div', { class: 'co-sub' }, (w.client || '') + (w.player_id ? ' · ID ' + w.player_id : '') + (w.cash_name ? ' · ' + w.cash_name : '')),
          h('div', { class: 'co-sub muted' }, fmtDate(w.created_at))));
      });
      box.innerHTML = ''; box.appendChild(frag);
    };
    render();
  }
  function wheelWinBanner(win, reload) {
    return h('div', { class: 'card wheel-banner' },
      h('div', null, h('b', null, '🎡 Фриспин — выигрыш ' + money0(win.amount) + ' ' + curSign('KGS')), h('small', null, 'Клиент крутил колесо. Пополните приз на его счёт.')),
      h('button', { class: 'primary-btn', style: { marginTop: '10px' }, onclick: () => wheelPay(win, reload) }, 'Пополнить выигрыш'));
  }
  async function wheelPay(win, reload) {
    let cashes = (state.cashes || []).filter((x) => ['1win_win', '1win_global'].indexOf(String(x.key).toLowerCase()) < 0 && x.enabled);
    if (!cashes.length) { try { const r = await api('/cashes'); state.cashes = r.items || []; cashes = (state.cashes || []).filter((x) => ['1win_win', '1win_global'].indexOf(String(x.key).toLowerCase()) < 0 && x.enabled); } catch (e) {} }
    const idInp = h('input', { class: 'input', placeholder: 'ID счёта (1win / 1xBet)', value: win.player_id || '' });
    let chosen = cashes.length ? cashes[0].id : 0;
    const cashRow = h('div', { class: 'cash-pick' });
    const drawCash = () => { cashRow.innerHTML = ''; cashes.forEach((cc) => cashRow.appendChild(h('button', { class: 'action-btn' + (cc.id === chosen ? ' primary' : ''), onclick: () => { chosen = cc.id; drawCash(); } }, cc.name.toUpperCase()))); };
    drawCash();
    let sh;
    sh = sheet({ title: 'Пополнить выигрыш · ' + money0(win.amount) + ' ' + curSign('KGS'), body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Касса'), cashRow), h('label', { class: 'field' }, h('span', null, 'ID счёта'), idInp)), actions: [
      h('button', { class: 'primary-btn', onclick: async (e) => { const b = e.currentTarget; const pid = (idInp.value || '').replace(/\\D/g, ''); if (!pid) { toast('Введите ID', 'err'); return; } b.disabled = true; try { const r = await api('/wheel/' + win.id + '/credit', { method: 'POST', body: { cash_id: chosen, player_id: pid } }); if (r.ok) { toast('Приз зачислён', 'ok'); sh.close(); if (reload) reload(); } else { toast(r.message || 'Не удалось зачислить', 'err'); b.disabled = false; } } catch (ex) { err(ex); b.disabled = false; } } }, 'Зачислить ' + money0(win.amount)),
      h('button', { class: 'action-btn', onclick: () => sh.close() }, 'Отмена')] });
  }
  async function cryptoView(shell) {""")
# 24b. register route
rep("cashes: cashesView, sites: sitesView, crypto: cryptoView, events: eventsView,",
    "cashes: cashesView, sites: sitesView, crypto: cryptoView, wheel: wheelView, events: eventsView,")
# 24c. Меню entry
rep("['crypto', 'wallet', 'Крипта', 'yellow', 'cashes'], ['security', 'shield', 'Безопасность', 'teal', 'settings']",
    "['crypto', 'wallet', 'Крипта', 'yellow', 'cashes'], ['wheel', 'bolt', 'Фриспин', 'teal', 'settings'], ['security', 'shield', 'Безопасность', 'teal', 'settings']")
# 24d. «Сайты»: мастер-тумблер фриспина + строка по каждому боту
rep("""      frag.appendChild(h('div', { class: 'card setting-row' }, h('div', null, h('b', null, '🪙 Криптовалюта (USDT)'), h('small', null, r.crypto_configured ? 'Токен подключён · вкладка «Крипта»' : 'Токен не задан — вкладка «Крипта»')), switchEl(!!r.crypto_master, (val) => toggle('all', 'crypto_master', val))));""",
    """      frag.appendChild(h('div', { class: 'card setting-row' }, h('div', null, h('b', null, '🪙 Криптовалюта (USDT)'), h('small', null, r.crypto_configured ? 'Токен подключён · вкладка «Крипта»' : 'Токен не задан — вкладка «Крипта»')), switchEl(!!r.crypto_master, (val) => toggle('all', 'crypto_master', val))));
      frag.appendChild(h('div', { class: 'card setting-row' }, h('div', null, h('b', null, '🎡 Фриспин (колесо)'), h('small', null, 'Бесплатный прокрут · настройки во вкладке «Фриспин»')), switchEl(!!r.wheel_master, (val) => toggle('all', 'wheel_master', val))));""")
rep("""        card.appendChild(row('🪙 Крипта (USDT)', 'crypto', b.crypto_toggle, b.crypto ? '' : (r.crypto_configured ? '' : '· нет токена')));""",
    """        card.appendChild(row('🪙 Крипта (USDT)', 'crypto', b.crypto_toggle, b.crypto ? '' : (r.crypto_configured ? '' : '· нет токена')));
        card.appendChild(row('🎡 Фриспин', 'wheel', b.wheel_toggle, b.wheel ? '' : (r.wheel_master ? '' : '· выключен сверху')));""")
# 24e. баннер выигрыша в чате поддержки (между presence и карточкой заявки)
rep("""        presence();
        caseCard(screen, c, ctx);""",
    """        presence();
        if (c.wheel_win && can('operations')) screen.appendChild(wheelWinBanner(c.wheel_win, draw));
        caseCard(screen, c, ctx);""")

# ── STAGE 26 (1.13.9.83) ── no crypto, «Деп на кассу», 1WIN vouchers, menu groups, 1xBet analytics, receipt → «Перевёл».
# Applied as exact unified diffs over the 1.13.9.81 files built above; every context line must match.
import re as _re

_HUNK = _re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _apply_diff(text, name):
    src = text.splitlines(keepends=True)
    out, pos = [], 0
    lines = Path(__file__).with_name(name).read_text(encoding="utf-8").splitlines(keepends=True)
    i = 0
    while i < len(lines) and not lines[i].startswith("@@"):
        i += 1
    while i < len(lines):
        m = _HUNK.match(lines[i])
        assert m, ("bad hunk", name, lines[i][:60])
        start = int(m.group(1)) - 1 if int(m.group(2) or 1) else int(m.group(1))
        assert start >= pos, ("overlap", name)
        out.extend(src[pos:start])
        pos = start
        i += 1
        last = None
        while i < len(lines) and not lines[i].startswith("@@"):
            tag, body = lines[i][:1], lines[i][1:]
            if tag == "\\":
                if last == "+" and out and out[-1].endswith("\n"):
                    out[-1] = out[-1][:-1]
                i += 1
                continue
            if tag in (" ", "-"):
                have = src[pos] if pos < len(src) else None
                assert have is not None and have.rstrip("\n") == body.rstrip("\n"), ("context mismatch", name, pos + 1)
                if tag == " ":
                    out.append(have)
                pos += 1
            elif tag == "+":
                out.append(body)
            else:
                raise AssertionError(("unexpected diff line", name, lines[i][:60]))
            last = tag
            i += 1
    out.extend(src[pos:])
    return "".join(out)


s = _apply_diff(s, "fe83_js.diff")

Path(sys.argv[2]).write_text(s, encoding="utf-8")
css = css + Path(__file__).with_name("fe_add.css").read_text(encoding="utf-8")
css = css + "\n.chip-tap{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}\n.cash-pick{display:flex;flex-direction:column;gap:8px}\n.cash-pick .action-btn{width:100%}\n"
# CRYPTO_1_13_9_74 styles
css = css + """
.site-card .site-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.site-card .site-head b{font-size:17px}
.site-sub{margin:10px 0 4px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.crypto-sec{margin:16px 2px 8px;font-weight:700;font-size:15px}
.crypto-tot .ct-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--line)}
.crypto-tot .ct-row:last-child{border-bottom:0}
.crypto-tot .ct-row>div{display:flex;flex-direction:column}
.crypto-tot small{color:var(--muted);font-size:12px}
.crypto-tot b{font-size:16px}
.crypto-cfg .field{margin-bottom:8px}
.crypto-ord .co-head{display:flex;align-items:center;justify-content:space-between}
.crypto-ord .co-head b{font-size:17px}
.crypto-ord .co-badge{font-size:12px;padding:2px 8px;border-radius:10px;background:var(--chip);color:var(--muted)}
.crypto-ord .co-badge.green{background:rgba(46,160,67,.16);color:var(--green)}
.crypto-ord .co-badge.red{background:rgba(220,70,70,.16);color:var(--red)}
.crypto-ord .co-badge.amber{background:rgba(210,150,30,.16);color:#c6881f}
.crypto-ord .co-badge.blue{background:rgba(40,120,220,.16);color:#2f6fd0}
.crypto-ord .co-sub{font-size:13px;margin-top:3px}
.crypto-ord .co-sub.muted{color:var(--muted);font-size:12px}
.crypto-ord .co-addr{display:flex;align-items:center;gap:6px;margin-top:6px;font-family:monospace;font-size:12px;word-break:break-all;cursor:pointer;color:var(--accent)}
.wheel-banner{border:1px solid rgba(210,150,30,.5);background:linear-gradient(180deg,rgba(255,205,70,.14),rgba(255,205,70,.05))}
.wheel-banner b{font-size:15px}.wheel-banner small{display:block;color:var(--muted);margin-top:2px}
"""
css = _apply_diff(css, "fe83_css.diff")
Path(sys.argv[3]).write_text(css, encoding="utf-8")
print("stage1 ok", len(s))
