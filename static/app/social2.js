(function(){
'use strict';
var L=window.__LUX,h=L.h,I=L.I,money=L.money,fmtDate=L.fmtDate,fmtTime=L.fmtTime,api=L.api,initial=L.initial,ding=L.ding,vibrate=L.vibrate,Sheet=L.Sheet,Av=L.Av,copyText=L.copyText;
L.P.bot='M12 3v3M7 6h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM9 11h.01M15 11h.01M9 15h6';L.P.folder=L.P.folder||'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z';L.P.eye='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z';L.P.pause=L.P.pause||'M10 5v14M14 5v14';L.P.trash=L.P.trash||'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13';
var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef;
function ago(iso){if(!iso)return '';var d=(Date.now()-new Date(iso))/1000;if(d<60)return 'только что';if(d<3600)return Math.floor(d/60)+' мин назад';if(d<86400)return Math.floor(d/3600)+' ч назад';return fmtDate(iso);}

/* ---------- Photo viewer (global) ---------- */
function PhotoViewer(p){var [scale,setScale]=useState(1);var start=useRef(null);
 useEffect(function(){var prev=document.body.style.overflow;document.body.style.overflow='hidden';function k(e){if(e.key==='Escape')p.onClose();}window.addEventListener('keydown',k);return function(){document.body.style.overflow=prev;window.removeEventListener('keydown',k);};},[]);
 function ts(e){if(e.touches.length===2){start.current={d:Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY),s:scale};}else start.current={y:e.touches[0].clientY};}
 function tm(e){if(e.touches.length===2&&start.current&&start.current.d){var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setScale(Math.max(1,Math.min(4,start.current.s*d/start.current.d)));}}
 function te(e){if(start.current&&start.current.y!==undefined&&e.changedTouches&&scale===1){var dy=e.changedTouches[0].clientY-start.current.y;if(Math.abs(dy)>90)p.onClose();}start.current=null;}
 return h('div',{className:'pv',onClick:function(){if(scale===1)p.onClose();},onTouchStart:ts,onTouchMove:tm,onTouchEnd:te},h('button',{className:'pv-x',onClick:function(e){e.stopPropagation();p.onClose();}},h(I,{name:'close',size:22})),h('img',{src:p.url,alt:'',style:{transform:'scale('+scale+')'},onDoubleClick:function(e){e.stopPropagation();setScale(scale>1?1:2.2);}}),h('a',{className:'pv-dl',href:p.url,target:'_blank',rel:'noopener',onClick:function(e){e.stopPropagation();}},h(I,{name:'ext',size:16}),'Открыть'));}
L.openPhoto=function(url){try{window.dispatchEvent(new CustomEvent('luxon-photo',{detail:url}));}catch(e){}};

/* ---------- Chats list ---------- */
function ChatsList(p){var [items,setItems]=useState(null);var [online,setOnline]=useState(0);var [tab,setTab]=useState('all');var [q,setQ]=useState('');var [found,setFound]=useState(null);var [fmsgs,setFmsgs]=useState(null);var [peek,setPeek]=useState(null);var [folders,setFolders]=useState([]);var [fmanage,setFmanage]=useState(false);var [ask,setAsk]=useState(null);var alive=useRef(true),qt=useRef(0);
 function loadFolders(){api('/api/web/folders').then(function(r){if(alive.current)setFolders(r.items||[]);}).catch(function(){});}
 /* Свайпы по строке чата: вправо — закрепить, влево — удалить у себя */
 function pinChat(it){api('/api/web/dm/'+it.peer.id+'/pinchat',{method:'POST',body:{}}).then(function(r){p.toast&&p.toast(r.pinned?'Чат закреплён':'Чат откреплён','success');load();}).catch(function(e){p.toast&&p.toast(e.message,'error');});}
 function hideChat(it){setAsk(it);}
 function load(){api('/api/web/dm').then(function(r){if(alive.current)setItems(r.items||[]);}).catch(function(){if(alive.current)setItems([]);});api('/api/web/chat/messages?limit=1').then(function(r){if(alive.current)setOnline(r.online||0);}).catch(function(){});}
 useEffect(function(){alive.current=true;load();loadFolders();var iv=setInterval(load,5000);return function(){alive.current=false;clearInterval(iv);};},[]);
 /* Глобальный поиск как в ТГ: контакты → люди → боты */
 useEffect(function(){var v=q.trim();if(v.length<2){setFound(null);setFmsgs(null);return;}var my=++qt.current;var tm=setTimeout(function(){api('/api/web/search?q='+encodeURIComponent(v)).then(function(r){if(my===qt.current)setFound(r);}).catch(function(){});api('/api/web/search/messages?q='+encodeURIComponent(v)).then(function(r){if(my===qt.current)setFmsgs(r.items||[]);}).catch(function(){});},280);return function(){clearTimeout(tm);};},[q]);
 var cf=tab.charAt(0)==='f'?folders.filter(function(x){return 'f'+x.id===tab;})[0]:null;
 var reqs=(items||[]).filter(function(x){return x.request;});var rest=(items||[]).filter(function(x){return !x.request&&(tab!=='unread'||x.unread>0)&&(!cf||(cf.peers||[]).indexOf(Number(x.peer.id))>=0);});
 function srow(cls,icon,title,sub,go,extra){return h('button',{className:'dm-row main',onClick:go},h('span',{className:'dm-av'},h('span',{className:'cav sys '+cls},h(I,{name:icon,size:20})),extra||null),h('span',{className:'t'},h('b',null,title,(cls==='lux'||cls==='father'||cls==='news')?h('span',{className:'vbadge sm'},h(I,{name:'check',size:9,w:3})):null),h('small',null,sub)),h(I,{name:'chev',size:18,className:'chev'}));}
 function urow(x,kind){return h('button',{key:kind+x.id,className:'dm-row',onClick:function(){if(kind==='bot'){p.onBot&&p.onBot(x);}else p.onOpen(x.id);}},
   h('span',{className:'dm-av'},kind==='bot'?h('span',{className:'cav sys bot2'},x.avatar_url?h('img',{src:x.avatar_url,alt:''}):h(I,{name:'bot',size:19})):h(Av,{src:x.avatar,name:x.name,size:44}),x.online?h('i',{className:'on'}):null),
   h('span',{className:'t'},h('b',null,x.name,kind==='bot'?h('span',{className:'bot-tag'},'BOT'):(x.verified?h(I,{name:'check',size:11,w:3,className:'vf'}):null)),h('small',null,'@'+x.username+(kind==='bot'&&x.users>=100?' · '+x.users+' пользователей':''))),
   h(I,{name:'chev',size:18,className:'chev'}));}
 var searching=q.trim().length>=2;
 return h('div',{className:'page',key:'chats'},
  h('div',{className:'ph'},h('button',{className:'pback',onClick:function(){if(p.onBack)p.onBack();else location.hash='#/home';}},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'Чаты'),h('p',{className:'h1sub'},'Общий чат и личные сообщения'))),
  h('div',{className:'search'},h(I,{name:'search',size:18}),h('input',{placeholder:'Поиск: люди, @юзернеймы, боты',value:q,onChange:function(e){setQ(e.target.value);}}),q?h('button',{className:'sx',onClick:function(){setQ('');}},h(I,{name:'close',size:15})):null),
  searching?h(React.Fragment,null,
   found===null?h('div',{className:'center',style:{padding:24}},h('span',{className:'spin'})):h(React.Fragment,null,
    found.contacts.length?h(React.Fragment,null,h('div',{className:'sec'},h('h3',null,'Контакты')),h('div',{className:'list'},found.contacts.map(function(x){return urow(x,'user');}))):null,
    found.users.length?h(React.Fragment,null,h('div',{className:'sec'},h('h3',null,'Люди')),h('div',{className:'list'},found.users.map(function(x){return urow(x,'user');}))):null,
    found.bots.length?h(React.Fragment,null,h('div',{className:'sec'},h('h3',null,'Боты')),h('div',{className:'list'},found.bots.map(function(x){return urow(x,'bot');}))):null,
    fmsgs&&fmsgs.length?h(React.Fragment,null,h('div',{className:'sec'},h('h3',null,'Сообщения'),h('small',null,fmsgs.length)),h('div',{className:'list'},fmsgs.map(function(m){return h('button',{key:'m'+m.msg_id,className:'dm-row',onClick:function(){p.onOpen(String(m.peer.id));}},h('span',{className:'dm-av'},h(Av,{src:m.peer.avatar,name:m.peer.name,size:44})),h('span',{className:'t'},h('b',null,m.peer.name),h('small',null,(m.mine?'Вы: ':'')+m.text)),h('span',{className:'r'},h('small',null,fmtTime(m.created_at))));}))):null,
    (!found.contacts.length&&!found.users.length&&!found.bots.length&&!(fmsgs&&fmsgs.length))?h('div',{className:'empty-line'},h(I,{name:'search',size:18}),'Ничего не найдено'):null)
  ):h(React.Fragment,null,
  /* Закреплённые строки как в ТГ: Избранное, общий чат, новости, LuxFather */
  h('div',{className:'list'},
   srow('fav','cloud','Избранное','Заметки, файлы и пересланное — только для вас',function(){if(!p.meId){p.toast&&p.toast('Профиль ещё загружается','');return;}p.onOpen(String(p.meId));}),
   srow('lux','chat',(p.brand||'LUXON')+' чат','в сети: '+online+' · общий чат клиентов',p.onGroup),
   srow('news','bell','Новости','Официальные объявления '+(p.brand||'LUXON'),p.onNews),
   srow('father','bot','LuxFather','Создание и настройка ваших ботов',p.onFather),srow('cts','users','Контакты','Ваши люди — со своими именами',function(){p.onContacts&&p.onContacts();})),
  /* Папки */
  h('div',{className:'folders'},[['all','Все'],['personal','Личные'],['bots','Боты'],['unread','Непрочитанные']].map(function(t){var n=t[0]==='unread'?(items||[]).filter(function(x){return x.unread;}).length:0;return h('button',{key:t[0],className:tab===t[0]?'on':'',onClick:function(){setTab(t[0]);vibrate(8);}},t[1],n?h('span',{className:'fcnt'},n):null);}).concat(folders.map(function(f){return h('button',{key:'f'+f.id,className:tab==='f'+f.id?'on':'',onClick:function(){setTab('f'+f.id);vibrate(8);}},f.icon+' '+f.name);})).concat([h('button',{key:'fmng',className:'fadd',onClick:function(){setFmanage(true);vibrate(8);},'aria-label':'Папки'},h(I,{name:'folder',size:14}),'+')])),
  reqs.length&&tab!=='bots'?h(React.Fragment,null,h('div',{className:'sec'},h('h3',null,'Запросы'),h('small',null,reqs.length)),h('div',{className:'list'},reqs.map(function(it){return h(DmRow,{key:'r'+it.peer.id,it:it,onOpen:p.onOpen,onPeek:setPeek,req:true,onSwipePin:pinChat,onSwipeHide:hideChat});}))):null,
  tab==='bots'?h(BotsFolder,{toast:p.toast,onBot:p.onBot}):h(React.Fragment,null,
   h('div',{className:'sec'},h('h3',null,'Личные')),
   items===null?h('div',{className:'list'},[0,1,2].map(function(i){return h('div',{key:i,className:'dm-row'},h('span',{className:'skel',style:{width:44,height:44,borderRadius:14}}),h('span',{className:'t'},h('span',{className:'skel',style:{height:12,width:'40%',display:'block'}}),h('span',{className:'skel',style:{height:10,width:'62%',display:'block',marginTop:6}})));})):(!rest.length?h('div',{className:'empty-line'},h(I,{name:'msg',size:18}),'Пока нет переписок — найдите человека в поиске или в общем чате'):h('div',{className:'list'},rest.map(function(it){return h(DmRow,{key:it.peer.id,it:it,onOpen:p.onOpen,onPeek:setPeek,onSwipePin:pinChat,onSwipeHide:hideChat});}))),
   tab==='all'?h(BotsFolder,{toast:p.toast,onBot:p.onBot}):null)),
  ask?h(L.Confirm,{danger:true,title:'Удалить чат?',text:'Переписка с «'+ask.peer.name+'» удалится только у вас. У собеседника она останется.',okLabel:'Удалить',onOk:function(){var it=ask;setAsk(null);return api('/api/web/dm/'+it.peer.id+'/hide',{method:'POST',body:{}}).then(function(){p.toast&&p.toast('Чат удалён','success');load();}).catch(function(e){p.toast&&p.toast(e.message,'error');});},onCancel:function(){setAsk(null);}}):null,
  fmanage?h(FoldersSheet,{folders:folders,chats:(items||[]).filter(function(x){return !x.request;}),toast:p.toast,onClose:function(){setFmanage(false);},onSaved:function(list){setFolders(list);}}):null,
  peek?h(PeekSheet,{it:peek,onClose:function(){setPeek(null);},onOpen:p.onOpen,onProfile:function(id){p.onProfile?p.onProfile(id):p.onOpen(id);}}):null);}

/* Свои папки (11.11): имя, иконка, какие чаты входят */
function FoldersSheet(p){var [list,setList]=useState((p.folders||[]).map(function(x){return {id:x.id,name:x.name,icon:x.icon,peers:(x.peers||[]).slice()};}));var [edit,setEdit]=useState(null);var [busy,setBusy]=useState(false);
 var ICONS=['📁','⭐','💼','🎮','🛒','❤️','🔥','🎓','🏦','👥','🤖','🔔'];
 function save(nl){if(busy)return;setBusy(true);api('/api/web/folders',{method:'POST',body:{items:nl}}).then(function(r){setList(r.items||[]);p.onSaved&&p.onSaved(r.items||[]);setBusy(false);setEdit(null);}).catch(function(e){p.toast&&p.toast(e.message,'error');setBusy(false);});}
 function del(f){save(list.filter(function(x){return x.id!==f.id;}));}
 if(edit)return h(Sheet,{title:edit.id?'Папка':'Новая папка',onClose:function(){setEdit(null);}},
  h('input',{className:'inp',placeholder:'Название папки',maxLength:16,value:edit.name,onChange:function(e){setEdit(Object.assign({},edit,{name:e.target.value}));}}),
  h('div',{className:'ficons'},ICONS.map(function(ic){return h('button',{key:ic,className:edit.icon===ic?'on':'',onClick:function(){setEdit(Object.assign({},edit,{icon:ic}));vibrate(6);}},ic);})),
  h('div',{className:'sec'},h('h3',null,'Чаты в папке'),h('small',null,edit.peers.length)),
  h('div',{className:'list fpick'},(p.chats||[]).length?(p.chats||[]).map(function(it){var id=Number(it.peer.id);var on=edit.peers.indexOf(id)>=0;return h('button',{key:id,className:'dm-row'+(on?' sel':''),onClick:function(){var np=on?edit.peers.filter(function(x){return x!==id;}):edit.peers.concat([id]);setEdit(Object.assign({},edit,{peers:np}));vibrate(6);}},h('span',{className:'dm-av'},h(Av,{src:it.peer.avatar,name:it.peer.name,size:38})),h('span',{className:'t'},h('b',null,it.peer.name)),h('span',{className:'fchk'},on?h(I,{name:'check',size:14,w:3}):null));}):h('div',{className:'empty-line'},'Пока нет чатов — папку можно наполнить позже')),
  h('button',{className:'btn mt12',disabled:busy||!edit.name.trim(),onClick:function(){var nl=edit.id?list.map(function(x){return x.id===edit.id?edit:x;}):list.concat([Object.assign({},edit,{id:(Math.max.apply(null,[0].concat(list.map(function(x){return x.id;})))+1)})]);save(nl);}},busy?h('span',{className:'spin'}):h(I,{name:'check',size:18,w:2.6}),'Сохранить'));
 return h(Sheet,{title:'Мои папки',sub:'до 6 папок со своим именем и иконкой',onClose:p.onClose},
  list.length?h('div',{className:'list'},list.map(function(f){return h('div',{key:f.id,className:'row frow'},h('span',{className:'i'},f.icon),h('span',{className:'t'},h('b',null,f.name),h('small',null,(f.peers||[]).length+' чат(ов)')),h('button',{className:'ic',onClick:function(){setEdit({id:f.id,name:f.name,icon:f.icon,peers:(f.peers||[]).slice()});}},h(I,{name:'edit2',size:16})),h('button',{className:'ic danger',onClick:function(){del(f);}},h(I,{name:'trash',size:16})));})):h('div',{className:'empty-line'},h(I,{name:'folder',size:18}),'Своих папок пока нет'),
  h('button',{className:'btn ghost mt12',disabled:list.length>=6,onClick:function(){setEdit({id:0,name:'',icon:'📁',peers:[]});}},h(I,{name:'spark',size:17}),list.length>=6?'Лимит 6 папок':'Новая папка'));}

/* Экран «Контакты» (12.1) */
function ContactsPage(p){var [items,setItems]=useState(null);var [q,setQ]=useState('');
 useEffect(function(){api('/api/web/contacts').then(function(r){setItems(r.items||[]);}).catch(function(){setItems([]);});},[]);
 var list=(items||[]).filter(function(x){var s=q.trim().toLowerCase();if(!s)return true;return ((x.alias||'')+' '+(x.name||'')+' '+(x.username||'')).toLowerCase().indexOf(s)>=0;});
 return h('div',{className:'page',key:'contacts'},
  h('div',{className:'ph'},h('button',{className:'pback',onClick:p.onBack},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'Контакты'),h('p',{className:'h1sub'},items===null?'…':(items.length+' контакт(ов)')))),
  h('div',{className:'search'},h(I,{name:'search',size:18}),h('input',{placeholder:'Поиск по контактам',value:q,onChange:function(e){setQ(e.target.value);}}),q?h('button',{className:'sx',onClick:function(){setQ('');}},h(I,{name:'close',size:15})):null),
  items===null?h('div',{className:'center',style:{padding:24}},h('span',{className:'spin'})):(!list.length?h('div',{className:'empty-line'},h(I,{name:'users',size:18}),items.length?'Никого не нашли':'Контактов пока нет — добавляйте людей из их профиля'):h('div',{className:'list'},list.map(function(x){return h('button',{key:x.id,className:'dm-row',onClick:function(){p.onOpen(String(x.id));}},h('span',{className:'dm-av'},h(Av,{src:x.avatar,name:x.alias||x.name,size:44}),x.online?h('i',{className:'on'}):null),h('span',{className:'t'},h('b',null,x.alias||x.name,x.verified?h(I,{name:'check',size:11,w:3,className:'vf'}):null),h('small',null,(x.alias?x.name+' · ':'')+(x.username?'@'+x.username:''))),h(I,{name:'chev',size:18,className:'chev'}));}))));}

/* Папка «Боты»: свои + с кем уже общался */
function BotsFolder(p){var [items,setItems]=useState(null);
 var [started,setStarted]=useState([]);
 useEffect(function(){api('/api/web/bots').then(function(r){setItems(r.items||[]);setStarted(r.started||[]);})
  .catch(function(){setItems([]);});},[]);
 function brow(b,mine){
  return h('button',{key:(mine?'m':'s')+b.id,className:'dm-row',onClick:function(){p.onBot&&p.onBot(b);}},
   h('span',{className:'dm-av'},h('span',{className:'cav sys bot2'},
    b.avatar_url?h('img',{src:b.avatar_url,alt:''}):h(I,{name:'bot',size:19}))),
   h('span',{className:'t'},h('b',null,b.name,h('span',{className:'bot-tag'},'BOT'),
    b.username==='LuxFather'||b.username==='LuxOn'?h('span',{className:'vbadge sm'},h(I,{name:'check',size:9,w:3})):null),
   h('small',null,mine?('@'+b.username+' · '+b.users+' польз.'):((b.last&&b.last.text)||('@'+b.username)))),
   h(I,{name:'chev',size:18,className:'chev'}));}
 return h(React.Fragment,null,
  started.length?h(React.Fragment,null,h('div',{className:'sec'},h('h3',null,'Запущенные боты'),
   h('small',null,started.length)),h('div',{className:'list'},started.map(function(b){return brow(b,false);}))):null,
  h('div',{className:'sec'},h('h3',null,'Ваши боты')),
  items===null?h('div',{className:'center',style:{padding:20}},h('span',{className:'spin'})):(!items.length?h('div',{className:'empty-line'},h(I,{name:'bot',size:18}),'Ботов нет — создайте в LuxFather'):h('div',{className:'list'},items.map(function(b){return brow(b,true);}))));}

/* Долгое нажатие — предпросмотр; свайп вправо — закрепить, влево — удалить.
   Иконка-кнопка вырастает по мере движения, на пороге — хаптик и вспышка. */
function DmRow(p){var it=p.it;var lp=useRef(0),fired=useRef(false),sx=useRef(0),sy=useRef(0),dx=useRef(0),sw=useRef(0),armed=useRef(false),el=useRef(null);
 function host(){return el.current&&el.current.parentNode;}
 function ts(e){var t=e.touches[0];sx.current=t.clientX;sy.current=t.clientY;dx.current=0;sw.current=0;armed.current=false;fired.current=false;clearTimeout(lp.current);lp.current=setTimeout(function(){if(sw.current)return;fired.current=true;vibrate(20);p.onPeek&&p.onPeek(it);},380);}
 function tm(e){var t=e.touches[0];var x=t.clientX-sx.current,y=t.clientY-sy.current;
  if(!sw.current&&Math.abs(x)>14&&Math.abs(x)>Math.abs(y)*1.4){sw.current=1;clearTimeout(lp.current);}
  else if(!sw.current&&Math.abs(y)>8){clearTimeout(lp.current);return;}
  if(sw.current){if(e.cancelable)e.preventDefault();dx.current=Math.max(-104,Math.min(104,x));
   var pgs=Math.min(1,Math.abs(dx.current)/72);var hit=pgs>=1;
   if(hit&&!armed.current){armed.current=true;vibrate(14);}
   if(!hit)armed.current=false;
   var n=el.current;if(n){n.style.transform='translateX('+dx.current+'px)';n.style.transition='none';}
   var hs=host();if(hs){hs.style.setProperty('--sw',pgs.toFixed(2));hs.className='dm-sw'+(dx.current>16?' r':(dx.current<-16?' l':''))+(hit?' go':'');}}}
 function te(e){clearTimeout(lp.current);var d=dx.current;var n=el.current;if(n){n.style.transition='transform .24s var(--sp2,ease)';n.style.transform='';var hs=host();if(hs)setTimeout(function(){hs.className='dm-sw';hs.style.removeProperty('--sw');},230);}
  if(sw.current){if(e&&e.cancelable)e.preventDefault();if(d>66&&p.onSwipePin){p.onSwipePin(it);}else if(d<-66&&p.onSwipeHide){p.onSwipeHide(it);}sw.current=0;dx.current=0;armed.current=false;return;}
  if(fired.current){e.preventDefault();e.stopPropagation();}}
 return h('div',{className:'dm-sw'},
  h('span',{className:'sw-pin'},h('i',{className:'swc'},h(I,{name:'pin',size:16})),h('em',null,it.pinned?'Открепить':'Закрепить')),
  h('span',{className:'sw-del'},h('i',{className:'swc'},h(I,{name:'trash',size:16})),h('em',null,'Удалить')),
  h('button',{ref:el,className:'dm-row'+(p.req?' req':''),
  onTouchStart:ts,onTouchMove:tm,onTouchEnd:te,onContextMenu:function(e){e.preventDefault();},
  onClick:function(e){if(fired.current||sw.current){e.preventDefault();return;}p.onOpen(it.peer.id);}},h('span',{className:'dm-av'},h(Av,{src:it.peer.avatar,name:it.peer.name,size:44}),it.peer.online?h('i',{className:'on'}):null),h('span',{className:'t'},h('b',null,it.peer.name,it.peer.verified?h(I,{name:'check',size:11,w:3,className:'vf'}):null),h('small',null,p.req?'Хочет написать вам':h(React.Fragment,null,it.last.mine?h('span',{className:'ticks pv'+(it.last.read?' rd':'')},h(I,{name:'check',size:11,w:3}),it.last.read?h(I,{name:'check',size:11,w:3,className:'t2'}):null):null,(it.last.mine?'Вы: ':'')+it.last.text))),h('span',{className:'r'},h('small',null,fmtTime(it.last.created_at)),it.unread?h('b',{className:'cnt'},it.unread):(it.pinned?h(I,{name:'pin',size:13,className:'pinned'}):null))));}

/* Предпросмотр переписки по зажатию */
function PeekSheet(p){var it=p.it;var [msgs,setMsgs]=useState(null);
 useEffect(function(){api('/api/web/dm/'+it.peer.id+'?limit=12').then(function(r){setMsgs(r.items||[]);}).catch(function(){setMsgs([]);});},[it.peer.id]);
 return h(Sheet,{title:it.peer.name,sub:it.peer.online?'в сети':'предпросмотр',onClose:p.onClose},
  h('div',{className:'peek'},msgs===null?h('div',{className:'center',style:{padding:22}},h('span',{className:'spin'})):(!msgs.length?h('div',{className:'empty-line'},h(I,{name:'msg',size:18}),'Сообщений нет'):msgs.slice(-10).map(function(m){return h('div',{key:m.id,className:'pk '+(m.mine?'mine':'')},h('span',null,m.kind==='photo'?'🖼 Фото':(m.kind==='voice'?'🎤 Голосовое':(L.fmtRich?L.fmtRich(m.text):m.text))),h('time',null,fmtTime(m.created_at)));}))),
  h('div',{className:'two-btn',style:{marginTop:12}},
   h('button',{className:'btn',onClick:function(){p.onClose();p.onOpen(it.peer.id);}},h(I,{name:'msg',size:18}),'Открыть чат'),
   h('button',{className:'btn ghost',onClick:function(){p.onClose();p.onProfile(it.peer.id);}},h(I,{name:'user',size:18}),'Профиль')));}

/* ---------- Новости ---------- */
function NewsPage(p){var [items,setItems]=useState(null);
 useEffect(function(){api('/api/web/news').then(function(r){setItems(r.items||[]);}).catch(function(){setItems([]);});},[]);
 return h('div',{className:'page',key:'news'},
  h('div',{className:'ph'},h('button',{className:'pback',onClick:p.onBack},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'Новости'),h('p',{className:'h1sub'},'Официальный канал '+(p.brand||'LUXON')))),
  items===null?h('div',{className:'center'},h('span',{className:'spin'})):(!items.length?h('div',{className:'empty-line'},h(I,{name:'bell',size:18}),'Публикаций пока нет'):h('div',{className:'news-list'},items.map(function(n){return h('article',{key:n.id,className:'news'},n.photo_url?h('img',{src:n.photo_url,alt:'',loading:'lazy'}):null,h('div',{className:'nb'},n.title?h('b',null,n.title):null,n.text?h('p',null,n.text):null,h('time',null,fmtDate(n.created_at))));}))));}

/* ---------- Чат с ботом ---------- */
function BotChat(p){var bid=p.botId;var [msgs,setMsgs]=useState(null);var [bot,setBot]=useState(null);var [busy,setBusy]=useState(false);var [prof,setProf]=useState(false);var box=useRef(null),lastId=useRef(0),alive=useRef(true);
 function scroll(){L.stickBottom(box,false,true);}
 function load(first){api('/api/web/bots/'+bid+'/chat'+(lastId.current?'?after_id='+lastId.current:'')).then(function(r){if(!alive.current)return;if(first)setBot(r.bot);var items=r.items||[];if(!items.length){setMsgs(function(prev){return prev===null?[]:prev;});return;}
  setMsgs(function(prev){var base=prev||[];var seen={};base.forEach(function(m){seen[m.id]=1;});return base.concat(items.filter(function(m){return !seen[m.id];}));});
  items.forEach(function(m){lastId.current=Math.max(lastId.current,m.id);});scroll();}).catch(function(e){if(first){p.toast(e.message,'error');p.onBack();}});}
 useEffect(function(){alive.current=true;load(true);var iv=setInterval(function(){load(false);},4000);return function(){alive.current=false;clearInterval(iv);};},[bid]);
 function push(body){setBusy(true);
  return api('/api/web/bots/'+bid+'/chat',{method:'POST',body:body,timeout:40000}).then(function(r){
   var add=[r.message].concat(r.replies||(r.reply?[r.reply]:[]));
   setMsgs(function(prev){
    var base=prev||[];var seen={};base.forEach(function(m){seen[m.id]=1;});
    return base.concat(add.filter(function(m){return m&&!seen[m.id];}));});
   add.forEach(function(m){if(m&&m.id>lastId.current)lastId.current=m.id;});
   /* Кнопка может увести в кассу — обрабатываем на клиенте. */
   (r.replies||[]).forEach(function(m){});
   scroll();setBusy(false);return true;
  }).catch(function(e){p.toast(e.message,'error');setBusy(false);return false;});}
 function send(t){if(!t.trim())return Promise.resolve(false);return push({text:t.trim()});}
 function tapBtn(bt){
  vibrate(10);
  var d=String(bt.d||'');
  if(d.indexOf('open:')===0){
   var what=d.slice(5);
   if(what==='withdraw'){p.onGo&&p.onGo('home');return;}
   if(what==='balance'){p.onBalance&&p.onBalance();return;}
   if(what==='support'){p.onGo&&p.onGo('support');return;}
   if(what.indexOf('tx:')===0){p.onTx&&p.onTx(what.slice(3));return;}
   p.onGo&&p.onGo('home');return;}
  push({callback:d,label:bt.t||''});}
 L.useVH();
 var started=!!(msgs&&msgs.length);
 /* Подмена «Старт» на композер меняет высоту ленты — досматриваем вниз. */
 useEffect(function(){if(started)scroll();},[started]);
 useEffect(function(){if(msgs&&msgs.length)scroll();},[msgs&&msgs.length]);
 var cmds=(bot&&bot.commands)||[];
 /* Кнопки последнего сообщения бота — reply-клавиатурой снизу, как в Telegram */
 var kbMsg=null;
 for(var qi=(msgs||[]).length-1;qi>=0;qi--){var mm=msgs[qi];if(!mm.mine){if(mm.buttons&&mm.buttons.length)kbMsg=mm;break;}}
 useEffect(function(){scroll();},[kbMsg&&kbMsg.id]);
 return h('div',{className:'gchat fixed'},
  /* Тап по шапке открывает профиль бота — как в ТГ */
  h('div',{className:'gc-head'},h('button',{className:'gc-ic',onClick:p.onBack},h(I,{name:'back',size:20})),
   h('button',{className:'gc-title gc-peer btitle',onClick:function(){setProf(true);}},
    h('span',{className:'cav sys bot2 sm'},bot&&bot.avatar_url?h('img',{src:bot.avatar_url,alt:''}):h(I,{name:'bot',size:16})),
    h('span',{className:'bt-t'},h('b',null,bot?bot.name:'…',h('span',{className:'bot-tag'},'BOT')),h('small',null,bot?('@'+bot.username+(bot.users>=100?' · '+bot.users+' пользователей':'')):''))),
   h('span',{style:{width:40}})),
  h('div',{className:'gc-msgs',ref:box},msgs===null?h('div',{className:'center'},h('span',{className:'spin'})):(!msgs.length?h('div',{className:'gc-empty bots'},
    h('span',{className:'cav sys bot2 big'},bot&&bot.avatar_url?h('img',{src:bot.avatar_url,alt:''}):h(I,{name:'bot',size:30})),
    h('b',null,bot?bot.name:'Бот'),
    bot&&bot.users>=100?h('span',{className:'bot-users'},bot.users+' пользователей'):null,
    h('div',{className:'bot-intro'},h('b',null,'Что умеет этот бот?'),
     h('p',null,(bot&&(bot.description||bot.about))||'Владелец пока не добавил описание.'),
     cmds.length?h('div',{className:'bi-links'},cmds.slice(0,8).map(function(c){return h('span',{key:c.command},'/'+c.command+(c.description?' — '+c.description:''));})):null)
   ):msgs.map(function(m){return h('div',{key:m.id,className:'gm-wrap'},h('div',{className:'gm '+(m.mine?'mine':'')},h('div',{className:'gm-b'},h('span',{className:'gm-t'},botRich(m.text,send)),h('span',{className:'gm-meta'},fmtTime(m.created_at)))),(m.buttons&&m.buttons.length&&!(kbMsg&&m.id===kbMsg.id))?h('div',{className:'ikb'},m.buttons.map(function(row,ri){return h('div',{key:ri,className:'ikb-row'},(row||[]).map(function(bt,ci){return h('button',{key:ci,className:bt.c?('ikc-'+bt.c):'',onClick:function(){tapBtn(bt);}},bt.t);}));})):null);}))),
  /* До запуска — кнопка Старт во всю ширину вместо поля, как в ТГ */
  !started&&msgs!==null?h('button',{className:'bot-start',onClick:function(){vibrate(15);send('/start');}},h(I,{name:'spark',size:18}),'Старт'):
  h(React.Fragment,null,
   kbMsg?null:h('div',{className:'bot-cmds'},['start','help'].concat(cmds.map(function(c){return c.command;})).filter(function(c,i,a){return c&&a.indexOf(c)===i;}).slice(0,10).map(function(c){return h('button',{key:c,onClick:function(){send('/'+c);}},'/'+c);})),
   h(L.Composer,{onSend:function(t){return send(t);},busy:busy,toast:p.toast,noMedia:true,noVoice:true,placeholder:'Сообщение боту'}),
   kbMsg?h('div',{className:'bot-kb'},kbMsg.buttons.map(function(row,ri){return h('div',{key:ri,className:'bkb-row'},(row||[]).map(function(bt,ci){return h('button',{key:ci,className:bt.c?('ikc-'+bt.c):'',onClick:function(){vibrate(10);tapBtn(bt);}},bt.t);}));})):null),
  prof&&bot?h(BotProfileSheet,{bot:bot,toast:p.toast,onClose:function(){setProf(false);},onStart:function(){setProf(false);send('/start');}}):null);}

/* /команды в тексте кликабельны — тап отправляет команду */
function botRich(text,send){var t=String(text||'');
 var tk=t.match(/\b(\d+:[A-Za-z0-9_-]{25,})\b/);
 if(tk){var pre2=t.slice(0,tk.index),post2=t.slice(tk.index+tk[1].length);
  return [pre2,h('button',{key:'tok',className:'md-token',onClick:function(e){e.stopPropagation();copyText(tk[1],'Токен скопирован');}},tk[1],h(I,{name:'copy',size:13})),post2];}
 if(t.indexOf('/')<0)return L.fmtRich?L.fmtRich(t):t;
 var out=[],re=/(^|\s)(\/[a-z0-9_]{2,24})/g,last=0,m,k=0;
 while((m=re.exec(t))){var pre=t.slice(last,m.index)+m[1];if(pre)out.push(pre);
  out.push(h('button',{key:'c'+(k++),className:'md-cmd',onClick:function(cmd){return function(e){e.stopPropagation();send(cmd);};}(m[2])},m[2]));
  last=m.index+m[0].length;}
 if(last<t.length)out.push(t.slice(last));
 return out;}

/* Профиль бота — открывается по шапке чата и из поиска */
function BotProfileSheet(p){var b=p.bot;
 return h(Sheet,{title:b.name,sub:'бот',onClose:p.onClose,center:true},
  h('span',{className:'cav sys bot2 big'},b.avatar_url?h('img',{src:b.avatar_url,alt:''}):h(I,{name:'bot',size:30})),
  h('div',{className:'uname'},b.name,h('span',{className:'bot-tag'},'BOT')),
  h('button',{className:'muted uatag',onClick:function(){copyText('@'+b.username,'@'+b.username+' скопирован');}},'@'+b.username,h(I,{name:'copy',size:13})),
  b.users>=100?h('div',{className:'bstat'},h(I,{name:'users',size:14}),b.users+' пользователей'):null,
  (b.description||b.about)?h('p',{className:'ubio'},b.description||b.about):null,
  (b.commands&&b.commands.length)?h('div',{className:'bcmd-card'},h('b',null,'Команды'),b.commands.map(function(c){return h('div',{key:c.command,className:'bc-row'},h('code',null,'/'+c.command),h('span',null,c.description||'—'));})):null,
  h('div',{className:'u-actions',style:{marginTop:12}},
   h('button',{onClick:function(){copyText(location.origin+'/app/#/bot/'+b.id,'Ссылка на бота скопирована');}},h(I,{name:'link',size:18}),'Ссылка'),
   h('button',{onClick:function(){var l=location.origin+'/app/#/bot/'+b.id;if(navigator.share)navigator.share({title:b.name,url:l}).catch(function(){});else copyText(l,'Ссылка скопирована');}},h(I,{name:'send',size:18}),'Переслать'),
   h('button',{onClick:p.onStart},h(I,{name:'spark',size:18}),'Старт')));}

/* ---------- Notifications ---------- *//* ---------- Notifications ---------- */
function NotifText(p){
 var t=String(p.text||'');
 var [open_,setOpen]=useState(false);
 var long=t.length>140;
 if(!long)return h('span',null,t);
 return h('span',{className:'ntext'},
  h('span',{className:open_?'':'clip3'},open_?t:t.slice(0,140).replace(/\s+\S*$/,'')+'…'),
  h('button',{className:'nmore',onClick:function(e){e.stopPropagation();setOpen(!open_);vibrate(8);}},
   open_?'Свернуть':'Показать всё'));}

function NotifItem(p){var n=p.n;var lines=String(n.text||'').split('\n').map(function(x){return x.trim();}).filter(Boolean);var title=(lines[0]||n.title||'').replace(/^[^\wА-Яа-яЁё0-9]+/,'').replace(/\s*[!.]+$/,'');var amt='',meta=[];lines.slice(1).forEach(function(l){var c=l.replace(/^[^\wА-Яа-яЁё0-9]+/,'');var m=c.match(/([\d\s]+[.,]?\d*)\s*сом/i);if(/зачисл|сумм|перевед|списан/i.test(c)&&m&&!amt){amt=m[1].replace(/\s+/g,' ').trim()+' сом';return;}if(/^(бк|id|номер|заявк|букмек)/i.test(c)&&meta.length<2){meta.push(c.replace(/^БК:\s*/i,'').replace(/^ID:\s*/i,'ID '));return;}});return h('div',{className:'notif '+n.kind+(n.unread?' unread':''),onClick:function(){p.onOpen&&p.onOpen(n);}},h('span',{className:'ni'},h(I,{name:n.kind==='success'?'check':(n.kind==='warn'?'alert':(n.kind==='gift'?'gift':'bell')),size:16})),h('div',{className:'nt'},h('div',{className:'nrow'},h('b',null,title),h('time',null,ago(n.created_at))),meta.length?h('span',null,meta.join(' · ')):null,amt?h('em',null,amt):null,lines.length>1?h('span',null,h(NotifText,{text:lines.slice(1).join('\n')})):null,n.photo_url?h('img',{src:n.photo_url,alt:''}):null),p.onHide?h('button',{className:'nx',onClick:function(e){e.stopPropagation();p.onHide(n);},'aria-label':'Удалить уведомление'},h(I,{name:'trash',size:15})):null);}
var NOTIF_PAGE=30;
function NotifPage(p){var [items,setItems]=useState(null);var [more,setMore]=useState(false);var [busy,setBusy]=useState(false);var [ask,setAsk]=useState(null);var off=useRef(0);
 /* Пагинация по 30: раньше тянули 80 разом и страница заметно тормозила. */
 function load(reset){if(busy)return;setBusy(true);var start=reset?0:off.current;
  api('/api/web/notifications/all?limit='+NOTIF_PAGE+'&offset='+start).then(function(r){var got=r.items||[];
   off.current=start+got.length;setMore(got.length>=NOTIF_PAGE);
   setItems(function(prev){var base=(reset||!prev)?[]:prev;var seen={};base.forEach(function(x){seen[x.id]=1;});return base.concat(got.filter(function(x){return !seen[x.id];}));});
  }).catch(function(){setItems(function(prev){return prev||[];});setMore(false);}).then(function(){setBusy(false);});}
 useEffect(function(){load(true);},[]);
 /* Удаление скрывает уведомление и в шторке, и на полной странице — состояние на сервере. */
 function hide(n){setItems(function(x){return (x||[]).filter(function(y){return y.id!==n.id;});});off.current=Math.max(0,off.current-1);
  return api('/api/web/notifications/state',{method:'POST',body:{ids:[n.id],action:'hide'}}).catch(function(){});}
 function readAll(){return api('/api/web/notifications/state',{method:'POST',body:{action:'read_all'}}).then(function(){setItems(function(x){return (x||[]).map(function(y){return Object.assign({},y,{unread:false});});});p.onSeen&&p.onSeen();}).catch(function(){});}
 var unread=(items||[]).filter(function(x){return x.unread;}).length;
 return h('div',{className:'page',key:'notifs'},
  h('div',{className:'ph'},h('button',{className:'pback',onClick:p.onBack},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'Уведомления'),h('p',{className:'h1sub'},unread?unread+' непрочитанных':'Все прочитаны'))),
  unread?h('button',{className:'notif-readall',onClick:readAll},h(I,{name:'check',size:16,w:3}),'Отметить все прочитанными'):null,
  items===null?h('div',{className:'center'},h('span',{className:'spin'})):(!items.length?h('div',{className:'empty-line'},h(I,{name:'bell',size:18}),'Уведомлений нет'):h(React.Fragment,null,
   h('div',{className:'notifs'},items.map(function(n){return h(NotifItem,{key:n.id,n:n,onHide:function(x){setAsk(x);},onRead:function(x){if(!x.unread)return;setItems(function(l){return (l||[]).map(function(y){return y.id===x.id?Object.assign({},y,{unread:false}):y;});});api('/api/web/notifications/state',{method:'POST',body:{ids:[x.id],action:'read'}}).catch(function(){});p.onSeen&&p.onSeen();}});})),
   more?h('button',{className:'btn ghost mt12',disabled:busy,onClick:function(){load(false);}},busy?h('span',{className:'spin'}):h(I,{name:'refresh',size:17}),busy?'Загружаем…':'Показать ещё 30'):h('div',{className:'notif-end'},'Это все уведомления'))),
  ask?h(L.Confirm,{danger:true,title:'Удалить уведомление?',text:(ask.title||'').slice(0,90),okLabel:'Удалить',onOk:function(){return hide(ask);},onCancel:function(){setAsk(null);}}):null);}
function NotifSheet(p){var [items,setItems]=useState(null);var [ask,setAsk]=useState(null);
 useEffect(function(){api('/api/web/notifications/all?limit=8').then(function(r){setItems(r.items||[]);var ids=(r.items||[]).filter(function(x){return x.unread;}).map(function(x){return x.id;});if(ids.length)api('/api/web/notifications/state',{method:'POST',body:{ids:ids,action:'read'}}).then(function(){p.onSeen&&p.onSeen();}).catch(function(){});}).catch(function(){setItems([]);});},[]);
 function hide(n){setItems(function(x){return (x||[]).filter(function(y){return y.id!==n.id;});});api('/api/web/notifications/state',{method:'POST',body:{ids:[n.id],action:'hide'}}).catch(function(){});}
 return h(Sheet,{title:'Уведомления',onClose:p.onClose},items===null?h('div',{className:'center'},h('span',{className:'spin'})):(!items.length?h('div',{className:'empty-line'},h(I,{name:'bell',size:18}),'Уведомлений нет'):h('div',{className:'notifs'},items.map(function(n){return h(NotifItem,{key:n.id,n:n,onHide:function(x){setAsk(x);}});}))),h('button',{className:'btn ghost sm mt12',onClick:function(){p.onClose();p.onAll();}},'Все уведомления'),ask?h(L.Confirm,{danger:true,title:'Удалить уведомление?',text:(ask.title||'').slice(0,90),okLabel:'Удалить',onOk:function(){hide(ask);setAsk(null);},onCancel:function(){setAsk(null);}}):null);}

/* ---------- LuxFather: боты клиента ---------- */
function LuxFather(p){var [items,setItems]=useState(null);var [limit,setLimit]=useState(10);var [open_,setOpen]=useState(null);var [mk,setMk]=useState(false);var [ask,setAsk]=useState(null);var [token,setToken]=useState(null);
 function load(){api('/api/web/bots').then(function(r){setItems(r.items||[]);setLimit(r.limit||10);}).catch(function(e){setItems([]);p.toast&&p.toast(e.message,'error');});}
 useEffect(load,[]);
 function del(b){api('/api/web/bots/'+b.id,{method:'DELETE'}).then(function(){setItems(function(x){return (x||[]).filter(function(y){return y.id!==b.id;});});setOpen(null);p.toast('Бот удалён','success');}).catch(function(e){p.toast(e.message,'error');});}
 return h('div',{className:'page',key:'bots'},
  h('div',{className:'ph'},h('button',{className:'pback',onClick:p.onBack},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'LuxFather'),h('p',{className:'h1sub'},'Ваши боты · '+((items||[]).length)+' из '+limit))),
  h('div',{className:'lf-hero'},h('span',{className:'lf-av'},h(I,{name:'bot',size:26})),h('b',null,'@LuxFather'),h('span',null,'Создавайте ботов для клиентов: имя, аватар, описание, команды и токен для внешних скриптов.')),
  items===null?h('div',{className:'list'},[0,1].map(function(i){return h('div',{key:i,className:'row'},h('span',{className:'skel',style:{width:38,height:38,borderRadius:12}}),h('span',{className:'t'},h('span',{className:'skel',style:{height:12,width:'50%',display:'block'}}),h('span',{className:'skel',style:{height:10,width:'70%',display:'block',marginTop:6}})));})):
  h(React.Fragment,null,
   items.length?h('div',{className:'list'},items.map(function(b){return h('button',{key:b.id,className:'row',onClick:function(){setOpen(b);}},
     h('span',{className:'i bot'+(b.enabled?'':' off')},b.avatar_url?h('img',{src:b.avatar_url,alt:''}):h(I,{name:'bot',size:18})),
     h('span',{className:'t'},h('b',null,b.name,h('span',{className:'bot-tag'},'BOT')),h('small',null,'@'+b.username+' · '+b.users+' польз. · '+b.msgs+' сообщ.')),
     h(I,{name:'chev',size:18,className:'chev'}));})):h('div',{className:'empty-line'},h(I,{name:'bot',size:18}),'Ботов пока нет — создайте первого'),
   h('button',{className:'btn mt12',disabled:items.length>=limit,onClick:function(){setMk(true);}},h(I,{name:'spark',size:18}),items.length>=limit?('Лимит '+limit+' ботов'):'Создать бота')),
  mk?h(BotCreate,{toast:p.toast,onClose:function(){setMk(false);},onDone:function(b,t){setMk(false);load();setToken({bot:b,token:t});}}):null,
  open_?h(BotSheet,{bot:open_,toast:p.toast,onClose:function(){setOpen(null);},onSaved:function(){load();},onToken:function(t){setToken({bot:open_,token:t});},onDelete:function(){setAsk(open_);}}):null,
  token?h(TokenSheet,{data:token,toast:p.toast,onClose:function(){setToken(null);}}):null,
  ask?h(L.Confirm,{danger:true,title:'Удалить бота?',text:'@'+ask.username+' и вся переписка с ним будут удалены. Токен перестанет работать.',okLabel:'Удалить',onOk:function(){del(ask);setAsk(null);},onCancel:function(){setAsk(null);}}):null);}

function BotCreate(p){var [name,setName]=useState('');var [uname,setUname]=useState('');var [about,setAbout]=useState('');var [busy,setBusy]=useState(false);var [err,setErr]=useState('');
 var uOk=/^[a-z0-9_]{5,32}$/.test(uname)&&/bot$/.test(uname);
 function go(){if(busy)return;setBusy(true);setErr('');
  api('/api/web/bots',{method:'POST',body:{name:name.trim(),username:uname,about:about.trim()}})
   .then(function(r){vibrate([25,40,25]);ding('ok');p.onDone(r.bot,r.token);})
   .catch(function(e){setErr(e.message);}).then(function(){setBusy(false);});}
 return h(Sheet,{title:'Новый бот',sub:'Как в BotFather',onClose:p.onClose},
  h('div',{className:'f-label'},'Название'),
  h('div',{className:'field'},h(I,{name:'bot',size:18}),h('input',{placeholder:'Например: Магазин LUXON',value:name,maxLength:64,onChange:function(e){setName(e.target.value);}})),
  h('div',{className:'f-label'},'Юзернейм'),
  h('div',{className:'field'+(uOk?' ok':'')},h(I,{name:'at',size:18}),h('input',{placeholder:'my_shop_bot',value:uname,autoCapitalize:'off',autoCorrect:'off',onChange:function(e){setUname(e.target.value.replace(/[^a-zA-Z0-9_]/g,'').toLowerCase());}}),uOk?h('span',{className:'tick'},h(I,{name:'check',size:14,w:3})):null),
  h('div',{className:'hint',style:{marginTop:6}},h(I,{name:'info',size:15}),'Латиница, от 5 символов, обязательно заканчивается на bot'),
  h('div',{className:'f-label'},'Коротко о боте'),
  h('div',{className:'field'},h(I,{name:'edit2',size:18}),h('input',{placeholder:'Одна строка, видна в профиле',value:about,maxLength:120,onChange:function(e){setAbout(e.target.value);}})),
  err?h('div',{className:'attn'},err):null,
  h('button',{className:'btn mt12',disabled:busy||name.trim().length<2||!uOk,onClick:go},busy?h('span',{className:'spin w'}):h(I,{name:'check',size:18}),busy?'Создаём…':'Создать бота'));}

function TokenSheet(p){var t=p.data.token;
 return h(Sheet,{title:'Бот готов',sub:'@'+p.data.bot.username,onClose:p.onClose,center:true},
  h('span',{className:'tvi ok'},h(I,{name:'check',size:26,w:3})),
  h('b',{style:{fontSize:17,marginTop:6}},p.data.bot.name),
  h('p',{className:'muted',style:{margin:'4px 0 14px',fontSize:13}},'Токен показывается один раз. Сохраните его — по нему внешние скрипты работают с ботом.'),
  h('div',{className:'token-box',onClick:function(){copyText(t,'Токен скопирован');}},h('code',null,t),h(I,{name:'copy',size:16})),
  h('button',{className:'btn mt12',onClick:function(){copyText(t,'Токен скопирован');}},h(I,{name:'copy',size:18}),'Скопировать токен'),
  h('button',{className:'btn ghost mt8',onClick:p.onClose},'Готово'));}

function BotSheet(p){var b=p.bot;var [tab,setTab]=useState('info');var [tok,setTok]=useState('');var [name,setName]=useState(b.name);var [about,setAbout]=useState(b.about||'');var [desc,setDesc]=useState(b.description||'');var [start,setStart]=useState(b.start_text||'');var [cmds,setCmds]=useState(b.commands||[]);var [busy,setBusy]=useState(false);
 function save(patch){setBusy(true);return api('/api/web/bots/'+b.id,{method:'PUT',body:patch}).then(function(){p.toast('Сохранено','success');p.onSaved&&p.onSaved();}).catch(function(e){p.toast(e.message,'error');}).then(function(){setBusy(false);});}
 function addCmd(){setCmds(cmds.concat([{command:'',description:'',reply:''}]));}
 function setCmd(i,k,v){setCmds(cmds.map(function(x,j){return j===i?Object.assign({},x,{[k]:v}):x;}));}
 return h(Sheet,{title:b.name,sub:'@'+b.username,onClose:p.onClose},
  h('div',{className:'bot-head'},h('label',{className:'bot-av'},b.avatar_url?h('img',{src:b.avatar_url,alt:''}):h(I,{name:'bot',size:26}),h('i',null,h(I,{name:'camera',size:12})),
   h('input',{type:'file',accept:'image/*',hidden:true,onChange:function(e){var f=e.target.files&&e.target.files[0];if(!f)return;var fd=new FormData();fd.append('file',f);api('/api/web/bots/'+b.id+'/avatar',{method:'POST',body:fd,timeout:60000}).then(function(){p.toast('Аватар обновлён','success');p.onSaved&&p.onSaved();}).catch(function(err){p.toast(err.message,'error');});}})),
   h('div',null,h('b',null,b.name,h('span',{className:'bot-tag'},'BOT')),h('small',null,b.users+' пользователей · '+b.msgs+' сообщений'))),
  h('div',{className:'utabs'},[['info','Профиль'],['cmds','Команды'],['api','Токен']].map(function(t){return h('button',{key:t[0],className:tab===t[0]?'on':'',onClick:function(){setTab(t[0]);}},t[1]);})),
  tab==='info'?h(React.Fragment,null,
   h('div',{className:'f-label'},'Название'),h('div',{className:'field'},h(I,{name:'bot',size:18}),h('input',{value:name,maxLength:64,onChange:function(e){setName(e.target.value);}})),
   h('div',{className:'f-label'},'Коротко'),h('div',{className:'field'},h(I,{name:'edit2',size:18}),h('input',{value:about,maxLength:120,onChange:function(e){setAbout(e.target.value);}})),
   h('div',{className:'f-label'},'Описание'),h('textarea',{className:'ta',value:desc,maxLength:600,rows:3,placeholder:'Что умеет бот',onChange:function(e){setDesc(e.target.value);}}),
   h('div',{className:'f-label'},'Сообщение на /start'),h('textarea',{className:'ta',value:start,maxLength:1000,rows:3,onChange:function(e){setStart(e.target.value);}}),
   h('button',{className:'btn mt12',disabled:busy,onClick:function(){save({name:name.trim(),about:about.trim(),description:desc.trim(),start_text:start.trim()});}},busy?h('span',{className:'spin w'}):h(I,{name:'check',size:18}),'Сохранить'),
   h('button',{className:'btn ghost danger mt8',onClick:p.onDelete},h(I,{name:'trash',size:18}),'Удалить бота')
  ):null,
  tab==='cmds'?h(React.Fragment,null,
   h('div',{className:'hint',style:{marginBottom:10}},h(I,{name:'info',size:15}),'Команда без слеша. Ответ уходит клиенту, когда он её напишет.'),
   cmds.map(function(c,i){return h('div',{key:i,className:'cmd-row'},
    h('div',{className:'field sm'},h('span',{className:'pre'},'/'),h('input',{placeholder:'help',value:c.command,onChange:function(e){setCmd(i,'command',e.target.value.replace(/[^a-zA-Z0-9_]/g,'').toLowerCase());}})),
    h('div',{className:'field sm'},h('input',{placeholder:'Описание для списка',value:c.description,onChange:function(e){setCmd(i,'description',e.target.value);}})),
    h('textarea',{className:'ta sm',rows:2,placeholder:'Ответ бота',value:c.reply,onChange:function(e){setCmd(i,'reply',e.target.value);}}),
    h('button',{className:'cmd-x',onClick:function(){setCmds(cmds.filter(function(_,j){return j!==i;}));}},h(I,{name:'trash',size:15})));}),
   h('button',{className:'btn ghost mt8',onClick:addCmd},h(I,{name:'spark',size:17}),'Добавить команду'),
   h('button',{className:'btn mt8',disabled:busy,onClick:function(){save({commands:cmds});}},busy?h('span',{className:'spin w'}):h(I,{name:'check',size:18}),'Сохранить команды')
  ):null,
  tab==='api'?h(React.Fragment,null,
   h('div',{className:'f-label'},'Текущий токен'),
   h('div',{className:'token-box'+(tok?'':' muted'),onClick:function(){if(tok)copyText(tok,'Токен скопирован');}},h('code',null,tok||b.token_hint||'скрыт'),tok?h(I,{name:'copy',size:15}):null),
   tok?null:h('button',{className:'btn ghost mt8',onClick:function(){api('/api/web/bots/'+b.id+'/token/reveal').then(function(r){setTok(r.token);}).catch(function(e){p.toast(e.message,'error');});}},h(I,{name:'eye',size:17}),'Показать токен'),
   h('div',{className:'hint',style:{marginTop:8}},h(I,{name:'lock2',size:15}),'Токен хранится зашифрованным. Показывайте его только своим скриптам.'),
   h('div',{className:'f-label'},'Как обращаться'),
   h('div',{className:'code-box'},h('code',null,'GET  /api/lux/bot/me'),h('code',null,'GET  /api/lux/bot/updates?after_id=0'),h('code',null,'POST /api/lux/bot/sendMessage'),h('code',null,'Header: X-Bot-Token: <токен>')),
   h('button',{className:'btn ghost mt12',onClick:function(){api('/api/web/bots/'+b.id+'/token',{method:'POST',body:{}}).then(function(r){p.onToken(r.token);}).catch(function(e){p.toast(e.message,'error');});}},h(I,{name:'refresh',size:18}),'Перевыпустить токен')
  ):null);}

/* ---------- Devices ---------- */
function DevicesPage(p){var [data,setData]=useState(null);var [qr,setQr]=useState(null);var [ask,setAsk]=useState(null);
 function load(){api('/api/web/sessions').then(setData).catch(function(e){p.toast(e.message,'error');});}
 useEffect(load,[]);
 function term(id){api('/api/web/sessions/terminate',{method:'POST',body:id?{id:id}:{all:true}}).then(function(){p.toast(id?'Сеанс завершён':'Другие сеансы завершены','success');load();}).catch(function(e){p.toast(e.message,'error');});}
 return h('div',{className:'page',key:'devices'},h('div',{className:'ph'},h('button',{className:'pback',onClick:p.onBack},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'Устройства'),h('p',{className:'h1sub'},'Где выполнен вход'))),
  h('div',{className:'card dev-connect'},h('span',{className:'tvi'},h(I,{name:'qr2',size:24})),h('b',null,'Подключить устройство'),h('span',null,'Откройте wwweeewww.fit/app на другом устройстве, нажмите «Войти по QR» и отсканируйте код этим телефоном'),h('button',{className:'btn sm',onClick:function(){setQr(true);}},h(I,{name:'camera',size:17}),'Сканировать QR')),
  data?h(React.Fragment,null,h('div',{className:'sec'},h('h3',null,'Это устройство')),data.current?h('div',{className:'list'},h(DevRow,{d:data.current,current:true}),data.others.length?h('button',{className:'row danger',onClick:function(){setAsk({all:true});},disabled:!data.current.can_terminate},h('span',{className:'i'},h(I,{name:'logout',size:17})),h('span',{className:'t'},h('b',null,'Завершить другие сеансы'),h('small',null,data.current.can_terminate?'Выйти на всех устройствах, кроме этого':'Будет доступно через 24 часа после входа с этого устройства'))):null):null,
   h('div',{className:'sec'},h('h3',null,'Активные сеансы'),h('small',null,data.others.length)),data.others.length?h('div',{className:'list'},data.others.map(function(d){return h(DevRow,{key:d.id,d:d,onTerm:data.current&&data.current.can_terminate?function(){setAsk({id:d.id,name:d.device});}:null});})):h('div',{className:'empty-line'},h(I,{name:'device',size:18}),'Других устройств нет')):h('div',{className:'center'},h('span',{className:'spin'})),
  qr?h(QrScanSheet,{toast:p.toast,onClose:function(){setQr(false);},onToken:function(t){setQr(false);p.onLink(t);}}):null,
  ask?h(L.Confirm,{danger:true,title:ask.all?'Завершить другие сеансы?':'Завершить сеанс?',text:ask.all?'На всех устройствах, кроме этого, потребуется войти заново.':('Устройство «'+(ask.name||'')+'» выйдет из профиля.'),okLabel:'Завершить',onOk:function(){term(ask.all?null:ask.id);setAsk(null);},onCancel:function(){setAsk(null);}}):null);}
function DevRow(p){var d=p.d;var m=/iPhone|iPad/.test(d.device)?'phone':(/Android/.test(d.device)?'android':'desktop');return h('div',{className:'row dev'},h('span',{className:'i dev-'+m},h(I,{name:m==='desktop'?'device':'phone2',size:18})),h('span',{className:'t'},h('b',null,d.device),h('small',null,(d.ip?d.ip+' · ':'')+(p.current?'в сети':ago(d.last_seen))),d.created_at?h('small',{className:'sub'},'Вход: '+fmtDate(d.created_at)):null),p.current?h('span',{className:'dev-cur'},'Текущее'):h('button',{className:'dev-term'+(p.onTerm?'':' off'),disabled:!p.onTerm,onClick:p.onTerm||null,'aria-label':'Завершить сеанс'},h(I,{name:'logout',size:15}),'Завершить'));}

/* ---------- QR scan (BarcodeDetector) ---------- */
function QrScanSheet(p){var v=useRef(null),cv=useRef(null),stream=useRef(null),raf=useRef(0);var [err,setErr]=useState('');var [manual,setManual]=useState('');var [ready,setReady]=useState(false);
 useEffect(function(){var alive=true;var det=('BarcodeDetector' in window)?new window.BarcodeDetector({formats:['qr_code']}):null;
  function loadJsQR(){return new Promise(function(res,rej){if(window.jsQR)return res();var sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc);});}
  function found(val){var m=/link\/([A-Za-z0-9_\-]+)/.exec(String(val||''));if(m){alive=false;vibrate(30);p.onToken(m[1]);return true;}return false;}
  function tick(){if(!alive)return;var el=v.current;if(!el||el.readyState<2){raf.current=requestAnimationFrame(tick);return;}
   if(det){det.detect(el).then(function(codes){if(!alive)return;var c=codes&&codes[0];if(c&&c.rawValue&&found(c.rawValue))return;raf.current=requestAnimationFrame(tick);}).catch(function(){raf.current=requestAnimationFrame(tick);});return;}
   try{var c=cv.current||(cv.current=document.createElement('canvas'));var w=el.videoWidth,hh=el.videoHeight;if(w&&hh){var k=Math.min(1,480/Math.max(w,hh));c.width=Math.round(w*k);c.height=Math.round(hh*k);var ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(el,0,0,c.width,c.height);var img=ctx.getImageData(0,0,c.width,c.height);var code=window.jsQR&&window.jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});if(code&&code.data&&found(code.data))return;}}catch(e){}
   setTimeout(function(){raf.current=requestAnimationFrame(tick);},120);}
  /* Те же грабли, что с микрофоном: без https и без явного жеста камера не даётся. */
  if(!window.isSecureContext){setErr('Камера работает только по https — откройте сайт по https или вставьте ссылку из QR ниже');return;}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){setErr('Камера недоступна в этом браузере — вставьте ссылку из QR ниже');return;}
  var prep=det?Promise.resolve():loadJsQR().catch(function(){setErr('Не удалось загрузить сканер — вставьте ссылку из QR ниже');});
  prep.then(function(){return navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});}).then(function(s){if(!alive){s.getTracks().forEach(function(t){t.stop();});return;}stream.current=s;var el=v.current;el.srcObject=s;el.setAttribute('playsinline','');el.muted=true;el.play().catch(function(){});setReady(true);tick();}).catch(function(e){var n=(e&&e.name)||'';
   if(n==='NotAllowedError'||n==='SecurityError')setErr('Доступ к камере запрещён. Настройки → сайт wwweeewww.fit → Камера → Разрешить. Или вставьте ссылку из QR ниже');
   else if(n==='NotFoundError')setErr('Камера не найдена — вставьте ссылку из QR ниже');
   else if(n==='NotReadableError')setErr('Камера занята другим приложением — закройте его и попробуйте снова');
   else setErr('Не удалось включить камеру — вставьте ссылку из QR ниже');});
  return function(){alive=false;cancelAnimationFrame(raf.current);if(stream.current)stream.current.getTracks().forEach(function(t){t.stop();});};},[]);
 return h(Sheet,{title:'Сканировать QR',sub:ready?'Наведите на код входа':'Включаем камеру…',onClose:p.onClose,center:true},h('div',{className:'cam sq'},h('video',{ref:v,playsInline:true,muted:true,autoPlay:true}),h('div',{className:'scan-frame'})),err?h('div',{className:'attn'},err):null,h('div',{className:'f-label',style:{alignSelf:'flex-start'}},'Или вставьте ссылку из QR'),h('div',{className:'field',style:{width:'100%'}},h(I,{name:'link',size:18}),h('input',{placeholder:'https://…/#/link/…',value:manual,onChange:function(e){setManual(e.target.value);}})),h('button',{className:'btn mt12',disabled:!/link\/[A-Za-z0-9_\-]+/.test(manual),onClick:function(){p.onToken(/link\/([A-Za-z0-9_\-]+)/.exec(manual)[1]);}},'Подтвердить'));}

/* ---------- Approve login from phone ---------- */
function LinkApprove(p){var [info,setInfo]=useState(null);var [err,setErr]=useState('');var [done,setDone]=useState(false);var [busy,setBusy]=useState(false);
 /* Раньше это была «шторка» поверх пустоты: после сканирования кнопка «Назад»
    оставляла серый экран с висящим окном. Теперь это обычная страница со своим
    заголовком — назад работает как везде. */
 /* Токен одноразовый. После подтверждения кнопка «Назад» возвращала на эту же
    страницу, она перезапрашивала info и показывала «QR устарел». Помним свои
    подтверждённые токены и сразу показываем «Готово». */
 function okKey(){return 'luxon-qr-ok-'+p.token;}
 function load(){setErr('');setInfo(null);
  try{if(sessionStorage.getItem(okKey())){setDone(true);return;}}catch(e){}
  api('/api/web/auth/qr/info/'+encodeURIComponent(p.token)).then(function(r){setInfo(r);}).catch(function(e){setErr(e.message);});}
 useEffect(load,[p.token]);
 function ok(){if(busy)return;setBusy(true);api('/api/web/auth/qr/approve',{method:'POST',body:{token:p.token}}).then(function(){try{sessionStorage.setItem(okKey(),'1');}catch(e){}setDone(true);ding('ok');vibrate([30,50,30]);
   /* Убираем #/link из истории, чтобы «Назад» вёл в профиль, а не сюда. */
   try{history.replaceState(null,'','#/devices');}catch(e){}}).catch(function(e){setErr(e.message);}).then(function(){setBusy(false);});}
 var expired=/устарел|истек|не найден|expired/i.test(err||'');
 return h('div',{className:'page',key:'link'},
  h('div',{className:'ph'},h('button',{className:'pback',onClick:p.onClose},h(I,{name:'back',size:22})),h('div',null,h('h1',{className:'h1'},'Вход на устройстве'),h('p',{className:'h1sub'},done?'Подтверждено':'Подтвердите вход по QR'))),
  h('div',{className:'card link-card'},
   done?h(React.Fragment,null,
     h('span',{className:'tvi ok'},h(I,{name:'check',size:26,w:3})),
     h('b',null,'Готово'),
     h('span',null,'Устройство вошло в ваш профиль. Управлять сеансами можно в разделе «Устройства».'),
     h('button',{className:'btn mt12',onClick:p.onClose},'Понятно')
   ):(err?h(React.Fragment,null,
     h('span',{className:'tvi bad'},h(I,{name:'alert',size:26})),
     h('b',null,expired?'QR устарел':'Не получилось'),
     h('span',null,expired?'Код входа живёт 3 минуты. Обновите страницу входа на другом устройстве и отсканируйте новый QR.':err),
     h('button',{className:'btn mt12',onClick:p.onRescan||p.onClose},h(I,{name:'camera',size:18}),'Сканировать заново'),
     h('button',{className:'btn ghost mt8',onClick:p.onClose},'Назад к устройствам')
   ):(info?h(React.Fragment,null,
     h('span',{className:'tvi'},h(I,{name:'device',size:26})),
     h('b',null,info.device),
     h('span',null,'IP '+(info.ip||'—')+'. Разрешить вход в ваш профиль LUXON на этом устройстве?'),
     h('div',{className:'two-btn',style:{width:'100%',marginTop:14}},h('button',{className:'btn ghost',onClick:p.onClose},'Отмена'),h('button',{className:'btn',disabled:busy,onClick:ok},busy?h('span',{className:'spin w'}):h(I,{name:'check',size:18}),'Разрешить'))
   ):h('div',{className:'center',style:{padding:26}},h('span',{className:'spin'}))))));}

/* ---------- QR login on auth screen (new device) ---------- */
function QrLogin(p){var [d,setD]=useState(null);var [left,setLeft]=useState(180);var alive=useRef(true);
 function start(){api('/api/web/auth/qr/start',{method:'POST',body:{}}).then(function(r){if(!alive.current)return;setD(r);setLeft(r.ttl||180);}).catch(function(e){p.toast&&p.toast(e.message,'error');});}
 useEffect(function(){alive.current=true;start();return function(){alive.current=false;};},[]);
 useEffect(function(){if(!d)return;var iv=setInterval(function(){setLeft(function(x){return Math.max(0,x-1);});api('/api/web/auth/qr/poll?token='+encodeURIComponent(d.token)).then(function(r){if(!alive.current)return;if(r.status==='ok'){clearInterval(iv);p.onDone(r);}else if(r.status==='expired'){clearInterval(iv);setD(null);}}).catch(function(){});},2000);return function(){clearInterval(iv);};},[d&&d.token]);
 return h('div',{className:'auth'},h('button',{className:'back',onClick:p.onBack},h(I,{name:'back',size:20}),'Назад'),h('div',{className:'mark'},h(I,{name:'qr2',size:28})),h('h1',null,'Вход по QR'),h('p',null,'На телефоне, где вы уже вошли: Профиль → Устройства → «Сканировать QR».'),d?h('div',{className:'qr2 login'},h('img',{src:d.qr,alt:'QR'}),h('small',null,'Обновится через '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0'))):h('div',{className:'qr2 login'},h('button',{className:'btn ghost sm',onClick:start},'Получить новый QR')));}

/* ---------- Privacy ---------- */
function PrivacySheet(p){var u=p.user;var [dm,setDm]=useState(u.priv_dm||'all');var [seen,setSeen]=useState(u.priv_seen!==false);var [calls,setCalls]=useState(u.priv_calls||'all');var [phone,setPhone]=useState(u.priv_phone||'all');var [busy,setBusy]=useState(false);
 function save(){setBusy(true);api('/api/web/privacy',{method:'POST',body:{priv_dm:dm,priv_seen:seen,priv_calls:calls,priv_phone:phone}}).then(function(){p.onSaved();}).catch(function(e){p.toast(e.message,'error');}).then(function(){setBusy(false);});}
 return h(Sheet,{title:'Конфиденциальность',onClose:p.onClose},h('div',{className:'f-label'},'Кто может писать мне'),h('div',{className:'tabs'},h('button',{className:dm==='all'?'on':'',onClick:function(){setDm('all');}},'Все'),h('button',{className:dm==='none'?'on':'',onClick:function(){setDm('none');}},'Никто')),h('p',{className:'note'},dm==='none'?'Новые пользователи не смогут написать первыми. Те, кому вы уже ответили, — смогут.':'Первое сообщение от незнакомого человека придёт как запрос — вы решите, отвечать ли.'),h('div',{className:'f-label'},'Время последнего входа'),h('div',{className:'tabs'},h('button',{className:seen?'on':'',onClick:function(){setSeen(true);}},'Показывать'),h('button',{className:!seen?'on':'',onClick:function(){setSeen(false);}},'Скрывать')),h('p',{className:'note'},seen?'Другие видят «был(а) 5 мин назад».':'Другие видят только «был(а) недавно».'),h('div',{className:'f-label'},'Кто может мне звонить'),h('div',{className:'tabs'},h('button',{className:calls==='all'?'on':'',onClick:function(){setCalls('all');}},'Все'),h('button',{className:calls==='contacts'?'on':'',onClick:function(){setCalls('contacts');}},'Контакты'),h('button',{className:calls==='none'?'on':'',onClick:function(){setCalls('none');}},'Никто')),h('p',{className:'note'},calls==='none'?'Входящие звонки отключены полностью.':(calls==='contacts'?'Дозвонятся только те, кого вы сохранили в контактах.':'Позвонить может любой пользователь, которого вы не заблокировали.')),h('p',{className:'note dim'},'Разговор идёт напрямую между устройствами и шифруется (DTLS-SRTP). Сервер передаёт только служебные данные соединения.'),h('div',{className:'f-label'},'Кто видит мой номер телефона'),h('div',{className:'tabs'},h('button',{className:phone==='all'?'on':'',onClick:function(){setPhone('all');}},'Все'),h('button',{className:phone==='contacts'?'on':'',onClick:function(){setPhone('contacts');}},'Контакты'),h('button',{className:phone==='none'?'on':'',onClick:function(){setPhone('none');}},'Никто')),h('p',{className:'note'},phone==='none'?'Номер скрыт ото всех.':(phone==='contacts'?'Номер видят только люди из ваших контактов.':'Номер виден в профиле всем пользователям.')),h('div',{className:'f-label'},'Защита входа'),h('button',{className:'row nav-row',onClick:function(){p.onPin&&p.onPin();}},h('span',{className:'i'},h(I,{name:'lock2',size:18})),h('span',{className:'t'},h('b',null,'Пароль на вход'),h('small',null,pinRead()?'Включён':'Выключен')),h(I,{name:'chev',size:18,className:'chev'})),h('button',{className:'btn mt12',disabled:busy,onClick:save},'Сохранить'));}

/* ---------- ПИН-код входа и автоблокировка ---------- */
var LOCK_OPTS=[[60,'1 минута'],[300,'5 минут'],[600,'10 минут'],[1800,'30 минут'],[3600,'1 час'],
 [7200,'2 часа'],[10800,'3 часа'],[14400,'4 часа'],[18000,'5 часов'],[21600,'6 часов'],
 [25200,'7 часов'],[28800,'8 часов'],[32400,'9 часов'],[0,'Никогда']];

function pinRead(){try{return JSON.parse(localStorage.getItem('lux_pin')||'null');}catch(e){return null;}}
function pinWrite(v){try{v?localStorage.setItem('lux_pin',JSON.stringify(v)):localStorage.removeItem('lux_pin');}catch(e){}}
function pinHash(code){
 /* Простой необратимый хэш: сам ПИН на устройстве не хранится. */
 var s=String(code)+'|luxon-pin';var a=5381;
 for(var i=0;i<s.length;i++){a=((a<<5)+a+s.charCodeAt(i))>>>0;}
 var b_=52711;for(var j=s.length-1;j>=0;j--){b_=((b_<<5)+b_+s.charCodeAt(j))>>>0;}
 return a.toString(36)+'.'+b_.toString(36);}

function PinPad(p){
 var [code,setCode]=useState('');
 var [shake,setShake]=useState(false);
 function push(d){
  if(code.length>=4)return;
  var next=code+d;setCode(next);vibrate(8);
  if(next.length===4)setTimeout(function(){
   if(p.onFull(next)===false){setShake(true);vibrate([30,60,30]);
    setTimeout(function(){setShake(false);setCode('');},420);}
   else setCode('');},120);}
 function del(){setCode(code.slice(0,-1));vibrate(6);}
 return h('div',{className:'pinpad'+(shake?' shake':'')},
  h('b',null,p.title),
  p.sub?h('small',null,p.sub):null,
  h('div',{className:'pin-dots'},[0,1,2,3].map(function(i){
   return h('i',{key:i,className:i<code.length?'on':''});})),
  h('div',{className:'pin-keys'},
   ['1','2','3','4','5','6','7','8','9'].map(function(d){
    return h('button',{key:d,onClick:function(){push(d);}},d);})
   .concat([
    p.onCancel?h('button',{key:'c',className:'sm',onClick:p.onCancel},'Отмена'):h('span',{key:'c'}),
    h('button',{key:'0',onClick:function(){push('0');}},'0'),
    h('button',{key:'d',className:'sm',onClick:del},h(I,{name:'back',size:20}))])));}

/* Экран блокировки поверх всего */
function PinGate(p){
 return h('div',{className:'pin-gate'},
  h(PinPad,{title:'Введите пароль',sub:'Кабинет заблокирован',
   onFull:function(c){
    var st=pinRead();
    if(st&&pinHash(c)===st.hash){p.onOk();return true;}
    return false;}}));}

function PinSheet(p){
 var st=pinRead();
 var [stage,setStage]=useState(st?'menu':'set');
 var [first,setFirst]=useState('');
 var [lock,setLock]=useState((st&&st.lock)||300);
 function save(hash,lockSec){pinWrite({hash:hash,lock:lockSec});p.toast('Пароль сохранён','success');}
 if(stage==='set')return h(Sheet,{title:'Пароль на вход',onClose:p.onClose,center:true},
  h(PinPad,{title:first?'Повторите пароль':'Придумайте пароль',
   sub:first?'Ещё раз, чтобы не ошибиться':'Четыре цифры',
   onFull:function(c){
    if(!first){setFirst(c);return true;}
    if(c!==first){p.toast('Пароли не совпали','error');setFirst('');return false;}
    save(pinHash(c),lock);setStage('menu');return true;},
   onCancel:function(){if(first)setFirst('');else p.onClose();}}));
 return h(Sheet,{title:'Пароль на вход',sub:'Кабинет закроется сам',onClose:p.onClose},
  h('div',{className:'row sw'},h('span',{className:'t'},h('b',null,'Пароль включён'),
   h('small',null,'Спросим четыре цифры при открытии')),
   h('button',{className:'sw-b on',onClick:function(){pinWrite(null);p.toast('Пароль отключён','');p.onClose();}},'Отключить')),
  h('div',{className:'f-label'},'Блокировать через'),
  h('div',{className:'lockgrid'},LOCK_OPTS.map(function(o){
   return h('button',{key:o[0],className:lock===o[0]?'on':'',onClick:function(){
    setLock(o[0]);var cur=pinRead();if(cur){cur.lock=o[0];pinWrite(cur);}vibrate(8);}},o[1]);})),
  h('p',{className:'note'},lock?('Если не пользоваться кабинетом '+
   (LOCK_OPTS.filter(function(o){return o[0]===lock;})[0]||['','',''])[1].toLowerCase()+
   ', понадобится пароль.'):'Пароль спросим только при полном перезапуске.'),
  h('button',{className:'btn ghost mt12',onClick:function(){setFirst('');setStage('set');}},
   h(I,{name:'lock2',size:18}),'Сменить пароль'));}

Object.assign(L,{PinSheet:PinSheet,PinGate:PinGate,pinRead:pinRead});

/* ---------- Balance ---------- */
function BalanceSheet(p){var u=p.user;var [tab,setTab]=useState('main');var [amount,setAmount]=useState('');var [busy,setBusy]=useState(false);var [hist,setHist]=useState(null);var amt=Number(amount)||0;
 useEffect(function(){if(tab==='hist'&&hist===null)api('/api/web/balance/history').then(function(r){setHist(r.items||[]);}).catch(function(){setHist([]);});},[tab]);
 function topup(){if(amt<100||amt>500000||busy)return;setBusy(true);api('/api/web/balance/topup',{method:'POST',body:{amount:amt}}).then(function(r){if(r.ok===false&&r.active){p.onPay(r.active.id);return;}if(r.request_id)p.onPay(r.request_id);}).catch(function(e){p.toast(e.message,'error');}).then(function(){setBusy(false);});}
 return h(Sheet,{title:'Баланс LUXON',sub:'Внутренний счёт',onClose:p.onClose},h('div',{className:'bal-card'},h('small',null,'Доступно'),h('b',null,money(u.balance||0),h('span',null,' сом')),h('span',{className:'bal-hint'},'Пополняйте баланс заранее и переводите на любую БК мгновенно, без QR и ожидания')),
  h('div',{className:'tabs'},h('button',{className:tab==='main'?'on':'',onClick:function(){setTab('main');}},'Пополнить'),h('button',{className:tab==='hist'?'on':'',onClick:function(){setTab('hist');}},'История')),
  tab==='main'?h(React.Fragment,null,h('div',{className:'f-label'},'Сумма'),h('div',{className:'field'},h(I,{name:'wallet',size:18}),h('input',{inputMode:'numeric',placeholder:'от 100',value:amount,onChange:function(e){setAmount(e.target.value.replace(/\D/g,''));}}),h('span',{className:'suffix'},'сом')),h('div',{className:'presets'},[500,1000,3000,5000,10000].map(function(v){return h('button',{key:v,className:amt===v?'on':'',onClick:function(){setAmount(String(v));}},money(v));})),h('p',{className:'note'},'От 100 до 500 000 сом. Оплата по QR или через банк — как обычное пополнение.'),h('button',{className:'btn mt8',disabled:amt<100||amt>500000||busy,onClick:topup},busy?h('span',{className:'spin w'}):h(I,{name:'qr',size:18}),'Пополнить баланс')):
  (hist===null?h('div',{className:'center'},h('span',{className:'spin'})):(!hist.length?h('div',{className:'empty-line'},h(I,{name:'history',size:18}),'Движений пока нет'):h('div',{className:'tx-list'},hist.map(function(x){return h('div',{key:x.id,className:'tx'},h('span',{className:'ic '+(x.delta>=0?'deposit':'withdraw')},h(I,{name:x.delta>=0?'arrowDown':'arrowUp',size:18,w:2.4})),h('span',{className:'t'},h('b',null,x.note||x.kind),h('small',null,fmtDate(x.created_at))),h('span',{className:'r'},h('b',{style:{color:x.delta>=0?'var(--green)':'var(--red)'}},(x.delta>=0?'+':'−')+money(Math.abs(x.delta)))));})))));}

/* Внутренний браузер (15.1): ссылка из чата открывается поверх приложения.
   Часть сайтов запрещает встраивание — тогда остаётся кнопка «В браузере». */
function InAppBrowser(p){var [loaded,setLoaded]=useState(false);var host='';try{host=new URL(p.url).host;}catch(e){host=p.url.slice(0,40);}
 useEffect(function(){var prev=document.body.style.overflow;document.body.style.overflow='hidden';var t=setTimeout(function(){setLoaded(function(v){return v;});},4000);return function(){document.body.style.overflow=prev;clearTimeout(t);};},[]);
 return h('div',{className:'iab'},
  h('div',{className:'iab-top'},
   h('button',{className:'iab-x',onClick:p.onClose},h(I,{name:'close',size:20})),
   h('div',{className:'iab-t'},h('b',null,host),h('small',null,loaded?'загружено':'загружаем…')),
   h('a',{className:'iab-ext',href:p.url,target:'_blank',rel:'noopener noreferrer',onClick:function(){setTimeout(p.onClose,150);}},h(I,{name:'ext',size:16}),'В браузере')),
  h('div',{className:'iab-body'},
   h('iframe',{src:p.url,sandbox:'allow-scripts allow-same-origin allow-forms allow-popups',referrerPolicy:'no-referrer',onLoad:function(){setLoaded(true);}}),
   loaded?null:h('div',{className:'iab-hint'},h('span',{className:'spin'}),h('p',null,'Если страница не открылась — сайт запрещает встраивание. Нажмите «В браузере».'))));}

Object.assign(L,{InAppBrowser:InAppBrowser,LuxFather:LuxFather,NewsPage:NewsPage,BotChat:BotChat,PhotoViewer:PhotoViewer,ChatsList:ChatsList,ContactsPage:ContactsPage,NotifPage:NotifPage,NotifSheet:NotifSheet,DevicesPage:DevicesPage,QrScanSheet:QrScanSheet,LinkApprove:LinkApprove,QrLogin:QrLogin,PrivacySheet:PrivacySheet,BalanceSheet:BalanceSheet});
L.P.phone2='M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2';L.P.link='M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1';
})();
