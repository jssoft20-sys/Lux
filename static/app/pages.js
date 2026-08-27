(function(){
'use strict';
var L=window.__LUX,h=L.h,I=L.I,money=L.money,fmtDate=L.fmtDate,fmtTime=L.fmtTime,api=L.api,STATUS=L.STATUS,initial=L.initial,copyText=L.copyText,vibrate=L.vibrate,ding=L.ding,Logo=L.Logo,Sheet=L.Sheet;
var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef,useMemo=React.useMemo;
L.P.edit2='M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z';L.P.lock2='M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z';L.P.wallet2='M2 7h17a3 3 0 0 1 3 3v9H2zM2 7V5a2 2 0 0 1 2-2h12v4M17 14h.01';L.P.qr2='M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 18h1M18 14h3';L.P.tv='M3 6h18v12H3zM8 21h8M12 18v3';L.P.star='m12 3 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 21l1.2-6.5L2.5 9.9l6.6-.9Z';L.P.x='M18 6 6 18M6 6l12 12';L.P.at='M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm4-4v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1';L.P.moon='M21 13A8.5 8.5 0 0 1 11 3a8.5 8.5 0 1 0 10 10Z';L.P.sun='M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4';L.P.doc='M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6';L.P.pin='M12 17v5M8 3h8l-1 7 3 3H6l3-3z';L.P.play='M6 4l14 8-14 8V4Z';L.P.pause='M7 5h3v14H7zM14 5h3v14h-3z';L.P.mic='M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8';L.P.reply='M9 14 4 9l5-5M4 9h9a7 7 0 0 1 7 7v4';L.P.trash='M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13';L.P.live='M12 12h.01M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7';L.P.gift='M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7c-2-3-6-3-6 0s4 0 6 0Zm0 0c2-3 6-3 6 0s-4 0-6 0Z';L.P.users='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8';L.P.trophy='M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5';L.P.more='M12 6h.01M12 12h.01M12 18h.01';L.P.msg='M4 4h16v12H5.5L4 17.5V4ZM8 9h8M8 12h5';L.P.quote='M7 7h4v5a4 4 0 0 1-4 4V7Zm8 0h4v5a4 4 0 0 1-4 4V7Z';L.P.link='M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1';L.P.cloud='M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.3 2A3.5 3.5 0 0 1 17.5 18H7Z';L.P.folder='M3 6h6l2 2h10v11H3V6Z';L.P.folderPlus='M3 6h6l2 2h10v11H3V6ZM12 12v5M9.5 14.5h5';L.P.contacts='M4 4h16v16H4zM9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 18a3.5 3.5 0 0 1 6 0M14.5 9h4M14.5 13h4';L.P.search2='M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-3.5-3.5';

/* ---------- Bank brand ---------- */
var BANKS=[['mbank','#1aa64a','M'],['o!','#e4002b','O!'],['odengi','#e4002b','O!'],['денег','#e4002b','O!'],['megapay','#f47b20','Mg'],['balance','#1e5bf6','B'],['bakai','#0b4f9c','Bk'],['optima','#0f8a3a','Op'],['demir','#e30613','D'],['elcart','#0a5cab','E'],['kicb','#7a1fa2','K'],['aiyl','#2a7a2a','A'],['dos','#e2001a','DC'],['finca','#00558c','F']];
var BANK_LOGOS={mbank:'mbank','o!':'odengi',odengi:'odengi','денег':'odengi',megapay:'megapay',balance:'balance',bakai:'bakai',optima:'optima',demir:'demir',companion:'companion','компаньон':'companion'};function bankStyle(m){var key=String((m.id||'')+' '+(m.name||'')).toLowerCase();var logo='';for(var k in BANK_LOGOS){if(key.indexOf(k)>=0){logo='/static/app/banks/'+BANK_LOGOS[k]+'.png';break;}}for(var i=0;i<BANKS.length;i++){if(key.indexOf(BANKS[i][0])>=0)return {c:BANKS[i][1],l:BANKS[i][2],logo:logo};}return {c:'#334155',l:(m.name||'?').slice(0,2),logo:logo};}
L.bankStyle=bankStyle;

/* ---------- Small components ---------- */
function BkItem(p){var b=p.bk;var on=b.deposit||b.withdraw;var st=b.deposit&&b.withdraw?'пополнение · вывод':(b.deposit?'только пополнение':(b.withdraw?'только вывод':'временно недоступно'));return h('button',{className:'bk-item'+(on?'':' off'),style:{'--c':b.color,animationDelay:(p.i||0)*35+'ms'},onClick:function(){p.onOpen(b);}},h(Logo,{bk:b}),h('div',{className:'t'},h('b',null,b.label),h('small',null,h('i',{className:'dot'+(on?' on':'')}),st)),h(I,{name:'chev',size:18,className:'chev'}));}
function TxRow(p){var t=p.tx,dep=t.kind==='deposit';return h('button',{className:'tx',style:{animationDelay:(p.i||0)*30+'ms'},onClick:function(){p.onOpen(t);}},h('span',{className:'ic '+t.kind},h(I,{name:dep?'arrowDown':'arrowUp',size:18,w:2.4})),h('span',{className:'t'},h('b',null,t.bookmaker==='luxon'?'Пополнение баланса':(t.bookmaker||'').toUpperCase()),h('small',null,fmtDate(t.created_at)+(t.bookmaker==='luxon'?'':' · ID '+t.player_id))),h('span',{className:'r'},h('b',null,(dep?'+':'−')+money(t.pay_amount||t.amount)),h('span',{className:'chip '+t.status},h('i'),STATUS[t.status]||t.status)));}
function IdField(p){var [edit,setEdit]=useState(!p.locked);useEffect(function(){setEdit(!p.locked);},[p.locked]);return h('div',{className:'field'+(p.ok?' ok':'')+(!edit?' locked':'')},h(I,{name:'user',size:18}),h('input',{inputMode:'numeric',placeholder:'Игровой ID',value:p.value,readOnly:!edit,onChange:function(e){p.onChange(e.target.value.replace(/\D/g,''));}}),!edit?h('button',{className:'edit-ic',onClick:function(){setEdit(true);},'aria-label':'Изменить'},h(I,{name:'edit2',size:16})):null);}
function CheckLine(p){var c=p.check;if(!c)return null;var soft=c.code==='FORMAT_ONLY';return h('div',{className:'check-line '+(c.wait?'wait':(c.ok?(soft?'soft':'ok'):'err'))},c.wait?h('span',{className:'spin'}):h(I,{name:c.ok?(soft?'info':'check'):'alert',size:15}),c.wait?'Проверяем ID у букмекера…':(c.ok?(soft?'ID принят — букмекер не отдаёт проверку счёта':('Счёт найден'+(c.name?': '+c.name:''))):(c.message||'ID не найден у букмекера')));}
function usePlayerCheck(bk,pid){var [check,setCheck]=useState(null);var t=useRef(0);useEffect(function(){if(!bk||pid.replace(/\D/g,'').length<4){setCheck(null);return;}var my=++t.current;setCheck({wait:true});var tm=setTimeout(function(){api('/api/web/player/check',{method:'POST',body:{bookmaker:bk.key,player_id:pid}}).then(function(r){if(my===t.current)setCheck(r);}).catch(function(){if(my===t.current)setCheck({ok:false,code:'PLAYER_CHECK_ERROR',message:'Не удалось проверить ID — повторите'});});},450);return function(){clearTimeout(tm);};},[bk&&bk.key,pid]);return check;}
/* Шаг с ID пройден, только если букмекер подтвердил счёт (или проверка для БК не предусмотрена). */
function idPassed(check){return !!(check&&!check.wait&&check.ok);}
function idFailed(check){return !!(check&&!check.wait&&check.ok===false);}
function StepBar(p){return h('div',{className:'steps'},p.items.map(function(t,i){return h('div',{key:i,className:'step'+(i<p.i?' done':(i===p.i?' on':''))},h('span',{className:'sn'},i<p.i?h(I,{name:'check',size:12,w:3}):(i+1)),h('small',null,t));}));}

/* ---------- Deposit ---------- */
function DepositSheet(p){var [bk,setBk]=useState(p.bk&&p.bk.deposit?p.bk:null);var [pid,setPid]=useState('');var [locked,setLocked]=useState(false);var [amount,setAmount]=useState('');var [busy,setBusy]=useState(false);var [err,setErr]=useState('');var [pay,setPay]=useState('bank');var [done,setDone]=useState(null);var [step,setStep]=useState(0);var check=usePlayerCheck(bk,pid);var balance=Number(p.balance||0);
 useEffect(function(){if(!bk)return;api('/api/web/prefs?bookmaker='+bk.key).then(function(r){if(r.active_deposit){p.onActive(r.active_deposit);return;}if(r.deposit_id&&!pid){setPid(r.deposit_id);setLocked(true);}}).catch(function(){});},[bk&&bk.key]);
 var min=bk?bk.deposit_min:100,max=bk?bk.deposit_max:100000;var amt=Number(amount)||0;
 var amtOk=amt>=min&&amt<=max;var idOk=idPassed(check);
 function create(){if(!idOk||!amtOk||busy)return;setBusy(true);setErr('');if(pay==='balance'){if(amt>balance){setErr('На балансе '+money(balance)+' сом — не хватает');setBusy(false);return;}api('/api/web/deposit/balance',{method:'POST',body:{bookmaker:bk.key,player_id:pid,amount:amt}}).then(function(r){vibrate([40,60,40]);ding('ok');setDone(r);p.onBalance&&p.onBalance(r);}).catch(function(e){setErr(e.message);vibrate([60,40,60]);}).then(function(){setBusy(false);});return;}api('/api/web/deposit',{method:'POST',body:{bookmaker:bk.key,player_id:pid,amount:amt}}).then(function(r){vibrate(30);p.onCreated(r);}).catch(function(e){if(e.data&&e.data.active_tx){p.onActive(e.data.active_tx);return;}setErr(e.message);vibrate([60,40,60]);}).then(function(){setBusy(false);});}
 if(done)return h(Sheet,{title:'Пополнение',onClose:p.onClose,center:true},h('div',{className:'result'},h('div',{className:'ok'},h('svg',{width:44,height:44,viewBox:'0 0 24 24',fill:'none',stroke:'#22a35a',strokeWidth:3,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'m5 12 4 4L19 6'}))),h('h3',null,'Зачислено'),h('p',null,'+'+money(amt)+' сом на ID '+pid+' · '+bk.label+'. Списано с баланса LUXON.'),h('button',{className:'btn',onClick:p.onClose},'Готово')));
 function back(){if(step>0){setStep(step-1);return;}if(bk&&!p.bk){setBk(null);return;}}
 var canBack=step>0||(bk&&!p.bk);
 return h(Sheet,{title:'Пополнение',sub:bk?bk.label:'Выберите БК',onClose:p.onClose,onBack:canBack?back:null},
  !bk?h('div',{className:'bk-grid'},p.bks.map(function(b){return h('button',{key:b.key,disabled:!b.deposit,onClick:function(){setBk(b);setStep(0);}},h(Logo,{bk:b,sm:true}),h('span',null,h('b',null,b.label),h('small',null,b.deposit?'доступно':'недоступно')));})):
  h('div',null,h('div',{className:'bk-pick'},h(Logo,{bk:bk,sm:true}),h('span',null,h('b',null,bk.label),h('small',null,money(min)+'–'+money(max)+' сом')),!p.bk?h('button',{className:'chg',onClick:function(){setBk(null);setStep(0);}},'Сменить'):null),
   h(StepBar,{i:step,items:['Игровой ID','Сумма','Подтверждение']}),
   /* --- шаг 1: ID. Дальше не пускаем, пока букмекер не подтвердил счёт --- */
   step===0?h('div',null,
     h('div',{className:'f-label'},'Игровой ID'),
     h(IdField,{value:pid,locked:locked,ok:idOk,onChange:function(v){setPid(v);setLocked(false);}}),
     h(CheckLine,{check:check}),
     idFailed(check)?h('div',{className:'attn'},h('b',null,'Счёт не найден. '),'Проверьте номер ID в приложении '+bk.label+' и введите заново — заявка не создастся с чужим или несуществующим ID.'):null,
     h('button',{className:'btn mt12',disabled:!idOk,onClick:function(){setStep(1);}},h(I,{name:'chev',size:18}),idOk?'Далее — сумма':(check&&check.wait?'Проверяем ID…':'Введите игровой ID'))
   ):null,
   /* --- шаг 2: сумма и способ --- */
   step===1?h('div',null,
     h('div',{className:'idok'},h(I,{name:'check',size:14,w:3}),'ID ',h('b',null,pid),check&&check.name?h('small',null,check.name):null),
     h('div',{className:'f-label'},'Способ оплаты'),h('div',{className:'paysel'},h('button',{className:pay==='bank'?'on':'',onClick:function(){setPay('bank');}},h(I,{name:'qr2',size:17}),h('span',null,h('b',null,'Банк'),h('small',null,'QR · приложения'))),h('button',{className:pay==='balance'?'on':'',disabled:balance<=0,onClick:function(){setPay('balance');}},h(I,{name:'wallet2',size:17}),h('span',null,h('b',null,'Баланс LUXON'),h('small',null,money(balance)+' сом')))),
     h('div',{className:'f-label'},'Сумма'),h('div',{className:'field'},h(I,{name:'wallet2',size:18}),h('input',{inputMode:'numeric',placeholder:String(min),value:amount,onChange:function(e){setAmount(e.target.value.replace(/\D/g,''));}}),h('span',{className:'suffix'},'сом')),
     h('div',{className:'presets'},[100,200,500,1000,2000,5000].filter(function(v){return v>=min&&v<=max;}).map(function(v){return h('button',{key:v,className:amt===v?'on':'',onClick:function(){setAmount(String(v));}},money(v));})),
     amount&&!amtOk?h('div',{className:'attn'},'Сумма от '+money(min)+' до '+money(max)+' сом'):null,
     h('button',{className:'btn mt12',disabled:!amtOk,onClick:function(){setStep(2);}},h(I,{name:'chev',size:18}),'Далее — проверить')
   ):null,
   /* --- шаг 3: подтверждение --- */
   step===2?h('div',null,
     h('div',{className:'confirm'},
       h('div',{className:'camt'},'+'+money(amt),h('span',null,'сом')),
       h('div',{className:'crows'},
        h('div',{className:'drow'},h('span',null,'Букмекер'),h('b',null,bk.label)),
        h('div',{className:'drow'},h('span',null,'Игровой ID'),h('b',null,pid,h(I,{name:'check',size:13}))),
        check&&check.name?h('div',{className:'drow'},h('span',null,'Счёт'),h('b',null,check.name)):null,
        h('div',{className:'drow'},h('span',null,'Способ'),h('b',null,pay==='balance'?'Баланс LUXON':'Банк · QR')))),
     err?h('div',{className:'attn'},err):null,
     h('button',{className:'btn mt12',disabled:busy,onClick:create},busy?h('span',{className:'spin w'}):h(I,{name:pay==='balance'?'wallet2':'qr2',size:19}),busy?'Секунду…':(pay==='balance'?'Пополнить с баланса':'К оплате'))
   ):null));}

/* ---------- Pay page ---------- */
function PayPage(p){var pid=p.pid;var [ask,setAsk]=useState(false);var [tx,setTx]=useState(p.tx||null);var [err,setErr]=useState('');var [left,setLeft]=useState(0);var [copied,setCopied]=useState(false);var [busy,setBusy]=useState(false);var [newId,setNewId]=useState('');var [receipt,setReceipt]=useState(false);
 function load(){api('/api/web/tx/'+encodeURIComponent(pid)).then(function(r){setTx(function(prev){if(prev&&prev.status==='pending'&&r.tx.status!=='pending'){if(r.tx.status==='success'){ding('ok');vibrate([40,60,40]);}else ding('bad');}return r.tx;});}).catch(function(e){setErr(e.message);});}
 useEffect(function(){load();},[pid]);
 useEffect(function(){if(!tx||tx.status!=='pending')return;var iv=setInterval(load,3000);return function(){clearInterval(iv);};},[tx&&tx.status]);
 useEffect(function(){if(!tx||!tx.expires_at)return;function tick(){setLeft(Math.max(0,Math.round((new Date(tx.expires_at)-Date.now())/1000)));}tick();var t=setInterval(tick,1000);return function(){clearInterval(t);};},[tx&&tx.expires_at]);
 function cancel(){if(busy)return;setAsk(true);}
 function doCancel(){setBusy(true);return api('/api/web/tx/'+encodeURIComponent(pid)+'/cancel',{method:'POST',body:{}}).then(load).catch(function(e){p.toast(e.message,'error');throw e;}).then(function(){setBusy(false);setAsk(false);},function(){setBusy(false);});}
 function retry(){if(busy||newId.length<4)return;setBusy(true);api('/api/web/tx/'+encodeURIComponent(pid)+'/retry',{method:'POST',body:{player_id:newId},timeout:60000}).then(function(r){setTx(r.tx);if(r.ok){ding('ok');p.toast('Зачислено!','success');}else p.toast(r.message,'error');}).catch(function(e){p.toast(e.message,'error');}).then(function(){setBusy(false);});}
 var head=h('div',{className:'ptop'},h('button',{className:'pback',onClick:p.onBack},h(I,{name:'back',size:22})),h('div',{className:'ptt'},h('b',null,tx&&tx.bookmaker==='luxon'?'Пополнение баланса':'Оплата'),tx?h('small',null,tx.bookmaker==='luxon'?'№ '+tx.request_no:(tx.bookmaker||'').toUpperCase()+' · ID '+tx.player_id):null),h('span',{style:{width:40}}));
 if(!tx)return h('div',{className:'ppage'},head,err?h('div',{className:'attn',style:{margin:16}},err):h('div',{className:'center'},h('span',{className:'spin'})));
 var st=tx.status;var mm=String(Math.floor(left/60)).padStart(2,'0'),ss=String(left%60).padStart(2,'0');var methods=(tx.payment_methods||[]).filter(function(m){return m&&m.url&&m.id!=='qr';});
 if(st==='success')return h('div',{className:'ppage'},head,h('div',{className:'pres ok'},h('div',{className:'okring'},h('svg',{width:52,height:52,viewBox:'0 0 24 24',fill:'none',stroke:'#fff',strokeWidth:3,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'m5 12 4 4L19 6'}))),h('h2',null,'Зачислено'),h('p',null,tx.bookmaker==='luxon'?'+'+money(tx.pay_amount)+' сом на баланс LUXON':'+'+money(tx.pay_amount)+' сом на ID '+tx.player_id+' · '+(tx.bookmaker||'').toUpperCase()),receipt?h('img',{className:'receipt',src:'/api/web/tx/'+encodeURIComponent(pid)+'/receipt.png',alt:'Чек'}):h('button',{className:'btn ghost',onClick:function(){setReceipt(true);}},h(I,{name:'doc',size:18}),'Показать чек'),h('button',{className:'btn mt8',onClick:p.onBack},'Готово')));
 if(st!=='pending'){var isP=st==='problem';return h('div',{className:'ppage'},head,h('div',{className:'pres '+(isP?'warn':'bad')},h('div',{className:'badring'},h(I,{name:st==='expired'?'clock':(isP?'alert':'x'),size:44})),h('h2',null,st==='expired'?'Время вышло':(isP?'Нужна проверка':'Отменено')),h('p',null,st==='expired'?'Платёж не поступил за 5 минут. Если вы перевели деньги — напишите в поддержку, оператор найдёт платёж.':(isP?(tx.error||'Оплата пришла, но букмекер не зачислил.'):(tx.error||'Заявка отменена.'))),isP&&tx.bookmaker!=='luxon'?h('div',{className:'retrybox'},h('b',null,'Деньги получены — проверьте игровой ID'),h('small',null,'Ошиблись в ID? Исправьте, зачислим автоматически'),h('div',{className:'field'},h(I,{name:'user',size:18}),h('input',{inputMode:'numeric',placeholder:tx.player_id,value:newId,onChange:function(e){setNewId(e.target.value.replace(/\D/g,''));}})),h('button',{className:'btn',disabled:busy||newId.length<4,onClick:retry},busy?h('span',{className:'spin w'}):h(I,{name:'refresh',size:18}),'Зачислить на этот ID')):null,h('button',{className:'btn soft mt8',onClick:function(){p.onSupport('Пополнение #'+tx.request_no+' ('+pid+'): '+(st==='expired'?'оплатил, но истекло':'вопрос'));}},h(I,{name:'headset',size:18}),'Написать в поддержку'),h('button',{className:'btn ghost mt8',onClick:p.onBack},'На главную')));}
 var pct=tx.expires_at?Math.max(0,Math.min(1,left/300)):1;
 return h('div',{className:'ppage'},head,h('div',{className:'pbody'},
  h('div',{className:'pamount'},h('span',{className:'v'},money(tx.pay_amount)),h('span',{className:'u'},'сом')),
  h('div',{className:'pwarn'},h(I,{name:'alert',size:15}),'Переведите ровно эту сумму — до тыйына'),
  h('div',{className:'ptimer'+(left<60?' low':'')},h('svg',{viewBox:'0 0 36 36'},h('circle',{cx:18,cy:18,r:16,className:'bgc'}),h('circle',{cx:18,cy:18,r:16,className:'fgc',style:{strokeDasharray:100.5,strokeDashoffset:100.5*(1-pct)}})),h('b',null,mm+':'+ss)),
  tx.qr_url?h('div',{className:'qr-box'},h('img',{src:tx.qr_url,alt:'QR'})):null,
  h('div',{className:'copy-row'},h('div',null,h('small',null,'Сумма к оплате'),h('b',null,money(tx.pay_amount)+' сом')),h('button',{onClick:function(){copyText(String(tx.pay_amount),'Сумма скопирована');setCopied(true);setTimeout(function(){setCopied(false);},1400);}},h(I,{name:copied?'check':'copy',size:17}))),
  methods.length?h('div',{className:'f-label'},'Оплатить через банк'):null,
  methods.length?h('div',{className:'banks'},methods.map(function(m){var st_=bankStyle(m);return h('a',{key:m.id||m.name,href:m.url,target:'_blank',rel:'noopener',style:{'--bc':st_.c}},h('span',{className:'bl'+(st_.logo?' img':'')},st_.logo?h('img',{src:st_.logo,alt:''}):st_.l),h('b',null,m.name||m.id),h(I,{name:'ext',size:14}));})):null,
  h('div',{className:'pwait'},h('span',{className:'spin'}),'Ждём поступление — зачислим автоматически'),
  h('button',{className:'btn ghost',onClick:function(){p.onSupport('Пополнение #'+tx.request_no+' ('+pid+'): оплатил, не зачислилось');}},h(I,{name:'headset',size:18}),'Проблема с оплатой'),
  h('button',{className:'btn danger mt8',disabled:busy,onClick:cancel},h(I,{name:'x',size:18}),'Отменить пополнение'),
  ask?h(L.Confirm,{danger:true,title:'Отменить пополнение?',text:'Если деньги уже перевели — не отменяйте, дождитесь зачисления. Отменённую заявку восстановить нельзя.',okLabel:'Отменить заявку',cancelLabel:'Не отменять',onOk:doCancel,onCancel:function(){setAsk(false);}}):null));}

/* ---------- Withdraw ---------- */
function WithdrawSheet(p){var [bk,setBk]=useState(p.bk&&p.bk.withdraw?p.bk:null);var [pid,setPid]=useState('');var [locked,setLocked]=useState(false);var [code,setCode]=useState('');var [file,setFile]=useState(null);var [lastQr,setLastQr]=useState('');var [useLast,setUseLast]=useState(false);var [busy,setBusy]=useState(false);var [err,setErr]=useState('');var [res,setRes]=useState(null);var [step,setStep]=useState(0);var check=usePlayerCheck(bk,pid);
 useEffect(function(){if(!bk)return;api('/api/web/prefs?bookmaker='+bk.key).then(function(r){if(r.withdraw_id&&!pid){setPid(r.withdraw_id);setLocked(true);}if(r.last_qr_url){setLastQr(r.last_qr_url);setUseLast(true);}}).catch(function(){});},[bk&&bk.key]);
 var preview=useMemo(function(){return file?URL.createObjectURL(file):'';},[file]);
 var idOk=idPassed(check);var qrOk=!!(file||(useLast&&lastQr));var codeOk=code.trim().length>=3;
 function submit(){if(!idOk||!qrOk||!codeOk||busy)return;setBusy(true);setErr('');var fd=new FormData();fd.append('bookmaker',bk.key);fd.append('player_id',pid);fd.append('code',code.trim());if(file)fd.append('file',file);else fd.append('qr_url',lastQr);api('/api/web/withdraw',{method:'POST',body:fd,timeout:60000}).then(function(r){vibrate(30);ding('ok');setRes(r);p.onCreated&&p.onCreated(r);}).catch(function(e){setErr(e.message);vibrate([60,40,60]);}).then(function(){setBusy(false);});}
 function pick(e){var f=e.target.files&&e.target.files[0];if(!f)return;if(!/^image\//.test(f.type||'')){setErr('Только фото (JPG, PNG, WEBP)');return;}if(f.size>12*1024*1024){setErr('Фото больше 12 МБ');return;}setErr('');setFile(f);setUseLast(false);}
 if(res)return h(Sheet,{title:'Вывод',onClose:p.onClose,center:true},h('div',{className:'result'},h('div',{className:'ok'},h('svg',{width:44,height:44,viewBox:'0 0 24 24',fill:'none',stroke:'#22a35a',strokeWidth:3,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'m5 12 4 4L19 6'}))),h('h3',null,'Заявка принята'),h('p',null,(res.amount?'Сумма '+money(res.amount)+' сом. ':'')+'Оператор переведёт деньги на ваш QR. Статус — в Истории.'),h('button',{className:'btn',onClick:p.onClose},'Понятно')));
 function back(){if(step>0){setStep(step-1);return;}if(bk&&!p.bk)setBk(null);}
 var canBack=step>0||(bk&&!p.bk);
 return h(Sheet,{title:'Вывод',sub:bk?bk.label:'Выберите БК',onClose:p.onClose,onBack:canBack?back:null},
  !bk?h('div',{className:'bk-grid'},p.bks.map(function(b){return h('button',{key:b.key,disabled:!b.withdraw,onClick:function(){setBk(b);setStep(0);}},h(Logo,{bk:b,sm:true}),h('span',null,h('b',null,b.label),h('small',null,b.withdraw?'доступно':'недоступно')));})):
  h('div',null,h('div',{className:'bk-pick'},h(Logo,{bk:bk,sm:true}),h('span',null,h('b',null,bk.label),h('small',null,money(bk.withdraw_min)+'–'+money(bk.withdraw_max)+' сом')),!p.bk?h('button',{className:'chg',onClick:function(){setBk(null);setStep(0);}},'Сменить'):null),
   h(StepBar,{i:step,items:['Игровой ID','Код и QR','Подтверждение']}),
   step===0?h('div',null,
     h('button',{className:'hint-btn',onClick:function(){p.onHow&&p.onHow();}},h(I,{name:'info',size:15}),'Как получить код вывода'),
     h('div',{className:'f-label'},'Игровой ID'),
     h(IdField,{value:pid,locked:locked,ok:idOk,onChange:function(v){setPid(v);setLocked(false);}}),
     h(CheckLine,{check:check}),
     idFailed(check)?h('div',{className:'attn'},h('b',null,'Счёт не найден. '),'Проверьте ID в приложении '+bk.label+'. Код вывода и QR вводить смысла нет, пока счёт не найден.'):null,
     h('button',{className:'btn mt12',disabled:!idOk,onClick:function(){setStep(1);}},h(I,{name:'chev',size:18}),idOk?'Далее — код и QR':(check&&check.wait?'Проверяем ID…':'Введите игровой ID'))
   ):null,
   step===1?h('div',null,
     h('div',{className:'idok'},h(I,{name:'check',size:14,w:3}),'ID ',h('b',null,pid),check&&check.name?h('small',null,check.name):null),
     h('div',{className:'f-label'},'Код вывода'),h('div',{className:'field'},h(I,{name:'lock2',size:18}),h('input',{placeholder:'Код из приложения БК',value:code,autoCapitalize:'off',autoCorrect:'off',onChange:function(e){setCode(e.target.value.replace(/\s/g,''));}})),
     h('div',{className:'f-label'},'QR банка для получения'),
     lastQr&&!file?h('div',{className:'lastqr'+(useLast?' on':''),onClick:function(){setUseLast(!useLast);}},h('img',{src:lastQr,alt:''}),h('div',null,h('b',null,'Прошлый QR'),h('small',null,useLast?'Будет использован':'Нажмите, чтобы использовать')),h('span',{className:'tick'+(useLast?'':' off')},h(I,{name:'check',size:14,w:3}))):null,
     h('div',{className:'upload'+(file?' has':'')},file?h('img',{src:preview,alt:'QR'}):(useLast&&lastQr?null:h('div',{className:'uhint'},h(I,{name:'qr2',size:26}),h('span',null,'Скриншот «Мой QR» из банка'))),h('div',{className:'two'},h('label',null,h(I,{name:'camera',size:17}),'Камера',h('input',{type:'file',accept:'image/*',capture:'environment',hidden:true,onChange:pick})),h('label',null,h(I,{name:'image',size:17}),file?'Другое':'Галерея',h('input',{type:'file',accept:'image/*',hidden:true,onChange:pick})))),
     err?h('div',{className:'attn'},err):null,
     h('button',{className:'btn mt12',disabled:!codeOk||!qrOk,onClick:function(){setErr('');setStep(2);}},h(I,{name:'chev',size:18}),!codeOk?'Введите код вывода':(!qrOk?'Приложите QR банка':'Далее — проверить'))
   ):null,
   step===2?h('div',null,
     h('div',{className:'confirm'},h('div',{className:'crows'},
       h('div',{className:'drow'},h('span',null,'Букмекер'),h('b',null,bk.label)),
       h('div',{className:'drow'},h('span',null,'Игровой ID'),h('b',null,pid,h(I,{name:'check',size:13}))),
       check&&check.name?h('div',{className:'drow'},h('span',null,'Счёт'),h('b',null,check.name)):null,
       h('div',{className:'drow'},h('span',null,'Код вывода'),h('b',null,code)),
       h('div',{className:'drow'},h('span',null,'QR'),h('b',null,file?'Новый файл':'Прошлый QR')))),
     h('div',{className:'hint',style:{marginTop:10}},h(I,{name:'info',size:15}),'Сумму подставит букмекер по коду. Оператор переведёт её на ваш QR.'),
     err?h('div',{className:'attn'},err):null,
     h('button',{className:'btn mt12',disabled:busy,onClick:submit},busy?h('span',{className:'spin w'}):h(I,{name:'arrowOutUp',size:19}),busy?'Отправляем…':'Отправить заявку')
   ):null));}

/* ---------- Tx sheet ---------- */
function TxSheet(p){var [tx,setTx]=useState(p.tx);var [receipt,setReceipt]=useState(false);var dep=tx.kind==='deposit';useEffect(function(){if(tx.status!=='pending')return;var iv=setInterval(function(){api('/api/web/tx/'+encodeURIComponent(tx.id)).then(function(r){setTx(r.tx);}).catch(function(){});},3000);return function(){clearInterval(iv);};},[tx.status]);
 if(dep&&(tx.status==='pending'||tx.status==='problem'))return h(Sheet,{title:'Пополнение #'+tx.request_no,sub:STATUS[tx.status],onClose:p.onClose,center:true},h('div',{className:'bigamt'},money(tx.pay_amount),h('span',null,'сом')),h('p',{className:'muted',style:{margin:'6px 0 14px'}},tx.status==='pending'?'Заявка ждёт оплаты.':(tx.error||'Нужна проверка.')),h('button',{className:'btn',onClick:function(){p.onPay(tx.id);}},h(I,{name:tx.status==='pending'?'qr2':'refresh',size:18}),tx.status==='pending'?'Открыть оплату':'Исправить и зачислить'));
 var isBal=tx.bookmaker==='luxon';var rows=isBal?[['Операция','Пополнение баланса'],['Номер заявки',tx.request_no,1],['Сумма',money(tx.pay_amount||tx.amount)+' сом'],['Создана',fmtDate(tx.created_at)]]:[['Букмекер',(tx.bookmaker||'').toUpperCase()],['Игровой ID',tx.player_id,1],['Номер заявки',tx.request_no,1],['Сумма',money(tx.pay_amount||tx.amount)+' сом'],['Создана',fmtDate(tx.created_at)]];if(tx.closed_at)rows.push(['Закрыта',fmtDate(tx.closed_at)]);
 return h(Sheet,{title:(dep?'Пополнение':'Вывод')+' #'+tx.request_no,sub:STATUS[tx.status]||tx.status,onClose:p.onClose,center:true},
  h('span',{className:'bigic '+tx.kind},h(I,{name:dep?'arrowDown':'arrowUp',size:26,w:2.4})),
  h('div',{className:'bigamt'},(dep?'+':'−')+money(tx.pay_amount||tx.amount),h('span',null,'сом')),
  h('span',{className:'chip '+tx.status,style:{marginTop:6}},h('i'),STATUS[tx.status]||tx.status),
  tx.status==='problem'?h('div',{className:'attn'},h('b',null,'Проверяет оператор. '),tx.error||''):null,tx.status==='rejected'&&tx.error?h('div',{className:'attn'},tx.error):null,
  h('div',{className:'detail-rows'},rows.map(function(r){return h('div',{className:'drow'+(r[2]?' copyable':''),key:r[0],onClick:function(){if(r[2])L.copyText(String(r[1]),r[0]+' скопирован');}},h('span',null,r[0]),h('b',null,String(r[1]),r[2]?h(I,{name:'copy',size:13}):null));})),
  tx.status==='success'?(receipt?h('img',{className:'receipt',src:'/api/web/tx/'+encodeURIComponent(tx.id)+'/receipt.png',alt:'Чек'}):h('button',{className:'btn ghost',onClick:function(){setReceipt(true);}},h(I,{name:'doc',size:18}),'Показать чек')):null,
  tx.receipt_url?h('a',{className:'btn ghost mt8',href:tx.receipt_url,target:'_blank',rel:'noopener'},h(I,{name:'image',size:17}),'Чек оператора'):null,
  h('button',{className:'btn soft mt8',onClick:function(){p.onSupport(txCard(tx,p.user));}},h(I,{name:'headset',size:18}),'Написать в поддержку'));}

/* Готовая карточка заявки для поддержки — оператор сразу видит всё, что нужно,
   и не выпрашивает номер, ID и сумму по одному сообщению. */
function txCard(tx,u){var dep=tx.kind==='deposit';var bal=tx.bookmaker==='luxon';
 var L_=[];
 L_.push((dep?'Пополнение':'Вывод')+' #'+tx.request_no+' — '+(STATUS[tx.status]||tx.status));
 L_.push('Номер операции: '+tx.id);
 L_.push(bal?'Счёт: Баланс LUXON':('Букмекер: '+(tx.bookmaker||'').toUpperCase()));
 if(!bal&&tx.player_id)L_.push('Игровой ID: '+tx.player_id);
 L_.push('Сумма: '+money(tx.pay_amount||tx.amount)+' сом');
 L_.push('Создана: '+fmtDate(tx.created_at));
 if(tx.closed_at)L_.push('Закрыта: '+fmtDate(tx.closed_at));
 if(tx.error)L_.push('Ошибка: '+tx.error);
 if(u&&u.name)L_.push('Клиент: '+u.name+(u.username?' (@'+u.username+')':''));
 L_.push('');
 L_.push('Вопрос: ');
 return L_.join('\n');}

/* ---------- BK sheet ---------- */
function BkSheet(p){var b=p.bk;var on=b.deposit||b.withdraw;return h(Sheet,{title:b.label,sub:on?'Касса подключена':'Временно недоступно',onClose:p.onClose},h('div',{className:'bkhead'},h(Logo,{bk:b}),h('div',null,h('b',null,b.label),h('small',null,'Для пополнения и вывода '+b.label+'. Проверяйте игровой ID перед подтверждением.'))),h('div',{className:'limits'},h('span',{className:'chip'},h(I,{name:'arrowDown',size:12}),money(b.deposit_min)+'–'+money(b.deposit_max)),h('span',{className:'chip'},h(I,{name:'arrowUp',size:12}),money(b.withdraw_min)+'–'+money(b.withdraw_max))),h('div',{className:'two-btn'},h('button',{className:'btn',disabled:!b.deposit,onClick:function(){p.onDeposit(b);}},h(I,{name:'arrowInDown',size:18}),'Пополнить'),h('button',{className:'btn ghost',disabled:!b.withdraw,onClick:function(){p.onWithdraw(b);}},h(I,{name:'arrowOutUp',size:18}),'Вывести')),h('button',{className:'btn soft mt8',onClick:function(){p.onHow(b);}},h(I,{name:'info',size:18}),'Как вывести — инструкция'));}

/* ---------- Story ---------- */
function Story(p){var slides=p.slides;var [i,setI]=useState(0);var [prog,setProg]=useState(0);var [paused,setPaused]=useState(false);var [closing,setClosing]=useState(false);var raf=useRef(0),t0=useRef(0),acc=useRef(0),hold=useRef(0),startY=useRef(0),done=useRef(false);var DUR=6000;
 L.lockBody();
 useEffect(function(){return function(){done.current=true;};},[]);
 function close(){if(closing||done.current)return;setClosing(true);setTimeout(function(){if(done.current)return;done.current=true;p.onClose&&p.onClose();},200);}
 /* Переход в шторку: обработчик сам заменяет сторис в стопке. Раньше здесь
    оставался закрытый, но не размонтированный слой — он ловил все тапы и экран
    переставал реагировать. Теперь если через 400 мс сторис ещё жив, закрываем. */
 function handoff(fn){if(closing||done.current||!fn)return;setClosing(true);setTimeout(function(){fn();setTimeout(function(){if(!done.current){done.current=true;p.onClose&&p.onClose();}},400);},180);}
 function next(){if(i<slides.length-1){setI(i+1);setProg(0);acc.current=0;}else close();}
 function prev(){if(i>0)setI(i-1);setProg(0);acc.current=0;}
 useEffect(function(){cancelAnimationFrame(raf.current);t0.current=performance.now();function tick(now){if(!paused)acc.current+=now-t0.current;t0.current=now;var pr=Math.min(1,acc.current/DUR);setProg(pr);if(pr>=1){next();return;}raf.current=requestAnimationFrame(tick);}raf.current=requestAnimationFrame(tick);return function(){cancelAnimationFrame(raf.current);};},[i,paused]);

 function down(e){hold.current=Date.now();setPaused(true);var t=e.touches?e.touches[0]:e;startY.current=t.clientY;}
 function up(e,z){setPaused(false);var t=e.changedTouches?e.changedTouches[0]:e;if(t&&t.clientY-startY.current>90){close();return;}if(Date.now()-hold.current<260){z==='l'?prev():next();}}
 var sl=slides[i];return h('div',{className:'story'+(closing?' closing':''),style:{'--a':sl.accent,'--b':sl.accent2}},h('div',{className:'story-bg'}),h('div',{className:'story-bars'},slides.map(function(_,k){return h('i',{key:k},h('b',{style:{width:(k<i?100:(k===i?prog*100:0))+'%'}}));})),h('div',{className:'story-top'},h('div',{className:'story-who'},h('span',{className:'m'},h(I,{name:p.icon||'spark',size:18})),h('div',null,h('b',null,p.title),h('small',null,(i+1)+'/'+slides.length))),h('button',{className:'story-x',onClick:close},h(I,{name:'close',size:22}))),h('div',{className:'story-zone l',onTouchStart:down,onTouchEnd:function(e){up(e,'l');},onMouseDown:down,onMouseUp:function(e){up(e,'l');}}),h('div',{className:'story-zone r',onTouchStart:down,onTouchEnd:function(e){up(e,'r');},onMouseDown:down,onMouseUp:function(e){up(e,'r');}}),h('div',{className:'story-card',key:i},h('div',{className:'story-art'},h('div',{className:'ring'},h(I,{name:sl.icon||'info',size:64,w:1.7})),h('span',{className:'n'},i+1)),h('div',{className:'story-k'},'ШАГ '+(i+1)),h('h2',null,sl.title),h('p',null,sl.text)),h('div',{className:'story-foot'},
  i<slides.length-1?h('button',{className:'story-btn',onClick:next},'Далее',h(I,{name:'chev',size:18})):h('button',{className:'story-btn done',onClick:function(){p.onAction?handoff(p.onAction):close();}},p.actionLabel||'Понятно',h(I,{name:'check',size:18})),
  /* Быстрые действия под сторис — не надо досматривать до конца */
  (p.onDeposit||p.onWithdraw)?h('div',{className:'story-acts'},
    p.onDeposit?h('button',{className:p.which==='deposit'?'pri':'',onClick:function(){handoff(p.onDeposit);}},h(I,{name:'arrowInDown',size:17}),'Пополнить'):null,
    p.onWithdraw?h('button',{className:p.which==='withdraw'?'pri':'',onClick:function(){handoff(p.onWithdraw);}},h(I,{name:'arrowOutUp',size:17}),'Вывести'):null):null));}

/* ---------- Verify ---------- */
function VerifySheet(p){var [shot,setShot]=useState(null);var [busy,setBusy]=useState(false);var [err,setErr]=useState('');var [ready,setReady]=useState(false);var vid=useRef(null),stream=useRef(null);
 useEffect(function(){var alive=true;if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:1280}},audio:false}).then(function(s){if(!alive){s.getTracks().forEach(function(t){t.stop();});return;}stream.current=s;if(vid.current){vid.current.srcObject=s;vid.current.play().catch(function(){});}setReady(true);}).catch(function(){setErr('Камера недоступна — загрузите селфи из галереи.');});}else setErr('Камера недоступна — загрузите селфи из галереи.');return function(){alive=false;if(stream.current)stream.current.getTracks().forEach(function(t){t.stop();});};},[]);
 function snap(){var v=vid.current;if(!v)return;var c=document.createElement('canvas');c.width=v.videoWidth||720;c.height=v.videoHeight||960;var ctx=c.getContext('2d');ctx.translate(c.width,0);ctx.scale(-1,1);ctx.drawImage(v,0,0);c.toBlob(function(b){setShot(b);vibrate(25);},'image/jpeg',.9);}
 function send(){if(!shot||busy)return;setBusy(true);setErr('');var fd=new FormData();fd.append('file',shot,'selfie.jpg');api('/api/web/verify',{method:'POST',body:fd,timeout:60000}).then(function(){ding('ok');p.onDone();}).catch(function(e){setErr(e.message);setShot(null);}).then(function(){setBusy(false);});}
 var preview=useMemo(function(){return shot?URL.createObjectURL(shot):'';},[shot]);
 return h(Sheet,{title:'Верификация',sub:'Селфи для подтверждения',onClose:p.onClose,center:true},h('div',{className:'cam'},shot?h('img',{src:preview,alt:''}):h('video',{ref:vid,playsInline:true,muted:true,autoPlay:true,style:{transform:'scaleX(-1)'}}),!shot?h('div',{className:'oval'}):null,!shot?h('div',{className:'tip'},ready?'Лицо в овал, хороший свет':'Включаем камеру…'):null),err?h('div',{className:'attn'},err):null,h('p',{className:'muted',style:{margin:'0 0 12px',fontSize:13}},'Фото видит только оператор. Система проверит, что в кадре есть лицо.'),!shot?h('div',{className:'two-btn'},h('button',{className:'btn',disabled:!ready,onClick:snap},h(I,{name:'camera',size:18}),'Сделать фото'),h('label',{className:'btn ghost'},h(I,{name:'image',size:18}),'Галерея',h('input',{type:'file',accept:'image/*',capture:'user',hidden:true,onChange:function(e){var f=e.target.files&&e.target.files[0];if(f)setShot(f);}}))):h('div',{className:'two-btn'},h('button',{className:'btn ghost',onClick:function(){setShot(null);}},'Переснять'),h('button',{className:'btn',disabled:busy,onClick:send},busy?h('span',{className:'spin w'}):h(I,{name:'check',size:18}),busy?'Проверяем…':'Отправить')));}

/* ---------- Edit profile ---------- */
function EditProfileSheet(p){var u=p.user;var [name,setName]=useState(u.name||'');var [bio,setBio]=useState(u.bio||'');var [uname,setUname]=useState(u.username||'');var [avail,setAvail]=useState(null);var [busy,setBusy]=useState(false);var [err,setErr]=useState('');var t=useRef(0);
 var nextChange=useMemo(function(){if(!u.username_changed_at)return null;var d=new Date(u.username_changed_at);d.setDate(d.getDate()+7);return d>new Date()?d:null;},[u.username_changed_at]);
 useEffect(function(){var v=uname.trim().toLowerCase();if(!v||v===(u.username||'')){setAvail(null);return;}var my=++t.current;setAvail({wait:true});var tm=setTimeout(function(){api('/api/web/username/check?username='+encodeURIComponent(v)).then(function(r){if(my===t.current)setAvail(r);}).catch(function(){});},450);return function(){clearTimeout(tm);};},[uname]);
 function save(){setBusy(true);setErr('');var chain=api('/api/web/profile2',{method:'POST',body:{name:name.trim(),bio:bio.trim()}});var v=uname.trim().toLowerCase();if(v&&v!==(u.username||''))chain=chain.then(function(){return api('/api/web/username',{method:'POST',body:{username:v}});});chain.then(function(){p.onSaved();}).catch(function(e){setErr(e.message);}).then(function(){setBusy(false);});}
 return h(Sheet,{title:'Редактировать',onClose:p.onClose},h('div',{className:'f-label'},'Имя'),h('div',{className:'field'},h(I,{name:'user',size:18}),h('input',{value:name,maxLength:48,onChange:function(e){setName(e.target.value);}})),h('div',{className:'f-label'},'О себе'),h('div',{className:'field'},h(I,{name:'edit2',size:18}),h('input',{value:bio,maxLength:140,placeholder:'Расскажите о себе',onChange:function(e){setBio(e.target.value);}})),
  h('div',{className:'f-label'},'Юзернейм'),h('div',{className:'field'+(avail&&avail.available?' ok':'')},h(I,{name:'at',size:18}),h('input',{value:uname,placeholder:'username',autoCapitalize:'off',autoCorrect:'off',disabled:!!nextChange,onChange:function(e){setUname(e.target.value.replace(/[^a-zA-Z0-9_]/g,'').toLowerCase());}}),avail&&avail.wait?h('span',{className:'spin'}):null,avail&&!avail.wait?h('span',{className:'tick'+(avail.available?'':' bad')},h(I,{name:avail.available?'check':'x',size:14,w:3})):null),
  nextChange?h('div',{className:'hint',style:{marginTop:6}},h(I,{name:'clock',size:15}),'Следующая смена — '+fmtDate(nextChange.toISOString())):h('div',{className:'hint',style:{marginTop:6}},h(I,{name:'info',size:15}),avail&&!avail.wait&&!avail.available?(avail.reason||'Недоступен'):'Латиница, от 5 символов. Смена раз в 7 дней; старый юзернейм замораживается на 7 дней — вернуть можете только вы'),
  h('div',{className:'ro-rows'},h('div',{className:'drow'},h('span',null,'Email'),h('b',null,u.email,h(I,{name:'lock2',size:13}))),h('div',{className:'drow'},h('span',null,'Телефон'),h('b',null,u.phone||'—',h(I,{name:'lock2',size:13})))),
  err?h('div',{className:'attn'},err):null,h('button',{className:'btn mt12',disabled:busy||name.trim().length<2||(avail&&(avail.wait||avail.available===false)),onClick:save},busy?h('span',{className:'spin w'}):h(I,{name:'check',size:18}),'Сохранить'));}

/* ---------- Account QR ---------- */
function QrSheet(p){var u=p.user;var handle=u.username?'@'+u.username:'id'+u.id;
 /* Копируем ссылку на профиль, а не юзернейм: её можно кинуть в любой мессенджер и она откроется. */
 var link=location.origin+'/app/#/u/'+(u.username||('id'+u.id));
 function share(){if(navigator.share){navigator.share({title:u.name,text:'Мой профиль в LUXON',url:link}).catch(function(){});return;}copyText(link,'Ссылка скопирована');}
 return h(Sheet,{title:'Мой QR',sub:'Покажите, чтобы вас нашли',onClose:p.onClose,center:true},
  h('div',{className:'qr-box'},h('img',{src:'/api/web/me/qr2.png?t='+(u.username||u.id),alt:'QR'})),
  h('div',{style:{fontSize:20,fontWeight:800,marginTop:4}},u.name),
  h('div',{className:'muted',style:{marginBottom:10}},handle),
  h('div',{className:'linkbox',onClick:function(){copyText(link,'Ссылка скопирована');}},h(I,{name:'link',size:16}),h('span',null,link.replace(/^https?:\/\//,'')),h(I,{name:'copy',size:15})),
  h('button',{className:'btn mt12',onClick:function(){copyText(link,'Ссылка скопирована');}},h(I,{name:'copy',size:18}),'Скопировать ссылку'),
  h('button',{className:'btn ghost mt8',onClick:share},h(I,{name:'send',size:18}),'Поделиться'),
  h('button',{className:'btn ghost mt8',onClick:function(){copyText(handle,'Юзернейм скопирован');}},h(I,{name:'at',size:18}),'Скопировать '+handle));}

/* ---------- Rules ---------- */
var RULES=[['18+ контент, стикеры и фото','мут 1 час'],['Оскорбление родителей и семьи','мут 1 час'],['Пожелания смерти участникам или их близким','мут 1 день'],['Оскорбление администрации и модераторов','мут 2 часа'],['Спам, флуд, повторяющиеся сообщения','мут 1 час'],['Порнография, треш, жестокость','мут 1 день'],['Реклама без согласования с администрацией','бан навсегда'],['Политика, нацизм, провокации конфликтов','мут 1 день'],['Разглашение чужих личных данных','бан навсегда'],['Токсичность, угрозы, неадекватное поведение','по усмотрению администрации'],['Упоминание других касс и сервисов','бан навсегда, без предупреждений']];
function RulesSheet(p){return h(Sheet,{title:'Правила чата',sub:'Ознакомьтесь перед общением',onClose:p.onClose},h('p',{className:'muted',style:{margin:'0 0 12px',fontSize:13.5}},'Чат LUXON — общее пространство клиентов. Мат скрывается звёздочками автоматически, ссылки и контакты не отправляются. За нарушения — мут или бан.'),h('div',{className:'rules'},RULES.map(function(r,i){return h('div',{className:'rule'+(r[1].indexOf('бан')>=0?' ban':''),key:i},h('span',{className:'n'},i+1),h('div',null,h('b',null,r[0]),h('small',null,r[1])));})),h('p',{className:'muted',style:{margin:'12px 0 0',fontSize:12.5}},'Администрация может менять и дополнять правила без уведомления. Будьте вежливы и уважайте участников.'),h('button',{className:'btn mt12',onClick:p.onClose},'Понятно'));}

Object.assign(L,{BkItem:BkItem,TxRow:TxRow,DepositSheet:DepositSheet,PayPage:PayPage,WithdrawSheet:WithdrawSheet,TxSheet:TxSheet,BkSheet:BkSheet,Story:Story,VerifySheet:VerifySheet,EditProfileSheet:EditProfileSheet,QrSheet:QrSheet,RulesSheet:RulesSheet,RULES:RULES});
})();
