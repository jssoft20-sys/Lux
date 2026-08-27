(function(){
'use strict';
var L=window.__LUX,h=L.h,I=L.I,money=L.money,fmtDate=L.fmtDate,fmtTime=L.fmtTime,fmtDay=L.fmtDay,api=L.api,initial=L.initial,ding=L.ding,vibrate=L.vibrate,Sheet=L.Sheet,copyText=L.copyText;
var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef,useMemo=React.useMemo;
/* Высота под клавиатуру пишется прямо в CSS-переменные документа.
   В стейт её класть нельзя: каждое движение visualViewport перерисовывало весь
   список сообщений — отсюда была секундная заморозка на фокусе инпута.
   Плюс iOS не всегда шлёт финальный resize после закрытия клавиатуры, поэтому
   добиваем отложенными замерами и слушаем focusout. */
var _vvRefs=0,_vvOff=null;
function _vvApply(){var vv=window.visualViewport;var de=document.documentElement;
 var h1=Math.round(vv?vv.height:window.innerHeight);
 var top=Math.round(vv&&vv.offsetTop>0?vv.offsetTop:0);
 var ae=document.activeElement;
 var typing=!!(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.isContentEditable));
 if(!typing){top=0;if(vv&&Math.abs(window.innerHeight-h1)<120)h1=Math.round(window.innerHeight);}
 var kb=Math.max(0,Math.round((window.innerHeight||h1)-h1-top));
 de.style.setProperty('--vvh',h1+'px');
 de.style.setProperty('--kb-top',top+'px');
 de.style.setProperty('--kb',(typing?kb:0)+'px');
 de.classList.toggle('kb-on',typing&&kb>90);
 if(top>0&&!typing)window.scrollTo(0,0);}
function _vvSettle(){_vvApply();[16,80,180,360,600,900,1300].forEach(function(ms){setTimeout(_vvApply,ms);});}
function useVH(){useEffect(function(){var vv=window.visualViewport;
  if(_vvRefs++===0){
   _vvApply();
   var onR=function(){_vvApply();};
   var onEnd=function(){_vvSettle();};
   if(vv){vv.addEventListener('resize',onR);vv.addEventListener('scroll',onR);}
   window.addEventListener('resize',onR);
   window.addEventListener('orientationchange',onEnd);
   document.addEventListener('focusin',onEnd,true);
   document.addEventListener('focusout',onEnd,true);
   _vvOff=function(){if(vv){vv.removeEventListener('resize',onR);vv.removeEventListener('scroll',onR);}window.removeEventListener('resize',onR);window.removeEventListener('orientationchange',onEnd);document.removeEventListener('focusin',onEnd,true);document.removeEventListener('focusout',onEnd,true);};
  } else _vvSettle();
  return function(){if(--_vvRefs<=0){_vvRefs=0;if(_vvOff)_vvOff();_vvOff=null;var de=document.documentElement;de.classList.remove('kb-on');de.style.removeProperty('--kb-top');de.style.removeProperty('--kb');}};},[]);return 0;}
function fmtDur(s){s=Math.round(s||0);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function ago(iso){if(!iso)return 'давно';var d=(Date.now()-new Date(iso))/1000;if(d<60)return 'только что';if(d<3600)return Math.floor(d/60)+' мин назад';if(d<86400)return Math.floor(d/3600)+' ч назад';return fmtDate(iso);}
/* Скрытые «у себя» сообщения. Сервер о них не знает — это личная чистка ленты. */
function hideKey(scope){return 'luxon-hide-'+scope;}
function hiddenSet(scope){try{return JSON.parse(localStorage.getItem(hideKey(scope))||'[]');}catch(e){return [];}}
function hideLocal(scope,id){try{var a=hiddenSet(scope);if(a.indexOf(id)<0)a.push(id);localStorage.setItem(hideKey(scope),JSON.stringify(a.slice(-500)));}catch(e){}}
function dropHidden(scope,items){var a=hiddenSet(scope);if(!a.length)return items;var o={};a.forEach(function(x){o[x]=1;});return items.filter(function(m){return !o[m.id];});}
/* Тап по свободному месту ленты убирает клавиатуру — как в мессенджерах.
   По пузырю, кнопке, картинке или ссылке фокус не снимаем. */
/* Разметка как в Telegram: **жирный**, __курсив__, `моно`, ||скрытое||, > цитата.
   Спойлер открывается тапом. Парсер без HTML — только текст, XSS невозможен. */
function fmtRich(text){var t=String(text||'');if(!/[*_`|>@~\[]/.test(t)&&t.indexOf('http')<0)return t;
 var out=[],key=0;
 t.split('\n').forEach(function(line,li){
  if(li)out.push('\n');
  if(line.slice(0,2)==='> '){out.push(h('span',{key:'q'+(key++),className:'md-q'},fmtInline(line.slice(2),function(){return key++;})));return;}
  out.push.apply(out,fmtInline(line,function(){return key++;}));});
 return out;}
function fmtInline(line,nk){var out=[];var re=/(\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\|\|([^|]+)\|\||\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]{4,300})\)|(https?:\/\/[^\s<]{6,300})|@([a-zA-Z0-9_]{3,32}))/g;var last=0,m;
 while((m=re.exec(line))){if(m.index>last)out.push(line.slice(last,m.index));
  if(m[2])out.push(h('b',{key:'b'+nk()},m[2]));
  else if(m[3])out.push(h('i',{key:'i'+nk()},m[3]));
  else if(m[4])out.push(h('s',{key:'k'+nk(),className:'md-s'},m[4]));
  else if(m[5])out.push(h('code',{key:'c'+nk(),className:'md-c'},m[5]));
  else if(m[6])out.push(h(Spoiler,{key:'s'+nk(),text:m[6]}));
  else if(m[7])out.push(h('a',{key:'l'+nk(),className:'md-l',href:m[8],target:'_blank',rel:'noopener noreferrer',onClick:function(u2){return function(e){e.stopPropagation();if(L.openLink){e.preventDefault();L.openLink(u2);}};}(m[8])},m[7]));
  else if(m[9])out.push(h('a',{key:'l'+nk(),className:'md-l',href:m[9],target:'_blank',rel:'noopener noreferrer',onClick:function(u2){return function(e){e.stopPropagation();if(L.openLink){e.preventDefault();L.openLink(u2);}};}(m[9])},m[9].replace(/^https?:\/\//,'').slice(0,48)));
  else if(m[10])out.push(h('button',{key:'u'+nk(),className:'md-u',onClick:function(un){return function(e){e.stopPropagation();copyText('@'+un,'@'+un+' скопирован');};}(m[10])},'@'+m[10]));
  last=m.index+m[0].length;}
 if(last<line.length)out.push(line.slice(last));
 return out;}
function Spoiler(p){var [open_,setOpen]=useState(false);return h('span',{className:'md-sp'+(open_?' open':''),onClick:function(e){e.stopPropagation();setOpen(true);}},open_?p.text:'▮'.repeat(Math.min(12,Math.max(4,p.text.length))));}

function blurComposer(e){var t=e&&e.target;
 if(t&&t.closest&&t.closest('.gm-b,button,a,img,video,input,textarea'))return;
 var ae=document.activeElement;
 if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'))ae.blur();}
function tokenHeader(){var hd={};try{var t=localStorage.getItem('luxon-web-token');if(t)hd['X-Web-Token']=t;}catch(e){}return hd;}
function avHue(n){var s=String(n||'?'),a=0;for(var i=0;i<s.length;i++)a=(a*31+s.charCodeAt(i))>>>0;return a%360;}
function Av(p){var st=p.size?{width:p.size,height:p.size,fontSize:p.size*.42}:{};
 if(!p.src){var hu=avHue(p.name);st=Object.assign({},st,{background:'linear-gradient(135deg,hsl('+hu+',58%,52%),hsl('+((hu+42)%360)+',58%,42%))',color:'#fff'});}
 return h('span',{className:'cav '+(p.className||''),style:st},p.src?h('img',{src:p.src,alt:''}):initial(p.name));}

L.P.crop=L.P.crop||'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14';L.P.smile=L.P.smile||'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01';
/* ---------- Voice ---------- */
function Voice(p){var [playing,setPlaying]=useState(false);var [pos,setPos]=useState(0);var a=useRef(null),w=useRef(null),drag=useRef(false);
 useEffect(function(){var el=a.current;if(!el)return;function t(){if(!drag.current)setPos(el.duration?el.currentTime/el.duration:0);}function e(){setPlaying(false);setPos(0);}el.addEventListener('timeupdate',t);el.addEventListener('ended',e);return function(){el.removeEventListener('timeupdate',t);el.removeEventListener('ended',e);};},[]);
 function toggle(){var el=a.current;if(!el)return;if(playing){el.pause();setPlaying(false);}else{document.querySelectorAll('audio').forEach(function(x){if(x!==el)x.pause();});el.play().then(function(){setPlaying(true);}).catch(function(){});}}
 /* Перемотка (3.6): тап или протяжка по волне ставит воспроизведение на это место */
 function seekTo(cx){var el=a.current,box=w.current;if(!el||!box)return;var r=box.getBoundingClientRect();var f=Math.max(0,Math.min(1,(cx-r.left)/Math.max(1,r.width)));setPos(f);var d=el.duration;if(d&&isFinite(d))el.currentTime=f*d;}
 function sd(e){e.stopPropagation();drag.current=true;seekTo((e.touches?e.touches[0]:e).clientX);}
 function sm(e){if(!drag.current)return;if(e.cancelable)e.preventDefault();e.stopPropagation();seekTo((e.touches?e.touches[0]:e).clientX);}
 function su(e){if(drag.current&&e)e.stopPropagation();drag.current=false;}
 var bars=useMemo(function(){var out=[];var seed=(p.id||1)*7;for(var i=0;i<26;i++){seed=(seed*9301+49297)%233280;out.push(.25+(seed/233280)*.75);}return out;},[p.id]);
 return h('div',{className:'voice'},h('audio',{ref:a,src:p.src,preload:'metadata'}),h('button',{className:'vbtn',onClick:toggle},h(I,{name:playing?'pause':'play',size:16})),h('div',{className:'wave seek',ref:w,onTouchStart:sd,onTouchMove:sm,onTouchEnd:su,onMouseDown:sd,onMouseMove:sm,onMouseUp:su,onMouseLeave:su,onClick:function(e){e.stopPropagation();}},bars.map(function(b,i){return h('i',{key:i,style:{height:(b*100)+'%'},className:i/bars.length<pos?'on':''});})),h('small',null,fmtDur(p.duration)));}

/* Одноразовое/таймерное фото (14.2): у получателя открывается один раз и сгорает */
function BurnPhoto(p){var m=p.m;var [open_,setOpen]=useState(false);var [left,setLeft]=useState(0);var [gone,setGone]=useState(false);var tm=useRef(0);
 function burn(){if(gone)return;setGone(true);setOpen(false);api('/api/web/dm/msg/'+m.id+'/burn',{method:'POST',body:{}}).catch(function(){});}
 function show(e){e.stopPropagation();if(m.mine||gone)return;setOpen(true);vibrate(10);
  if(m.burn>1){setLeft(m.burn);var end=Date.now()+m.burn*1000;clearInterval(tm.current);tm.current=setInterval(function(){var l=Math.ceil((end-Date.now())/1000);setLeft(l);if(l<=0){clearInterval(tm.current);burn();}},250);}}
 function close(e){if(e)e.stopPropagation();clearInterval(tm.current);burn();}
 useEffect(function(){return function(){clearInterval(tm.current);};},[]);
 if(open_)return h('div',{className:'pv burnview',onClick:close},m.burn>1?h('span',{className:'burn-cnt'},left+' c'):null,h('button',{className:'pv-x',onClick:close},h(I,{name:'close',size:22})),h('img',{src:m.file_url,alt:''}));
 return h('button',{className:'burn-ph'+(gone||m.deleted?' off':''),onClick:show},h('span',{className:'bp-ic'},'🔥'),h('span',{className:'bp-t'},h('b',null,gone||m.deleted?'Фото просмотрено':(m.burn===1?'Одноразовое фото':'Фото · '+m.burn+' сек')),h('small',null,m.mine?'Откроется у получателя один раз':(gone||m.deleted?'Больше недоступно':'Нажмите, чтобы посмотреть'))));}

/* Превью ссылки на профиль в переписке (13.8) */
function ProfileLinkCard(p){var [u,setU]=useState(null);var [err,setErr]=useState(false);
 useEffect(function(){var alive=true;api('/api/web/users/'+encodeURIComponent(p.handle)).then(function(r){if(alive)setU(r.user);}).catch(function(){if(alive)setErr(true);});return function(){alive=false;};},[p.handle]);
 if(err)return null;
 return h('button',{className:'plink'+(u?'':' ld'),onClick:function(e){e.stopPropagation();if(u&&p.onUser)p.onUser(u.id);}},
  u?h(Av,{src:u.avatar,name:u.name,size:38}):h('span',{className:'skel',style:{width:38,height:38,borderRadius:12}}),
  h('span',{className:'t'},h('b',null,u?u.name:'Профиль…',u&&u.verified?h(I,{name:'check',size:11,w:3,className:'vf'}):null),h('small',null,u?('@'+(u.username||('id'+u.id))+(u.bio?' · '+u.bio.slice(0,40):'')):'')),
  h(I,{name:'chev',size:16,className:'chev'}));}
var PROFILE_LINK_RE=/\/app\/?#\/u\/([A-Za-z0-9_]{3,32})/;

/* ---------- Message bubble with swipe-to-reply + long press ---------- */
/* Итог звонка приходит kind=call | call_video с JSON внутри. */
function callInfo(m){
 var d={};try{d=JSON.parse(m.text||'{}');}catch(e){d={};}
 var video=!!d.video||m.kind==='call_video';
 var reason=d.reason||'hangup';
 var sec=Math.max(0,Math.round(d.duration||m.duration||0));
 var missed=reason==='missed'||reason==='declined';
 var label;
 if(reason==='missed')label=m.mine?'Не ответили':'Пропущенный звонок';
 else if(reason==='declined')label=m.mine?'Отклонён':'Вы отклонили';
 else if(reason==='cancel')label='Отменённый звонок';
 else if(sec)label=(video?'Видеозвонок':'Звонок')+' · '+L.callDur(sec);
 else label=video?'Видеозвонок':'Звонок';
 return {video:video,missed:missed,label:label,sec:sec,reason:reason};}

function CallBubble(p){
 var m=p.m,c=callInfo(m);
 return h('button',{className:'callbub'+(c.missed?' miss':'')+(m.mine?' mine':''),onClick:function(){p.onInfo&&p.onInfo(m,c);}},
  h('span',{className:'cb-ic'},h(I,{name:c.video?'cam':'phone',size:18})),
  h('span',{className:'cb-t'},h('b',null,c.label),
   h('small',null,(m.mine?'Исходящий':'Входящий')+' · '+fmtTime(m.created_at))),
  h('span',{className:'cb-go'},h(I,{name:'phone',size:16})));}

function BubbleBase(p){var m=p.m;var sx=useRef(0),sy=useRef(0),dx=useRef(0),on=useRef(false),lp=useRef(0),el=useRef(null),fired=useRef(false);
 /* 480 мс на долгое нажатие ощущались как «не реагирует». 330 мс — как в ТГ. */
 function ts(e){var t=e.touches[0];sx.current=t.clientX;sy.current=t.clientY;dx.current=0;on.current=false;fired.current=false;clearTimeout(lp.current);lp.current=setTimeout(function(){fired.current=true;vibrate(18);p.onMenu(m);},330);}
 function tm(e){var t=e.touches[0];var x=t.clientX-sx.current,y=t.clientY-sy.current;if(!on.current&&(Math.abs(y)>6||Math.abs(x)>10))clearTimeout(lp.current);if(!on.current&&x<-14&&Math.abs(y)<-x*.6)on.current=true;if(on.current){if(e.cancelable)e.preventDefault();dx.current=Math.max(-80,x);if(el.current){el.current.style.transform='translateX('+dx.current+'px)';el.current.style.transition='none';el.current.style.setProperty('--sw',String(Math.min(1,-dx.current/50)));}}}
 function te(e){clearTimeout(lp.current);if(fired.current&&e&&e.cancelable)e.preventDefault();if(el.current){el.current.style.transition='transform .2s';el.current.style.transform='';}if(on.current&&dx.current<-50){vibrate(15);p.onReply(m);}on.current=0;dx.current=0;}
 return h('div',{className:'gm '+(m.mine?'mine':'')+(p.cont?' cont':'')+(m.pending?' sending':'')+(m.failed?' failed':''),ref:el,onTouchStart:ts,onTouchMove:tm,onTouchEnd:te,onTouchCancel:te,onContextMenu:function(e){e.preventDefault();p.onMenu(m);}},h('span',{className:'swipe-hint'},h(I,{name:'reply',size:16})),
  !m.mine&&p.showAv?h('span',{className:'gm-av',onClick:function(){p.onUser&&p.onUser(m.user_id||m.from_id);}},p.cont?null:h(Av,{src:m.avatar,name:m.name,size:30})):null,
  h('div',{className:'gm-b'},!m.mine&&p.showAv&&!p.cont?h('div',{className:'gm-name',onClick:function(){p.onUser&&p.onUser(m.user_id||m.from_id);}},m.name,m.verified?h(I,{name:'check',size:11,w:3,className:'vf'}):null):null,
   m.reply?h('div',{className:'gm-reply tap',onClick:function(e){e.stopPropagation();if(p.onQuote&&m.reply_to)p.onQuote(m.reply_to);}},h('b',null,m.reply.name||'…'),h('span',null,m.reply.kind==='voice'?'🎤 Голосовое':(m.reply.kind==='photo'?'🖼 Фото':(m.reply.text||'')))):null,
   (m.deleted&&!(m.burn>0))?h('em',{className:'gm-del'},'Сообщение удалено'):h(React.Fragment,null,m.kind==='photo'&&m.burn>0?h(BurnPhoto,{m:m}):null,m.kind==='photo'&&!m.burn&&m.file_url?h('img',{src:m.file_url,alt:'',loading:'lazy',onClick:function(e){e.stopPropagation();L.openPhoto(m.file_url);}}):null,m.kind==='video'&&m.file_url?h('video',{src:m.file_url,controls:true,playsInline:true,preload:'metadata',className:'gm-video'}):null,m.kind==='voice'&&m.file_url?h(Voice,{id:m.id,src:m.file_url,duration:m.duration}):null,m.kind==='sticker'?h('span',{className:'gm-sticker'},m.text):(m.text?h('span',{className:'gm-t'},fmtRich(m.text)):null),(m.text&&m.kind!=='sticker'&&PROFILE_LINK_RE.test(m.text))?h(ProfileLinkCard,{handle:m.text.match(PROFILE_LINK_RE)[1],onUser:p.onUser}):null),
   (m.reactions&&m.reactions.length)?h('div',{className:'gm-rx'},m.reactions.map(function(x){return h('button',{key:x.e,className:x.me?'me':'',onClick:function(e){e.stopPropagation();p.onReact&&p.onReact(m,x.e);}},x.e,x.n>1?h('b',null,x.n):null);})):null,
   h('span',{className:'gm-meta'},p.pinned?h(I,{name:'pin',size:11}):null,m.edited?h('i',{className:'ed'},'изм.'):null,fmtTime(m.created_at),
    m.pending?h(I,{name:'clock',size:12,className:'snd'}):(m.failed?h(I,{name:'alert',size:12,className:'fail'}):(m.mine?h('span',{className:'ticks'+(m.read?' rd':''),title:m.read?'Прочитано':'Отправлено'},h(I,{name:'check',size:12,w:3}),m.read?h(I,{name:'check',size:12,w:3,className:'t2'}):null):null)))));}
/* Каждое новое сообщение раньше перерисовывало всю ленту — отсюда рывки при наборе.
   Пузырь пересобирается только если поменялось само сообщение. */
var Bubble=React.memo(BubbleBase,function(a,b){var x=a.m,y=b.m;
 return x.id===y.id&&x.text===y.text&&x.deleted===y.deleted&&x.edited===y.edited&&x.read===y.read&&x.file_url===y.file_url&&x.pending===y.pending&&x.failed===y.failed&&a.cont===b.cont&&a.pinned===b.pinned&&a.showAv===b.showAv&&JSON.stringify(x.reactions||[])===JSON.stringify(y.reactions||[]);});

/* ---------- Редактор фото перед отправкой (14.1): обрезка, рисование, SD/HD,
   одноразовое / таймер (14.2) ---------- */
function PhotoEditor(p){var [mode,setMode]=useState('');var [hd,setHd]=useState(true);var [burn,setBurn]=useState(0);var [color,setColor]=useState('#ff3b30');var [ready,setReady]=useState(false);var [crop,setCrop]=useState(null);var [busy,setBusy]=useState(false);
 var base=useRef(null),ink=useRef(null),view=useRef(null),wrap=useRef(null),drawing=useRef(false),last=useRef(null),cstart=useRef(null);
 useEffect(function(){var url=URL.createObjectURL(p.file);var im=new Image();
  im.onload=function(){var b=document.createElement('canvas');b.width=im.naturalWidth;b.height=im.naturalHeight;b.getContext('2d').drawImage(im,0,0);base.current=b;
   var k=document.createElement('canvas');k.width=b.width;k.height=b.height;ink.current=k;URL.revokeObjectURL(url);setReady(true);};
  im.onerror=function(){URL.revokeObjectURL(url);p.toast&&p.toast('Не удалось открыть фото','error');p.onCancel();};
  im.src=url;
  var prev=document.body.style.overflow;document.body.style.overflow='hidden';return function(){document.body.style.overflow=prev;};},[]);
 useEffect(function(){if(ready)paint();},[ready,mode,crop]);
 function paint(){var v=view.current,b=base.current;if(!v||!b)return;var maxW=Math.min(window.innerWidth-24,560),maxH=window.innerHeight*0.62;
  var sc=Math.min(maxW/b.width,maxH/b.height,1);v.width=Math.round(b.width*sc);v.height=Math.round(b.height*sc);v._sc=sc;
  var g=v.getContext('2d');g.clearRect(0,0,v.width,v.height);g.drawImage(b,0,0,v.width,v.height);g.drawImage(ink.current,0,0,v.width,v.height);
  if(mode==='crop'&&crop){g.fillStyle='rgba(0,0,0,.55)';g.fillRect(0,0,v.width,v.height);var r=cropRect();g.clearRect(r.x*v._sc,r.y*v._sc,r.w*v._sc,r.h*v._sc);g.drawImage(b,r.x,r.y,r.w,r.h,r.x*v._sc,r.y*v._sc,r.w*v._sc,r.h*v._sc);var k=ink.current;g.drawImage(k,r.x,r.y,r.w,r.h,r.x*v._sc,r.y*v._sc,r.w*v._sc,r.h*v._sc);g.strokeStyle='#fff';g.lineWidth=2;g.strokeRect(r.x*v._sc,r.y*v._sc,r.w*v._sc,r.h*v._sc);}}
 function cropRect(){var c=crop,b=base.current;var x1=Math.max(0,Math.min(c.x1,c.x2)),y1=Math.max(0,Math.min(c.y1,c.y2));var x2=Math.min(b.width,Math.max(c.x1,c.x2)),y2=Math.min(b.height,Math.max(c.y1,c.y2));return {x:x1,y:y1,w:Math.max(8,x2-x1),h:Math.max(8,y2-y1)};}
 function pt(e){var v=view.current;var r=v.getBoundingClientRect();var t=e.touches?e.touches[0]:e;return {x:(t.clientX-r.left)/v._sc,y:(t.clientY-r.top)/v._sc};}
 function pd(e){if(!ready)return;e.preventDefault();var q=pt(e);
  if(mode==='draw'){drawing.current=true;last.current=q;}
  else if(mode==='crop'){cstart.current=q;setCrop({x1:q.x,y1:q.y,x2:q.x,y2:q.y});}}
 function pm(e){if(!ready)return;var q=pt(e);
  if(mode==='draw'&&drawing.current){e.preventDefault();var g=ink.current.getContext('2d');g.strokeStyle=color;g.lineCap='round';g.lineJoin='round';g.lineWidth=Math.max(4,base.current.width/120);g.beginPath();g.moveTo(last.current.x,last.current.y);g.lineTo(q.x,q.y);g.stroke();last.current=q;paint();}
  else if(mode==='crop'&&cstart.current){e.preventDefault();setCrop({x1:cstart.current.x,y1:cstart.current.y,x2:q.x,y2:q.y});}}
 function pu(){drawing.current=false;cstart.current=null;}
 function applyCrop(){if(!crop)return;var r=cropRect();var b=base.current,k=ink.current;
  var nb=document.createElement('canvas');nb.width=r.w;nb.height=r.h;nb.getContext('2d').drawImage(b,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
  var nk=document.createElement('canvas');nk.width=r.w;nk.height=r.h;nk.getContext('2d').drawImage(k,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
  base.current=nb;ink.current=nk;setCrop(null);setMode('');vibrate(10);}
 function clearInk(){var k=ink.current;k.getContext('2d').clearRect(0,0,k.width,k.height);paint();vibrate(8);}
 function doSend(){if(busy||!ready)return;setBusy(true);var b=base.current;
  var out=document.createElement('canvas');var maxSide=hd?1600:900;var sc=Math.min(1,maxSide/Math.max(b.width,b.height));
  out.width=Math.max(1,Math.round(b.width*sc));out.height=Math.max(1,Math.round(b.height*sc));
  var g=out.getContext('2d');g.drawImage(b,0,0,out.width,out.height);g.drawImage(ink.current,0,0,out.width,out.height);
  out.toBlob(function(blob){if(!blob){setBusy(false);p.toast&&p.toast('Не удалось обработать фото','error');return;}p.onSend(blob,burn?{burn:burn}:undefined);},'image/jpeg',hd?0.9:0.72);}
 var BURNS=[[0,'Обычное'],[1,'🔥 1 раз'],[3,'3 сек'],[5,'5 сек'],[10,'10 сек']];
 return h('div',{className:'pedit',ref:wrap},
  h('div',{className:'pe-top'},h('button',{className:'pe-x',onClick:p.onCancel},h(I,{name:'close',size:21})),
   h('div',{className:'pe-tools'},
    h('button',{className:mode==='draw'?'on':'',onClick:function(){setMode(mode==='draw'?'':'draw');setCrop(null);vibrate(8);}},h(I,{name:'edit2',size:17}),'Рисовать'),
    h('button',{className:mode==='crop'?'on':'',onClick:function(){setMode(mode==='crop'?'':'crop');setCrop(null);vibrate(8);}},h(I,{name:'crop',size:17}),'Обрезать'),
    h('button',{className:'q '+(hd?'on':''),onClick:function(){setHd(!hd);vibrate(8);}},hd?'HD':'SD'))),
  h('div',{className:'pe-stage'},ready?h('canvas',{ref:view,onTouchStart:pd,onTouchMove:pm,onTouchEnd:pu,onMouseDown:pd,onMouseMove:pm,onMouseUp:pu,onMouseLeave:pu}):h('span',{className:'spin'})),
  mode==='draw'?h('div',{className:'pe-colors'},['#ff3b30','#ffcc00','#34c759','#0a84ff','#ffffff','#111111'].map(function(cx){return h('button',{key:cx,className:color===cx?'on':'',style:{background:cx},onClick:function(){setColor(cx);vibrate(6);}});}),h('button',{className:'pe-clear',onClick:clearInk},'Стереть всё')):null,
  mode==='crop'?h('div',{className:'pe-crophint'},crop?h('button',{className:'btn sm',onClick:applyCrop},h(I,{name:'check',size:16,w:2.6}),'Применить обрезку'):h('span',null,'Проведите по фото, выделяя нужную область')):null,
  p.burnable?h('div',{className:'pe-burn'},BURNS.map(function(bx){return h('button',{key:bx[0],className:burn===bx[0]?'on':'',onClick:function(){setBurn(bx[0]);vibrate(6);}},bx[1]);})):null,
  h('div',{className:'pe-bottom'},h('span',{className:'pe-note'},burn?(burn===1?'Получатель откроет фото один раз':'Фото удалится через '+burn+' сек после открытия'):(hd?'Высокое качество':'Экономия трафика')),
   h('button',{className:'pe-send',disabled:busy,onClick:doSend},busy?h('span',{className:'spin w'}):h(I,{name:'send',size:19}))));}

/* ---------- Composer (shared) ---------- */
/* Поле ввода неуправляемое: React больше не перерисовывает чат на каждый символ.
   В стейте живёт только флаг «есть текст» — он переключает микрофон на самолётик.
   Именно из-за controlled input лента дёргалась и поле «тянулось» при наборе. */
function Composer(p){var [has,setHas]=useState(!!(p.preset||''));var [rec,setRec]=useState(null);var [sec,setSec]=useState(0);var [lock,setLock]=useState(false);var [paused,setPaused]=useState(false);var [pv,setPv]=useState(null);var [drag,setDrag]=useState({x:0,y:0});var [wave,setWave]=useState(null);var [sel,setSel]=useState(false);var [pvPlay,setPvPlay]=useState(false);var [pedit,setPedit]=useState(null);var [stik,setStik]=useState(false);
 var recorder=useRef(null),chunks=useRef([]),t0=useRef(0),typingT=useRef(0),inp=useRef(null),held=useRef(false),starting=useRef(false),mx=useRef(0),my=useRef(0);
 var actx=useRef(null),anl=useRef(null),wraf=useRef(0),wbuf=useRef(null),pvAudio=useRef(null),pauseAt=useRef(0),pausedMs=useRef(0);
 function val(){return inp.current?inp.current.value:'';}
 function put(v){if(!inp.current)return;inp.current.value=v;grow();var nx=!!v.trim();setHas(function(o){return o===nx?o:nx;});}
 /* Автовысота как в ТГ: до 5 строк, дальше скролл внутри поля. */
 function grow(){var el=inp.current;if(!el)return;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,124)+'px';}
 useEffect(function(){if(p.preset)put(p.preset);grow();},[]);
 useEffect(function(){if(p.editing){put(p.editing.text||'');inp.current&&inp.current.focus();}},[p.editing&&p.editing.id]);
 useEffect(function(){if(p.focusTick)inp.current&&inp.current.focus();},[p.focusTick]);
 useEffect(function(){if(p.mention){var t=val();put((t?t+' ':'')+'@'+p.mention+' ');inp.current&&inp.current.focus();}},[p.mention]);
 function onType(){grow();var v=val();var nx=!!v.trim();setHas(function(o){return o===nx?o:nx;});
  var now=Date.now();if(now-typingT.current>2500){typingT.current=now;p.onTyping&&p.onTyping();}}
 /* ---------- форматирование выделения: **жирный** __курсив__ `моно` ~~зачёркнутый~~ ||спойлер|| > цитата [текст](ссылка) ---------- */
 function checkSel(){var el=inp.current;if(!el)return;var s=el.selectionStart,e=el.selectionEnd;var on=(e-s)>0&&!rec&&!pv;setSel(function(o){return o===on?o:on;});}
 function wrapSel(a,b){var el=inp.current;if(!el)return;var s=el.selectionStart,e=el.selectionEnd;if(s===e)return;var v=el.value,mid=v.slice(s,e),pre=v.slice(0,s),post=v.slice(e);
  if(pre.slice(-a.length)===a&&post.slice(0,b.length)===b){el.value=pre.slice(0,-a.length)+mid+post.slice(b.length);el.setSelectionRange(s-a.length,e-a.length);}
  else{el.value=pre+a+mid+b+post;el.setSelectionRange(s+a.length,e+a.length);}
  onType();el.focus();vibrate(8);}
 function quoteSel(){var el=inp.current;if(!el)return;var s=el.selectionStart,e=el.selectionEnd;if(s===e)return;var v=el.value;var ls=v.lastIndexOf('\n',s-1)+1;var le=v.indexOf('\n',e);if(le<0)le=v.length;
  var block=v.slice(ls,le);var off=block.split('\n').every(function(l){return l.slice(0,2)==='> ';});
  var next=block.split('\n').map(function(l){return off?l.slice(2):'> '+l;}).join('\n');
  el.value=v.slice(0,ls)+next+v.slice(le);el.setSelectionRange(ls,ls+next.length);onType();el.focus();vibrate(8);}
 function linkSel(){var el=inp.current;if(!el)return;var s=el.selectionStart,e=el.selectionEnd;if(s===e)return;var mid=el.value.slice(s,e);
  var url=window.prompt('Ссылка','https://');if(!url)return;el.value=el.value.slice(0,s)+'['+mid+']('+url.trim()+')'+el.value.slice(e);
  el.setSelectionRange(s,s+mid.length+url.trim().length+4);onType();el.focus();}
 /* Текст чистим сразу, отправка идёт фоном: клавиатура остаётся поднятой,
    можно набирать следующее сообщение не дожидаясь ответа сервера. */
 function send(file,extra){var t=val().trim();if(!t&&!file)return;
  if(p.editing&&!file){p.onEditSave(p.editing,t).then(function(ok){if(ok===false)put(t);});put('');return;}
  put('');setSel(false);p.onSend(t,file,extra).then(function(ok){if(ok===false&&!val())put(t);});}
 /* ---------- живая осциллограмма записи ---------- */
 function waveOn(stream){try{var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;actx.current=new AC();var src=actx.current.createMediaStreamSource(stream);var a=actx.current.createAnalyser();a.fftSize=512;a.smoothingTimeConstant=.65;src.connect(a);anl.current=a;wbuf.current=new Uint8Array(a.fftSize);
  var bars=new Array(28).fill(3),tick=0;
  var loopW=function(){wraf.current=requestAnimationFrame(loopW);if(!anl.current)return;if(++tick%3)return;
   anl.current.getByteTimeDomainData(wbuf.current);var sum=0,n=wbuf.current.length;
   for(var i=0;i<n;i++){var d=(wbuf.current[i]-128)/128;sum+=d*d;}
   var rms=Math.sqrt(sum/n);var hgt=Math.max(3,Math.min(22,Math.round(3+rms*95)));
   bars.push(hgt);if(bars.length>28)bars.shift();setWave(bars.slice());};
  loopW();}catch(e){}}
 function waveOff(){if(wraf.current)cancelAnimationFrame(wraf.current);wraf.current=0;anl.current=null;try{actx.current&&actx.current.close();}catch(e){}actx.current=null;setWave(null);}
 function startRec(){if(rec||starting.current)return;
  /* В PWA/standalone Safari отдаёт getUserMedia только по https и только из
     обработчика реального тапа. Раньше отказ выглядел как «ничего не работает». */
  if(!window.isSecureContext){p.toast('Голосовые работают только по https','error');return;}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){p.toast('Браузер не умеет записывать голосовые — откройте кабинет в Safari или Chrome','error');return;}held.current=true;starting.current=true;navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}}).then(function(stream){starting.current=false;if(!held.current){stream.getTracks().forEach(function(x){x.stop();});p.toast('Микрофон разрешён — нажмите ещё раз, чтобы записать','');return;}var mime=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(function(m){return MediaRecorder.isTypeSupported(m);})||'';var r=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);chunks.current=[];r.ondataavailable=function(e){if(e.data&&e.data.size)chunks.current.push(e.data);};r.onstop=function(){stream.getTracks().forEach(function(x){x.stop();});waveOff();recorder.current=null;var dur=(Date.now()-t0.current-pausedMs.current)/1000;var blob=new Blob(chunks.current,{type:r.mimeType||'audio/webm'});setRec(null);setPaused(false);
   if(r._cancel||dur<0.7||!blob.size){setLock(false);setPv(null);return;}
   var ext=(r.mimeType||'').indexOf('mp4')>=0?'m4a':((r.mimeType||'').indexOf('ogg')>=0?'ogg':'webm');
   if(r._preview){setPv({blob:blob,dur:dur,name:'voice.'+ext,url:URL.createObjectURL(blob)});return;}
   blob.name='voice.'+ext;setLock(false);send(blob,{duration:dur});};r.start(200);recorder.current=r;t0.current=Date.now();pausedMs.current=0;setRec(r);setSec(0);waveOn(stream);vibrate(20);}).catch(function(err){starting.current=false;held.current=false;var n=String(err&&err.name||'');
   if(n==='NotAllowedError'||n==='SecurityError')p.toast('Доступ к микрофону запрещён. Настройки → сайт → Микрофон → Разрешить','error');
   else if(n==='NotFoundError')p.toast('Микрофон не найден','error');
   else if(n==='NotReadableError')p.toast('Микрофон занят другим приложением','error');
   else p.toast('Не удалось включить микрофон','error');});}
 useEffect(function(){if(!rec)return;var t=setInterval(function(){if(!paused)setSec(Math.floor((Date.now()-t0.current-pausedMs.current)/1000));},250);return function(){clearInterval(t);};},[rec,paused]);
 useEffect(function(){return function(){waveOff();};},[]);
 function stopRec(){held.current=false;if(recorder.current&&recorder.current.state!=='inactive')recorder.current.stop();}
 function sendRec(){if(recorder.current&&recorder.current.state!=='inactive'){held.current=false;recorder.current.stop();}}
 function cancelRec(){_gOff();waveOff();if(recorder.current){recorder.current._cancel=true;stopRec();}setRec(null);setLock(false);setPv(null);setPaused(false);vibrate(18);}
 /* Замок и жесты записи */
 var lockR=useRef(false);useEffect(function(){lockR.current=lock;},[lock]);
 function _gOff(){document.removeEventListener('touchmove',_gMove,true);document.removeEventListener('touchend',_gUp,true);document.removeEventListener('touchcancel',_gUp,true);document.removeEventListener('mousemove',_gMove,true);document.removeEventListener('mouseup',_gUp,true);}
 function _gMove(e){micMove(e);}
 function _gUp(){_gOff();micUp();}
 function micDown(e){if(rec||recorder.current)return;var t=e.touches?e.touches[0]:e;mx.current=t.clientX;my.current=t.clientY;setDrag({x:0,y:0});
  /* Панель записи заменяет поле ввода, кнопка микрофона размонтируется —
     поэтому движение и отпускание ловим на документе. */
  document.addEventListener('touchmove',_gMove,{capture:true,passive:false});
  document.addEventListener('touchend',_gUp,true);
  document.addEventListener('touchcancel',_gUp,true);
  document.addEventListener('mousemove',_gMove,true);
  document.addEventListener('mouseup',_gUp,true);
  startRec();}
 function micMove(e){if(!recorder.current||lockR.current)return;var t=e.touches?e.touches[0]:e;if(!t)return;var dx=t.clientX-mx.current,dy=t.clientY-my.current;if(e.cancelable)e.preventDefault();setDrag({x:Math.min(0,dx),y:Math.min(0,dy)});
  if(dx<-72){_gOff();vibrate(25);cancelRec();return;}
  if(dy<-58){setLock(true);setDrag({x:0,y:0});vibrate([15,30,15]);}}
 function micUp(){if(lockR.current)return;setDrag({x:0,y:0});stopRec();}
 function pauseRec(){var r=recorder.current;if(!r)return;try{if(paused){r.resume();pausedMs.current+=Date.now()-pauseAt.current;setPaused(false);}else{r.pause();pauseAt.current=Date.now();setPaused(true);}vibrate(12);}catch(e){}}
 /* Стоп с прослушиванием: запись останавливается, но не отправляется */
 function previewRec(){var r=recorder.current;if(!r||r.state==='inactive')return;r._preview=true;held.current=false;r.stop();}
 function sendPv(){if(!pv)return;var b=pv.blob;b.name=pv.name;send(b,{duration:pv.dur});setPv(null);setLock(false);setPvPlay(false);}
 function dropPv(){if(pv&&pv.url)try{URL.revokeObjectURL(pv.url);}catch(e){}setPv(null);setLock(false);setPvPlay(false);vibrate(18);}
 function togglePv(){var a=pvAudio.current;if(!a)return;if(a.paused){a.play();setPvPlay(true);}else{a.pause();setPvPlay(false);}}
 var cancelNear=drag.x<-40;
 function bars(live){var src=live||[];return h('span',{className:'rwave'},(src.length?src:new Array(28).fill(3)).map(function(v,i){return h('i',{key:i,style:{height:v+'px'}});}));}
 /* Панель записи: слева корзина, справа «отправить» — всегда видимы и кликабельны */
 function recBar(kind){
  var trash=h('button',{className:'rtrash'+(cancelNear?' hot':''),onClick:kind==='pv'?dropPv:cancelRec,'aria-label':'Удалить запись'},h(I,{name:'trash',size:19}));
  var go=h('button',{className:'rsend',onClick:kind==='pv'?sendPv:sendRec,'aria-label':'Отправить'},h(I,{name:'send',size:19}));
  if(kind==='pv')return h('div',{className:'gc-rec locked pv'},trash,
    h('button',{className:'rbtn play',onClick:togglePv},h(I,{name:pvPlay?'pause':'play',size:17})),
    h('audio',{ref:pvAudio,src:pv.url,preload:'metadata',onEnded:function(){setPvPlay(false);},style:{display:'none'}}),
    h('span',{className:'rwave still'},new Array(28).fill(0).map(function(_,i){return h('i',{key:i,style:{height:(4+((i*7)%16))+'px'}});})),
    h('b',null,fmtDur(Math.round(pv.dur))),go);
  if(kind==='lock')return h('div',{className:'gc-rec locked'},trash,
    h('span',{className:'rdot'+(paused?' pause':'')}),h('b',null,fmtDur(sec)),bars(wave),
    h('button',{className:'rbtn',onClick:pauseRec,'aria-label':paused?'Продолжить':'Пауза'},h(I,{name:paused?'play':'pause',size:17})),
    h('button',{className:'rbtn',onClick:previewRec,title:'Прослушать','aria-label':'Прослушать'},h(I,{name:'headset',size:17})),go);
  return h('div',{className:'gc-rec',style:{transform:'translateX('+Math.round(drag.x/3)+'px)'}},trash,
    h('span',{className:'rdot'}),h('b',null,fmtDur(sec)),bars(wave),
    h('span',{className:'rhint'+(cancelNear?' hot':'')},h(I,{name:'back',size:13}),cancelNear?'Отпустите — отмена':'Влево — отмена'),
    h('span',{className:'rlock',style:{transform:'translateY('+Math.round(drag.y/2)+'px)'}},h(I,{name:'lock2',size:16})),go);}
 var FMT=[['**','**','fBold','Ж'],['__','__','fItal','К'],['~~','~~','fStrike','З'],['`','`','fMono','{}'],['||','||','fSpoil','▮']];
 return h(React.Fragment,null,pedit?h(PhotoEditor,{file:pedit,burnable:!!p.burnable,toast:p.toast,onCancel:function(){setPedit(null);},onSend:function(blob,ex){setPedit(null);blob.name='photo.jpg';send(blob,ex);}}):null,p.editing?h('div',{className:'gc-reply edit'},h(I,{name:'edit2',size:16}),h('div',null,h('b',null,'Изменение'),h('span',null,(p.editing.text||'').slice(0,80))),h('button',{onClick:function(){put('');p.onCancelEdit();}},h(I,{name:'close',size:16}))):null,p.reply&&!p.editing?h('div',{className:'gc-reply'},h(I,{name:'reply',size:16}),h('div',null,h('b',null,p.reply.name),h('span',null,p.reply.kind==='voice'?'🎤 Голосовое':(p.reply.kind==='photo'?'🖼 Фото':(p.reply.text||'').slice(0,80)))),h('button',{onClick:p.onCancelReply},h(I,{name:'close',size:16}))):null,
  sel&&!rec&&!pv?h('div',{className:'fmt-bar'},
    FMT.map(function(f){return h('button',{key:f[2],className:f[2],onMouseDown:function(e){e.preventDefault();},onClick:function(){wrapSel(f[0],f[1]);}},f[3]);}),
    h('button',{className:'fQuote',onMouseDown:function(e){e.preventDefault();},onClick:quoteSel},h(I,{name:'quote',size:15})),
    h('button',{className:'fLink',onMouseDown:function(e){e.preventDefault();},onClick:linkSel},h(I,{name:'link',size:15})),
    h('button',{className:'fClr',onMouseDown:function(e){e.preventDefault();},onClick:function(){var el=inp.current;if(el){el.setSelectionRange(el.selectionEnd,el.selectionEnd);setSel(false);el.focus();}}},h(I,{name:'close',size:14}))):null,
  pv?recBar('pv'):rec&&lock?recBar('lock'):rec?recBar():
  h('div',{className:'gc-send'},p.stickers?h('button',{className:'gc-ic'+(stik?' on':''),onMouseDown:function(e){e.preventDefault();},onClick:function(){setStik(!stik);vibrate(8);}},h(I,{name:'smile',size:20})):null,p.noMedia?null:h('label',{className:'gc-ic'},h(I,{name:'image',size:19}),h('input',{type:'file',accept:'image/*,video/mp4,video/webm,video/quicktime',hidden:true,disabled:p.busy,onChange:function(e){var f=e.target.files&&e.target.files[0];if(f&&/^image\//.test(f.type)){setPedit(f);}else if(f&&/^video\/(mp4|webm|quicktime)/.test(f.type)){if(f.size>40*1024*1024){p.toast&&p.toast('Видео больше 40 МБ','error');}else send(f);};e.target.value='';}})),h('textarea',{ref:inp,rows:1,placeholder:p.placeholder||'Сообщение',enterKeyHint:'send',autoCapitalize:'sentences',autoCorrect:'on',onFocus:function(){setStik(false);p.onFocus&&p.onFocus();},onBlur:function(){setTimeout(function(){setSel(false);},180);},onSelect:checkSel,onMouseUp:checkSel,onTouchEnd:checkSel,onKeyUp:checkSel,onInput:onType,onKeyDown:function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!p.busy)send();}}}),(has||p.noVoice)?h('button',{className:'gc-go'+(has?' pop':' idle'),onMouseDown:function(e){e.preventDefault();},onTouchStart:function(e){e.preventDefault();},disabled:p.busy||!has,onClick:function(){send();}},p.busy?h('span',{className:'spin w'}):h(I,{name:p.editing?'check':'send',size:19})):h('button',{className:'gc-go mic'+(rec?' on':''),
   onTouchStart:function(e){e.preventDefault();micDown(e);},
   onTouchMove:function(e){if(e.cancelable)e.preventDefault();micMove(e);},
   onTouchEnd:function(e){e.preventDefault();micUp();},
   onMouseDown:function(e){e.preventDefault();micDown(e);},
   onMouseUp:function(){micUp();},
   onContextMenu:function(e){e.preventDefault();}},h(I,{name:'mic',size:19}))),
  stik?h('div',{className:'stik-panel'},['❤️','😂','😍','🔥','👍','👎','😮','😢','🎉','🙏','💯','😎','🤔','😡','🥳','🤝','💪','☝️','⚡','💸','🍀','🚀','🏆','🎯'].map(function(e2){return h('button',{key:e2,onClick:function(){setStik(false);vibrate(10);p.onSend('',null,{stickerEmoji:e2});}},e2);})):null);}


/* Карточка звонка: что было, сколько длилось, перезвонить */
function CallInfoSheet(p){
 var c=p.c,m=p.m;
 function row(k,v){return h('div',{className:'ci-row'},h('span',null,k),h('b',null,v));}
 var when=new Date(m.created_at);
 return h(Sheet,{title:c.video?'Видеозвонок':'Звонок',sub:(p.peer&&p.peer.name)||'',onClose:p.onClose,center:true},
  h('span',{className:'ci-ic'+(c.missed?' miss':'')},h(I,{name:c.video?'cam':'phone',size:26})),
  h('b',{style:{fontSize:17,marginTop:8}},c.label),
  h('div',{className:'ci-list'},
   row('Направление',m.mine?'Исходящий':'Входящий'),
   row('Тип',c.video?'С видео':'Только звук'),
   row('Дата',when.toLocaleDateString('ru-RU',{day:'2-digit',month:'long'})),
   row('Время',fmtTime(m.created_at)),
   row('Длительность',c.sec?L.callDur(c.sec):'—'),
   row('Итог',{missed:'Не ответили',declined:'Отклонён',cancel:'Отменён',hangup:'Завершён',failed:'Обрыв связи'}[c.reason]||'Завершён')),
  h('div',{className:'ci-btns'},
   h('button',{className:'btn',onClick:function(){p.onCall(false);}},h(I,{name:'phone',size:18}),'Позвонить'),
   c.video?h('button',{className:'btn ghost',onClick:function(){p.onCall(true);}},h(I,{name:'cam',size:18}),'Видео'):null));}

/* Пересылка: до 5 чатов за раз, Избранное первой строкой */
function ForwardSheet(p){var [items,setItems]=useState(null);var [sel,setSel]=useState([]);var [busy,setBusy]=useState(false);
 useEffect(function(){api('/api/web/dm').then(function(r){setItems((r.items||[]).filter(function(x){return !x.request;}));}).catch(function(){setItems([]);});},[]);
 function tog(id){setSel(function(cur){if(cur.indexOf(id)>=0)return cur.filter(function(x){return x!==id;});if(cur.length>=5){p.toast('Максимум 5 чатов за раз','');return cur;}return cur.concat([id]);});}
 function go(){if(!sel.length||busy)return;setBusy(true);
  api('/api/web/forward',{method:'POST',body:{scope:p.scope||'chat',peer_id:p.peerId||0,message_id:p.m.id,targets:sel}})
   .then(function(r){vibrate([20,40,20]);ding('ok');
    /* Если переслали в открытый сейчас чат — показываем сразу, не ждём long-poll. */
    if(p.onSent)p.onSent(r&&r.messages||[]);
    p.toast('Переслано: '+sel.length,'success');p.onClose();})
   .catch(function(e){p.toast(e.message,'error');}).then(function(){setBusy(false);});}
 return h(Sheet,{title:'Переслать',sub:'Выберите до 5 чатов',onClose:p.onClose},
  h('div',{className:'fwd-prev'},h(I,{name:'reply',size:15}),h('span',null,(p.m.text||(p.m.kind==='photo'?'🖼 Фото':(p.m.kind==='voice'?'🎤 Голосовое':'Сообщение'))).slice(0,90))),
  h('div',{className:'list'},
   h('button',{className:'dm-row'+(sel.indexOf(p.meId)>=0?' sel':''),onClick:function(){tog(p.meId);}},
    h('span',{className:'dm-av'},h('span',{className:'cav sys fav'},h(I,{name:'pin',size:19}))),
    h('span',{className:'t'},h('b',null,'Избранное'),h('small',null,'Сохранить себе')),
    h('span',{className:'fw-tick'+(sel.indexOf(p.meId)>=0?' on':'')},h(I,{name:'check',size:13,w:3}))),
   items===null?h('div',{className:'center',style:{padding:16}},h('span',{className:'spin'})):items.map(function(it){var on=sel.indexOf(it.peer.id)>=0;
    return h('button',{key:it.peer.id,className:'dm-row'+(on?' sel':''),onClick:function(){tog(it.peer.id);}},
     h('span',{className:'dm-av'},h(Av,{src:it.peer.avatar,name:it.peer.name,size:44}),it.peer.online?h('i',{className:'on'}):null),
     h('span',{className:'t'},h('b',null,it.peer.name),h('small',null,it.peer.online?'в сети':'был(а) недавно')),
     h('span',{className:'fw-tick'+(on?' on':'')},h(I,{name:'check',size:13,w:3})));})),
  h('button',{className:'btn mt12',disabled:!sel.length||busy,onClick:go},busy?h('span',{className:'spin w'}):h(I,{name:'send',size:18}),sel.length?('Переслать · '+sel.length):'Выберите чат'));}

/* ---------- Context menu ---------- */
function MsgMenu(p){var m=p.m;return h('div',{className:'gc-menu-bd',onClick:p.onClose},h('div',{className:'gc-menu',onClick:function(e){e.stopPropagation();}},
 (p.onReact&&!m.deleted)?h('div',{className:'rx-row'},['❤️','👍','🔥','😂','😮','👎'].map(function(e2){var mine=(m.reactions||[]).some(function(x){return x.e===e2&&x.me;});return h('button',{key:e2,className:mine?'on':'',onClick:function(){p.onReact(m,e2);p.onClose();}},e2);})):null,
 h('div',{className:'gc-menu-prev'},h('b',null,m.name||(m.mine?'Вы':'')),h('span',null,m.kind==='voice'?'🎤 Голосовое':(m.kind==='photo'?'🖼 Фото':(m.kind==='video'?'🎬 Видео':(m.text||'').slice(0,100))))),h('button',{onClick:function(){p.onReply(m);p.onClose();}},h(I,{name:'reply',size:18}),'Ответить'),!m.deleted&&p.onForward?h('button',{onClick:function(){p.onForward(m);p.onClose();}},h(I,{name:'send',size:18}),'Переслать'):null,m.text?h('button',{onClick:function(){copyText(m.text,'Текст скопирован');p.onClose();}},h(I,{name:'copy',size:18}),'Копировать'):null,!m.deleted&&p.onPin?h('button',{onClick:function(){p.onPin(m);p.onClose();}},h(I,{name:'pin',size:18}),'Закрепить'):null,!m.mine&&p.onUser?h('button',{onClick:function(){p.onUser(m.user_id||m.from_id);p.onClose();}},h(I,{name:'user',size:18}),'Профиль'):null,!m.mine&&p.onDm?h('button',{onClick:function(){p.onDm(m.user_id||m.from_id);p.onClose();}},h(I,{name:'msg',size:18}),'Написать лично'):null,m.mine&&!m.deleted&&m.text&&editable(m)&&p.onEdit?h('button',{onClick:function(){p.onEdit(m);p.onClose();}},h(I,{name:'edit2',size:18}),'Изменить'):null,m.mine&&!m.deleted&&editable(m)?h('button',{className:'danger',onClick:function(){p.onDelete(m,true);p.onClose();}},h(I,{name:'trash',size:18}),'Удалить у всех'):null,
 !m.deleted?h('button',{onClick:function(){p.onDelete(m,false);p.onClose();}},h(I,{name:'x',size:18}),'Удалить у себя'):null,m.mine&&!m.deleted&&!editable(m)?h('div',{className:'gc-menu-note'},'Изменить или удалить можно в течение 5 минут'):null));}
function editable(m){return (Date.now()-new Date(m.created_at))<5*60*1000;}

/* ---------- User profile sheet ---------- */
function UserSheet(p){var [u,setU]=useState(p.user||null);var [tab,setTab]=useState('info');var [media,setMedia]=useState(null);var [inCt,setInCt]=useState(null);var [shareU,setShareU]=useState(false);var [askAlias,setAskAlias]=useState(null);var [callable,setCallable]=useState(null);
 useEffect(function(){if(!u||p.me&&p.me.id===u.id)return;api('/api/web/calls/peer/'+u.id).then(setCallable).catch(function(){});},[u&&u.id]);
 useEffect(function(){if(!u||p.me&&p.me.id===u.id)return;api('/api/web/contacts/state/'+u.id).then(function(r){setInCt(!!r.contact);}).catch(function(){});},[u&&u.id]);
 function togCt(){if(!inCt){setAskAlias({v:''});return;}setInCt(false);api('/api/web/contacts/'+u.id,{method:'DELETE'}).then(function(){p.toast&&p.toast('Удалён из контактов','success');}).catch(function(e){setInCt(true);p.toast&&p.toast(e.message,'error');});}
 /* 12.2: своё имя для контакта — видно только вам */
 function addCt(alias){setAskAlias(null);setInCt(true);api('/api/web/contacts/'+u.id,{method:'POST',body:{alias:alias||''}}).then(function(){p.toast&&p.toast(alias?('В контактах как «'+alias+'»'):'Добавлен в контакты','success');}).catch(function(e){setInCt(false);p.toast&&p.toast(e.message,'error');});}
 useEffect(function(){if(p.user)return;api(p.handle?('/api/web/users/'+encodeURIComponent(p.handle)):('/api/web/chat/user/'+p.id)).then(function(r){setU(r.user);}).catch(function(e){p.toast&&p.toast(e.message,'error');p.onClose();});},[p.id,p.handle]);
 useEffect(function(){if(!u||tab==='info'||media)return;api('/api/web/media/'+u.id+'?scope='+(p.scope||'chat')).then(setMedia).catch(function(){setMedia({photos:[],videos:[],links:[]});});},[u&&u.id,tab]);
 if(!u)return h(Sheet,{title:'Профиль',onClose:p.onClose,center:true},h('div',{className:'center'},h('span',{className:'spin'})));
 var mine=p.me&&p.me.id===u.id;
 var cnt=media?{photos:media.photos.length,videos:media.videos.length,links:media.links.length}:null;
 function grid(items,video){return items.length?h('div',{className:'umedia'},items.map(function(x){return h('button',{key:(video?'v':'p')+x.id,className:'umcell'+(video?' vid':''),onClick:function(){if(!video&&L.openPhoto)L.openPhoto(x.url);}},video?h('video',{src:x.url,muted:true,playsInline:true,preload:'metadata'}):h('img',{src:x.url,alt:'',loading:'lazy'}),video?h('span',{className:'pl'},h(I,{name:'play',size:16})):null);})):h('div',{className:'umempty'},h(I,{name:video?'tv':'image',size:22}),video?'Видео пока нет':'Фото пока нет');}
 function ulink(x){return location.origin+'/app/#/u/'+(x.username||('id'+x.id));}
 var bodyTab=tab==='qr'?h('div',{className:'uqr'},h('img',{src:'/api/web/users/'+encodeURIComponent(u.username||('id'+u.id))+'/qr.png',alt:'QR',onError:function(e){e.target.style.display='none';}}),h('div',{className:'linkbox',onClick:function(){copyText(ulink(u),'Ссылка скопирована');}},h(I,{name:'link',size:16}),h('span',null,ulink(u).replace(/^https?:\/\//,'')),h(I,{name:'copy',size:15}))):(tab==='info'?h(React.Fragment,null,
   u.bio?h('p',{className:'ubio'},u.bio):null,
   h('div',{className:'stats2',style:{width:'100%',marginTop:12}},h('div',{className:'stat'},h('small',null,'Сообщений'),h('b',null,u.messages||0)),h('div',{className:'stat'},h('small',null,'С нами с'),h('b',null,fmtDate(u.since).split(',')[0]))),
   mine?null:h('div',{className:'two-btn',style:{width:'100%',marginTop:10}},h('button',{className:'btn',onClick:function(){p.onDm(u.id);}},h(I,{name:'msg',size:18}),'Написать'),h('button',{className:'btn ghost',onClick:function(){p.onMention(u.username||u.name);}},h(I,{name:'at',size:18}),'Упомянуть')),
   h('div',{className:'u-actions'},
    h('button',{onClick:function(){setTab('qr');}},h(I,{name:'qr2',size:18}),'QR-код'),
    h('button',{onClick:function(){setShareU(true);}},h(I,{name:'send',size:18}),'Переслать'))
 ):(media===null?h('div',{className:'center',style:{padding:24}},h('span',{className:'spin'})):
   (tab==='photos'?grid(media.photos,false):(tab==='videos'?grid(media.videos,true):
    (media.links.length?h('div',{className:'ulinks'},media.links.map(function(x){return h('a',{key:'l'+x.id,href:x.url,target:'_blank',rel:'noopener noreferrer'},h('span',{className:'li'},h(I,{name:'link',size:16})),h('span',{className:'lt'},h('b',null,x.url.replace(/^https?:\/\//,'').slice(0,52)),h('small',null,fmtDate(x.created_at))));})):h('div',{className:'umempty'},h(I,{name:'link',size:22}),'Ссылок пока нет'))))));
 return h(Sheet,{title:u.name,sub:u.online?'в сети':'был(а) '+ago(u.last_seen),onClose:p.onClose,center:tab==='info'},
  h('div',{className:'uhead'},h('button',{className:'uav-tap',onClick:function(){if(u.avatar&&L.openPhoto)L.openPhoto(u.avatar,u.name);},'aria-label':'Открыть фото'},h(Av,{src:u.avatar,name:u.name,size:84,className:'big'})),h('div',{className:'uname'},u.name,u.verified?h('span',{className:'vbadge'},h(I,{name:'check',size:11,w:3})):null),u.username?h('button',{className:'muted uatag',onClick:function(){copyText('@'+u.username,'@'+u.username+' скопирован');}},'@'+u.username,h(I,{name:'copy',size:12})):null,u.phone?h('a',{className:'muted uatag uphone',href:'tel:'+String(u.phone).replace(/[^+0-9]/g,''),onClick:function(e){e.stopPropagation();}},h(I,{name:'phone',size:12}),u.phone):null),
  mine?null:h('div',{className:'u-chips'},
   p.onDm?h('button',{onClick:function(){p.onDm(u.id);}},h(I,{name:'msg',size:20}),h('span',null,'чат')):null,
   h('button',{className:(callable&&!callable.can_call)?'off':'',onClick:function(){if(callable&&!callable.can_call){p.toast&&p.toast(callable.reason||u.name+' не принимает звонки','');vibrate(8);return;}p.onClose();if(L.startCall)L.startCall({id:u.id,name:u.name,avatar:u.avatar||''},false);}},h(I,{name:'phone',size:20}),h('span',null,'звонок')),
   h('button',{className:(callable&&!callable.can_call)?'off':'',onClick:function(){if(callable&&!callable.can_call){p.toast&&p.toast(callable.reason||u.name+' не принимает видеозвонки','');vibrate(8);return;}p.onClose();if(L.startCall)L.startCall({id:u.id,name:u.name,avatar:u.avatar||''},true);}},h(I,{name:'cam',size:20}),h('span',null,'видео')),
   h('button',{onClick:function(){copyText(ulink(u),'Ссылка на профиль скопирована');}},h(I,{name:'link',size:20}),h('span',null,'ссылка'))),
  (mine||inCt===null)?null:h('button',{className:'row nav-row uct',onClick:togCt},h('span',{className:'i'},h(I,{name:inCt?'check':'user',size:18})),h('span',{className:'t'},h('b',null,inCt?'В контактах':'Добавить в контакты'),h('small',null,inCt?'Нажмите, чтобы убрать':'Со своим именем — видно только вам')),h(I,{name:'chev',size:18,className:'chev'})),
  h('div',{className:'utabs'},[['info','О профиле'],['photos','Фото'],['videos','Видео'],['links','Ссылки'],['qr','QR']].map(function(t){return h('button',{key:t[0],className:tab===t[0]?'on':'',onClick:function(){setTab(t[0]);}},t[1],(cnt&&t[0]!=='info'&&cnt[t[0]])?h('i',null,cnt[t[0]]):null);})),
  bodyTab,
  askAlias?h(Sheet,{title:'В контакты',sub:'можно со своим именем',onClose:function(){setAskAlias(null);}},
   h('input',{className:'inp',placeholder:u.name,maxLength:48,value:askAlias.v,onChange:function(e){setAskAlias({v:e.target.value});}}),
   h('p',{className:'note'},'Это имя увидите только вы — в чатах и контактах. Профиль собеседника не меняется.'),
   h('button',{className:'btn mt12',onClick:function(){addCt(askAlias.v.trim());}},h(I,{name:'check',size:18,w:2.6}),'Добавить')):null,
  shareU?h(ShareLinkSheet,{title:'Профиль '+u.name,link:ulink(u),text:'Профиль '+u.name+' в LUXON: '+ulink(u),toast:p.toast,onClose:function(){setShareU(false);}}):null);}

/* Пересылка ссылки (профиль, бот) по чатам — до 5, плюс системный шэринг */
function ShareLinkSheet(p){var [items,setItems]=useState(null);var [sel,setSel]=useState([]);var [busy,setBusy]=useState(false);
 useEffect(function(){api('/api/web/dm').then(function(r){setItems((r.items||[]).filter(function(x){return !x.request;}));}).catch(function(){setItems([]);});},[]);
 function tog(id){setSel(function(cur){if(cur.indexOf(id)>=0)return cur.filter(function(x){return x!==id;});if(cur.length>=5){p.toast&&p.toast('Максимум 5 чатов','');return cur;}return cur.concat([id]);});}
 function go(){if(!sel.length||busy)return;setBusy(true);
  var okN=0;
  sel.reduce(function(chain,id){return chain.then(function(){
   return api('/api/web/dm/'+id+'/send',{method:'POST',body:{text:p.text}})
    .then(function(){okN++;}).catch(function(){});});},Promise.resolve())
   .then(function(){vibrate([20,40,20]);ding('ok');
    p.toast&&p.toast(okN?('Отправлено: '+okN):'Не удалось отправить',okN?'success':'error');
    if(okN)p.onClose();setBusy(false);});}
 return h(Sheet,{title:'Переслать',sub:p.title,onClose:p.onClose},
  h('button',{className:'fwd-prev tap',onClick:function(){copyText(p.link,'Ссылка скопирована');}},
   h(I,{name:'link',size:15}),h('span',null,p.link),h(I,{name:'copy',size:15})),
  h('div',{className:'f-label'},'Отправить в чаты'),
  h('div',{className:'list'},items===null?h('div',{className:'center',style:{padding:16}},h('span',{className:'spin'})):
   (!items.length?h('div',{className:'empty-line'},h(I,{name:'msg',size:18}),'Нет переписок — можно поделиться системно'):
    items.map(function(it){var on=sel.indexOf(it.peer.id)>=0;
     return h('button',{key:it.peer.id,className:'dm-row'+(on?' sel':''),onClick:function(){tog(it.peer.id);}},
      h('span',{className:'dm-av'},h(Av,{src:it.peer.avatar,name:it.peer.name,size:44}),it.peer.online?h('i',{className:'on'}):null),
      h('span',{className:'t'},h('b',null,it.peer.name),h('small',null,it.peer.online?'в сети':'был(а) недавно')),
      h('span',{className:'fw-tick'+(on?' on':'')},h(I,{name:'check',size:13,w:3})));}))),
  h('button',{className:'btn mt12',disabled:!sel.length||busy,onClick:go},busy?h('span',{className:'spin w'}):h(I,{name:'send',size:18}),sel.length?('Отправить · '+sel.length):'Выберите чат'),
  h('button',{className:'btn ghost mt8',onClick:function(){if(navigator.share){navigator.share({title:p.title,url:p.link}).catch(function(){});}else copyText(p.link,'Ссылка скопирована');}},h(I,{name:'ext',size:17}),'Поделиться вне LUXON'));}

/* ---------- Group chat ---------- */
function GroupChat(p){var [msgs,setMsgs]=useState(null);var [fwd,setFwd]=useState(null);var [pins,setPins]=useState([]);var [pinI,setPinI]=useState(0);var [reply,setReply]=useState(null);var [editing,setEditing]=useState(null);var [online,setOnline]=useState(0);var [typing,setTyping]=useState([]);var [busy,setBusy]=useState(false);var [menu,setMenu]=useState(null);var [who,setWho]=useState(null);var [atBottom,setAtBottom]=useState(true);var [unseen,setUnseen]=useState(0);var [mention,setMention]=useState('');var [focusTick,setFocusTick]=useState(0);
 var box=useRef(null),lastId=useRef(0),firstId=useRef(0),alive=useRef(true),ctl=useRef(null),olderBusy=useRef(false),atBot=useRef(true);
 /* Поллинг живёт в одном замыкании с первого рендера: читать оттуда стейт нельзя,
    иначе лента дёргается и скроллит не туда. Держим позицию в ref. */
 function scrollBottom(smooth){L.stickBottom(box,smooth,true);}
 function merge(items,initial_){if(!items.length)return;setMsgs(function(prev){var base=prev||[];var seen={};base.forEach(function(m){seen[m.id]=1;});var add=items.filter(function(m){return !seen[m.id];});var upd=base.map(function(m){var f=items.find(function(x){return x.id===m.id;});return f||m;});if(!add.length)return upd;lastId.current=Math.max(lastId.current,add[add.length-1].id);if(!firstId.current)firstId.current=add[0].id;if(!initial_){var others=add.filter(function(m){return !m.mine;}).length;if(others){if(atBot.current)scrollBottom(true);else setUnseen(function(v){return v+others;});ding();}}return upd.concat(add);});}
 useEffect(function(){alive.current=true;Promise.all([api('/api/web/chat/messages?limit=50'),api('/api/web/chat/pins').catch(function(){return {items:[]};})]).then(function(rs){var r=rs[0];var items=dropHidden('chat',r.items||[]);setMsgs(items);if(items.length){lastId.current=items[items.length-1].id;firstId.current=items[0].id;}setOnline(r.online||0);setTyping(r.typing||[]);setPins(rs[1].items||[]);scrollBottom(false);loop();}).catch(function(){setMsgs([]);loop();});return function(){alive.current=false;if(ctl.current)ctl.current.abort();};},[]);
 function loop(){if(!alive.current)return;var c=new AbortController();ctl.current=c;fetch('/api/web/chat/poll?after_id='+lastId.current+'&wait=25',{credentials:'same-origin',signal:c.signal,headers:tokenHeader()}).then(function(r){return r.json();}).then(function(r){if(!alive.current)return;if(r&&r.items)merge(r.items);if(r){setOnline(r.online||0);setTyping(r.typing||[]);}if(r&&r.items&&r.items.length)api('/api/web/chat/pins').then(function(x){setPins(x.items||[]);}).catch(function(){});setTimeout(loop,r&&r.items&&r.items.length?0:250);}).catch(function(){if(alive.current)setTimeout(loop,2500);});}
 useEffect(function(){var b=box.current;if(!b)return;var raf=0;function onS(){var nb=b.scrollHeight-b.scrollTop-b.clientHeight<90;atBot.current=nb;if(raf)return;raf=requestAnimationFrame(function(){raf=0;setAtBottom(nb);if(nb)setUnseen(0);});if(b.scrollTop<60&&firstId.current>1)older();}b.addEventListener('scroll',onS,{passive:true});return function(){b.removeEventListener('scroll',onS);};},[msgs===null]);
 function older(){if(olderBusy.current)return;olderBusy.current=true;var b=box.current,ph=b?b.scrollHeight:0;api('/api/web/chat/messages?before_id='+firstId.current+'&limit=40').then(function(r){var items=r.items||[];if(!items.length){firstId.current=1;return;}firstId.current=items[0].id;setMsgs(function(prev){return items.concat(prev||[]);});setTimeout(function(){if(b)b.scrollTop=b.scrollHeight-ph;},20);}).catch(function(){}).then(function(){olderBusy.current=false;});}
 /* Как в ТГ: пузырь появляется сразу с часиками и заменяется настоящим,
    когда сервер ответил. Ожидание сети больше не видно. */
 function send(t,file,extra){if(busy)return Promise.resolve(false);setBusy(true);var tmp='t'+Date.now();
  var ghost={id:tmp,pending:true,mine:true,user_id:(p.user&&p.user.id)||0,name:(p.user&&p.user.name)||'',kind:file?(extra&&extra.duration?'voice':'photo'):'text',text:t,file_url:file&&!extra?'':'',duration:(extra&&extra.duration)||0,reply:reply?{id:reply.id,name:reply.name,text:reply.text}:null,created_at:new Date().toISOString()};
  setMsgs(function(prev){return (prev||[]).concat([ghost]);});scrollBottom(true);vibrate(10);
  var body;if(file){body=new FormData();body.append('text',t);body.append('file',file,file.name||'voice.webm');if(reply)body.append('reply_to',reply.id);if(extra&&extra.duration)body.append('duration',String(extra.duration));if(extra&&extra.burn)body.append('burn',String(extra.burn));}else body={text:t,reply_to:reply?reply.id:null};
  setReply(null);
  return api('/api/web/chat/send',{method:'POST',body:body,timeout:60000}).then(function(r){
   setMsgs(function(prev){var list=prev||[];var out=list.map(function(x){return x.id===tmp?r.message:x;});
    var seen={};out=out.filter(function(x){if(seen[x.id])return false;seen[x.id]=1;return true;});
    if(!seen[r.message.id])out=out.concat([r.message]);return out;});
   lastId.current=Math.max(lastId.current,r.message.id);scrollBottom(true);setBusy(false);return true;
  }).catch(function(e){
   setMsgs(function(prev){return (prev||[]).map(function(x){return x.id===tmp?Object.assign({},x,{pending:false,failed:true}):x;});});
   p.toast(e.message,'error');setBusy(false);return false;});}
 /* «У себя» прячем локально (список скрытых живёт в localStorage), «у всех» — на сервере. */
 function del(m,all){if(!all){hideLocal('chat',m.id);setMsgs(function(prev){return (prev||[]).filter(function(x){return x.id!==m.id;});});return;}
  api('/api/web/chat/delete',{method:'POST',body:{id:m.id}}).then(function(){setMsgs(function(prev){return (prev||[]).map(function(x){return x.id===m.id?Object.assign({},x,{deleted:true,text:'',file_url:''}):x;});});}).catch(function(e){p.toast(e.message,'error');});}
 var pinIds=useMemo(function(){var o={};pins.forEach(function(x){o[x.id]=1;});return o;},[pins]);
 var groups=useMemo(function(){var out=[],last='';(msgs||[]).forEach(function(m){var d=fmtDay(m.created_at);if(d!==last){out.push({day:d,id:'d'+m.id});last=d;}out.push(m);});return out;},[msgs]);
 var pin=pins.length?pins[pinI%pins.length]:null;
 useVH();return h('div',{className:'gchat fixed'},
  h('div',{className:'gc-head'},h('button',{className:'gc-ic',onClick:p.onBack},h(I,{name:'back',size:20})),h('div',{className:'gc-title'},h('b',null,(p.brand||'LUXON')+' чат'),h('small',null,typing.length?h('span',{className:'typing'},typing.slice(0,2).join(', ')+(typing.length>1?' печатают':' печатает'),h('i'),h('i'),h('i')):h('span',{className:'st-on'},h('i',{className:'dot-on'}),'в сети: '+online))),h('button',{className:'gc-ic',onClick:p.onDms},h(I,{name:'msg',size:19}),p.dmUnread?h('span',{className:'badge'},p.dmUnread):null),h('button',{className:'gc-ic',onClick:p.onRules},h(I,{name:'doc',size:18}))),
  pin?h('button',{className:'gc-pin',onClick:function(){setPinI(pinI+1);var el=document.getElementById('gm-'+pin.id);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('flash');setTimeout(function(){el.classList.remove('flash');},1200);}}},h(I,{name:'pin',size:15}),h('div',null,h('b',null,'Закреплено'+(pins.length>1?' '+((pinI%pins.length)+1)+'/'+pins.length:'')),h('span',null,pin.text||(pin.kind==='photo'?'🖼 Фото':'🎤 Голосовое')))):null,
  h('div',{className:'gc-msgs',ref:box,onPointerDown:blurComposer},msgs===null?h('div',{className:'center'},h('span',{className:'spin'})):(!msgs.length?h('div',{className:'gc-empty'},h(I,{name:'chat',size:30}),h('b',null,'Пока тихо'),h('span',null,'Напишите первым')):groups.map(function(m,idx){if(m.day)return h('div',{key:m.id,className:'gc-day'},h('span',null,m.day));var prev=groups[idx-1],cont=prev&&!prev.day&&prev.user_id===m.user_id&&(new Date(m.created_at)-new Date(prev.created_at))<240000;return h('div',{key:m.id,id:'gm-'+m.id,className:'gm-wrap'},h(Bubble,{m:m,cont:cont,showAv:true,pinned:!!pinIds[m.id],onReply:function(x){setReply(x);setFocusTick(Date.now());},onMenu:setMenu,onUser:function(id){setWho({id:id});}}));}))),
  (!atBottom||unseen)?h('button',{className:'gc-new',onClick:function(){scrollBottom(true);setUnseen(0);},'aria-label':'Вниз'},h(I,{name:'arrowDown',size:20}),unseen?h('span',{className:'cnt'},unseen>99?'99+':unseen):null):null,
  h(Composer,{reply:reply,onCancelReply:function(){setReply(null);},editing:editing,onCancelEdit:function(){setEditing(null);},onEditSave:function(m,t){return api('/api/web/chat/edit',{method:'POST',body:{id:m.id,text:t}}).then(function(r){setMsgs(function(prev){return (prev||[]).map(function(x){return x.id===m.id?Object.assign({},x,{text:r.text,edited:true}):x;});});setEditing(null);return true;}).catch(function(e){p.toast(e.message,'error');return false;});},onSend:send,busy:busy,toast:p.toast,mention:mention,focusTick:focusTick,onFocus:function(){scrollBottom(false);setTimeout(function(){scrollBottom(false);},260);setTimeout(function(){scrollBottom(false);},520);},onTyping:function(){api('/api/web/chat/typing',{method:'POST',body:{}}).catch(function(){});}}),
  menu?h(MsgMenu,{m:menu,onClose:function(){setMenu(null);},onReply:function(m){setReply(m);setFocusTick(Date.now());},onForward:function(m){setFwd(m);},onEdit:function(m){setEditing(m);setReply(null);},onDelete:del,onUser:function(id){setWho({id:id});},onDm:p.onDm,toast:p.toast}):null,
  fwd?h(ForwardSheet,{m:fwd,meId:p.user&&p.user.id,scope:'chat',toast:p.toast,onClose:function(){setFwd(null);}}):null,
  who?h(UserSheet,{id:who.id,me:p.user,onClose:function(){setWho(null);},onDm:function(id){setWho(null);p.onDm(id);},onMention:function(n){setWho(null);setMention(n+'_'+Date.now());setMention(n);}}):null);}

/* ---------- DM list ---------- */
function DmList(p){var [items,setItems]=useState(null);var alive=useRef(true);
 function load(){api('/api/web/dm').then(function(r){if(alive.current)setItems(r.items||[]);}).catch(function(){if(alive.current)setItems([]);});}
 useEffect(function(){alive.current=true;load();var iv=setInterval(load,4000);return function(){alive.current=false;clearInterval(iv);};},[]);
 useVH();return h('div',{className:'gchat fixed'},h('div',{className:'gc-head'},h('button',{className:'gc-ic',onClick:p.onBack},h(I,{name:'back',size:20})),h('div',{className:'gc-title'},h('b',null,'Личные сообщения'),h('small',null,'Переписка с участниками')),h('span',{style:{width:40}})),h('div',{className:'dm-list'},items===null?h('div',{className:'center'},h('span',{className:'spin'})):(!items.length?h('div',{className:'gc-empty',style:{marginTop:80}},h(I,{name:'msg',size:30}),h('b',null,'Нет переписок'),h('span',null,'Нажмите на участника в общем чате → «Написать»')):items.map(function(it){return h('button',{key:it.peer.id,className:'dm-row',onClick:function(){p.onOpen(it.peer.id);}},h('span',{className:'dm-av'},h(Av,{src:it.peer.avatar,name:it.peer.name,size:46}),it.peer.online?h('i',{className:'on'}):null),h('span',{className:'t'},h('b',null,it.peer.name,it.peer.verified?h(I,{name:'check',size:11,w:3,className:'vf'}):null),h('small',null,(it.last.mine?'Вы: ':'')+it.last.text)),h('span',{className:'r'},h('small',null,fmtTime(it.last.created_at)),it.unread?h('b',{className:'cnt'},it.unread):null));}))));}

/* ---------- DM thread ---------- */
function DmThread(p){var peer=p.peerId;var saved=p.meId&&String(p.meId)===String(peer);var [find,setFind]=useState(null);var [hits,setHits]=useState([]);var [hitI,setHitI]=useState(0);var findT=useRef(0);var [callable,setCallable]=useState(null);var [callInfoM,setCallInfo]=useState(null);var [fwd,setFwd]=useState(null);var [dpins,setDpins]=useState([]);var [dpinI,setDpinI]=useState(0);var [menu2,setMenu2]=useState(false);var [askClear,setAskClear]=useState(null);
 /* Статус подтягиваем отдельным быстрым запросом: long-poll висит до 25 с,
    и всё это время в шапке было «был(а) давно». */var [msgs,setMsgs]=useState(null);var [pinfo,setPinfo]=useState(null);var [reply,setReply]=useState(null);var [editing,setEditing]=useState(null);var [dstate,setDstate]=useState(null);var [atBottom,setAtBottom]=useState(true);var [unseen,setUnseen]=useState(0);var atBot=useRef(true);
 useEffect(function(){if(saved)return;api('/api/web/dm/state/'+peer).then(setDstate).catch(function(){});},[peer]);
 useEffect(function(){if(saved)return;api('/api/web/calls/peer/'+peer).then(setCallable).catch(function(){});},[peer]);
 function loadPins(){api('/api/web/dm/'+peer+'/pins').then(function(r){setDpins(r.items||[]);setDpinI(0);}).catch(function(){});}
 useEffect(loadPins,[peer]);
 function react(m,e2){vibrate(10);api('/api/web/dm/msg/'+m.id+'/react',{method:'POST',body:{emoji:e2}}).then(function(r){setMsgs(function(prev){return (prev||[]).map(function(x){return x.id===m.id?Object.assign({},x,{reactions:r.reactions}):x;});});}).catch(function(er){p.toast(er.message,'error');});}
 function pinMsg(m,on){api('/api/web/dm/'+peer+'/pin',{method:'POST',body:{id:m.id,pin:on}}).then(function(){vibrate(12);p.toast(on?'Закреплено':'Откреплено','success');loadPins();}).catch(function(e){p.toast(e.message,'error');});}
 function clearChat(scope){if(scope==='all'){return api('/api/web/dm/'+peer+'/clear',{method:'POST',body:{scope:'all'}}).then(function(){setMsgs([]);setDpins([]);p.toast('Переписка очищена у всех','success');});}
  try{var st=JSON.parse(localStorage.getItem('lux_clear')||'{}');var mx=0;(msgs||[]).forEach(function(m){if(typeof m.id==='number')mx=Math.max(mx,m.id);});st['dm'+peer]=mx;localStorage.setItem('lux_clear',JSON.stringify(st));}catch(e){}
  setMsgs([]);setDpins([]);p.toast('Очищено у вас','success');return Promise.resolve();}
 /* Поиск по всей переписке: сервер отдаёт id совпадений, контекст догружаем по before_id. */
 useEffect(function(){var q=(find||'').trim();if(q.length<2){setHits([]);setHitI(0);return;}
  var my=++findT.current;var tm=setTimeout(function(){
   api('/api/web/dm/'+peer+'/search?q='+encodeURIComponent(q)).then(function(r){
    if(my!==findT.current)return;var it=r.items||[];setHits(it);setHitI(0);if(it.length)jumpTo(it[0].id);
   }).catch(function(){});},300);
  return function(){clearTimeout(tm);};},[find,peer]);
 function jumpTo(id){
  var el=document.getElementById('m'+id);
  if(el){el.scrollIntoView({block:'center',behavior:'smooth'});return;}
  api('/api/web/dm/'+peer+'?before_id='+(id+1)+'&limit=40').then(function(r){
   var items=enrich(dropHidden('dm'+peer,r.items||[]),pinfo&&pinfo.name);
   setMsgs(items);setTimeout(function(){var e2=document.getElementById('m'+id);if(e2)e2.scrollIntoView({block:'center'});},60);
  }).catch(function(){});}
 function stepHit(d){if(!hits.length)return;var n=(hitI+d+hits.length)%hits.length;setHitI(n);jumpTo(hits[n].id);vibrate(8);}
 function clearFloor(){try{return (JSON.parse(localStorage.getItem('lux_clear')||'{}'))['dm'+peer]||0;}catch(e){return 0;}}
 useEffect(function(){var alive2=true;function ping(){api('/api/web/chat/user/'+peer).then(function(r){if(alive2&&r&&r.user)setPinfo(function(pi){return Object.assign({},pi||{},{id:r.user.id,name:r.user.name,avatar:r.user.avatar,verified:r.user.verified,online:!!r.user.online,last_seen:r.user.last_seen});});}).catch(function(){});}
  ping();var iv=setInterval(function(){if(!document.hidden)ping();},15000);return function(){alive2=false;clearInterval(iv);};},[peer]);
 function approve(){api('/api/web/dm/'+peer+'/approve',{method:'POST',body:{}}).then(function(){setDstate(function(d){return Object.assign({},d,{request:false,approved:true,can_write:true});});p.toast('Переписка открыта','success');}).catch(function(e){p.toast(e.message,'error');});}
 function block(spam){api('/api/web/dm/'+peer+'/block',{method:'POST',body:{}}).then(function(){p.toast(spam?'Отмечено как спам':'Пользователь заблокирован','');p.onBack();}).catch(function(e){p.toast(e.message,'error');});}var [busy,setBusy]=useState(false);var [menu,setMenu]=useState(null);var [typing,setTyping]=useState(false);var [focusTick,setFocusTick]=useState(0);var box=useRef(null),lastId=useRef(0),firstId=useRef(0),alive=useRef(true),ctl=useRef(null);
 function scrollBottom(s){L.stickBottom(box,s,true);}
 function merge(items){if(!items.length)return;var _cf=clearFloor();if(_cf)items=items.filter(function(m){return typeof m.id!=='number'||m.id>_cf;});if(!items.length)return;setMsgs(function(prev){var base=prev||[];var seen={};base.forEach(function(m){seen[m.id]=1;});var add=items.filter(function(m){return !seen[m.id];});var upd=base.map(function(m){var f=items.find(function(x){return x.id===m.id;});return f||m;});if(!add.length)return upd;lastId.current=Math.max(lastId.current,add[add.length-1].id);if(add.some(function(m){return !m.mine;})){ding();}if(atBot.current)scrollBottom(true);else setUnseen(function(v){return v+add.filter(function(m){return !m.mine;}).length;});return enrich(upd.concat(add),pinfo&&pinfo.name);});}
 /* В ЛС сервер шлёт только reply_to — имя и текст цитаты достаём из ленты. */
 function enrich(list,pname){list.forEach(function(m){if(!m.reply&&m.reply_to){var src=null;for(var k=0;k<list.length;k++){if(list[k].id===m.reply_to){src=list[k];break;}}m.reply={name:src?(src.mine?'Вы':(pname||'Сообщение')):'Сообщение',text:src?(src.text||''):'',kind:src?src.kind:'text'};}});return list;}
 useEffect(function(){alive.current=true;api('/api/web/dm/'+peer).then(function(r){var _cf=clearFloor();var items=enrich(dropHidden('dm'+peer,r.items||[]).filter(function(m){return !_cf||m.id>_cf;}),r.peer&&r.peer.name);setMsgs(items);setPinfo(r.peer);if(items.length){lastId.current=items[items.length-1].id;firstId.current=items[0].id;}scrollBottom(false);loop();}).catch(function(e){p.toast(e.message,'error');p.onBack();});return function(){alive.current=false;if(ctl.current)ctl.current.abort();};},[peer]);
 function loop(){if(!alive.current)return;var c=new AbortController();ctl.current=c;fetch('/api/web/dm/poll/'+peer+'?after_id='+lastId.current+'&wait=25',{credentials:'same-origin',signal:c.signal,headers:tokenHeader()}).then(function(r){return r.json();}).then(function(r){if(!alive.current)return;if(r&&r.items)merge(r.items);if(r&&r.read_upto){setMsgs(function(prev){var ch=false;var out=(prev||[]).map(function(m){if(m.mine&&!m.read&&typeof m.id==='number'&&m.id<=r.read_upto){ch=true;return Object.assign({},m,{read:true});}return m;});return ch?out:prev;});}if(r){setTyping(!!r.typing);setPinfo(function(pi){return pi?Object.assign({},pi,{online:!!r.online}):pi;});}setTimeout(loop,r&&r.items&&r.items.length?0:250);}).catch(function(){if(alive.current)setTimeout(loop,2500);});}
 function send(t,file,extra){if(busy)return Promise.resolve(false);var stkr=extra&&extra.stickerEmoji;if(stkr)t=extra.stickerEmoji;setBusy(true);var tmp='t'+Date.now();
  var ghost={id:tmp,pending:true,mine:true,from_id:0,kind:file?(extra&&extra.duration?'voice':'photo'):(stkr?'sticker':'text'),text:t,file_url:'',duration:(extra&&extra.duration)||0,created_at:new Date().toISOString()};
  setMsgs(function(prev){return (prev||[]).concat([ghost]);});scrollBottom(true);vibrate(10);
  var body;if(file){body=new FormData();body.append('text',t);body.append('file',file,file.name||'voice.webm');if(reply)body.append('reply_to',reply.id);if(extra&&extra.duration)body.append('duration',String(extra.duration));if(extra&&extra.burn)body.append('burn',String(extra.burn));}else{body={text:t,reply_to:reply?reply.id:null};if(stkr)body.sticker=1;}
  setReply(null);
  return api('/api/web/dm/'+peer+'/send',{method:'POST',body:body,timeout:60000}).then(function(r){
   setMsgs(function(prev){var list=prev||[];var out=list.map(function(x){return x.id===tmp?r.message:x;});
    var seen={};out=out.filter(function(x){if(seen[x.id])return false;seen[x.id]=1;return true;});
    if(!seen[r.message.id])out=out.concat([r.message]);return out;});
   lastId.current=Math.max(lastId.current,r.message.id);scrollBottom(true);setBusy(false);return true;
  }).catch(function(e){
   setMsgs(function(prev){return (prev||[]).map(function(x){return x.id===tmp?Object.assign({},x,{pending:false,failed:true}):x;});});
   p.toast(e.message,'error');setBusy(false);return false;});}
 function del(m,all){if(!all){hideLocal('dm'+peer,m.id);setMsgs(function(prev){return (prev||[]).filter(function(x){return x.id!==m.id;});});return;}
  api('/api/web/dm/'+peer+'/delete',{method:'POST',body:{id:m.id}}).then(function(){setMsgs(function(prev){return (prev||[]).map(function(x){return x.id===m.id?Object.assign({},x,{deleted:true,text:'',file_url:''}):x;});});}).catch(function(e){p.toast(e.message,'error');});}
 var groups=useMemo(function(){var out=[],last='';(msgs||[]).forEach(function(m){var d=fmtDay(m.created_at);if(d!==last){out.push({day:d,id:'d'+m.id});last=d;}out.push(m);});return out;},[msgs]);
 useEffect(function(){var b=box.current;if(!b)return;var raf=0;function onS(){var nb=b.scrollHeight-b.scrollTop-b.clientHeight<90;atBot.current=nb;if(raf)return;raf=requestAnimationFrame(function(){raf=0;setAtBottom(nb);if(nb)setUnseen(0);});}b.addEventListener('scroll',onS,{passive:true});return function(){b.removeEventListener('scroll',onS);};},[msgs===null]);
 useVH();return h('div',{className:'gchat fixed'},h('div',{className:'gc-head'},h('button',{className:'gc-ic',onClick:p.onBack},h(I,{name:'back',size:20})),
  saved?h('div',{className:'gc-peer'},h('span',{className:'cav sys fav sm'},h(I,{name:'pin',size:16})),h('div',{className:'gc-title'},h('b',null,'Избранное'),h('small',null,'Заметки, файлы, пересланное'))):
  (pinfo?h('button',{className:'gc-peer',onClick:function(){p.onUser(pinfo.id);}},h(Av,{src:pinfo.avatar,name:pinfo.name,size:36}),h('div',{className:'gc-title'},h('b',null,pinfo.name,pinfo.verified?h(I,{name:'check',size:11,w:3,className:'vf'}):null),h('small',null,typing?h('span',{className:'typing'},'печатает',h('i'),h('i'),h('i')):(pinfo.online?h('span',{className:'st-on'},h('i',{className:'dot-on'}),'в сети'):h('span',{className:'st-off'},h('i',{className:'dot-off'}),(pinfo.last_seen?'был(а) '+ago(pinfo.last_seen):(dstate&&dstate.peer&&dstate.peer.seen_text||'не в сети'))))))):h('div',{className:'gc-title'},h('b',null,'…'))),
  saved?null:h('button',{className:'gc-ic',onClick:function(){if(callable&&!callable.can_call){p.toast(callable.reason||'Пользователь не принимает звонки','');return;}if(L.startCall)L.startCall({id:peer,name:(pinfo&&pinfo.name)||'Пользователь',avatar:(pinfo&&pinfo.avatar)||''},false);else p.toast('Звонки недоступны','error');}},h(I,{name:'phone',size:19})),  (saved||(callable&&!callable.can_call))?null:h('button',{className:'gc-ic',onClick:function(){if(L.startCall)L.startCall({id:peer,name:(pinfo&&pinfo.name)||'Пользователь',avatar:(pinfo&&pinfo.avatar)||''},true);else p.toast('Звонки недоступны','error');}},h(I,{name:'cam',size:19})),  h('button',{className:'gc-ic',onClick:function(){setFind(find===null?'':null);setHits([]);}},h(I,{name:'search',size:19})),  h('button',{className:'gc-ic',onClick:function(){setMenu2(true);}},h(I,{name:'more',size:20}))),  find!==null?h('div',{className:'gc-find'},   h('input',{autoFocus:true,placeholder:'Поиск по сообщениям',value:find,onChange:function(e){setFind(e.target.value);}}),   h('span',{className:'cnt'},hits.length?((hitI+1)+'/'+hits.length):((find||'').trim().length<2?'':'нет')),   h('button',{disabled:!hits.length,onClick:function(){stepHit(-1);}},h(I,{name:'arrowUp',size:16})),   h('button',{disabled:!hits.length,onClick:function(){stepHit(1);}},h(I,{name:'arrowDown',size:16})),   h('button',{onClick:function(){setFind(null);setHits([]);}},h(I,{name:'close',size:16}))):null,
  dpins.length?h('button',{className:'gc-pin',onClick:function(){setDpinI((dpinI+1)%dpins.length);}},h(I,{name:'pin',size:14}),h('div',{className:'pt'},h('b',null,'Закреплённое'+(dpins.length>1?' '+(dpinI+1)+'/'+dpins.length:'')),h('span',null,dpins[dpinI].kind==='photo'?'🖼 Фото':(dpins[dpinI].kind==='voice'?'🎤 Голосовое':dpins[dpinI].text))),h('span',{className:'px',onClick:function(e){e.stopPropagation();pinMsg(dpins[dpinI],false);}},h(I,{name:'close',size:14}))):null,
  h('div',{className:'gc-msgs',ref:box,onPointerDown:blurComposer},msgs===null?h('div',{className:'skel-thread'},[0,1,2,3,4,5].map(function(i){return h('div',{key:i,className:'skel skel-msg'+(i%2?' me':'')});})):(!msgs.length?(saved?h('div',{className:'saved-empty'},h('span',{className:'sc'},h(I,{name:'cloud',size:24})),h('b',null,'Ваше облачное хранилище'),h('ul',null,h('li',null,'Пересылайте сюда сообщения'),h('li',null,'Храните фотографии и видео'),h('li',null,'Чат доступен с любого устройства'),h('li',null,'Находите нужное в поиске'))):h('div',{className:'gc-empty'},h(I,{name:'msg',size:30}),h('b',null,'Начните переписку'))):groups.map(function(m,idx){if(m.day)return h('div',{key:m.id,className:'gc-day'},h('span',null,m.day));var prev=groups[idx-1],cont=prev&&!prev.day&&prev.from_id===m.from_id&&(new Date(m.created_at)-new Date(prev.created_at))<240000;var isHit=hits.length&&hits[hitI]&&hits[hitI].id===m.id;if(m.kind==='call'||m.kind==='call_video')return h('div',{key:m.id,id:'m'+m.id,className:'gm-wrap sys'},h(CallBubble,{m:m,onInfo:function(mm,cc){setCallInfo({m:mm,c:cc});}}));return h('div',{key:m.id,id:'m'+m.id,className:'gm-wrap'+(isHit?' hit':'')},h(Bubble,{m:m,cont:cont,showAv:false,onReply:function(x){setReply(x);setFocusTick(Date.now());},onMenu:setMenu,onQuote:jumpTo,onReact:react}));}))),
  (!atBottom||unseen)?h('button',{className:'gc-new',onClick:function(){scrollBottom(true);setUnseen(0);},'aria-label':'Вниз'},h(I,{name:'arrowDown',size:20}),unseen?h('span',{className:'cnt'},unseen>99?'99+':unseen):null):null,
  dstate&&dstate.request?h('div',{className:'dm-req'},h('b',null,'Новое сообщение от '+(dstate.peer.name||'пользователя')),h('span',null,'Ответить, одобрить или ограничить?'),h('div',{className:'dm-req-b'},h('button',{className:'btn sm',onClick:approve},'Одобрить'),h('button',{className:'btn sm ghost',onClick:function(){block(false);}},'Заблокировать'),h('button',{className:'btn sm ghost',onClick:function(){block(true);}},'Спам'))):null,
  dstate&&!dstate.can_write?h('div',{className:'dm-locked'},h(I,{name:'lock',size:15}),dstate.reason||'Переписка недоступна',dstate.blocked?h('button',{onClick:function(){api('/api/web/dm/'+peer+'/block',{method:'POST',body:{unblock:true}}).then(function(){setDstate(function(d){return Object.assign({},d,{blocked:false,can_write:true,reason:''});});});}},'Разблокировать'):null):
  h(Composer,{reply:reply,onCancelReply:function(){setReply(null);},editing:editing,onCancelEdit:function(){setEditing(null);},onEditSave:function(m,t){return api('/api/web/dm/'+peer+'/edit',{method:'POST',body:{id:m.id,text:t}}).then(function(r){setMsgs(function(prev){return (prev||[]).map(function(x){return x.id===m.id?Object.assign({},x,{text:r.text,edited:true}):x;});});setEditing(null);return true;}).catch(function(e){p.toast(e.message,'error');return false;});},onSend:send,busy:busy,toast:p.toast,burnable:true,stickers:true,focusTick:focusTick,onFocus:function(){scrollBottom(false);setTimeout(function(){scrollBottom(false);},260);setTimeout(function(){scrollBottom(false);},520);},onTyping:function(){api('/api/web/chat/typing',{method:'POST',body:{}}).catch(function(){});}}),
  menu?h(MsgMenu,{m:menu,onClose:function(){setMenu(null);},onReact:react,onReply:function(m){setReply(m);setFocusTick(Date.now());},onForward:function(m){setFwd(m);},onPin:function(m){pinMsg(m,true);},onEdit:function(m){setEditing(m);setReply(null);},onDelete:del,toast:p.toast}):null,
  fwd?h(ForwardSheet,{m:fwd,meId:p.meId||(p.user&&p.user.id),scope:'dm',peerId:Number(peer),toast:p.toast,
   onSent:function(list){(list||[]).forEach(function(x){if(String(x.peer_id)===String(peer))merge([x.message]);});},
   onClose:function(){setFwd(null);}}):null,
  callInfoM?h(CallInfoSheet,{m:callInfoM.m,c:callInfoM.c,peer:pinfo,onClose:function(){setCallInfo(null);},onCall:function(v){setCallInfo(null);if(L.startCall)L.startCall({id:peer,name:(pinfo&&pinfo.name)||'',avatar:(pinfo&&pinfo.avatar)||''},v);}}):null,
  menu2?h(Sheet,{title:saved?'Избранное':'Чат',onClose:function(){setMenu2(false);},center:false},
   h('button',{className:'row',onClick:function(){setMenu2(false);setAskClear('me');}},h('span',{className:'i'},h(I,{name:'history',size:18})),h('span',{className:'t'},h('b',null,'Очистить у себя'),h('small',null,'История скроется только у вас'))),
   saved?null:h('button',{className:'row',onClick:function(){setMenu2(false);setAskClear('all');}},h('span',{className:'i',style:{background:'var(--red-soft)',color:'var(--red)'}},h(I,{name:'trash',size:18})),h('span',{className:'t'},h('b',null,'Очистить у всех'),h('small',null,'Сообщения удалятся у обоих'))),
   saved?h('button',{className:'row',onClick:function(){setMenu2(false);setAskClear('all');}},h('span',{className:'i',style:{background:'var(--red-soft)',color:'var(--red)'}},h(I,{name:'trash',size:18})),h('span',{className:'t'},h('b',null,'Очистить Избранное'),h('small',null,'Все заметки удалятся'))):null):null,
  askClear?h(L.Confirm,{danger:true,title:askClear==='all'?'Очистить у всех?':'Очистить у себя?',text:askClear==='all'?'Вся переписка будет удалена у обоих участников. Действие необратимо.':'История скроется только на этом аккаунте.',okLabel:'Очистить',onOk:function(){return clearChat(askClear).then(function(){setAskClear(null);});},onCancel:function(){setAskClear(null);}}):null);}

/* ---------- Support page ---------- */
/* Оценка оператора прямо в чате: звёзды загораются волной, без перезагрузки. */
var RATE_LABEL={1:['😞','Плохо'],2:['🙁','Так себе'],3:['😐','Нормально'],4:['🙂','Хорошо'],5:['🤩','Отлично']};
function RateCard(p){var [hover,setHover]=useState(0);var [sent,setSent]=useState(p.rating||0);var [busy,setBusy]=useState(false);
 function pick(n){if(busy||sent)return;setBusy(true);setHover(n);vibrate([18,40,18]);
  api('/api/web/support/rate',{method:'POST',body:{rating:n}}).then(function(){setSent(n);ding('ok');p.onDone&&p.onDone(n);})
   .catch(function(e){setHover(0);p.toast&&p.toast(e.message,'error');}).then(function(){setBusy(false);});}
 if(sent){var L_=RATE_LABEL[sent]||RATE_LABEL[5];
  return h('div',{className:'rate-card'},h('div',{className:'rate-done'},h('span',{className:'em'},L_[0]),h('b',null,'Спасибо за оценку'),h('span',{className:'rate-label'},'⭐'.repeat(sent)+'✩'.repeat(5-sent)+'  '+L_[1])));}
 var lit=hover;
 return h('div',{className:'rate-card'},h('b',null,'Как вам работа оператора?'),h('small',null,'Одно касание — и мы поймём, где подтянуть'),
  h('div',{className:'rate-stars',onMouseLeave:function(){setHover(0);}},[1,2,3,4,5].map(function(n){
   return h('button',{key:n,className:n<=lit?'lit':'',onPointerEnter:function(){if(!busy)setHover(n);},onClick:function(){pick(n);}},'⭐');})));}

function SupportPage(p){var [msgs,setMsgs]=useState(null);var [busy,setBusy]=useState(false);var box=useRef(null),lastId=useRef(0),alive=useRef(true),got=useRef(false);
 /* Карточка заявки из истории: висит над полем ввода и уходит вместе с первым
    сообщением — оператор сразу видит номер, БК, ID и сумму. */
 var [card,setCard]=useState(String(p.preset||'').indexOf('\n')>0?String(p.preset):'');
 function scroll(){L.stickBottom(box,false,true);}
 /* Опрос жил в интервале и держал `msgs` из ПЕРВОГО рендера — там всегда null.
    Пустой ответ поллинга поэтому затирал всю переписку (сообщение исчезало сразу
    после отправки). Теперь состояние трогаем только через функциональный setState. */
 function load(){api('/api/web/support/messages'+(lastId.current?'?after_id='+lastId.current:'')).then(function(r){if(!alive.current)return;var items=r.items||[];got.current=true;
  if(!items.length){setMsgs(function(prev){return prev===null?[]:prev;});return;}
  setMsgs(function(prev){var base=prev||[];var seen={};base.forEach(function(m){seen[m.id]=1;});var add=items.filter(function(m){return !seen[m.id];});if(!add.length)return base;if(lastId.current&&add.some(function(m){return m.from==='operator';}))ding();return base.concat(add);});
  items.forEach(function(m){lastId.current=Math.max(lastId.current,m.id);});scroll();}).catch(function(){if(!got.current)setMsgs(function(prev){return prev===null?[]:prev;});});}
 useEffect(function(){alive.current=true;load();var iv=setInterval(load,3000);return function(){alive.current=false;clearInterval(iv);};},[]);
 function send(t,file){setBusy(true);var body;if(file){body=new FormData();body.append('text',t);body.append('file',file);}else body={text:t};return api('/api/web/support/send',{method:'POST',body:body,timeout:40000}).then(function(r){setMsgs(function(prev){return (prev||[]).concat([r.message]);});lastId.current=Math.max(lastId.current,r.message.id);scroll();setBusy(false);return true;}).catch(function(e){p.toast(e.message,'error');setBusy(false);return false;});}
 useVH();return h('div',{className:'gchat support fixed'},h('div',{className:'gc-head'},h('button',{className:'gc-ic',onClick:p.onBack},h(I,{name:'back',size:20})),h('span',{className:'sup-av'},h(I,{name:'headset',size:18})),h('div',{className:'gc-title'},h('b',null,'Поддержка '+(p.brand||'LUXON')),h('small',null,h('i',{className:'dot-on'}),'Оператор онлайн')),h('span',{style:{width:40}})),
  h('div',{className:'gc-msgs',ref:box,onPointerDown:blurComposer},msgs===null?h('div',{className:'center'},h('span',{className:'spin'})):(!msgs.length?h('div',{className:'gc-empty'},h(I,{name:'headset',size:30}),h('b',null,'Напишите нам'),h('span',null,'Ответим в ближайшие минуты')):msgs.map(function(m){return h('div',{key:m.id,className:'gm-wrap'},h('div',{className:'gm '+(m.from==='client'?'mine':'')},h('div',{className:'gm-b'},m.file_url?h('img',{src:m.file_url,alt:'',onClick:function(){L.openPhoto(m.file_url);}}):null,m.text?h('span',{className:'gm-t'},m.text):null,h('span',{className:'gm-meta'},fmtTime(m.created_at)))));}))),
  (msgs&&msgs.length&&/вопрос реш|обращение закрыт|отмечен как реш/i.test(String(msgs[msgs.length-1].text||'')))?h(RateCard,{toast:p.toast}):null,
  card?h('div',{className:'sup-card'},h('span',{className:'ci'},h(I,{name:'doc',size:16})),h('div',null,h('b',null,card.split('\n')[0]),h('span',null,card.split('\n').slice(1,4).join(' · '))),h('button',{onClick:function(){setCard('');},'aria-label':'Убрать'},h(I,{name:'close',size:16}))):null,
  h(Composer,{onSend:function(t,f,e){var full=card?(card.replace(/\n*Вопрос:\s*$/,'')+'\n\nВопрос: '+(t||'—')):t;return send(full,f,e).then(function(r){if(r!==false)setCard('');return r;});},busy:busy,toast:p.toast,preset:card?'':(p.preset||''),placeholder:card?'Опишите проблему':'Опишите вопрос',onFocus:function(){scroll();setTimeout(scroll,280);setTimeout(scroll,540);}}));}

/* ---------- Sport TV ---------- */
function SportTv(p){var [items,setItems]=useState(null);var [cur,setCur]=useState(null);
 useEffect(function(){api('/api/web/streams').then(function(r){setItems(r.items||[]);if((r.items||[]).length)setCur(r.items[0]);}).catch(function(){setItems([]);});},[]);
 var placeholders=[['Футбол','Топ-матчи недели'],['Бокс / MMA','Главные бои'],['Теннис','Турниры ATP / WTA'],['Хоккей','Лучшие игры']];
 return h('div',{className:'page',key:'tv'},h('div',{className:'ph'},h('div',null,h('h1',{className:'h1'},'Спорт ТВ'),h('p',{className:'h1sub'},'Прямые эфиры в кабинете'))),
  items===null?h('div',{className:'center'},h('span',{className:'spin'})):h(React.Fragment,null,
   cur?h('div',{className:'player-wrap'},h('div',{className:'player'},cur.embed_url?h('iframe',{src:cur.embed_url,allow:'autoplay; fullscreen; picture-in-picture',allowFullScreen:true,frameBorder:0}):(cur.hls_url?h(HlsVideo,{src:cur.hls_url,poster:cur.poster}):h('div',{className:'player-off'},h(I,{name:'tv',size:36}),'Плеер не настроен'))),h('div',{className:'player-info'},cur.live?h('span',{className:'live-badge'},h('i'),'LIVE'):h('span',{className:'chip'},'Запись'),h('b',null,cur.title),cur.subtitle?h('small',null,cur.subtitle):null)):null,
   items.length>1?h('div',{className:'streams'},items.map(function(s){return h('button',{key:s.id,className:'stream'+(cur&&cur.id===s.id?' on':''),onClick:function(){setCur(s);}},h('span',{className:'poster',style:s.poster?{backgroundImage:'url('+s.poster+')'}:null},s.live?h('i',{className:'ld'}):null),h('span',{className:'t'},h('b',null,s.title),h('small',null,s.schedule||s.subtitle||(s.live?'в эфире':'запись'))));})):null,
   h('div',{className:'sec'},h('div',null,h('h3',null,'Каналы'))),
   h('div',{className:'tv-grid'},placeholders.map(function(x,i){return h('div',{key:i,className:'tv-card',style:{animationDelay:i*40+'ms'}},h('span',{className:'tvi'},h(I,{name:'tv',size:22})),h('b',null,x[0]),h('small',null,x[1]),h('span',{className:'soon'},'Скоро'));}))));}
function HlsVideo(p){var v=useRef(null);var [err,setErr]=useState('');useEffect(function(){var el=v.current;if(!el)return;if(el.canPlayType('application/vnd.apple.mpegurl')){el.src=p.src;return;}var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js';s.onload=function(){if(window.Hls&&window.Hls.isSupported()){var hl=new window.Hls({lowLatencyMode:true});hl.loadSource(p.src);hl.attachMedia(el);hl.on(window.Hls.Events.ERROR,function(_,d){if(d.fatal)setErr('Поток недоступен');});el._hls=hl;}else setErr('Браузер не поддерживает HLS');};document.head.appendChild(s);return function(){if(el._hls)el._hls.destroy();};},[p.src]);return h(React.Fragment,null,h('video',{ref:v,controls:true,playsInline:true,autoPlay:true,muted:true,poster:p.poster||undefined}),err?h('div',{className:'player-off'},err):null);}

/* ---------- Contests ---------- */
function cLeft(ms){if(ms<=0)return '';var d=Math.floor(ms/86400000),hh=Math.floor(ms%86400000/3600000),mm=Math.floor(ms%3600000/60000);if(d)return d+' дн '+hh+' ч';if(hh)return hh+' ч '+mm+' мин';return mm+' мин';}
function ContestCard(p){var c=p.c;var [now_,setNow]=useState(Date.now());
 useEffect(function(){if(c.status!=='active'&&c.status!=='soon')return;var iv=setInterval(function(){setNow(Date.now());},30000);return function(){clearInterval(iv);};},[c.status]);
 var act=c.status==='active';var soon=c.status==='soon';var judging=c.status==='judging';var fin=c.status==='finished';
 var left=act&&c.ends_at?Math.max(0,new Date(c.ends_at)-now_):0;
 var till=soon&&c.starts_at?Math.max(0,new Date(c.starts_at)-now_):0;
 var sub=fin?'итоги подведены':(judging?'подводим итоги':(soon?(till?'старт через '+cLeft(till):'скоро старт'):(left?'до конца: '+cLeft(left):'идёт сейчас')));
 var medal=['🥇','🥈','🥉'];
 return h('div',{className:'contest'+(act?' act':'')+(fin?' fin':'')+(soon?' soon':'')},
  c.banner_url?h('img',{className:'cb',src:c.banner_url,alt:'',loading:'lazy'}):null,
  h('div',{className:'ct'},
   h('div',{className:'row1'},h('span',{className:'ci'},h(I,{name:fin?'trophy':'gift',size:19})),h('div',null,h('b',null,c.title),h('small',null,sub))),
   c.description?h('p',null,c.description):null,
   c.rules?h('div',{className:'crules'},h('b',null,'Условия'),h('span',null,c.rules)):null,
   /* даты начала и конца — видно сразу, без открытия карточки */
   (c.starts_at||c.ends_at)?h('div',{className:'cdates'},
     c.starts_at?h('span',null,h(I,{name:'clock',size:13}),'Старт: ',h('b',null,fmtDate(c.starts_at))):null,
     c.ends_at?h('span',null,h(I,{name:'clock',size:13}),'Финиш: ',h('b',null,fmtDate(c.ends_at))):null):null,
   /* призовые места */
   (c.places&&c.places.length)?h('div',{className:'cplaces'},c.places.map(function(pl){return h('div',{key:pl.place,className:'cpl'},h('span',{className:'m'},medal[pl.place-1]||(pl.place+'')),h('span',null,pl.place+' место'),h('b',null,pl.prize||'—'));})):(c.prize?h('div',{className:'prize'},h(I,{name:'gift',size:14}),'Приз: ',h('b',null,c.prize)):null),
   /* победители — карточка висит сутки после завершения */
   (fin&&c.winners&&c.winners.length)?h('div',{className:'cwins'},h('b',{className:'wh'},'Победители'),c.winners.map(function(w){return h('div',{key:w.place+'-'+w.id,className:'cwin'+(w.me?' me':'')},h('span',{className:'m'},medal[w.place-1]||(w.place+'')),h(Av,{src:w.avatar,name:w.name,size:28}),h('span',{className:'wn'},h('b',null,w.me?'Вы 🎉':w.name),w.prize?h('small',null,w.prize):null));})):null,
   (fin&&(!c.winners||!c.winners.length))?h('div',{className:'cwins'},h('span',{className:'muted'},'Победители будут объявлены здесь')):null,
   h('div',{className:'cf'},
    h('span',{className:'pp'},h(I,{name:'users',size:13}),c.participants),
    act?h('button',{className:'btn sm'+(c.joined?' soft':''),disabled:c.joined||p.busy,onClick:function(){p.onJoin(c);}},c.joined?h(I,{name:'check',size:16}):null,c.joined?'Участвуете':'Участвовать'):(soon?h('span',{className:'cstat'},'Ожидание старта'):(judging?h('span',{className:'cstat'},'Идёт подсчёт'):null)))));}
function ContestsSheet(p){var [items,setItems]=useState(p.items||null);var [busy,setBusy]=useState(false);useEffect(function(){if(!items)api('/api/web/contests').then(function(r){setItems(r.items||[]);}).catch(function(){setItems([]);});},[]);
 function join(c){setBusy(true);api('/api/web/contests/'+c.id+'/join',{method:'POST',body:{}}).then(function(r){setItems(function(prev){return (prev||[]).map(function(x){return x.id===c.id?r.contest:x;});});vibrate([30,40,30]);ding('ok');p.toast('Вы участвуете!','success');}).catch(function(e){p.toast(e.message,'error');}).then(function(){setBusy(false);});}
 return h(Sheet,{title:'Конкурсы',onClose:p.onClose},items===null?h('div',{className:'center'},h('span',{className:'spin'})):(!items.length?h('div',{className:'soon-box'},h('span',{className:'tvi'},h(I,{name:'gift',size:28})),h('b',null,'Скоро'),h('span',null,'Розыгрыши для клиентов LUXON. Уведомим о старте.')):h('div',{className:'contests'},items.map(function(c){return h(ContestCard,{key:c.id,c:c,busy:busy,onJoin:join});}))));}

/* ---------- Notifications ---------- */
function NotifSheet(p){var [items,setItems]=useState(null);useEffect(function(){api('/api/web/notifications/list').then(function(r){setItems(r.items||[]);var top=(r.items||[])[0];if(top)api('/api/web/notifications/seen',{method:'POST',body:{id:top.id}}).then(function(){p.onSeen&&p.onSeen();}).catch(function(){});}).catch(function(){setItems([]);});},[]);
 return h(Sheet,{title:'Уведомления',onClose:p.onClose},items===null?h('div',{className:'center'},h('span',{className:'spin'})):(!items.length?h('div',{className:'soon-box'},h('span',{className:'tvi'},h(I,{name:'bell',size:28})),h('b',null,'Пока пусто')):h('div',{className:'notifs'},items.map(function(n,i){return h('div',{key:n.id,className:'notif '+n.kind+(n.unread?' unread':''),style:{animationDelay:i*25+'ms'}},h('span',{className:'ni'},h(I,{name:n.kind==='success'?'check':(n.kind==='warn'?'alert':(n.kind==='gift'?'gift':'bell')),size:17})),h('div',{className:'nt'},h('b',null,n.title),n.text.split('\n').length>1?h('span',null,n.text.split('\n').slice(1).join('\n').slice(0,300)):null,n.photo_url?h('img',{src:n.photo_url,alt:''}):null,h('small',null,ago(n.created_at))),n.unread?h('i',{className:'nd'}):null);}))));}

Object.assign(L,{Av:Av,Composer:Composer,useVH:useVH,fmtRich:fmtRich,GroupChat:GroupChat,DmList:DmList,DmThread:DmThread,UserSheet:UserSheet,SupportPage:SupportPage,SportTv:SportTv,ContestsSheet:ContestsSheet,ContestCard:ContestCard,NotifSheet:NotifSheet});
})();
