const LUX_SW_VERSION='lux-push-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let data={};
    try{ data=event.data?event.data.json():{}; }
    catch(e){ data={title:'LUX ON',body:event.data?event.data.text():''}; }

    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const visible=windows.some(c=>c.visibilityState==='visible');

    if(visible){
      for(const c of windows){
        try{ c.postMessage({type:'LUX_PUSH_EVENT',payload:data}); }catch(e){}
      }
      return;
    }

    await self.registration.showNotification(data.title||'LUX ON',{
      body:data.body||'',
      icon:data.icon||'/static/push/api.png',
      badge:data.badge||'/static/push/api.png',
      image:data.image||undefined,
      tag:data.tag||('lux-'+Date.now()),
      renotify:true,
      requireInteraction:!!data.requireInteraction,
      vibrate:[120,60,120],
      timestamp:data.timestamp||Date.now(),
      data:{url:data.url||'/',event:data.event||'',id:data.id||''}
    });
  })());
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=(event.notification.data&&event.notification.data.url)||'/';
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of windows){
      try{
        if('focus' in c){
          await c.focus();
          c.postMessage({type:'LUX_PUSH_OPEN',url:target,event:event.notification.data&&event.notification.data.event,id:event.notification.data&&event.notification.data.id});
          return;
        }
      }catch(e){}
    }
    if(self.clients.openWindow) await self.clients.openWindow(target);
  })());
});