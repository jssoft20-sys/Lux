/* LUXON — звонки. Медиа идёт напрямую между браузерами (WebRTC, DTLS-SRTP:
   шифрование в WebRTC обязательное и не отключается). Сервер участвует только
   в обмене SDP и ICE — звук и видео через него не проходят. Сторонних сервисов
   нет: список ICE берётся с своего же сервера (/api/web/calls/config). */
(function(){
'use strict';
var L=window.__LUX,h=L.h,I=L.I,api=L.api,vibrate=L.vibrate,Av=L.Av,Sheet=L.Sheet;
var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef;

L.P.phoneUp='M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2Z';
L.P.phoneDown='M2 9a16 16 0 0 1 20 0v3l-4.5.6-1-3a12 12 0 0 0-9 0l-1 3L2 12V9Z';
L.P.micOff='M12 3a3 3 0 0 0-3 3v3M15 9V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 10.5 6M19 11v1M12 18v3M8 21h8M3 3l18 18';
L.P.cam='M4 7h11v10H4zM15 11l5-3v8l-5-3';
L.P.camOff='M4 7h8v10H4zM15 11l5-3v8l-3-1.8M3 3l18 18';
L.P.speaker='M4 9h4l5-4v14l-5-4H4zM16.5 9.5a4 4 0 0 1 0 5M19 7a8 8 0 0 1 0 10';
L.P.speakerOff='M4 9h4l5-4v14l-5-4H4zM17 10l4 4M21 10l-4 4';
L.P.shieldLock='M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3ZM10 12h4v4h-4zM10.8 12v-1.4a1.2 1.2 0 0 1 2.4 0V12';
L.P.callIn='M7 17 17 7M17 7H9M17 7v8';
L.P.callOut='M17 7 7 17M7 17h8M7 17V9';
L.P.callMiss='M17 7 7 17M7 17h8M7 17V9M3 3l4 4';

function dur(s){s=Math.max(0,Math.floor(s));var m=Math.floor(s/60),x=s%60;
 var hh=Math.floor(m/60);if(hh)return hh+':'+String(m%60).padStart(2,'0')+':'+String(x).padStart(2,'0');
 return m+':'+String(x).padStart(2,'0');}

/* ---------- гудки и рингтон: генерим звуком, файлы не нужны ---------- */
function Ring(){
 var ctx=null,timer=0,nodes=[];
 function ac(){var C=window.AudioContext||window.webkitAudioContext;if(!C)return null;
  if(!ctx)ctx=new C();if(ctx.state==='suspended')ctx.resume();return ctx;}
 function tone(freq,at,len,vol){
  var c=ac();if(!c)return;
  var o=c.createOscillator(),g=c.createGain();
  o.type='sine';o.frequency.value=freq;
  g.gain.setValueAtTime(0.0001,at);
  g.gain.exponentialRampToValueAtTime(vol,at+0.03);
  g.gain.setValueAtTime(vol,at+len-0.05);
  g.gain.exponentialRampToValueAtTime(0.0001,at+len);
  o.connect(g);g.connect(c.destination);o.start(at);o.stop(at+len+0.02);
  nodes.push(o);}
 return {
  /* Исходящий: длинный гудок раз в 4 секунды, как в телефоне. */
  dial:function(){this.stop();var self=this;
   var beat=function(){var c=ac();if(!c)return;tone(425,c.currentTime,1.1,0.05);};
   beat();timer=setInterval(beat,4000);},
  /* Входящий: двойная трель раз в 2,5 секунды. */
  ring:function(){this.stop();
   var beat=function(){var c=ac();if(!c)return;var t=c.currentTime;
    tone(784,t,0.28,0.07);tone(659,t+0.34,0.28,0.07);};
   beat();timer=setInterval(beat,2500);},
  /* Отбой: два коротких низких. */
  bye:function(){this.stop();var c=ac();if(!c)return;var t=c.currentTime;
   tone(392,t,0.16,0.06);tone(294,t+0.2,0.24,0.06);},
  stop:function(){if(timer)clearInterval(timer);timer=0;
   nodes.forEach(function(o){try{o.stop();}catch(e){}});nodes=[];}
 };}
var RING=Ring();

/* ---------- один активный звонок на вкладку ---------- */
var ICE_CACHE=null;
function iceConfig(){
 if(ICE_CACHE)return Promise.resolve(ICE_CACHE);
 return api('/api/web/calls/config').then(function(r){
  ICE_CACHE={iceServers:r.ice||[],iceCandidatePoolSize:2,bundlePolicy:'max-bundle'};return ICE_CACHE;
 }).catch(function(){ICE_CACHE={iceServers:[]};return ICE_CACHE;});}

/* Разрешения спрашиваем один раз: результат помним, повторно не дёргаем. */
function grabMedia(video){
 return navigator.mediaDevices.getUserMedia({
  audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,
   channelCount:1,sampleRate:48000,sampleSize:16,latency:0.01},
  video:video?{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30},facingMode:'user'}:false});}

/* Дефолтный битрейт opus в браузере скачет и на слабой сети даёт хрипы.
   Фиксируем разумный потолок — голос становится ровным. */
function tuneSenders(pc,video){
 try{
  pc.getSenders().forEach(function(sn){
   if(!sn.track)return;
   var pr=sn.getParameters();
   if(!pr.encodings||!pr.encodings.length)pr.encodings=[{}];
   if(sn.track.kind==='audio'){pr.encodings[0].maxBitrate=40000;pr.encodings[0].dtx='disabled';}
   else if(video){pr.encodings[0].maxBitrate=900000;pr.encodings[0].maxFramerate=30;}
   sn.setParameters(pr).catch(function(){});});
 }catch(e){}}

function mediaError(e){var n=String(e&&e.name||'');
 if(n==='NotAllowedError'||n==='SecurityError')return 'Нет доступа к микрофону или камере. Разрешите в настройках сайта.';
 if(n==='NotFoundError')return 'Микрофон или камера не найдены';
 if(n==='NotReadableError')return 'Устройство занято другим приложением';
 return 'Не удалось включить микрофон';}

/* ================= экран звонка ================= */
function CallScreen(p){
 /* p: {mode:'out'|'in', peer, video, callId, offer} */
 var [state,setState]=useState(p.mode==='out'?'calling':'incoming');
 var [sec,setSec]=useState(0);
 var [mute,setMute]=useState(false);
 var [camOff,setCamOff]=useState(!p.video);
 var [spk,setSpk]=useState(false);
 var [err,setErr]=useState('');
 var [stats,setStats]=useState('');
 var pc=useRef(null),local=useRef(null),cid=useRef(p.callId||0),alive=useRef(true);
 var iceLast=useRef(0),t0=useRef(0),lv=useRef(null),rv=useRef(null),ra=useRef(null),pending=useRef([]);
 var remoteSet=useRef(false),outbox=useRef([]),ringTo=useRef(0);

 function stop(reason){
  if(!alive.current)return;alive.current=false;
  RING.stop();if(ringTo.current)clearTimeout(ringTo.current);
  if(reason!=='hangup'||state==='active')RING.bye();
  try{if(local.current)local.current.getTracks().forEach(function(t){t.stop();});}catch(e){}
  try{if(pc.current)pc.current.close();}catch(e){}
  if(cid.current)api('/api/web/calls/'+cid.current+'/end',{method:'POST',body:{reason:reason||'hangup'}}).catch(function(){});
  p.onClose();}

 function fail(msg){setErr(msg);setState('ended');setTimeout(function(){stop('failed');},1600);}

 function buildPc(cfg){
  var c=new RTCPeerConnection(cfg);
  c.onicecandidate=function(e){
   if(!e.candidate)return;
   var cand=e.candidate.toJSON?e.candidate.toJSON():e.candidate;
   /* Кандидаты сыплются сразу после setLocalDescription, а call_id приходит
      позже ответом /start. Раньше они молча терялись и звонок навсегда
      застревал на «Соединение…». Теперь копим и отправляем пачкой. */
   if(!cid.current){outbox.current.push(cand);return;}
   sendIce(cand);};
  c.ontrack=function(e){
   var st=e.streams&&e.streams[0];if(!st)return;
   if(e.track.kind==='video'&&rv.current)rv.current.srcObject=st;
   if(e.track.kind==='audio'&&ra.current){ra.current.srcObject=st;ra.current.play().catch(function(){});}};
  c.onconnectionstatechange=function(){
   var s=c.connectionState;
   if(s==='connected'){if(state!=='active'){RING.stop();setState('active');t0.current=Date.now();tuneSenders(c,p.video);vibrate(20);}}
   else if(s==='failed')fail('Связь не установилась. Проверьте интернет и попробуйте ещё раз.');
   else if(s==='disconnected')setStats('соединение потеряно…');};
  return c;}

 function sendIce(cand){
  if(!cid.current)return;
  api('/api/web/calls/'+cid.current+'/ice',{method:'POST',body:{cand:cand}}).catch(function(){});}
 function flushOutbox(){
  var q=outbox.current;outbox.current=[];q.forEach(sendIce);}
 function drainIce(){var q=pending.current;pending.current=[];
  q.forEach(function(cd){try{pc.current.addIceCandidate(new RTCIceCandidate(cd));}catch(e){}});}

 function pushIce(list){(list||[]).forEach(function(cd){
   if(!cd)return;
   if(remoteSet.current){try{pc.current.addIceCandidate(new RTCIceCandidate(cd));}catch(e){}}
   else pending.current.push(cd);});}

 /* Гудок исходящего и трель входящего. Ждём ответа не дольше минуты. */
 useEffect(function(){
  if(state==='calling')RING.dial();
  else if(state==='incoming')RING.ring();
  else RING.stop();
  if(state==='calling'||state==='incoming'){
   if(ringTo.current)clearTimeout(ringTo.current);
   ringTo.current=setTimeout(function(){
    if(!alive.current)return;
    setErr(p.mode==='out'?'Не отвечает':'Пропущенный звонок');setState('ended');
    setTimeout(function(){stop('missed');},1200);},60000);
  }else if(ringTo.current){clearTimeout(ringTo.current);ringTo.current=0;}
  return function(){};},[state]);

 /* --- исходящий --- */
 useEffect(function(){
  if(p.mode!=='out')return;
  var stream;
  iceConfig().then(function(cfg){
   return grabMedia(p.video).then(function(s){
    if(!alive.current){s.getTracks().forEach(function(t){t.stop();});return;}
    stream=s;local.current=s;if(lv.current)lv.current.srcObject=s;
    pc.current=buildPc(cfg);
    s.getTracks().forEach(function(t){pc.current.addTrack(t,s);});
    return pc.current.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:!!p.video});
   });
  }).then(function(offer){
   if(!alive.current||!offer)return;
   return pc.current.setLocalDescription(offer).then(function(){
    return api('/api/web/calls/start',{method:'POST',body:{peer_id:p.peer.id,video:p.video?1:0,sdp:JSON.stringify(offer)}});
   });
  }).then(function(r){
   if(!alive.current||!r)return;cid.current=r.call_id;flushOutbox();poll();
  }).catch(function(e){
   if(e&&e.name)fail(mediaError(e));else fail((e&&e.message)||'Звонок не прошёл');});
  return function(){};
 },[]);

 /* --- входящий: принять --- */
 function accept(){
  setState('connecting');
  iceConfig().then(function(cfg){
   return grabMedia(p.video).then(function(s){
    if(!alive.current){s.getTracks().forEach(function(t){t.stop();});return;}
    local.current=s;if(lv.current)lv.current.srcObject=s;
    pc.current=buildPc(cfg);
    s.getTracks().forEach(function(t){pc.current.addTrack(t,s);});
    var offer=JSON.parse(p.offer);
    return pc.current.setRemoteDescription(new RTCSessionDescription(offer)).then(function(){
     remoteSet.current=true;drainIce();
     return pc.current.createAnswer();
    });
   });
  }).then(function(ans){
   if(!alive.current||!ans)return;
   return pc.current.setLocalDescription(ans).then(function(){
    return api('/api/web/calls/'+cid.current+'/answer',{method:'POST',body:{sdp:JSON.stringify(ans)}});
   });
  }).then(function(){if(alive.current)poll();
  }).catch(function(e){
   if(e&&e.name)fail(mediaError(e));else fail((e&&e.message)||'Не удалось принять звонок');});}

 function decline(){stop('declined');}

 /* --- long-poll сигналинга --- */
 function poll(){
  if(!alive.current||!cid.current)return;
  api('/api/web/calls/'+cid.current+'/poll?ice_after='+iceLast.current+'&wait=20',{timeout:30000}).then(function(r){
   if(!alive.current)return;
   var c=r.call||{};
   if(typeof c.ice_last==='number')iceLast.current=c.ice_last;
   if(c.answer&&pc.current&&!remoteSet.current){
    try{
     pc.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(c.answer))).then(function(){
      remoteSet.current=true;drainIce();});
    }catch(e){}
   }
   pushIce(c.ice);
   if(c.status==='active'&&state==='calling')setState('connecting');
   if(c.status==='ended'){
    var m={declined:'Отклонён',missed:'Не отвечает',cancel:'Отменён',failed:'Ошибка соединения'}[c.end_reason]||'Звонок завершён';
    setErr(m);setState('ended');setTimeout(function(){stop(c.end_reason||'hangup');},1200);return;}
   setTimeout(poll,60);
  }).catch(function(){if(alive.current)setTimeout(poll,1500);});}

 /* таймер разговора */
 useEffect(function(){
  if(state!=='active')return;
  if(!t0.current)t0.current=Date.now();
  var iv=setInterval(function(){setSec(Math.floor((Date.now()-t0.current)/1000));},500);
  return function(){clearInterval(iv);};},[state]);

 /* уходим со страницы — вешаем трубку */
 useEffect(function(){
  var bye=function(){if(cid.current)navigator.sendBeacon&&navigator.sendBeacon('/api/web/calls/'+cid.current+'/end');};
  window.addEventListener('beforeunload',bye);
  return function(){window.removeEventListener('beforeunload',bye);
   try{if(local.current)local.current.getTracks().forEach(function(t){t.stop();});}catch(e){}
   try{if(pc.current)pc.current.close();}catch(e){}};},[]);

 function toggleMute(){var s=local.current;if(!s)return;var on=!mute;
  s.getAudioTracks().forEach(function(t){t.enabled=!on;});setMute(on);vibrate(10);}
 function toggleCam(){var s=local.current;if(!s)return;var off=!camOff;
  s.getVideoTracks().forEach(function(t){t.enabled=!off;});setCamOff(off);vibrate(10);}
 /* Громкая связь: по умолчанию выключена, как в обычном звонке. */
 function toggleSpk(){var a=ra.current;var on=!spk;setSpk(on);
  if(a){a.volume=1;
   try{if(a.setSinkId)a.setSinkId('default');}catch(e){}
   /* iOS/Safari переключает динамик только через playsinline + перезапуск */
   try{a.playsInline=!on;a.play().catch(function(){});}catch(e){}}
  vibrate(10);p.onSpk&&p.onSpk(on);}

 var title=state==='calling'?'Вызов…':state==='incoming'?(p.video?'Входящий видеозвонок':'Входящий звонок'):
   state==='connecting'?'Соединение…':state==='active'?dur(sec):(err||'Завершён');

 return h('div',{className:'callscr'+(p.video?' vid':'')},
  h('audio',{ref:ra,autoPlay:true,playsInline:true,style:{display:'none'}}),
  p.video?h('video',{ref:rv,className:'cs-remote',autoPlay:true,playsInline:true}):null,
  p.video?h('video',{ref:lv,className:'cs-local',autoPlay:true,playsInline:true,muted:true}):null,
  h('div',{className:'cs-top'},
   h(Av,{src:p.peer.avatar,name:p.peer.name,size:96}),
   h('b',null,p.peer.name),
   h('span',{className:'cs-st'+(state==='active'?' on':'')},title),
   stats?h('span',{className:'cs-warn'},stats):null,
   h('span',{className:'cs-e2e'},h(I,{name:'shieldLock',size:13}),'Звонок защищён шифрованием')),
  h('div',{className:'cs-btns'},
   state==='incoming'?h(React.Fragment,null,
    h('button',{className:'cs-b red',onClick:decline},h(I,{name:'phoneDown',size:26})),
    h('button',{className:'cs-b green',onClick:accept},h(I,{name:'phoneUp',size:26}))
   ):h(React.Fragment,null,
    h('button',{className:'cs-b sm'+(mute?' act':''),onClick:toggleMute},h(I,{name:mute?'micOff':'mic',size:21})),
    p.video?h('button',{className:'cs-b sm'+(camOff?' act':''),onClick:toggleCam},h(I,{name:camOff?'camOff':'cam',size:21})):
      h('button',{className:'cs-b sm'+(spk?' act':''),onClick:toggleSpk,'aria-label':'Громкая связь'},h(I,{name:spk?'speaker':'speakerOff',size:21})),
    h('button',{className:'cs-b red',onClick:function(){stop('hangup');}},h(I,{name:'phoneDown',size:26})))));}

/* ================= слой звонков: висит в App ================= */
function CallLayer(p){
 var [call,setCall]=useState(null);
 var alive=useRef(true),busy=useRef(false);
 useEffect(function(){
  alive.current=true;
  function loop(){
   if(!alive.current)return;
   if(busy.current){setTimeout(loop,1200);return;}
   api('/api/web/calls/incoming?wait=25',{timeout:35000}).then(function(r){
    if(!alive.current)return;
    if(r.call&&!busy.current){
     busy.current=true;vibrate([90,60,90,60,90]);
     setCall({mode:'in',peer:r.call.peer||{},video:!!r.call.video,callId:r.call.id,offer:r.call.offer});
    }
    setTimeout(loop,r.call?2000:80);
   }).catch(function(){if(alive.current)setTimeout(loop,3000);});}
  loop();
  return function(){alive.current=false;};},[]);

 /* Наружу: L.startCall(peer, video) */
 useEffect(function(){
  L.startCall=function(peer,video){
   if(busy.current){p.toast&&p.toast('Уже идёт звонок','');return;}
   if(!window.isSecureContext){p.toast&&p.toast('Звонки работают только по https','error');return;}
   if(!window.RTCPeerConnection||!navigator.mediaDevices){p.toast&&p.toast('Браузер не поддерживает звонки','error');return;}
   busy.current=true;setCall({mode:'out',peer:peer,video:!!video});};
  return function(){L.startCall=null;};},[]);

 if(!call)return null;
 return h(CallScreen,Object.assign({},call,{onClose:function(){busy.current=false;setCall(null);}}));}

/* ================= журнал звонков ================= */
function CallsPage(p){
 var [items,setItems]=useState(null);
 var [tab,setTab]=useState('all');
 var [sel,setSel]=useState(null);
 function load(){api('/api/web/calls/history').then(function(r){setItems(r.items||[]);}).catch(function(){setItems([]);});}
 useEffect(load,[]);
 function label(x){
  if(x.reason==='missed')return x.outgoing?'Не ответили':'Пропущенный';
  if(x.reason==='declined')return 'Отклонён';
  if(x.duration)return (x.outgoing?'Исходящий':'Входящий')+' ('+dur(x.duration)+')';
  return x.outgoing?'Исходящий · отменён':'Отменённый';}
 function del(x){api('/api/web/calls/'+x.id,{method:'DELETE'}).then(function(){setSel(null);setItems(function(l){return (l||[]).filter(function(y){return y.id!==x.id;});});p.toast&&p.toast('Запись удалена','success');}).catch(function(e){p.toast&&p.toast(e.message,'error');});}
 var list=(items||[]).filter(function(x){return tab!=='miss'||(x.reason==='missed'&&!x.outgoing);});
 return h('div',{className:'page'},
  h('div',{className:'ph'},h('button',{className:'pback',onClick:p.onBack},h(I,{name:'back',size:22})),
   h('div',null,h('h1',{className:'h1'},'Звонки'),h('p',{className:'h1sub'},'Разговор идёт напрямую и шифруется')),
   h('div',{className:'calls-tabs'},h('button',{className:tab==='all'?'on':'',onClick:function(){setTab('all');}},'Все'),h('button',{className:tab==='miss'?'on':'',onClick:function(){setTab('miss');}},'Пропущ.'))),
  h('button',{className:'dm-row newcall',onClick:function(){p.onNew&&p.onNew();}},
   h('span',{className:'dm-av'},h('span',{className:'cav sys nc'},h(I,{name:'phone',size:19}))),
   h('span',{className:'t'},h('b',{className:'bl'},'Новый звонок'),h('small',null,'Выберите, кому позвонить')),
   h(I,{name:'chev',size:18,className:'chev'})),
  h('div',{className:'sec'},h('h3',null,'Недавние звонки')),
  items===null?h('div',{className:'list'},[0,1,2].map(function(i){return h('div',{key:i,className:'skel skel-card'});})):
  (!list.length?h('div',{className:'empty-line'},h(I,{name:'phone',size:18}),tab==='miss'?'Пропущенных нет':'Звонков ещё не было'):
   h('div',{className:'list'},list.map(function(x){
    var miss=x.reason==='missed'&&!x.outgoing;
    return h('button',{key:x.id,className:'dm-row',onClick:function(){setSel(x);}},
     h('span',{className:'dm-av'},h(Av,{src:x.peer.avatar,name:x.peer.name,size:44})),
     h('span',{className:'t'},h('b',{className:miss?'miss':''},x.peer.name),
      h('small',null,h(I,{name:miss?'callMiss':(x.outgoing?'callOut':'callIn'),size:12,className:'cdir'+(miss?' miss':'')}),
       ' '+label(x)+(x.video?' · видео':''))),
     h('span',{className:'r'},h('small',null,L.fmtDate?L.fmtDate(x.created_at):''),
      h('span',{className:'cs-again'},h(I,{name:'info',size:15}))));}))),
  sel?h(L.Sheet,{title:sel.video?'Видеозвонок':'Звонок',sub:sel.peer.name,onClose:function(){setSel(null);},center:true},
   h(Av,{src:sel.peer.avatar,name:sel.peer.name,size:72,className:'big'}),
   h('b',{style:{fontSize:17,marginTop:8}},sel.peer.name),
   h('p',{className:'muted',style:{margin:'4px 0 2px',fontSize:13}},label(sel)+' · '+(L.fmtDate?L.fmtDate(sel.created_at):'')+' '+(L.fmtTime?L.fmtTime(sel.created_at):'')),
   h('div',{className:'two-btn',style:{width:'100%',marginTop:14}},
    h('button',{className:'btn',onClick:function(){setSel(null);p.onCall&&p.onCall(sel.peer,false);}},h(I,{name:'phone',size:18}),'Позвонить'),
    h('button',{className:'btn ghost',onClick:function(){setSel(null);p.onCall&&p.onCall(sel.peer,true);}},h(I,{name:'cam',size:18}),'Видео')),
   h('button',{className:'btn ghost danger mt8',style:{width:'100%'},onClick:function(){del(sel);}},h(I,{name:'trash',size:17}),'Удалить запись')):null);}

Object.assign(L,{CallLayer:CallLayer,CallsPage:CallsPage,callDur:dur});
})();
