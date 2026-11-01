/* Облако (Supabase): вход, резервная копия прогресса, рейтинг.
   Сайт полностью работает без него: прогресс живёт в localStorage, каждый запрос ждёт не дольше
   TIMEOUT, любые ошибки ловятся и не ломают игру. В коде только publishable-ключ, доступ режут правила RLS. */
(function(){
const BASE='https://ivbrdktnkmbqujfmqmdj.supabase.co';
const PKEY='sb_publishable_Rbj68HyVDkeGDFrEaD4IhQ_LrFLgRtA';
const SESS='organika-session', HUB='organika-hub';
const GAMES={aromadom:'aromadom-v1',alkeny:'dvoinaya-svyaz-v1',alkiny:'alkiny-v1',alkadieny:'alkadieny-v1',chains:'chains-v1'};
/* игры, добавленные позже: сервер принимает их только после своего SQL (chains.sql), поэтому отправляем их
   отдельным запросом - если сервер ещё не обновлён, это не мешает сохранять остальные игры */
const LATE=new Set(['chains']);
const TIMEOUT=6000;
const HOURS_BACK=7*24*3600*1000;   // сервер принимает звёзды по часам только за последние 8 дней

const ls={get:k=>{try{return localStorage.getItem(k);}catch(e){return null;}},
          set:(k,v)=>{try{localStorage.setItem(k,v);}catch(e){}},
          del:k=>{try{localStorage.removeItem(k);}catch(e){}}};
const json=k=>{try{return JSON.parse(ls.get(k)||'null');}catch(e){return null;}};
const dayStr=(off=0)=>{const d=new Date(); d.setDate(d.getDate()+off); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};

let online=null;   // null - ещё не пробовали, true/false - по последнему запросу

/* ---------- HTTP с таймаутом ---------- */
async function req(path,{method='GET',body,auth=true,headers={}}={}){
  const h=Object.assign({apikey:PKEY},headers);
  if(body!==undefined) h['Content-Type']='application/json';
  if(auth){const t=await token(); if(t) h.Authorization='Bearer '+t;}
  const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),TIMEOUT);
  let r;
  try{ r=await fetch(BASE+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:ctl.signal}); }
  catch(e){ online=false; const err=new Error('Нет связи с сервером'); err.offline=true; throw err; }
  finally{ clearTimeout(timer); }
  online=true;
  const txt=await r.text(); let data=null; try{data=txt?JSON.parse(txt):null;}catch(e){data=txt;}
  if(!r.ok){
    const err=new Error((data&&(data.msg||data.message||data.error_description||data.error))||('HTTP '+r.status));
    err.status=r.status; err.code=data&&(data.code||data.error_code); throw err;
  }
  return data;
}

/* ---------- сессия ---------- */
const session=()=>json(SESS);
function keep(d){
  if(!d||!d.access_token||!d.user) return null;
  const s={access_token:d.access_token,refresh_token:d.refresh_token,
           expires_at:d.expires_at||Math.floor(Date.now()/1000)+(d.expires_in||3600),
           user:{id:d.user.id,email:d.user.email}};
  ls.set(SESS,JSON.stringify(s)); return s;
}
let refreshing=null;
async function token(){
  const s=session(); if(!s) return null;
  if(s.expires_at*1000-Date.now()>60000) return s.access_token;
  if(!refreshing) refreshing=req('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:s.refresh_token},auth:false})
    .then(keep)
    .catch(e=>{ if(!e.offline&&e.status>=400&&e.status<500) ls.del(SESS); return null; })   // сессия отозвана - выходим
    .finally(()=>{refreshing=null;});
  const n=await refreshing; return n?n.access_token:null;
}
function forgetSync(){ statusP=null; const H=json(HUB); if(H){ ['synced','profileDirty','admin','blocked','premiumUntil','push'].forEach(k=>delete H[k]); ls.set(HUB,JSON.stringify(H)); } }

async function signUp(email,password){
  const d=await req('/auth/v1/signup',{method:'POST',body:{email,password},auth:false});
  forgetSync();
  return keep(d)?{ok:true}:{ok:false,confirm:true};   // без сессии - значит, включено подтверждение почты
}
async function signIn(email,password){
  forgetSync();
  keep(await req('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false}));
}
/* Восстановление пароля: письмо со ссылкой, ссылка возвращает на сайт с токеном в адресе (#access_token=…&type=recovery) */
async function recover(email){
  const back=location.origin+location.pathname.replace(/[^/]*$/,'');   // хаб в той же папке
  await req('/auth/v1/recover?redirect_to='+encodeURIComponent(back),{method:'POST',body:{email},auth:false});
}
/* Разобрать адрес после перехода по ссылке из письма. null - ссылки нет. */
async function fromLink(){
  const hs=location.hash.slice(1);
  if(!/(^|&)(access_token|error)=/.test(hs)) return null;
  const p=new URLSearchParams(hs);
  history.replaceState(null,'',location.pathname+location.search);   // убрать токен из адресной строки
  if(p.get('error')) return {error:p.get('error_code')||p.get('error'),message:p.get('error_description')||''};
  const at=p.get('access_token');
  const user=await req('/auth/v1/user',{headers:{Authorization:'Bearer '+at},auth:false});
  forgetSync();
  keep({access_token:at,refresh_token:p.get('refresh_token'),expires_in:+p.get('expires_in')||3600,user});
  return {type:p.get('type')||''};
}
async function setPassword(password){
  await req('/auth/v1/user',{method:'PUT',body:{password}});
}
async function signOut(){
  try{ await pushOff(); }catch(e){}   // чтобы устройство не получало напоминания за чужой аккаунт
  try{ await req('/auth/v1/logout',{method:'POST'}); }catch(e){}
  ls.del(SESS); forgetSync();
}

/* ---------- профиль ---------- */
/* колонка school появляется после admin.sql; пока её нет, работаем без неё */
/* колонка grade (цель-оценка) - после profile_grade.sql; пока колонок нет, работаем без них */
const noCol=e=>e&&(e.code==='42703'||e.code==='PGRST204'||/school|grade/i.test(e.message||''));
async function getProfile(){
  const s=session(); if(!s) return null;
  const q=cols=>req(`/rest/v1/profiles?select=${cols}&id=eq.${s.user.id}`);
  const r=await q('nick,avatar,school,grade')
    .catch(e=>{ if(!noCol(e)) throw e; return q('nick,avatar,school'); })
    .catch(e=>{ if(!noCol(e)) throw e; return q('nick,avatar'); });
  return (r&&r[0])||null;
}
/* Сохранить ник, аватарку и (если переданы) учебное заведение и цель-оценку 3-5.
   school: строка - сохранить, '' - стереть, не передано - не трогать. Ник занят → ошибка с code 'taken'. */
async function saveProfile(nick,avatar,school,grade){
  const s=session(); if(!s) return;
  const body={id:s.user.id,nick,avatar:avatar||null,updated_at:new Date().toISOString()};
  if(school) body.school=String(school).slice(0,80); else if(school==='') body.school=null;
  if(grade>=3&&grade<=5) body.grade=grade|0;
  const send=b=>req('/rest/v1/profiles?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:b});
  try{
    await send(body).catch(e=>{ if(!noCol(e)||!('grade' in body||'school' in body)) throw e;
      delete body.grade; return send(body).catch(e2=>{ if('school' in body&&noCol(e2)){ delete body.school; return send(body); } throw e2; }); });
    const H=json(HUB)||{}; delete H.profileDirty; ls.set(HUB,JSON.stringify(H));
  }catch(e){
    if(e.code==='23505'){ const err=new Error('Этот ник уже занят'); err.code='taken'; throw err; }
    if(e.offline){ const H=json(HUB)||{}; H.profileDirty=1; ls.set(HUB,JSON.stringify(H)); }
    throw e;
  }
}

/* ---------- синхронизация прогресса ---------- */
/* Скачать сохранения. Обычно побеждает более свежее; при первом входе на устройстве - то, где больше звёзд. */
async function pull(firstLogin){
  const s=session(); if(!s||!await token()) return false;
  const rows=await req('/rest/v1/progress?select=game,state,earned,level,opened,total,updated_at');
  const hours=await req(`/rest/v1/star_hours?select=hour,game,stars&hour=gte.${new Date(Date.now()-HOURS_BACK).toISOString()}`).catch(()=>[]);
  const H=json(HUB)||{}; H.games=H.games||{}; H.synced=H.synced||{}; let changed=false;
  (rows||[]).forEach(r=>{
    const k=GAMES[r.game]; if(!k||!r.state) return;
    const m=H.games[r.game], rt=Date.parse(r.updated_at);
    const take=!m||!m.t||!json(k)||(firstLogin?r.earned>(m.earned||0):rt>m.t);
    if(!take) return;
    ls.set(k,JSON.stringify(r.state));
    H.games[r.game]={stars:r.state.stars||0,earned:r.earned,level:r.level,open:r.opened,total:r.total,t:rt};
    H.synced[r.game]=rt; changed=true;
  });
  /* звёзды по часам: берём большее из двух, дальше игра прибавляет к этому */
  H.sh=H.sh||{};
  (hours||[]).forEach(d=>{ const k=new Date(d.hour).toISOString(), b=H.sh[k]=H.sh[k]||{}; b[d.game]=Math.max(b[d.game]||0,d.stars); });
  ls.set(HUB,JSON.stringify(H));
  return changed;
}
/* Отправить на сервер то, что изменилось с прошлой отправки */
async function push(only){
  const s=session(); if(!s||!await token()) return;
  const st0=await status().catch(()=>null);
  if(st0&&st0.blocked_until) return;   // заблокированному сервер всё равно не даст сохранить
  const H=json(HUB)||{}, synced=H.synced||{}, rows=[];
  Object.entries(GAMES).forEach(([g,k])=>{
    if(only&&g!==only) return;
    const st=json(k), m=(H.games||{})[g];
    if(!st||!m||!m.t||(synced[g]&&synced[g]>=m.t)) return;
    rows.push({user_id:s.user.id,game:g,state:st,earned:Math.max(0,m.earned|0),level:Math.max(1,m.level|0),
               opened:Math.max(0,m.open|0),total:Math.max(0,m.total|0),updated_at:new Date(m.t).toISOString()});
  });
  const upsert=(table,conflict,list)=>list.length?req(`/rest/v1/${table}?on_conflict=${conflict}`,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:list}):null;
  const late=r=>LATE.has(r.game), sent=[];
  await upsert('progress','user_id,game',rows.filter(r=>!late(r))); sent.push(...rows.filter(r=>!late(r)));
  for(const r of rows.filter(late)){ try{ await upsert('progress','user_id,game',[r]); sent.push(r); }catch(e){ if(e.offline) throw e; } }
  /* звёзды по часам за последние 7 дней - из них сервер считает рейтинг с лимитом 150 звёзд в час */
  const cut=new Date(Date.now()-HOURS_BACK).toISOString(), hr=[];
  Object.entries(H.sh||{}).forEach(([hour,gs])=>{ if(hour<cut) return;
    Object.entries(gs).forEach(([g,n])=>{ if(GAMES[g]&&(!only||g===only)) hr.push({user_id:s.user.id,hour,game:g,stars:Math.min(1000,Math.max(0,n|0))}); }); });
  await upsert('star_hours','user_id,hour,game',hr.filter(r=>!late(r)));
  try{ await upsert('star_hours','user_id,hour,game',hr.filter(late)); }catch(e){ if(e.offline) throw e; }
  const H2=json(HUB)||{}; H2.synced=H2.synced||{};
  if(H2.sh) Object.keys(H2.sh).forEach(k=>{ if(k<cut) delete H2.sh[k]; });   // старые часы больше не нужны
  sent.forEach(r=>{H2.synced[r.game]=Date.parse(r.updated_at);});
  H2.lastSync=Date.now(); H2.syncUser=s.user.id; ls.set(HUB,JSON.stringify(H2));
  pushTouch().catch(()=>{});
}
/* Статус от сервера: блокировка, стирание прогресса админом, админ ли я, подписка.
   Раз за загрузку страницы, до первой отправки - чтобы стёртый прогресс не вернулся на сервер из этого браузера. */
let statusP=null;
function status(){
  if(!statusP) statusP=(async()=>{
    const s=session(); if(!s||!await token()) return null;
    const r=((await req('/rest/v1/rpc/my_status',{method:'POST',body:{}}))||[])[0]||{};
    const H=json(HUB)||{};
    H.blocked=r.blocked_until?{until:Date.parse(r.blocked_until),reason:r.block_reason||''}:null;
    H.admin=!!r.is_admin;
    /* стирание админом (all - всё, иначе одна игра). Стираем локально, только если этот браузер
       уже отправлял прогресс этого аккаунта до стирания - иначе здесь не те данные, что стёрли. */
    const uid=s.user.id, seen=Object.assign({},(H.resetSeen||{})[uid]); let wiped=false;
    Object.entries(r.resets||{}).forEach(([g,at])=>{
      const t=Date.parse(at); if(!(t>(seen[g]||0))) return;
      seen[g]=t;
      if(!(H.syncUser===uid&&H.lastSync&&H.lastSync<t)) return;
      const list=g==='all'?Object.keys(GAMES):GAMES[g]?[g]:[];
      list.forEach(id=>{ ls.del(GAMES[id]); if(H.games) delete H.games[id]; if(H.synced) delete H.synced[id];
        [H.sh,H.sd].forEach(m=>m&&Object.values(m).forEach(b=>delete b[id])); if(H.last===id) delete H.last; });
      if(g==='all') delete H.days;
      wiped=true;
    });
    H.resetSeen=Object.assign({},H.resetSeen,{[uid]:seen});
    if(wiped){ ls.set(HUB,JSON.stringify(H)); location.reload(); await new Promise(()=>{}); }   // перезагрузка с чистым прогрессом
    ls.set(HUB,JSON.stringify(H));
    await subscription().catch(()=>{});
    return r;
  })().catch(e=>{ statusP=null; throw e; });
  return statusP;
}
/* Полная синхронизация: статус, скачать, потом отправить. Возвращает true, если локальный прогресс поменялся. */
async function sync(firstLogin){
  if(firstLogin) statusP=null;
  await status().catch(()=>{});
  const changed=await pull(firstLogin);
  await push();
  return changed;
}

/* Игры зовут queue() после каждого сохранения - отправка раз в несколько секунд */
const timers={};
function queue(game){
  if(!session()) return;
  clearTimeout(timers[game]);
  timers[game]=setTimeout(()=>{ push(game).catch(()=>{}); },3000);
}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='hidden'||!session()) return;
  Object.keys(timers).forEach(g=>{ clearTimeout(timers[g]); delete timers[g]; push(g).catch(()=>{}); });
});

/* ---------- рейтинг и подписка ---------- */
async function leaderboard(period){
  return await req('/rest/v1/rpc/leaderboard',{method:'POST',body:{p_period:period==='week'?'week':'all',p_limit:50}});
}
async function subscription(){
  const s=session(); if(!s) return null;
  const r=await req('/rest/v1/subscriptions?select=until');
  const until=r&&r[0]?Date.parse(r[0].until):0;
  const H=json(HUB)||{}; H.premiumUntil=until; ls.set(HUB,JSON.stringify(H));
  return until;
}

/* ---------- сообщить об ошибке ---------- */
/* Скриншот (только со входом) - в закрытую папку bug-shots/<id игрока>/, текст - в таблицу bug_reports */
async function upload(bucket,path,blob){
  const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),30000);
  try{
    const r=await fetch(`${BASE}/storage/v1/object/${bucket}/${path}`,{method:'POST',signal:ctl.signal,
      headers:{apikey:PKEY,Authorization:'Bearer '+await token(),'Content-Type':blob.type||'image/jpeg'},body:blob});
    if(!r.ok){ const err=new Error('Картинка не загрузилась (HTTP '+r.status+')'); err.status=r.status; throw err; }
  }catch(e){ if(e.name==='AbortError'||e instanceof TypeError){ const err=new Error('Нет связи с сервером'); err.offline=true; throw err; } throw e; }
  finally{ clearTimeout(timer); }
}
/* Своя аватарка (с подпиской): квадратный JPEG в открытую папку avatars/<id игрока>/<время>.jpg.
   В профиле хранится как «img:<путь>» - так её видно в рейтинге у всех. Загрузку без подписки не пропустит сервер. */
const AVA_RE=/^img:([0-9a-f-]{36}\/\d{10,14}\.jpg)$/;
const avaSrc=a=>{ const m=AVA_RE.exec(a||''); return m?`${BASE}/storage/v1/object/public/avatars/${m[1]}`:null; };
async function avatarUpload(blob){
  const s=session(); if(!s||!await token()) throw new Error('Нужен вход в аккаунт');
  const path=`${s.user.id}/${Date.now()}.jpg`;
  await upload('avatars',path,blob);
  return 'img:'+path;
}
async function report({place,message,shot,nick,device}){
  const s=session(); let path=null;
  if(shot&&s&&await token()){ path=`${s.user.id}/${Date.now()}.jpg`; await upload('bug-shots',path,shot); }
  await req('/rest/v1/bug_reports',{method:'POST',headers:{Prefer:'return=minimal'},
    body:{place,message,shot:path,nick:nick||null,email:s?s.user.email:null,device:device||null}});   // user_id сервер ставит сам
}

/* ---------- админ-панель (сервер сам проверяет, что ты админ) ---------- */
const rpc=(name,args)=>req('/rest/v1/rpc/'+name,{method:'POST',body:args||{}});
const admin={
  players:()=>rpc('admin_players'),
  setPremium:(user,until)=>rpc('admin_set_premium',{p_user:user,p_until:until}),
  block:(user,until,reason)=>rpc('admin_block',{p_user:user,p_until:until,p_reason:reason||''}),
  wipe:(user,game)=>rpc('admin_wipe',{p_user:user,p_game:game||null}),
  reports:done=>rpc('admin_reports',{p_done:!!done}),
  reportDone:(id,done)=>rpc('admin_report_done',{p_id:id,p_done:!!done}),
  /* скриншот из закрытой папки - картинкой для <img> */
  async shot(path){
    const r=await fetch(`${BASE}/storage/v1/object/authenticated/bug-shots/${path}`,{headers:{apikey:PKEY,Authorization:'Bearer '+await token()}});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return URL.createObjectURL(await r.blob());
  }
};

/* ---------- напоминания о серии (push) ----------
   Подписка браузера хранится в push_subs вместе с серией и последним днём занятий;
   раз в час сервер (Edge Function streak-reminders) напоминает тем, кто вчера занимался, а сегодня ещё нет. */
const VAPID='BK3uXJaq47pLbePNiC-LTMW2chw54qcRi8AZk3kfTK0cdeKilACgJerx7DC0WxqvxuX1hvSVD9gxCTdv4MHHLrI';
const pushOk=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const keyBytes=s=>{ const b=atob((s+'='.repeat((4-s.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(b,c=>c.charCodeAt(0)); };
/* серия и последний день - как в хабе, по дням занятий organika-hub.days */
function streakInfo(H){
  const S=new Set(H.days||[]), d=new Date(); let n=0;
  const ds=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
  if(!S.has(ds(d))) d.setDate(d.getDate()-1);
  while(S.has(ds(d))){ n++; d.setDate(d.getDate()-1); }
  return {streak:n,lastDay:[...S].sort().pop()||null};
}
async function pushSave(sub,hour,minute){
  const H=json(HUB)||{}, j=sub.toJSON(), i=streakInfo(H);
  await rpc('push_save',{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth,
    p_tz:Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/Moscow',p_hour:hour,p_minute:minute|0,p_streak:i.streak,p_last_day:i.lastDay});
  const H2=json(HUB)||{}; H2.push={hour,minute:minute|0,day:i.lastDay}; ls.set(HUB,JSON.stringify(H2));
}
/* включить (или сменить время: minute 0 или 30). Ошибка code 'denied' - уведомления запрещены в браузере */
async function pushOn(hour,minute){
  if(!pushOk()) throw Object.assign(new Error('Этот браузер не умеет уведомления'),{code:'unsupported'});
  if(await Notification.requestPermission()!=='granted') throw Object.assign(new Error('Уведомления запрещены'),{code:'denied'});
  const reg=await navigator.serviceWorker.ready;
  const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(VAPID)});
  await pushSave(sub,hour,minute);
}
async function pushOff(){
  const H=json(HUB)||{}; delete H.push; ls.set(HUB,JSON.stringify(H));
  if(!pushOk()) return;
  const reg=await navigator.serviceWorker.getRegistration(); const sub=reg&&await reg.pushManager.getSubscription();
  if(sub){ await rpc('push_delete',{p_endpoint:sub.endpoint}).catch(()=>{}); await sub.unsubscribe().catch(()=>{}); }
}
/* после занятий сообщить серверу новый последний день (иначе он не поймёт, что серию пора спасать) */
async function pushTouch(){
  const H=json(HUB)||{}; if(!H.push||!session()||!pushOk()) return;
  if(H.push.day===streakInfo(H).lastDay) return;
  const reg=await navigator.serviceWorker.getRegistration(); const sub=reg&&await reg.pushManager.getSubscription();
  if(!sub||Notification.permission!=='granted'){ delete H.push; ls.set(HUB,JSON.stringify(H)); return; }
  await pushSave(sub,H.push.hour,H.push.minute);
}

window.Cloud={
  user:()=>{const s=session(); return s?s.user:null;},
  online:()=>online,
  signUp,signIn,signOut,recover,fromLink,setPassword,getProfile,saveProfile,
  nickFree:n=>req('/rest/v1/rpc/nick_available',{method:'POST',body:{p_nick:n}}),
  pull,push,sync,queue,leaderboard,subscription,report,status,admin,avaSrc,avatarUpload,
  push:{ok:pushOk,on:pushOn,off:pushOff,time:()=>{const p=(json(HUB)||{}).push; return p?{hour:p.hour,minute:p.minute|0}:null;}},
  isAdmin:()=>!!(json(HUB)||{}).admin,
  blocked:()=>{const b=(json(HUB)||{}).blocked; return session()&&b&&b.until>Date.now()?b:null;}
};
})();
