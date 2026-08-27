(function(){
'use strict';
var L=window.__LUX,h=L.h,I=L.I,money=L.money,fmtDate=L.fmtDate,api=L.api,STATUS=L.STATUS,initial=L.initial,ding=L.ding,vibrate=L.vibrate,Logo=L.Logo,Sheet=L.Sheet,Toast=L.Toast;
var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef,useMemo=React.useMemo,useCallback=React.useCallback;

var HOW_DEPOSIT=[{icon:'bk',accent:'#22a35a',accent2:'#0f6b3a',title:'Выберите БК',text:'Нажмите «Пополнить» и выберите букмекера.'},{icon:'user',accent:'#2563eb',accent2:'#1e40af',title:'ID и сумма',text:'Введите игровой ID — система проверит его сразу. Укажите сумму.'},{icon:'qr',accent:'#7c3aed',accent2:'#4c1d95',title:'Оплатите по QR',text:'Отсканируйте QR в банке или нажмите кнопку банка. Переведите ровно указанную сумму.'},{icon:'check',accent:'#22a35a',accent2:'#0f6b3a',title:'Зачислится само',text:'Как только платёж поступит — деньги упадут на игровой счёт. Чек — в Истории.'}];
var HOW_WITHDRAW=[{icon:'bk',accent:'#2563eb',accent2:'#1e40af',title:'Закажите вывод в БК',text:'В приложении букмекера: «Вывести» → «Касса». Выберите наш город и кассу.'},{icon:'lock',accent:'#d97706',accent2:'#92400e',title:'Получите код',text:'Букмекер выдаст короткий код подтверждения. Он одноразовый.'},{icon:'qr',accent:'#7c3aed',accent2:'#4c1d95',title:'QR вашего банка',text:'Скриншот «Мой QR» из MBank, О!Деньги, Bakai, Optima или Balance.'},{icon:'arrowOutUp',accent:'#22a35a',accent2:'#0f6b3a',title:'Отправьте заявку',text:'ID, код и QR — оператор переведёт сумму. Статус и чек — в Истории.'}];

var PAGES=['home','chat','chats','dms','dm','tv','history','profile','bk','pay','support','u','devices','notifs','link','bots','news','bot','calls'];
function parseHash(){var hs=(location.hash||'').replace(/^#\/?/,'').split('/');var pg=hs[0]||'home';return {page:pg,arg:hs[1]||''};}

function TopBar(p){var u=p.user;
 return h('div',{className:'topbar top2'},
  h('button',{className:'brand',onClick:function(){p.go('home');}},h('span',{className:'m'},'L'),
   h('span',null,h('b',null,p.brand||'LUXON'))),
  h('button',{className:'balchip',onClick:p.onBalance,'aria-label':'Баланс'},
   h(I,{name:'wallet',size:15}),h('b',null,money((u&&u.balance)||0)),h('span',null,'с')),
  h('button',{className:'ic',onClick:function(){p.go('tv');},'aria-label':'Спорт ТВ'},
   h(I,{name:'tv',size:19}),p.live?h('span',{className:'live-dot'}):null),
  h('button',{className:'ic',onClick:p.onNotif,'aria-label':'Уведомления'},h(I,{name:'bell',size:19}),
   p.notif?h('span',{className:'badge'},p.notif):null),
  h('button',{className:'ic',onClick:p.onSupport,'aria-label':'Поддержка'},h(I,{name:'headset',size:19}),
   p.unread?h('span',{className:'badge'},p.unread):null),
  h('button',{className:'av',onClick:function(){p.go('profile');}},
   u&&u.avatar_url?h('img',{src:u.avatar_url,alt:''}):initial(u&&u.name)));}
function Nav(p){
 /* Мессенджер во главе: чаты и звонки слева, касса центральной кнопкой,
    история и профиль справа. Спорт ТВ переехал в верхнюю панель. */
 var map={chat:'chats',dm:'chats',dms:'chats',bot:'chats',bots:'chats',news:'chats',support:'chats'};
 var cur=map[p.page]||p.page;
 function tab(id,label,icon,badge){
  return h('button',{key:id,className:'ntab'+(cur===id?' on':''),onClick:function(){vibrate(8);p.go(id);}},
   h('span',{className:'nic'},h(I,{name:icon,size:21}),
    badge?h('i',{className:'ndot'},badge>9?'9+':badge):null),
   h('span',{className:'nlb'},label));}
 return h('nav',{className:'nav nav2'},
  tab('chats','Чаты','chat',p.dm),
  tab('calls','Звонки','phone',0),
  h('button',{key:'home',className:'nfab'+(cur==='home'?' on':''),onClick:function(){vibrate(10);p.go('home');}},
   h('span',{className:'nfab-r'},h(I,{name:'wallet',size:23})),h('span',{className:'nlb'},'Касса')),
  tab('history','История','history',0),
  tab('profile','Профиль','user',0));}

function App(){
 var [boot,setBoot]=useState('checking');var [auth,setAuth]=useState({step:'email',email:'',delivery:'',code:''});var [me,setMe]=useState(null);var [splash,setSplash]=useState(false);
 var [route,setRoute]=useState(parseHash());var [dir,setDir]=useState('');var [sheetStack,setSheetStack]=useState([]);var sheet=sheetStack.length?sheetStack[sheetStack.length-1]:null;
 /* Шторки складываются стопкой: из карточки БК открыл сторис-инструкцию, закрыл —
    вернулся в карточку БК, а не на главную с потерей всего выбора. */
 var setSheet=useCallback(function(v){setSheetStack(v?[v]:[]);},[]);
 var pushSheet=useCallback(function(v){setSheetStack(function(st){return st.concat([v]);});},[]);
 var popSheet=useCallback(function(){setSheetStack(function(st){return st.slice(0,-1);});},[]);var [toast,setToast]=useState(null);var [txs,setTxs]=useState(null);var [txStats,setTxStats]=useState({});var [histKind,setHistKind]=useState('deposit');var [q,setQ]=useState('');var [contests,setContests]=useState(null);var [supportPreset,setSupportPreset]=useState('');
 var notifAfter=useRef(0),toastSeq=useRef(0),newVer=useRef(false);var page=route.page,arg=route.arg;var [photo,setPhoto]=useState('');var [offline,setOffline]=useState(!navigator.onLine);var [pull,setPull]=useState(0);var pullY=useRef(0),pulling=useRef(false),refreshing=useRef(false);
 useEffect(function(){function on(){setOffline(false);loadMe();}function off(){setOffline(true);}window.addEventListener('online',on);window.addEventListener('offline',off);return function(){window.removeEventListener('online',on);window.removeEventListener('offline',off);};},[]);
 function ptrStart(e){if(sheet||refreshing.current)return;var fs=['chat','dms','dm','pay','support','chats','devices','notifs','link'].indexOf(page)>=0;if(fs)return;if((document.scrollingElement||document.documentElement).scrollTop>0)return;pullY.current=e.touches[0].clientY;pulling.current=true;}
 function ptrMove(e){if(!pulling.current)return;var dy=e.touches[0].clientY-pullY.current;if(dy<0){pulling.current=false;setPull(0);return;}setPull(Math.min(90,dy*.5));}
 function ptrEnd(){if(!pulling.current)return;pulling.current=false;if(pull>=60){refreshing.current=true;setPull(60);vibrate(15);Promise.all([loadMe(),loadTxs(page==='history'?histKind:'')]).catch(function(){}).then(function(){setTimeout(function(){refreshing.current=false;setPull(0);},350);});}else setPull(0);}
 useEffect(function(){L.openPhoto=function(url){setPhoto(url);};return function(){L.openPhoto=null;};},[]);
 var showToast=useCallback(function(text,type){setToast({id:++toastSeq.current,text:text,type:type||''});},[]);
 /* Пароль на вход: спрашиваем при запуске и после простоя дольше выбранного. */
 var [locked,setLocked]=useState(function(){return !!(L.pinRead&&L.pinRead());});
 var awayAt=useRef(0);
 useEffect(function(){
  function hide(){if(document.hidden)awayAt.current=Date.now();else{
   var st=L.pinRead&&L.pinRead();
   if(st&&st.lock&&awayAt.current&&(Date.now()-awayAt.current)/1000>=st.lock)setLocked(true);
   awayAt.current=0;}}
  document.addEventListener('visibilitychange',hide);
  return function(){document.removeEventListener('visibilitychange',hide);};},[]);
 /* Общая точка для тостов из хелперов (копирование, разрешения). */
 useEffect(function(){L.toast=showToast;return function(){L.toast=null;};},[showToast]);
 function loadMe(){return api('/api/web/me').then(function(r){setMe(r);setBoot('ok');if(r.user&&r.user.theme)L.applyTheme(r.user.theme);if(r.app_version&&r.app_version!==L.APP_VERSION)newVer.current=true;return r;}).catch(function(e){if(e.auth)setBoot('auth');else{setBoot(me?'ok':'error');}});}
 useEffect(function(){loadMe();},[]);
 useEffect(function(){function onHash(){setRoute(parseHash());}window.addEventListener('hashchange',onHash);return function(){window.removeEventListener('hashchange',onHash);};},[]);
 function go(p,a){if(newVer.current&&!sheet){location.hash='#/'+p+(a?'/'+a:'');location.reload();return;}var order=['chats','calls','home','history','profile'];setDir(order.indexOf(p)>=0&&order.indexOf(p)<order.indexOf(page)?'back':'');location.hash='#/'+p+(a?'/'+a:'');window.scrollTo({top:0});}
 function back(){if(history.length>1)history.back();else go('home');}
 function loadTxs(kind){return api('/api/web/transactions?limit=40'+(kind?'&kind='+kind:'')).then(function(r){setTxs(r.items||[]);setTxStats(r.stats||{});}).catch(function(e){if(e.auth)setBoot('auth');});}
 useEffect(function(){if(boot!=='ok')return;loadTxs('');api('/api/web/contests').then(function(r){setContests(r.items||[]);}).catch(function(){setContests([]);});},[boot]);
 useEffect(function(){if(boot!=='ok')return;if(page==='history')loadTxs(histKind);if(page==='home')loadTxs('');},[page,histKind]);
 useEffect(function(){if(boot!=='ok')return;var iv=setInterval(function(){if(document.hidden)return;api('/api/web/notifications?after_id='+notifAfter.current).then(function(r){(r.items||[]).forEach(function(n){notifAfter.current=Math.max(notifAfter.current,n.id);var txt=String(n.text||'').split('\n')[0].slice(0,120);if(!txt)return;var okk=/✅|успеш|зачисл/i.test(n.text);showToast(txt,okk?'success':'');ding(okk?'ok':'');vibrate(okk?[40,60,40]:30);});if((r.items||[]).length){loadTxs(page==='history'?histKind:'');loadMe();}}).catch(function(){});},5000);var iv2=setInterval(function(){if(!document.hidden)loadMe();},30000);return function(){clearInterval(iv);clearInterval(iv2);};},[boot,page,histKind]);

 function onAuthDone(r){try{if(r.token)localStorage.setItem('luxon-web-token',r.token);}catch(e){}setSplash(true);setTimeout(function(){setSplash(false);},2000);loadMe();}
 function logout(){api('/api/web/auth/logout',{method:'POST'}).catch(function(){}).then(function(){try{localStorage.removeItem('luxon-web-token');}catch(e){}setMe(null);setBoot('auth');setAuth({step:'email',email:'',delivery:'',code:''});setSheet(null);go('home');});}
 function openSupport(preset){setSupportPreset(preset||'');setSheet(null);go('support');}
 function openStory(kind){setSheet({kind:'story',which:kind});}
 function openPay(pid){setSheet(null);go('pay',pid);}
 function setTheme(t){L.applyTheme(t);api('/api/web/profile2',{method:'POST',body:{theme:t}}).then(loadMe).catch(function(){});}

 if(boot==='checking')return h('div',{className:'center',style:{minHeight:'100vh'}},h('span',{className:'spin lg'}));
 if(locked&&L.PinGate)return h(L.PinGate,{onOk:function(){setLocked(false);}});
 if(boot==='auth'){
  /* Открытая ссылка (в т.ч. по QR профиля) не пускает внутрь без входа. */
  if(auth.step==='email'&&page!=='home'&&page!=='link'&&!auth.seen){
   return h(L.AuthGate,{target:{page:page,arg:arg},onLogin:function(){setAuth(Object.assign({},auth,{seen:true}));},onQr:function(){setAuth(Object.assign({},auth,{step:'qr',seen:true}));}});
  }
  if(page==='link')return h(L.LinkApprove,{token:arg,onClose:function(){go('home');}});
  if(auth.step==='qr')return h(L.QrLogin,{toast:showToast,onBack:function(){setAuth(Object.assign({},auth,{step:'email'}));},onDone:onAuthDone});
  if(auth.step==='email')return h(L.AuthEmail,{brand:'LUXON',onQr:function(){setAuth(Object.assign({},auth,{step:'qr'}));},onNext:function(email,r){setAuth({step:'otp',email:email,delivery:r.delivery,code:'',seen:true});}});
  if(auth.step==='otp')return h(L.AuthOtp,{email:auth.email,delivery:auth.delivery,onBack:function(){setAuth(Object.assign({},auth,{step:'email'}));},onRegister:function(code){setAuth(Object.assign({},auth,{step:'register',code:code}));},onDone:onAuthDone});
  return h(L.AuthRegister,{email:auth.email,code:auth.code,onBack:function(){setAuth(Object.assign({},auth,{step:'otp'}));},onDone:onAuthDone});}
 if(boot==='error'&&!me)return h('div',{className:'auth'},h('div',{className:'mark',style:{background:'var(--red)'}},h(I,{name:'alert',size:28})),h('h1',null,'Нет связи'),h('p',null,'Сервер не отвечает. Проверьте интернет.'),h('button',{className:'btn',onClick:function(){setBoot('checking');loadMe();}},'Повторить'));
 var u=me.user,bks=me.bookmakers||[];var anyDep=bks.some(function(b){return b.deposit;}),anyWd=bks.some(function(b){return b.withdraw;});var recent=(txs||[]).slice(0,3);var fullscreen=['chat','dms','dm','pay','support','bot'].indexOf(page)>=0;
 var body;
 if(page==='home')body=h('div',{className:'page '+dir,key:'home'},
  h('div',{className:'hero'},h('div',{className:'hl'},h('small',null,'Здравствуйте'),h('b',null,u.name),h('span',{className:'st'},h('i'),me.blocked?'Кабинет ограничен':(anyDep||anyWd?'Кассы работают':'Кассы на паузе'))),h('button',{className:'bal',onClick:function(){setSheet({kind:'balance'});}},h('small',null,'Баланс'),h('b',null,money(u.balance||0)),h('span',null,'сом'))),
  h('div',{className:'quick'},h('button',{disabled:!anyDep||me.blocked,onClick:function(){setSheet({kind:'deposit'});}},h('span',{className:'i dep'},h(I,{name:'arrowInDown',size:20})),h('span',null,h('b',null,'Пополнить'),h('small',null,'QR · банки'))),h('button',{disabled:!anyWd||me.blocked,onClick:function(){setSheet({kind:'withdraw'});}},h('span',{className:'i wd'},h(I,{name:'arrowOutUp',size:20})),h('span',null,h('b',null,'Вывести'),h('small',null,'по коду БК')))),
  h('div',{className:'stories'},[['dep','Пополнить','arrowInDown',function(){openStory('deposit');}],['wd','Вывести','arrowOutUp',function(){openStory('withdraw');}],['tv','Спорт ТВ','tv',function(){go('tv');}],['gift','Конкурсы','gift',function(){setSheet({kind:'contests'});}],['sup','Поддержка','headset',function(){openSupport('');}],['ver','Верификация','shield',function(){go('profile');}]].map(function(s){return h('button',{key:s[0],className:'story-bubble '+s[0],onClick:s[3]},h('span',{className:'ring'},h('span',null,h(I,{name:s[2],size:22}))),h('b',null,s[1]));})),
  h('div',{className:'sec'},h('h3',null,'Конкурсы'),h('button',{className:'more',onClick:function(){setSheet({kind:'contests'});}},'Все')),
  contests&&contests.length?h('div',{className:'contests'},contests.slice(0,1).map(function(c){return h(L.ContestCard,{key:c.id,c:c,onJoin:function(x){api('/api/web/contests/'+x.id+'/join',{method:'POST',body:{}}).then(function(r){setContests(function(prev){return (prev||[]).map(function(y){return y.id===x.id?r.contest:y;});});ding('ok');showToast('Вы участвуете','success');}).catch(function(e){showToast(e.message,'error');});}});})):h('button',{className:'soon-row',onClick:function(){setSheet({kind:'contests'});}},h('span',{className:'ci'},h(I,{name:'gift',size:20})),h('span',{className:'t'},h('b',null,'Розыгрыши для клиентов'),h('small',null,'Первый конкурс скоро — сообщим уведомлением')),h('span',{className:'soon'},'Скоро')),
  h('div',{className:'sec'},h('h3',null,'Операции'),h('button',{className:'more',onClick:function(){go('history');}},'Все')),
  txs===null?h('div',{className:'tx-list'},[0,1,2].map(function(i){return h('div',{key:i,className:'tx'},h('span',{className:'skel',style:{width:38,height:38}}),h('span',{className:'t'},h('span',{className:'skel',style:{height:12,width:'45%',display:'block'}}),h('span',{className:'skel',style:{height:10,width:'65%',display:'block',marginTop:6}})));})):(recent.length?h('div',{className:'tx-list'},recent.map(function(t,i){return h(L.TxRow,{key:t.id,tx:t,i:i,onOpen:function(x){setSheet({kind:'tx',tx:x});}});})):h('div',{className:'empty-line'},h(I,{name:'history',size:18}),'Операций пока нет')),
  h('div',{className:'sec'},h('h3',null,'Букмекеры'),h('small',null,'Доступно: '+bks.filter(function(b){return b.deposit||b.withdraw;}).length)),
  h('div',{className:'bk-list big'},bks.map(function(b,i){return h(L.BkItem,{key:b.key,bk:b,i:i,onOpen:function(x){setSheet({kind:'bk',bk:x});}});})),
  h('div',{style:{height:8}}));
 else if(page==='bk'){var list=bks.filter(function(b){var s=q.trim().toLowerCase();return !s||b.label.toLowerCase().indexOf(s)>=0;});body=h('div',{className:'page '+dir,key:'bk'},h('div',{className:'ph'},h('button',{className:'pback',onClick:back},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'Букмекеры'),h('p',{className:'h1sub'},'Доступно: '+list.filter(function(b){return b.deposit||b.withdraw;}).length))),h('div',{className:'search'},h(I,{name:'search',size:18}),h('input',{placeholder:'Найти',value:q,onChange:function(e){setQ(e.target.value);}})),h('div',{className:'bk-list'},list.map(function(b,i){return h(L.BkItem,{key:b.key,bk:b,i:i,onOpen:function(x){setSheet({kind:'bk',bk:x});}});})));}
 else if(page==='chats')body=h(L.ChatsList,{key:'chats',brand:me.brand,meId:u.id,toast:showToast,onBack:function(){go('home');},onGroup:function(){go('chat');},onOpen:function(id){go('dm',String(id));},onNews:function(){go('news');},onFather:function(){go('bots');},onBot:function(b){go('bot',String(b.id));},onProfile:function(id){setSheet({kind:'user',id:id,scope:'dm'});}});
 else if(page==='chat')body=h(L.GroupChat,{key:'gchat',user:u,brand:me.brand,toast:showToast,dmUnread:me.dm_unread,onBack:function(){go('chats');},onDms:function(){go('chats');},onDm:function(id){go('dm',String(id));},onRules:function(){setSheet({kind:'rules'});}});
 else if(page==='dms')body=h(L.ChatsList,{key:'chats',brand:me.brand,meId:u.id,toast:showToast,onBack:function(){go('home');},onGroup:function(){go('chat');},onOpen:function(id){go('dm',String(id));},onNews:function(){go('news');},onFather:function(){go('bots');},onBot:function(b){go('bot',String(b.id));},onProfile:function(id){setSheet({kind:'user',id:id,scope:'dm'});}});
 else if(page==='dm')body=h(L.DmThread,{key:'dm'+arg,peerId:arg,meId:u.id,toast:showToast,onBack:function(){go('chats');},onUser:function(id){setSheet({kind:'user',id:id,scope:'dm'});}});
 else if(page==='bots')body=h(L.LuxFather,{key:'bots',toast:showToast,onBack:back});
 else if(page==='calls')body=h(L.CallsPage,{key:'calls',toast:showToast,onBack:back,onCall:function(peer,video){if(L.startCall)L.startCall(peer,video);}});
 else if(page==='news')body=h(L.NewsPage,{key:'news',brand:me.brand,onBack:back});
 else if(page==='bot')body=h(L.BotChat,{key:'bot'+arg,botId:arg,toast:showToast,onBack:function(){go('chats');},onGo:function(pg){go(pg);},onBalance:function(){setSheet({kind:'balance'});},onTx:function(pid){openPay(pid);}});
 else if(page==='devices')body=h(L.DevicesPage,{key:'devices',toast:showToast,onBack:back,onLink:function(){setSheet({kind:'qrscan'});}});
 else if(page==='notifs')body=h(L.NotifPage,{key:'notifs',onBack:back,onSeen:function(){setMe(function(m){return m?Object.assign({},m,{notif_unread:0}):m;});}});
 else if(page==='link')body=h(L.LinkApprove,{key:'link'+arg,token:arg,onClose:function(){go('devices');}});
 else if(page==='tv')body=h(L.SportTv,{key:'tv'});
 else if(page==='pay')body=h(L.PayPage,{key:'pay'+arg,pid:arg,toast:showToast,onBack:function(){loadTxs('');go('home');},onSupport:openSupport});
 else if(page==='support')body=h(L.SupportPage,{key:'support',brand:me.brand,preset:supportPreset,toast:showToast,onBack:function(){setSupportPreset('');loadMe();back();}});
 else if(page==='history'){var st=txStats[histKind]||{count:0,total:0};body=h('div',{className:'page '+dir,key:'history'},h('div',{className:'ph'},h('div',null,h('h1',{className:'h1'},'История'),h('p',{className:'h1sub'},'Все операции'))),h('div',{className:'tabs'},h('button',{className:histKind==='deposit'?'on':'',onClick:function(){setTxs(null);setHistKind('deposit');}},'Пополнения'),h('button',{className:histKind==='withdraw'?'on':'',onClick:function(){setTxs(null);setHistKind('withdraw');}},'Выводы')),h('div',{className:'stats2'},h('div',{className:'stat'},h('small',null,'Успешных'),h('b',null,st.count||0)),h('div',{className:'stat'},h('small',null,'На сумму'),h('b',null,money(st.total||0)+' сом'))),txs===null?h('div',{className:'center'},h('span',{className:'spin'})):(txs.length?h('div',{className:'tx-list'},txs.map(function(t,i){return h(L.TxRow,{key:t.id,tx:t,i:i,onOpen:function(x){setSheet({kind:'tx',tx:x});}});})):h('div',{className:'empty-line'},h(I,{name:'history',size:18}),histKind==='deposit'?'Пополнений не было':'Выводов не было')));}
 else if(PAGES.indexOf(page)<0)body=h('div',{className:'errpage'},h('div',{className:'mark'},h(I,{name:'search',size:30})),h('h2',null,'Страницы нет'),h('p',null,'Похоже, ссылка устарела или введена с ошибкой.'),h('button',{className:'btn',onClick:function(){go('home');}},'На главную'));
 else if(page==='u')body=h('div',{className:'page',key:'u'+arg},h('div',{className:'ph'},h('button',{className:'pback',onClick:function(){history.length>1?history.back():go('home');}},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'Профиль'),h('p',{className:'h1sub'},'@'+String(arg).replace(/^@/,'')))),h('div',{className:'u-page-hint'},h(I,{name:'qr2',size:18}),'Профиль открыт по ссылке'),h(L.UserSheet,{key:arg,handle:arg,me:u,toast:showToast,onClose:function(){history.length>1?history.back():go('home');},onDm:function(id){go('dm',String(id));},onMention:function(){go('chat');}}));
 else{var vs=u.verify_status||'none';var vmap={none:['Не пройдена','Селфи за минуту','shield'],pending:['На проверке','Оператор проверит','clock'],approved:['Верифицирован','Полный доступ','check'],rejected:['Отклонена',u.verify_note||'Повторите при хорошем свете','alert']};var dark=(document.documentElement.getAttribute('data-theme')==='dark');
  body=h('div',{className:'page '+dir,key:'profile'},
  h('div',{className:'pro'},h('label',{className:'av'},u.avatar_url?h('img',{src:u.avatar_url,alt:''}):initial(u.name),h('i',null,h(I,{name:'camera',size:13})),h('input',{type:'file',accept:'image/*',hidden:true,onChange:function(e){var f=e.target.files&&e.target.files[0];if(!f)return;var fd=new FormData();fd.append('file',f);api('/api/web/avatar',{method:'POST',body:fd,timeout:60000}).then(function(){showToast('Аватар обновлён','success');loadMe();}).catch(function(err){showToast(err.message,'error');});}})),h('div',{className:'pt'},h('b',null,u.name,vs==='approved'?h('span',{className:'vbadge'},h(I,{name:'check',size:11,w:3})):null),h('small',null,u.username?'@'+u.username:'Юзернейм не задан'),h('small',null,u.email),h('small',null,u.phone||'')),h('button',{className:'ic',onClick:function(){setSheet({kind:'edit'});},'aria-label':'Редактировать'},h(I,{name:'edit2',size:18}))),
  h('div',{className:'pro-actions'},h('button',{onClick:function(){setSheet({kind:'qr'});}},h(I,{name:'qr2',size:18}),'Мой QR'),h('button',{onClick:function(){setSheet({kind:'balance'});}},h(I,{name:'wallet2',size:18}),money(u.balance||0)+' сом'),h('button',{onClick:function(){setTheme(dark?'light':'dark');}},h(I,{name:dark?'sun':'moon',size:18}),dark?'Светлая':'Тёмная')),
  h('button',{className:'verify '+vs,onClick:function(){if(vs==='none'||vs==='rejected')setSheet({kind:'verify'});}},h('span',{className:'i'},h(I,{name:vmap[vs][2],size:20})),h('span',{className:'t'},h('b',null,'Верификация · '+vmap[vs][0]),h('small',null,vmap[vs][1])),(vs==='none'||vs==='rejected')?h(I,{name:'chev',size:18,className:'chev'}):null),
  h('div',{className:'list'},h('button',{className:'row',onClick:function(){openSupport('');}},h('span',{className:'i'},h(I,{name:'headset',size:18})),h('span',{className:'t'},h('b',null,'Поддержка'),h('small',null,'Оператор онлайн')),h(I,{name:'chev',size:18,className:'chev'})),h('button',{className:'row',onClick:function(){go('devices');}},h('span',{className:'i'},h(I,{name:'device',size:18})),h('span',{className:'t'},h('b',null,'Устройства'),h('small',null,'Сеансы и вход по QR')),h(I,{name:'chev',size:18,className:'chev'})),h('button',{className:'row',onClick:function(){setSheet({kind:'privacy'});}},h('span',{className:'i'},h(I,{name:'lock2',size:18})),h('span',{className:'t'},h('b',null,'Конфиденциальность'),h('small',null,'Кто может писать · был(а) в сети')),h(I,{name:'chev',size:18,className:'chev'})),h('button',{className:'row',onClick:function(){go('notifs');}},h('span',{className:'i'},h(I,{name:'bell',size:18})),h('span',{className:'t'},h('b',null,'Уведомления')),h(I,{name:'chev',size:18,className:'chev'})),h('button',{className:'row',onClick:function(){setSheet({kind:'rules'});}},h('span',{className:'i'},h(I,{name:'doc',size:18})),h('span',{className:'t'},h('b',null,'Правила чата')),h(I,{name:'chev',size:18,className:'chev'})),h('button',{className:'row',onClick:function(){openStory('deposit');}},h('span',{className:'i'},h(I,{name:'info',size:18})),h('span',{className:'t'},h('b',null,'Как это работает')),h(I,{name:'chev',size:18,className:'chev'}))),
  h('div',{className:'stats2'},h('div',{className:'stat'},h('small',null,'Пополнений'),h('b',null,(me.stats.deposit.count||0)+' · '+money(me.stats.deposit.total))),h('div',{className:'stat'},h('small',null,'Выводов'),h('b',null,(me.stats.withdraw.count||0)+' · '+money(me.stats.withdraw.total)))),
  h('div',{className:'list'},h('button',{className:'row danger',onClick:logout},h('span',{className:'i'},h(I,{name:'logout',size:18})),h('span',{className:'t'},h('b',null,'Выйти')))),
  h('div',{className:'ver'},'LUXON · v'+L.APP_VERSION));}

 /* Шторки рендерятся всей стопкой, а не только верхняя. Раньше нижняя
    размонтировалась: открыл инструкцию из «Вывести» — вернулся на пустой
    шаг, а иногда поверх оставался невидимый слой и экран переставал
    реагировать на тапы. Теперь нижние живы, но не ловят события. */
 function renderSheet(sheet,idx){var close=function(){setSheetStack(function(st){return st.slice(0,idx);});};var sh=null;
  if(sheet.kind==='deposit')sh=h(L.DepositSheet,{bks:bks,bk:sheet.bk,balance:u.balance,onClose:close,onCreated:function(r){openPay(r.request_id);},onBalance:function(){loadMe();loadTxs('');},onActive:function(tx){showToast('У вас есть активное пополнение','');openPay(tx.id);}});
  else if(sheet.kind==='privacy')sh=h(L.PrivacySheet,{user:u,toast:showToast,onClose:close,onPin:function(){pushSheet({kind:'pin'});},onSaved:function(){close();loadMe();}});
  else if(sheet.kind==='pin')sh=h(L.PinSheet,{toast:showToast,onClose:popSheet});
  else if(sheet.kind==='qrscan')sh=h(L.QrScanSheet,{onClose:close,onToken:function(t){close();go('link',t);}});
  else if(sheet.kind==='withdraw')sh=h(L.WithdrawSheet,{bks:bks,bk:sheet.bk,onClose:close,onCreated:function(){loadTxs('');},onHow:function(){pushSheet({kind:'story',which:'withdraw'});}});
  else if(sheet.kind==='bk')sh=h(L.BkSheet,{bk:sheet.bk,onClose:close,onDeposit:function(b){pushSheet({kind:'deposit',bk:b});},onWithdraw:function(b){pushSheet({kind:'withdraw',bk:b});},onHow:function(){pushSheet({kind:'story',which:'withdraw'});}});
  else if(sheet.kind==='tx')sh=h(L.TxSheet,{tx:sheet.tx,user:u,onClose:close,onSupport:openSupport,onPay:openPay});
  else if(sheet.kind==='story')sh=h(L.Story,{title:sheet.which==='deposit'?'Как пополнить':'Как вывести',icon:sheet.which==='deposit'?'arrowInDown':'arrowOutUp',which:sheet.which,slides:sheet.which==='deposit'?HOW_DEPOSIT:HOW_WITHDRAW,actionLabel:sheet.which==='deposit'?'Пополнить':'Вывести',onAction:function(){setSheetStack(function(st){return st.slice(0,-1).concat([{kind:sheet.which}]);});},onDeposit:anyDep&&!me.blocked?function(){setSheetStack(function(st){return st.slice(0,-1).concat([{kind:'deposit'}]);});}:null,onWithdraw:anyWd&&!me.blocked?function(){setSheetStack(function(st){return st.slice(0,-1).concat([{kind:'withdraw'}]);});}:null,onClose:close});
  else if(sheet.kind==='verify')sh=h(L.VerifySheet,{onClose:close,onDone:function(){close();showToast('Селфи отправлено на проверку','success');loadMe();}});
  else if(sheet.kind==='edit')sh=h(L.EditProfileSheet,{user:u,onClose:close,onSaved:function(){close();showToast('Сохранено','success');loadMe();}});
  else if(sheet.kind==='qr')sh=h(L.QrSheet,{user:u,toast:showToast,onClose:close});
  else if(sheet.kind==='rules')sh=h(L.RulesSheet,{onClose:close});
  else if(sheet.kind==='contests')sh=h(L.ContestsSheet,{items:contests,toast:showToast,onClose:close});
  else if(sheet.kind==='notif')sh=h(L.NotifSheet,{onClose:close,onAll:function(){close();go('notifs');},onSeen:function(){setMe(function(m){return m?Object.assign({},m,{notif_unread:0}):m;});}});
  else if(sheet.kind==='user')sh=h(L.UserSheet,{id:sheet.id,scope:sheet.scope||'chat',me:u,onClose:close,onDm:function(id){close();go('dm',String(id));},onMention:function(){close();go('chat');}});
  else if(sheet.kind==='balance')sh=h(L.BalanceSheet,{user:u,toast:showToast,onClose:close,onPay:function(pid){close();openPay(pid);}});
  return sh;}
 var sheetNodes=sheetStack.map(function(item,idx){var node=renderSheet(item,idx);
  return node?h('div',{key:item.kind+'-'+idx,className:'sheet-layer'+(idx<sheetStack.length-1?' under':'')},node):null;});

 return h('div',{className:'shell'+(fullscreen?' fs':''),onTouchStart:ptrStart,onTouchMove:ptrMove,onTouchEnd:ptrEnd},offline?h('div',{className:'offline'},h('div',{className:'mark'},h(I,{name:'alert',size:28})),h('h2',null,'Нет подключения к интернету'),h('p',null,'Проверьте Wi-Fi или мобильную сеть — как только связь вернётся, всё продолжится само.'),h('button',{className:'btn',onClick:function(){if(navigator.onLine){setOffline(false);loadMe();}}},'Повторить')):null,pull?h('div',{className:'ptr'+(refreshing.current?' go':''),style:{height:pull}},h('span',{className:'spin',style:{transform:'rotate('+(pull*4)+'deg)'}}),refreshing.current?'Обновляем…':(pull>=60?'Отпустите':'Потяните')):null,splash?h(L.Splash,{name:u.name}):null,fullscreen?null:h(TopBar,{user:u,brand:me.brand,unread:me.unread,notif:me.notif_unread,live:me.streams_live,go:go,onBalance:function(){setSheet({kind:'balance'});},onSupport:function(){openSupport('');},onNotif:function(){setSheet({kind:'notif'});}}),body,fullscreen?null:h(Nav,{page:page,go:go,live:me.streams_live,dm:me.dm_unread}),sheetNodes,photo?h(L.PhotoViewer,{url:photo,onClose:function(){setPhoto('');}}):null,L.CallLayer?h(L.CallLayer,{toast:showToast,key:'calllayer'}):null,toast?h(Toast,{id:toast.id,text:toast.text,type:toast.type,onClose:function(){setToast(null);}}):null);
}
ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
