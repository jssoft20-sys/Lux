# -*- coding: utf-8 -*-
"""Single-page admin + client dashboard for the LuxOn Optima Hub.

Kept in its own module so optima.py stays focused on logic. The page talks to
the JSON endpoints in optima.py and opens a Server-Sent Events stream for
near-instant transaction updates.
"""

HTML = r"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>LuxOn Optima</title>
<style>
:root{--g:#18c964;--g2:#0fa855;--ink:#0b0f0d;--mut:#8b948d;--line:#e6eae7;--bg:#f4f7f5;--card:#fff;--danger:#e5484d;--in:#0c1f17}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:var(--ink)}
button,input,select{font:inherit}
button{cursor:pointer}
.hidden{display:none!important}
.top{height:64px;background:#0b0f0d;color:#fff;display:flex;align-items:center;padding:0 22px;position:sticky;top:0;z-index:10}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;letter-spacing:.3px}
.brand .dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--g),var(--g2));display:grid;place-items:center;color:#04120a;font-weight:900}
.brand span{color:var(--g)}
.live{margin-left:auto;display:flex;gap:14px;align-items:center;color:#c9d3cc;font-size:13px}
.live i{width:9px;height:9px;border-radius:50%;background:var(--g);box-shadow:0 0 0 0 rgba(24,201,100,.6);animation:p 1.6s infinite}
@keyframes p{0%{box-shadow:0 0 0 0 rgba(24,201,100,.5)}70%{box-shadow:0 0 0 9px rgba(24,201,100,0)}100%{box-shadow:0 0 0 0 rgba(24,201,100,0)}}
.shell{max-width:1480px;margin:auto;padding:22px}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.toolbar h1{margin:0 auto 0 0;font-size:24px;letter-spacing:-.4px}
.btn{height:40px;border:0;border-radius:10px;padding:0 15px;font-weight:700;background:#11150f;color:#fff;white-space:nowrap}
.btn.green{background:var(--g);color:#04120a}
.btn.soft{background:#fff;color:#12150f;border:1px solid var(--line)}
.btn.mini{height:32px;font-size:12px;padding:0 11px}
.btn.red{background:#fff;color:var(--danger);border:1px solid #f3c9cb}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
.metric{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px}
.metric small{color:var(--mut);font-weight:700;font-size:12px}
.metric strong{display:block;margin-top:8px;font-size:23px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;margin-top:14px;overflow:hidden}
.cardhead{display:flex;gap:10px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);font-weight:700}
.cardhead .muted{margin-left:auto;color:var(--mut);font-weight:600}
.filters{display:flex;gap:9px;align-items:end;flex-wrap:wrap;margin-top:14px}
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:11px;font-weight:700;color:var(--mut)}
.in{height:40px;border:1px solid #d7ddd8;border-radius:10px;background:#fff;padding:0 12px;outline:0}
.in:focus{border-color:var(--g);box-shadow:0 0 0 3px rgba(24,201,100,.12)}
table{width:100%;border-collapse:collapse}
th{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#95a09a;text-align:left;background:#fafbfa;padding:11px 14px;border-bottom:1px solid var(--line);position:sticky;top:64px}
td{padding:12px 14px;border-bottom:1px solid #f1f3f1;font-size:13px;vertical-align:middle}
tr.flash{animation:fl 2s ease}
@keyframes fl{0%{background:rgba(24,201,100,.22)}100%{background:transparent}}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.money{font-weight:800;white-space:nowrap}.money.in{color:var(--g2)}.money.out{color:var(--danger)}
.muted{color:var(--mut)}
.badge{display:inline-flex;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:800}
.badge.online{background:#e6f9ee;color:#0c8a43}.badge.error{background:#fdebec;color:#c32d31}.badge.new,.badge.stale{background:#fff6e6;color:#a86a00}
.st{display:inline-flex;padding:3px 8px;border-radius:7px;font-size:11px;font-weight:700;background:#eef1ee;color:#5f685f}
.wallets{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:13px;padding:15px}
.wallet{border:1px solid var(--line);border-radius:13px;padding:15px;background:#fff}
.wallet h3{margin:0;font-size:16px}
.wtop{display:flex;align-items:start;gap:8px}.wtop .badge{margin-left:auto}
.kv{margin-top:11px;display:grid;grid-template-columns:96px minmax(0,1fr);gap:6px 8px;font-size:12px}
.kv span{color:var(--mut)}.kv b,.kv code{overflow-wrap:anywhere}
.secret{display:flex;gap:6px;align-items:center}
.secret code{background:#0c130e;color:#c6f7d8;border-radius:7px;padding:5px 8px;font-size:11px;flex:1;overflow:auto;white-space:nowrap}
.actions{display:flex;gap:6px;margin-top:13px;flex-wrap:wrap}
.code{background:#0b120d;color:#c6f7d8;border-radius:10px;padding:12px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.modal{position:fixed;inset:0;background:rgba(6,10,7,.55);z-index:50;display:grid;place-items:center;padding:18px}
.modalbox{width:min(560px,100%);background:#fff;border-radius:16px;padding:20px;max-height:92vh;overflow:auto}
.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:6px}.formgrid .full{grid-column:1/-1}
.formgrid .in{width:100%}
.login{position:fixed;inset:0;background:radial-gradient(1200px 500px at 50% -10%,#12231a,#0b0f0d);display:grid;place-items:center;padding:20px;z-index:100}
.loginbox{width:min(400px,100%);background:#fff;border-radius:18px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.4)}
.loginbox .dot{width:48px;height:48px;border-radius:13px;background:linear-gradient(135deg,var(--g),var(--g2));display:grid;place-items:center;color:#04120a;font-weight:900;font-size:22px;margin-bottom:14px}
.loginbox h2{margin:0 0 4px;font-size:24px}.loginbox p{margin:0 0 18px;color:var(--mut);font-size:13px}
.loginbox .in{width:100%;margin-bottom:10px}
.notice{padding:10px 12px;border-radius:10px;font-size:12px}
.notice.err{background:#fdebec;color:#b4282c}.notice.ok{background:#e9f9f0;color:#0c8a43}
.empty{padding:40px;text-align:center;color:var(--mut)}
.toast{position:fixed;right:18px;bottom:18px;background:#0c120d;color:#fff;padding:11px 15px;border-radius:10px;z-index:120;opacity:0;transform:translateY(8px);transition:.2s}
.toast.show{opacity:1;transform:none}
.dir{font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px}
.dir.in{background:#e6f9ee;color:#0c8a43}.dir.out{background:#fdebec;color:#c32d31}
@media(max-width:860px){.grid{grid-template-columns:1fr 1fr}.wallets{grid-template-columns:1fr}.shell{padding:14px}th{top:0;position:static}}
</style>
</head>
<body>

<section id="login" class="login">
  <form id="loginForm" class="loginbox">
    <div class="dot">L</div>
    <h2>LuxOn <span style="color:var(--g)">Optima</span></h2>
    <p>Введите пароль администратора или ключ доступа</p>
    <input id="loginKey" class="in" type="password" placeholder="Пароль / ключ доступа" autocomplete="off">
    <button class="btn green" style="width:100%;height:44px">Войти</button>
    <div id="loginError" class="notice err hidden" style="margin-top:12px"></div>
  </form>
</section>

<div id="dashboard" class="hidden">
  <header class="top">
    <div class="brand"><div class="dot">L</div>LuxOn <span>Optima</span></div>
    <div class="live"><span id="serverTime" class="mono"></span><i></i><span id="liveText">live</span></div>
  </header>
  <main class="shell">
    <div class="toolbar">
      <h1 id="pageTitle">Транзакции</h1>
      <button id="addBtn" class="btn green hidden">+ Кошелёк</button>
      <button id="refreshBtn" class="btn soft">Обновить</button>
      <button id="logoutBtn" class="btn soft">Выйти</button>
    </div>

    <section class="grid">
      <div class="metric"><small>Сумма за период</small><strong><span id="mAmount">0,00</span> <span class="muted" style="font-size:13px" id="mCurrency">KGS</span></strong></div>
      <div class="metric"><small>Операций</small><strong id="mCount">0</strong></div>
      <div class="metric"><small>Кошельков online</small><strong id="mOnline">0</strong></div>
      <div class="metric"><small>Последняя синхронизация</small><strong id="mSync" style="font-size:14px">—</strong></div>
    </section>

    <div class="filters">
      <div class="field"><label>Дата от</label><input id="fromDate" class="in" type="date"></div>
      <div class="field"><label>Дата до</label><input id="toDate" class="in" type="date"></div>
      <div id="walletFilterWrap" class="field hidden"><label>Кошелёк</label><select id="walletFilter" class="in"><option value="">Все</option></select></div>
      <div class="field" style="flex:1;min-width:200px"><label>Поиск</label><input id="searchInput" class="in" placeholder="ID, сумма, тип, получатель, номер"></div>
      <button id="applyBtn" class="btn">Показать</button>
    </div>

    <section id="clientApiCard" class="card hidden">
      <div class="cardhead">Доступ к API<span class="muted">терминал</span></div>
      <div style="padding:16px"><div id="clientKv" class="kv"></div><div id="clientCurl" class="code" style="margin-top:12px"></div></div>
    </section>

    <section id="walletsCard" class="card hidden">
      <div class="cardhead">Кошельки<span id="walletCount" class="muted">0</span></div>
      <div id="walletsGrid" class="wallets"></div>
    </section>

    <section class="card">
      <div class="cardhead">Транзакции<span id="txCount" class="muted">0</span></div>
      <div style="overflow:auto;max-height:64vh">
        <table>
          <thead><tr>
            <th>Дата</th><th>Время</th><th>Сумма</th><th>Тип</th><th>Статус</th>
            <th>Контрагент</th><th>Номер</th><th>ID</th>
          </tr></thead>
          <tbody id="txBody"></tbody>
        </table>
      </div>
      <div id="txEmpty" class="empty hidden">Нет транзакций за выбранный период</div>
    </section>
  </main>
</div>

<div id="addModal" class="modal hidden">
  <form id="addForm" class="modalbox">
    <h2 style="margin:0 0 4px">Новый кошелёк</h2>
    <p class="muted" style="margin:0 0 6px;font-size:13px">Привязка по логину, паролю и TOTP-ключу Optima Business</p>
    <div class="formgrid">
      <div class="field full"><label>Название</label><input id="wName" class="in" required placeholder="Например: ИП Иванов"></div>
      <div class="field"><label>ID / Логин</label><input id="wLogin" class="in" required></div>
      <div class="field"><label>Пароль</label><input id="wPassword" class="in" type="password" required></div>
      <div class="field full"><label>TOTP-секрет (base32)</label><input id="wTotp" class="in" type="password" required placeholder="S2KXLFZ..."></div>
      <div class="field full"><label>Разрешённые IP для API (через запятую, опционально)</label><input id="wIp" class="in" placeholder="напр. 1.2.3.4, 10.0.0.0/24"></div>
    </div>
    <div id="addError" class="notice err hidden" style="margin-top:10px"></div>
    <div class="actions" style="justify-content:flex-end;margin-top:14px">
      <button id="addCancel" type="button" class="btn soft">Отмена</button>
      <button class="btn green">Добавить и привязать</button>
    </div>
  </form>
</div>

<div id="secretModal" class="modal hidden">
  <div class="modalbox"><h2 id="secretTitle" style="margin:0 0 10px"></h2><div id="secretBody"></div>
  <div class="actions" style="justify-content:flex-end;margin-top:14px"><button id="secretClose" class="btn">Закрыть</button></div></div>
</div>

<div id="toast" class="toast"></div>

<script>
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={me:null,csrf:'',wallets:[],transactions:[],stats:{count:0,amount:0},timer:null,es:null,streamKey:null};
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),1900);}
function copy(t){navigator.clipboard&&navigator.clipboard.writeText(t).then(()=>toast('Скопировано'),()=>{});}
window.__copy=copy;
function today(){const d=new Date(),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());}

async function api(path,opts){
  opts=opts||{};opts.headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});
  if(state.csrf)opts.headers['X-CSRF']=state.csrf;
  opts.credentials='include';
  const r=await fetch(path,opts);
  let j={};try{j=await r.json();}catch(e){}
  if(!r.ok||j.ok===false)throw new Error(j.error||('HTTP '+r.status));
  return j;
}

function statusBadge(s){const cls=s==='online'?'online':(s==='error'?'error':'new');const t={online:'online',error:'ошибка',stale:'устарело',new:'новый'}[s]||s;return '<span class="badge '+cls+'">'+esc(t)+'</span>';}

function txRow(t){
  const dir=t.direction==='in'?'<span class="dir in">IN</span>':(t.direction==='out'?'<span class="dir out">OUT</span>':'');
  const cp=esc(t.recipientName||t.payerAccount||t.recipientAccount||'—');
  return '<tr data-id="'+esc(t.id)+'">'
    +'<td>'+esc(t.date)+'</td>'
    +'<td class="mono">'+esc(t.time||'')+'</td>'
    +'<td class="money '+esc(t.direction||'')+'">'+money(t.amount)+' '+esc(t.currency||'')+'</td>'
    +'<td><span class="st">'+esc(t.type||'')+'</span> '+dir+'</td>'
    +'<td><span class="st">'+esc(t.status||'')+'</span></td>'
    +'<td>'+cp+'</td>'
    +'<td class="mono">'+esc(t.transferNum||'')+'</td>'
    +'<td class="mono muted">'+esc(t.id)+'</td>'
  +'</tr>';
}

function walletCard(w){
  const ep=esc(w.api_endpoint);
  const sec=(label,val,kind)=> val?('<div class="kv"><span>'+label+'</span><div class="secret"><code>'+esc(val)+'</code>'
    +'<button class="btn mini soft" onclick="__copy(\''+esc(val).replace(/'/g,"")+'\')">copy</button></div></div>'):'';
  return '<div class="wallet"><div class="wtop"><h3>'+esc(w.name)+'</h3>'+statusBadge(w.status)+'</div>'
    +'<div class="kv">'
      +'<span>Компания</span><b>'+esc(w.company_name||'—')+'</b>'
      +'<span>Логин</span><b class="mono">'+esc(w.login)+'</b>'
      +'<span>Счёт</span><b class="mono">'+esc(w.account||'—')+'</b>'
      +'<span>Баланс</span><b>'+(w.balance?money(w.balance)+' '+esc(w.currency||''):'—')+'</b>'
      +'<span>Синхр.</span><b class="mono">'+esc(w.last_sync_at||'—')+'</b>'
      +(w.last_error?('<span>Ошибка</span><b style="color:var(--danger)">'+esc(w.last_error)+'</b>'):'')
    +'</div>'
    +'<div style="margin-top:10px" class="kv"><span>API</span><div class="secret"><code>'+ep+'?key=…</code>'
      +'<button class="btn mini soft" data-reveal="'+w.id+'">Ключи</button></div></div>'
    +'<div class="actions">'
      +'<button class="btn mini" data-sync="'+w.id+'">Синхронизировать</button>'
      +'<button class="btn mini soft" data-reveal="'+w.id+'">Показать ключи</button>'
      +'<button class="btn mini soft" data-rotate-api="'+w.id+'">Ротация API</button>'
      +'<button class="btn mini red" data-del="'+w.id+'">Удалить</button>'
    +'</div></div>';
}

function render(){
  const admin=state.me&&state.me.role==='admin';
  $('pageTitle').textContent = admin?'Панель администратора':('Транзакции'+(state.me&&state.me.wallet?' · '+state.me.wallet.name:''));
  $('mAmount').textContent=money(state.stats.amount);
  $('mCount').textContent=state.stats.count||0;
  const online=state.wallets.filter(w=>w.status==='online').length;
  $('mOnline').textContent=online;
  const syncs=state.wallets.map(w=>w.last_sync_at).filter(Boolean).sort();
  $('mSync').textContent=(syncs.length?syncs[syncs.length-1]:'—');
  const cur=(state.wallets[0]&&state.wallets[0].currency)||'KGS';$('mCurrency').textContent=cur;

  $('addBtn').classList.toggle('hidden',!admin);
  $('walletsCard').classList.toggle('hidden',!admin);
  $('walletFilterWrap').classList.toggle('hidden',!admin);
  $('clientApiCard').classList.toggle('hidden',admin);

  if(admin){
    $('walletCount').textContent=state.wallets.length;
    $('walletsGrid').innerHTML=state.wallets.length?state.wallets.map(walletCard).join(''):'<div class="empty">Нет кошельков. Нажмите «+ Кошелёк».</div>';
    const sel=$('walletFilter'),keep=sel.value;
    sel.innerHTML='<option value="">Все кошельки</option>'+state.wallets.map(w=>'<option value="'+w.id+'">'+esc(w.name)+'</option>').join('');
    if([...sel.options].some(o=>o.value===keep))sel.value=keep;
  } else if(state.me&&state.me.wallet){
    const w=state.me.wallet;
    $('clientKv').innerHTML='<span>Кошелёк</span><b>'+esc(w.name)+'</b>'
      +'<span>Счёт</span><b class="mono">'+esc(w.account||'—')+'</b>'
      +'<span>API-ключ</span><div class="secret"><code>'+esc(w.api_key||'')+'</code><button class="btn mini soft" onclick="__copy(\''+esc(w.api_key||'')+'\')">copy</button></div>';
    const ep=w.api_endpoint;
    $('clientCurl').textContent='# JSON транзакций\ncurl "'+ep+'?key='+(w.api_key||'')+'"\n\n# свежие (live-подтяжка)\ncurl "'+ep+'?fresh=1&key='+(w.api_key||'')+'"\n\n# поток новых операций (SSE)\ncurl -N "'+ep+'/stream?key='+(w.api_key||'')+'"';
  }

  const body=$('txBody');
  body.innerHTML=state.transactions.map(txRow).join('');
  $('txCount').textContent=state.transactions.length;
  $('txEmpty').classList.toggle('hidden',state.transactions.length>0);
}

function queryStr(){
  const p=new URLSearchParams({from:$('fromDate').value,to:$('toDate').value,q:$('searchInput').value||''});
  if(state.me&&state.me.role==='admin'&&$('walletFilter').value)p.set('wallet_id',$('walletFilter').value);
  return p.toString();
}

async function load(){
  if(!state.me)return;
  try{
    const j=await api('/optima/_/dashboard?'+queryStr());
    state.me=j.me;state.wallets=j.wallets||[];state.transactions=j.transactions||[];state.stats=j.stats||{count:0,amount:0};
    $('serverTime').textContent=j.server_time||'';
    render();ensureStream();
  }catch(e){ if(/Unauthorized/i.test(e.message)){location.reload();} else toast(e.message); }
}

// ---- live SSE for the currently focused single wallet --------------------
function currentStreamTarget(){
  if(state.me&&state.me.role==='client'&&state.me.wallet)return state.me.wallet;
  if(state.me&&state.me.role==='admin'){
    const id=$('walletFilter').value;
    if(id){const w=state.wallets.find(x=>String(x.id)===String(id));if(w)return w;}
  }
  return null;
}
async function ensureStream(){
  const w=currentStreamTarget();
  const slug=w?w.slug:null;
  if(!w){ if(state.es){state.es.close();state.es=null;state.streamKey=null;} return; }
  // need api_key: client already has it; admin must reveal
  let key=w.api_key;
  if(!key&&state.me.role==='admin'){
    try{const j=await api('/optima/_/wallets/'+w.id+'/reveal');key=j.wallet.api_key;}catch(e){return;}
  }
  const target=slug+'|'+key;
  if(state.streamKey===target&&state.es)return;
  if(state.es){state.es.close();state.es=null;}
  state.streamKey=target;
  try{
    const es=new EventSource(w.api_endpoint+'/stream?backlog=0&key='+encodeURIComponent(key));
    state.es=es;
    es.addEventListener('transaction',ev=>{
      let d;try{d=JSON.parse(ev.data);}catch(_){return;}
      if(!d.tx)return;
      if(state.transactions.some(t=>t.id===d.tx.id))return;
      state.transactions.unshift(d.tx);
      state.stats.count=(state.stats.count||0)+1;
      state.stats.amount=(Number(state.stats.amount||0)+Number(d.tx.amount||0));
      render();
      const row=document.querySelector('#txBody tr[data-id="'+CSS.escape(d.tx.id)+'"]');
      if(row)row.classList.add('flash');
      toast('Новая операция: '+money(d.tx.amount)+' '+(d.tx.currency||''));
    });
    es.onerror=()=>{/* browser auto-reconnects */};
  }catch(e){}
}

async function reveal(id){
  try{
    const j=await api('/optima/_/wallets/'+id+'/reveal');const w=j.wallet;
    const ep=w.api_endpoint;
    $('secretTitle').textContent='Доступы · '+w.name;
    $('secretBody').innerHTML=
      '<div class="kv"><span>API-ключ</span><div class="secret"><code>'+esc(w.api_key)+'</code><button class="btn mini soft" onclick="__copy(\''+esc(w.api_key)+'\')">copy</button></div>'
      +'<span>Client-ключ</span><div class="secret"><code>'+esc(w.client_key)+'</code><button class="btn mini soft" onclick="__copy(\''+esc(w.client_key)+'\')">copy</button></div></div>'
      +'<div class="code" style="margin-top:12px">'+esc('# JSON транзакций в терминале\ncurl "'+ep+'?key='+w.api_key+'"\n\n# свежие (принудительная подтяжка)\ncurl "'+ep+'?fresh=1&key='+w.api_key+'"\n\n# live-поток новых операций\ncurl -N "'+ep+'/stream?key='+w.api_key+'"')+'</div>';
    $('secretModal').classList.remove('hidden');
  }catch(e){toast(e.message);}
}

// ---- events --------------------------------------------------------------
$('loginForm').onsubmit=async e=>{
  e.preventDefault();const err=$('loginError');err.classList.add('hidden');
  try{
    const j=await api('/optima/_/login',{method:'POST',body:JSON.stringify({key:$('loginKey').value})});
    state.me=j.me;state.csrf=j.csrf||'';
    $('login').classList.add('hidden');$('dashboard').classList.remove('hidden');
    await load();startTimer();
  }catch(ex){err.textContent=ex.message;err.classList.remove('hidden');}
};
$('logoutBtn').onclick=async()=>{try{await api('/optima/_/logout',{method:'POST',body:'{}'});}catch(e){}location.reload();};
$('refreshBtn').onclick=load;
$('applyBtn').onclick=load;
$('searchInput').onkeydown=e=>{if(e.key==='Enter')load();};
$('walletFilter').onchange=load;
$('fromDate').onchange=load;$('toDate').onchange=load;
$('addBtn').onclick=()=>{$('addError').classList.add('hidden');$('addModal').classList.remove('hidden');};
$('addCancel').onclick=()=>$('addModal').classList.add('hidden');
$('secretClose').onclick=()=>$('secretModal').classList.add('hidden');
$('addForm').onsubmit=async e=>{
  e.preventDefault();const err=$('addError');err.classList.add('hidden');
  try{
    const body={name:$('wName').value,login:$('wLogin').value,password:$('wPassword').value,totp:$('wTotp').value,allowed_ip:$('wIp').value};
    const j=await api('/optima/_/wallets',{method:'POST',body:JSON.stringify(body)});
    $('addModal').classList.add('hidden');$('addForm').reset();
    toast('Кошелёк добавлен — идёт авторизация…');
    await load();reveal(j.wallet.id);
  }catch(ex){err.textContent=ex.message;err.classList.remove('hidden');}
};
document.addEventListener('click',async ev=>{
  const t=ev.target.closest('[data-sync],[data-reveal],[data-rotate-api],[data-del]');
  if(!t)return;
  if(t.dataset.reveal)return reveal(t.dataset.reveal);
  if(t.dataset.sync){try{await api('/optima/_/wallets/'+t.dataset.sync+'/sync',{method:'POST',body:'{}'});toast('Синхронизация запущена');setTimeout(load,1200);}catch(e){toast(e.message);}return;}
  if(t.dataset.rotateApi){if(!confirm('Сгенерировать новый API-ключ? Старый перестанет работать.'))return;try{const j=await api('/optima/_/wallets/'+t.dataset.rotateApi+'/rotate',{method:'POST',body:JSON.stringify({kind:'api'})});copy(j.key);toast('Новый API-ключ скопирован');load();}catch(e){toast(e.message);}return;}
  if(t.dataset.del){if(!confirm('Удалить кошелёк и все его транзакции?'))return;try{await api('/optima/_/wallets/'+t.dataset.del+'/delete',{method:'POST',body:'{}'});toast('Удалено');load();}catch(e){toast(e.message);}return;}
});

function startTimer(){clearInterval(state.timer);state.timer=setInterval(load,2500);}

$('fromDate').value=today();$('toDate').value=today();
(async()=>{try{const j=await api('/optima/_/me');if(j.me){state.me=j.me;state.csrf=j.csrf||'';$('login').classList.add('hidden');$('dashboard').classList.remove('hidden');await load();startTimer();}}catch(e){}})();
})();
</script>
</body>
</html>"""
