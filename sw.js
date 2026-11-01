/* Сайт как приложение: страницы и файлы сохраняются на устройстве и открываются без сети.
   Страницы - сначала из сети (чтобы обновления приходили сразу), без сети - из сохранённых.
   Скрипты, иконки и шрифты - из сохранённых, в фоне обновляются.
   Запросы к Supabase не трогаем - ими занимается cloud.js. */
const CACHE='organika-v7';
const CORE=['hub','index.html','spravochnik.html','aromadom.html','alkeny.html','alkiny.html','alkadieny.html',
  'cloud.js?v=8','lives.js?v=2','nickfilter.js?v=2','me.js?v=4','admin.html','mistakes.html','chains.html','manifest.webmanifest?v=2',
  'icons/icon-192.png?v=2','icons/icon-512.png?v=2','icons/apple-touch-icon.png?v=2','icons/favicon.png?v=2'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(CORE.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

/* напоминание о серии от сервера (Edge Function streak-reminders) */
self.addEventListener('push',e=>{
  let d={}; try{ d=e.data?e.data.json():{}; }catch(x){ d={body:e.data&&e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title||'Органика в играх',{
    body:d.body||'Сыграй один уровень, чтобы сохранить серию.',icon:'icons/icon-192.png?v=2',badge:'icons/favicon.png?v=2',
    tag:d.tag||'streak',data:{url:d.url||'hub'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=new URL(e.notification.data&&e.notification.data.url||'hub',self.registration.scope).href;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{
    const w=ws.find(x=>x.url.startsWith(self.registration.scope));
    return w?w.navigate(url).then(x=>(x||w).focus()):clients.openWindow(url);
  }));
});

const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  const same=url.origin===self.location.origin;
  const fonts=/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if(!same&&!fonts) return;                      // Supabase и прочее - напрямую в сеть

  if(req.mode==='navigate'){
    e.respondWith((async()=>{
      const c=await caches.open(CACHE);
      try{
        const r=await withTimeout(fetch(req),5000);
        if(r.ok) c.put(req,r.clone());
        return r;
      }catch(x){
        return (await c.match(req,{ignoreSearch:true}))||(await c.match('hub'))||Response.error();
      }
    })());
    return;
  }
  e.respondWith((async()=>{
    const c=await caches.open(CACHE);
    const hit=await c.match(req);
    const net=fetch(req).then(r=>{ if(r&&(r.ok||r.type==='opaque')) c.put(req,r.clone()); return r; }).catch(()=>hit);
    return hit||net;
  })());
});
