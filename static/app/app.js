/* LUXON web cabinet — React 18 без сборки. Тот же бэк, что у Telegram-бота. */
(function(){
'use strict';
var h=React.createElement,useState=React.useState,useEffect=React.useEffect,useRef=React.useRef,useCallback=React.useCallback,useMemo=React.useMemo;
var APP_VERSION='10.64.1';
function applyTheme(t){document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',t==='dark'?'#0f1419':'#ffffff');try{localStorage.setItem('luxon-theme',t);}catch(e){}}
try{applyTheme(localStorage.getItem('luxon-theme')||'light');}catch(e){}

/* ---------- icons ---------- */
var P={
 home:'M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3Z',bk:'M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 21v-5h6v5M8 7h2M14 7h2M8 11h2M14 11h2',
 history:'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',user:'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
 chat:'M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-4.6A8 8 0 1 1 21 12Z',headset:'M4 14v-3a8 8 0 0 1 16 0v3M4 14h3v5H5a1 1 0 0 1-1-1v-4Zm16 0h-3v5h2a1 1 0 0 0 1-1v-4Z',
 arrowDown:'M12 5v14m-6-6 6 6 6-6',arrowUp:'M12 19V5m-6 6 6-6 6 6',arrowInDown:'M18 6 6 18M8 18H6v-2M18 6h-8M18 6v8',arrowOutUp:'M6 18 18 6M8 6h10v10',
 back:'m15 18-6-6 6-6',close:'M18 6 6 18M6 6l12 12',check:'m5 12 4 4L19 6',chev:'m9 18 6-6-6-6',copy:'M8 8h10v12H8zM6 16H4V4h12v2',
 mail:'M4 6h16v12H4zM4 7l8 6 8-6',phone:'M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2Z',
 qr:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-3.5-3.5',
 ext:'M14 4h6v6M20 4l-9 9M18 13v6H5V6h6',shield:'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3ZM9 12l2 2 4-4',
 camera:'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',image:'M4 5h16v14H4zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM4 17l5-5 4 4 3-3 4 4',
 send:'M22 2 11 13M22 2 15 22l-4-9-9-4 20-7Z',refresh:'M20 11A8 8 0 0 0 6 6L4 8M4 13a8 8 0 0 0 14 5l2-2M4 4v4h4M20 20v-4h-4',
 edit:'M4 20h4l10-10-4-4L4 16v4ZM13 7l4 4',logout:'M10 17l5-5-5-5M15 12H3M21 3v18',wallet:'M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h3',
 lock:'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-5M12 8h.01',lang:'M3 5h8M7 5V3M9 5c-1 4-3 7-6 9M5 8c1 3 4 6 7 7M13 21l4-10 4 10M14.5 17h5',
 clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 7v5l3 2',spark:'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2',
 alert:'M12 9v4M12 17h.01M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',bell:'M6 8a6 6 0 0 1 12 0v6l2 2H4l2-2V8ZM10 20a2 2 0 0 0 4 0',id:'M3 6h18v12H3zM7 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM13 10h5M13 14h3',device:'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM11 18h2'
};
function I(p){var n=p.name,s=p.size||22;return h('svg',{width:s,height:s,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:p.w||2,strokeLinecap:'round',strokeLinejoin:'round',className:p.className||'','aria-hidden':'true'},h('path',{d:P[n]||P.info}));}

/* ---------- helpers ---------- */
function money(v){v=Number(v||0);return v.toLocaleString('ru-RU',{minimumFractionDigits:v%1?2:0,maximumFractionDigits:2});}
var TZ='Asia/Bishkek';function _parts(iso){var d=new Date(iso);if(isNaN(d))return null;try{var f=new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});var o={};f.formatToParts(d).forEach(function(x){o[x.type]=x.value;});return o;}catch(e){var p=function(n){return String(n).padStart(2,'0');};return {day:p(d.getDate()),month:p(d.getMonth()+1),year:String(d.getFullYear()).slice(2),hour:p(d.getHours()),minute:p(d.getMinutes())};}}
function fmtDate(iso){if(!iso)return '';var o=_parts(iso);if(!o)return String(iso).slice(0,16).replace('T',' ');return o.day+'.'+o.month+'.'+o.year+', '+o.hour+':'+o.minute;}
function fmtTime(iso){var o=_parts(iso);return o?(o.hour+':'+o.minute):'';}
function fmtDay(iso){var d=new Date(iso);if(isNaN(d))return '';var k=function(x){try{return new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(x);}catch(e){return x.toDateString();}};var t=new Date();var y=new Date(t);y.setDate(t.getDate()-1);if(k(d)===k(t))return 'Сегодня';if(k(d)===k(y))return 'Вчера';try{return new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,day:'numeric',month:'long'}).format(d);}catch(e){return k(d);}}
function api(path,opt){opt=opt||{};var headers={};var body=opt.body;if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}var tok=null;try{tok=localStorage.getItem('luxon-web-token');}catch(e){}if(tok)headers['X-Web-Token']=tok;var ctrl=new AbortController();var t=setTimeout(function(){ctrl.abort();},opt.timeout||20000);return fetch(path,{method:opt.method||'GET',headers:headers,body:body,credentials:'same-origin',signal:ctrl.signal}).then(function(r){clearTimeout(t);return r.json().catch(function(){return {ok:false,message:'Ошибка сервера'};}).then(function(j){if(r.status===401){var e=new Error('AUTH');e.auth=true;throw e;}if(!r.ok||j.ok===false){var err=new Error(j.detail||j.message||('Ошибка '+r.status));err.data=j;throw err;}return j;});}).catch(function(e){clearTimeout(t);if(e.name==='AbortError')throw new Error('Нет связи с сервером');throw e;});}
var STATUS={pending:'Ожидает',success:'Успешно',rejected:'Отклонено',expired:'Истекло',problem:'Проблема'};
function initial(name){return (String(name||'?').trim().charAt(0)||'?').toUpperCase();}
/* Копирование всегда даёт обратную связь: тост + вибра. Раньше часть кнопок
   копировала молча и было непонятно, сработало или нет. */
function copyRaw(t){t=String(t);
 var legacy=function(){
  /* iOS игнорирует select() на readonly textarea — копирование молча
     не срабатывало (токены, юзернеймы). Работает только связка
     contentEditable + Range + Selection. */
  return new Promise(function(res,rej){
   var el=document.createElement('div');
   el.textContent=t;el.contentEditable='true';el.setAttribute('readonly','');
   el.style.cssText='position:fixed;left:0;top:0;opacity:0;white-space:pre;'+
    'font-size:16px;-webkit-user-select:text;user-select:text';
   document.body.appendChild(el);
   var sel=window.getSelection(),rng=document.createRange();
   rng.selectNodeContents(el);sel.removeAllRanges();sel.addRange(rng);
   var ta=document.createElement('textarea');ta.value=t;
   ta.style.cssText='position:fixed;left:0;top:0;opacity:0;font-size:16px';
   document.body.appendChild(ta);ta.focus();ta.setSelectionRange(0,t.length);
   var ok=false;try{ok=document.execCommand('copy');}catch(e){}
   if(!ok){try{sel.removeAllRanges();sel.addRange(rng);ok=document.execCommand('copy');}catch(e){}}
   try{sel.removeAllRanges();}catch(e){}
   document.body.removeChild(ta);document.body.removeChild(el);
   ok?res():rej(new Error('copy'));});};
 if(navigator.clipboard&&window.isSecureContext){
  try{return navigator.clipboard.writeText(t).catch(legacy);}catch(e){return legacy();}}
 return legacy();}
function copyText(t,label){var say=window.__LUX&&window.__LUX.toast;
 return copyRaw(t).then(function(){vibrate(12);if(say)say(label||'Скопировано','success');})
  .catch(function(){
   /* Последний рубеж: показываем текст, чтобы можно было выделить руками. */
   if(window.__LUX&&window.__LUX.showCopy)window.__LUX.showCopy(t);
   else if(say)say('Не удалось скопировать','error');});}
function vibrate(p){try{if(navigator.vibrate)navigator.vibrate(p);}catch(e){}}
var _audio=null;function ding(kind){try{var C=window.AudioContext||window.webkitAudioContext;if(!C)return;_audio=_audio||new C();var ctx=_audio;if(ctx.state==='suspended')ctx.resume();var t0=ctx.currentTime,seq=kind==='ok'?[660,880]:(kind==='bad'?[440,330]:[587,784]);seq.forEach(function(f,i){var o=ctx.createOscillator(),g=ctx.createGain(),at=t0+i*.14;o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(.12,at+.02);g.gain.exponentialRampToValueAtTime(.0001,at+.14);o.connect(g);g.connect(ctx.destination);o.start(at);o.stop(at+.15);});}catch(e){}}

/* ---------- Logo with fallback ---------- */
function Logo(p){var bk=p.bk||{};var [bad,setBad]=useState(false);var cls='logo '+(p.sm?'sm ':'')+(bad?'fb':'');var style=bad?{background:bk.color||'#6b7280'}:null;return h('div',{className:cls,style:style},bad?h('span',null,(bk.label||'?').slice(0,7)):h('img',{src:bk.logo,alt:bk.label||'',onError:function(){setBad(true);}}));}

/* ---------- Sheet ---------- */
/* Блокировка прокрутки под модалками — через счётчик. Вложенные шторки, сторис и
   окна подтверждения раньше затирали body.overflow друг другу, и после закрытия
   он мог остаться 'hidden', а поверх экрана — «мёртвый» слой. */
var _lockN=0;
function lockBody(){useEffect(function(){if(_lockN++===0)document.body.style.overflow='hidden';
 return function(){if(--_lockN<=0){_lockN=0;document.body.style.overflow='';}};},[]);}
function Sheet(p){var [closing,setClosing]=useState(false);var startY=useRef(0),dy=useRef(0),el=useRef(null);var done=useRef(false);
 function close(){if(closing||done.current)return;setClosing(true);setTimeout(function(){if(done.current)return;done.current=true;p.onClose&&p.onClose();},210);}
 lockBody();
 /* Нижние шторки в стопке не должны перехватывать тапы. */
 useEffect(function(){return function(){done.current=true;};},[]);
 function ts(e){var t=e.touches[0];startY.current=t.clientY;dy.current=0;}
 function tm(e){var t=e.touches[0];dy.current=Math.max(0,t.clientY-startY.current);if(dy.current>0&&el.current){if(e.cancelable)e.preventDefault();el.current.style.transform='translateY('+dy.current+'px)';el.current.style.transition='none';}}
 function te(){if(!el.current)return;el.current.style.transition='transform .25s cubic-bezier(.2,.8,.2,1)';if(dy.current>110){close();}else el.current.style.transform='';dy.current=0;}
 return h(React.Fragment,null,h('div',{className:'sheet-bd'+(closing?' closing':''),onClick:close}),h('div',{className:'sheet'+(closing?' closing':''),ref:el},h('div',{className:'drag-zone',onTouchStart:ts,onTouchMove:tm,onTouchEnd:te},h('div',{className:'grab'}),h('div',{className:'head'},p.left?p.left:(p.onBack?h('button',{className:'bk',onClick:p.onBack},h(I,{name:'back',size:20})):h('span',{style:{width:40}})),h('div',{className:'tt'},h('b',null,p.title),p.sub?h('small',null,p.sub):null),h('button',{className:'x',onClick:close,'aria-label':'Закрыть'},h(I,{name:'close',size:20})))),h('div',{className:'body'+(p.center?' center':'')},p.children)));}

/* ---------- Toast ---------- */
function Toast(p){useEffect(function(){var t=setTimeout(p.onClose,p.ms||3200);return function(){clearTimeout(t);};},[p.id]);return h('div',{className:'toast '+(p.type||'')},h(I,{name:p.type==='success'?'check':(p.type==='error'?'alert':'bell'),size:18}),h('span',null,p.text),h('button',{className:'x',onClick:p.onClose},h(I,{name:'close',size:16})));}

/* ---------- Confirm ---------- */
/* Своё окно вместо window.confirm: браузерное выглядит чужеродно, в PWA
   выпадает системной плашкой и на iOS иногда блокируется. */
function Confirm(p){var [closing,setClosing]=useState(false);var [busy,setBusy]=useState(false);lockBody();
 function close(){if(closing)return;setClosing(true);setTimeout(function(){p.onCancel&&p.onCancel();},190);}
 function ok(){if(busy)return;var r=p.onOk&&p.onOk();if(r&&r.then){setBusy(true);r.then(function(){setBusy(false);close();}).catch(function(){setBusy(false);});return;}close();}
 return h(React.Fragment,null,
  h('div',{className:'cf-bd'+(closing?' closing':''),onClick:close}),
  h('div',{className:'cf-box'+(closing?' closing':'')},
   h('span',{className:'cf-i'+(p.danger?' bad':'')},h(I,{name:p.icon||(p.danger?'alert':'info'),size:24})),
   h('b',null,p.title||'Подтвердите'),
   p.text?h('p',null,p.text):null,
   h('div',{className:'cf-b'},
    h('button',{className:'btn ghost',onClick:close},p.cancelLabel||'Отмена'),
    h('button',{className:'btn'+(p.danger?' danger':''),disabled:busy,onClick:ok},busy?h('span',{className:'spin w'}):null,p.okLabel||'Подтвердить'))));}

/* ---------- Auth gate ---------- */
/* Ни один раздел не открывается без сессии. Переход по ссылке/QR запоминается
   и после входа клиента возвращает ровно туда, куда он шёл. */
function AuthGate(p){var t=p.target||{};
 var what=({u:'профиль участника',chat:'общий чат',dm:'переписку',pay:'оплату заявки',history:'историю операций',profile:'профиль',devices:'устройства',tv:'Спорт ТВ',support:'поддержку',notifs:'уведомления',chats:'чаты'})[t.page]||'этот раздел';
 return h('div',{className:'auth gate'},
  h('div',{className:'mark'},h(I,{name:'lock2',size:28})),
  h('h1',null,'Нужен вход'),
  h('p',null,'Чтобы открыть '+what+', войдите в кабинет LUXON. После входа мы вернём вас на эту страницу.'),
  t.page==='u'&&t.arg?h('div',{className:'gate-who'},h('span',{className:'m'},h(I,{name:'user',size:20})),h('div',null,h('b',null,'@'+String(t.arg).replace(/^@/,'')),h('small',null,'откроется после входа'))):null,
  h('button',{className:'btn',style:{marginTop:18},onClick:p.onLogin},h(I,{name:'mail',size:19}),'Войти по email'),
  h('button',{className:'btn ghost',style:{marginTop:10},onClick:p.onQr},h(I,{name:'qr2',size:19}),'Войти по QR'),
  h('div',{className:'hint',style:{marginTop:16,justifyContent:'center'}},h(I,{name:'shield',size:15}),'Данные видны только вам'));}

/* ---------- Auth ---------- */
function AuthEmail(p){var [email,setEmail]=useState('');var [busy,setBusy]=useState(false);var [sent,setSent]=useState(false);var [err,setErr]=useState('');var ok=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
 function go(){if(!ok||busy||sent)return;setBusy(true);setErr('');api('/api/web/auth/start',{method:'POST',body:{email:email.trim()}}).then(function(r){setSent(true);vibrate(20);setTimeout(function(){p.onNext(email.trim().toLowerCase(),r);},650);}).catch(function(e){setErr(e.message);setBusy(false);});}
 return h('div',{className:'auth'},h('div',{className:'mark'},h(I,{name:'spark',size:30,w:2.2})),h('h1',null,p.brand?'Войти в '+p.brand:'Вход'),h('label',null,'Введите ваш email'),h('div',{className:'field'+(ok?' ok':'')},h(I,{name:'mail',size:20}),h('input',{type:'email',inputMode:'email',autoComplete:'email',placeholder:'name@example.com',value:email,disabled:sent,onChange:function(e){setEmail(e.target.value);setErr('');},onKeyDown:function(e){if(e.key==='Enter')go();},autoFocus:true}),ok?h('span',{className:'tick'},h(I,{name:'check',size:16,w:3})):null),err?h('div',{className:'hint err',style:{marginTop:12}},h(I,{name:'alert',size:16}),err):null,h('button',{className:'btn'+(sent?' sent':''),style:{marginTop:16},disabled:!ok||busy,onClick:go},sent?h(I,{name:'check',size:20,w:3}):(busy?h('span',{className:'spin',style:{borderTopColor:'#fff'}}):null),sent?'Код отправлен':(busy?'Отправляем код…':'Получить код')),h('div',{className:'divider'},'или'),h('button',{className:'btn ghost',type:'button',onClick:p.onQr},h(I,{name:'qr2',size:20}),'Войти по QR с другого устройства'),h('div',{style:{height:8}}),h('button',{className:'btn ghost tg',disabled:true,type:'button'},h('svg',{width:22,height:22,viewBox:'0 0 24 24',fill:'#2AABEE'},h('path',{d:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 6.9-1.6 7.6c-.1.6-.5.7-.9.4l-2.5-1.8-1.2 1.1c-.1.1-.2.2-.5.2l.2-2.6 4.7-4.2c.2-.2 0-.3-.3-.1l-5.8 3.6-2.5-.8c-.5-.2-.6-.5.1-.8l9.8-3.8c.5-.1.9.1.5 1.2Z'})),'Войти через Telegram',h('span',{className:'soon'},'скоро')));}

function AuthOtp(p){var [code,setCode]=useState(['','','','','','']);var [busy,setBusy]=useState(false);var [err,setErr]=useState('');var [left,setLeft]=useState(30);var refs=useRef([]);var full=code.join('').length===6;var otpAc=useRef(null);
 /* WebOTP: код из SMS подставляется сам, без копипаста. На iOS работает автозаполнение
    по autocomplete=one-time-code на каждом поле — поэтому оно проставлено ниже. */
 useEffect(function(){if(!('OTPCredential' in window)||!navigator.credentials)return;var ac=new AbortController();otpAc.current=ac;
  navigator.credentials.get({otp:{transport:['sms']},signal:ac.signal}).then(function(o){var v=String(o&&o.code||'').replace(/\D/g,'').slice(0,6);if(v.length===6){var c=v.split('');setCode(c);vibrate(15);setTimeout(function(){verify(v);},120);}}).catch(function(){});
  return function(){try{ac.abort();}catch(e){}};},[]);
 useEffect(function(){if(left<=0)return;var t=setTimeout(function(){setLeft(left-1);},1000);return function(){clearTimeout(t);};},[left]);
 useEffect(function(){setTimeout(function(){refs.current[0]&&refs.current[0].focus();},200);},[]);
 function setAt(i,v){v=v.replace(/\D/g,'');var c=code.slice();if(v.length>1){for(var k=0;k<6;k++)c[k]=v[k]||'';setCode(c);var last=Math.min(5,v.length-1);refs.current[last]&&refs.current[last].focus();if(v.length>=6)setTimeout(function(){verify(c.join(''));},80);return;}c[i]=v;setCode(c);setErr('');if(v&&i<5)refs.current[i+1].focus();if(v&&i===5&&c.join('').length===6)setTimeout(function(){verify(c.join(''));},80);}
 function key(i,e){if(e.key==='Backspace'&&!code[i]&&i>0){refs.current[i-1].focus();}}
 function verify(v){v=v||code.join('');if(v.length!==6||busy)return;try{otpAc.current&&otpAc.current.abort();}catch(e){}setBusy(true);setErr('');api('/api/web/auth/verify',{method:'POST',body:{email:p.email,code:v}}).then(function(r){if(r.need_profile){p.onRegister(v);return;}p.onDone(r);}).catch(function(e){setErr(e.message||'Неверный код');vibrate([60,40,60]);setCode(['','','','','','']);setTimeout(function(){refs.current[0]&&refs.current[0].focus();},50);}).then(function(){setBusy(false);});}
 function resend(){if(left>0)return;api('/api/web/auth/start',{method:'POST',body:{email:p.email}}).then(function(r){setLeft(30);if(r.delivery==='admin')setErr('');}).catch(function(e){setErr(e.message);});}
 return h('div',{className:'auth'},h('button',{className:'back',onClick:p.onBack},h(I,{name:'back',size:20}),'Назад'),h('div',{className:'mark'},h(I,{name:'mail',size:28})),h('h1',null,'Введите код'),h('p',null,'Мы отправили 6-значный код на ',h('b',null,p.email)),p.delivery==='admin'?h('div',{className:'hint',style:{marginBottom:14}},h(I,{name:'info',size:16}),'Почта не подключена — код выдаст оператор поддержки'):null,h('div',{className:'otp'+(err?' error':'')},code.map(function(v,i){return h(React.Fragment,{key:i},i===3?h('span',{className:'dot'}):null,h('input',{ref:function(el){refs.current[i]=el;},className:v?'filled':'',inputMode:'numeric',pattern:'[0-9]*',maxLength:i===0?6:1,value:v,autoComplete:'one-time-code',name:'otp'+i,onChange:function(e){setAt(i,e.target.value);},onKeyDown:function(e){key(i,e);},onFocus:function(e){e.target.select();}}));})),err?h('div',{className:'hint err'},h(I,{name:'alert',size:16}),err):(full?h('div',{className:'hint ok'},h(I,{name:'check',size:16}),'Код введён'):h('div',{className:'hint'},'Код действует 5 минут')),h('button',{className:'btn',disabled:!full||busy,onClick:function(){verify();}},busy?h('span',{className:'spin',style:{borderTopColor:'#fff'}}):null,busy?'Проверяем…':'Подтвердить'),h('div',{style:{textAlign:'center',marginTop:18,color:'var(--muted)',fontSize:14}},left>0?'Отправить снова через '+left+' с':h('button',{className:'link',onClick:resend},'Отправить код снова')));}

function AuthRegister(p){var [name,setName]=useState('');var [phone,setPhone]=useState('+996');var [busy,setBusy]=useState(false);var [err,setErr]=useState('');var [avatar,setAvatar]=useState(null);var ok=name.trim().length>=2&&phone.replace(/\D/g,'').length>=9;
 function go(){if(!ok||busy)return;setBusy(true);setErr('');api('/api/web/auth/verify',{method:'POST',body:{email:p.email,code:p.code,name:name.trim(),phone:phone}}).then(function(r){if(avatar){var fd=new FormData();fd.append('file',avatar);return api('/api/web/avatar',{method:'POST',body:fd}).catch(function(){}).then(function(){return r;});}return r;}).then(function(r){p.onDone(r);}).catch(function(e){setErr(e.message);}).then(function(){setBusy(false);});}
 var preview=useMemo(function(){return avatar?URL.createObjectURL(avatar):'';},[avatar]);
 return h('div',{className:'auth'},h('button',{className:'back',onClick:p.onBack},h(I,{name:'back',size:20}),'Назад'),h('div',{className:'mark'},h(I,{name:'user',size:28})),h('h1',null,'Знакомимся'),h('p',null,'Расскажите немного о себе — и кабинет готов.'),h('div',{className:'avatar-pick'},h('label',{className:'av'},preview?h('img',{src:preview,alt:''}):h('span',null,initial(name)),h('i',null,h(I,{name:'camera',size:14})),h('input',{type:'file',accept:'image/*',hidden:true,onChange:function(e){var f=e.target.files&&e.target.files[0];if(f)setAvatar(f);}})),h('div',null,h('b',null,'Аватар'),h('small',null,'Необязательно, можно позже'))),h('label',null,'Ваше имя'),h('div',{className:'field'},h(I,{name:'user',size:20}),h('input',{placeholder:'Как к вам обращаться',value:name,autoComplete:'name',onChange:function(e){setName(e.target.value);},autoFocus:true})),h('label',{style:{marginTop:14}},'Номер телефона'),h('div',{className:'field'},h(I,{name:'phone',size:20}),h('input',{type:'tel',inputMode:'tel',placeholder:'+996 500 000 000',value:phone,autoComplete:'tel',onChange:function(e){setPhone(e.target.value);},onKeyDown:function(e){if(e.key==='Enter')go();}})),err?h('div',{className:'hint err',style:{marginTop:12}},h(I,{name:'alert',size:16}),err):null,h('button',{className:'btn',style:{marginTop:18},disabled:!ok||busy,onClick:go},busy?h('span',{className:'spin',style:{borderTopColor:'#fff'}}):null,'Создать кабинет'));}

function Splash(p){return h('div',{className:'splash'},h('div',{className:'mark'},h(I,{name:'spark',size:40,w:2.2})),h('small',null,'ДОБРО ПОЖАЛОВАТЬ'),h('h2',null,p.name),h('p',null,'Кабинет готов к работе'));}

function stickBottom(box,smooth,hold){
 var el=(box&&box.current)||box;if(!el)return;
 var go=function(sm){var x=(box&&box.current)||box;if(!x)return;
  try{x.scrollTo({top:x.scrollHeight,behavior:sm?'smooth':'auto'});}
  catch(e){x.scrollTop=x.scrollHeight;}};
 go(smooth);
 requestAnimationFrame(function(){go(false);requestAnimationFrame(function(){go(false);});});
 [40,120,260].forEach(function(ms){setTimeout(function(){go(false);},ms);});
 if(hold&&window.ResizeObserver){
  var el2=(box&&box.current)||box;if(!el2)return;
  var ro=new ResizeObserver(function(){go(false);});
  try{ro.observe(el2);if(el2.firstElementChild)ro.observe(el2.firstElementChild);}catch(e){}
  setTimeout(function(){try{ro.disconnect();}catch(e){}},1400);}}

window.__LUX={h:h,I:I,P:P,stickBottom:stickBottom,money:money,fmtDate:fmtDate,fmtTime:fmtTime,fmtDay:fmtDay,api:api,STATUS:STATUS,initial:initial,copyText:copyText,vibrate:vibrate,ding:ding,Logo:Logo,Sheet:Sheet,Toast:Toast,Confirm:Confirm,lockBody:lockBody,AuthGate:AuthGate,AuthEmail:AuthEmail,AuthOtp:AuthOtp,AuthRegister:AuthRegister,Splash:Splash,APP_VERSION:APP_VERSION,applyTheme:applyTheme};
})();
