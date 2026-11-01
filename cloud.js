/* Облако (Supabase): вход, резервная копия прогресса, рейтинг.
   Сайт полностью работает без него: прогресс живёт в localStorage, каждый запрос ждёт не дольше
   TIMEOUT, любые ошибки ловятся и не ломают игру. В коде только publishable-ключ, доступ режут правила RLS. */
(function(){
const BASE='https://ivbrdktnkmbqujfmqmdj.supabase.co';
const PKEY='sb_publishable_Rbj68HyVDkeGDFrEaD4IhQ_LrFLgRtA';
const SESS='organika-session', HUB='organika-hub';
const GAMES={aromadom:'aromadom-v1',alkeny:'dvoinaya-svyaz-v1',alkiny:'alkiny-v1',alkadieny:'alkadieny-v1'};
const TIMEOUT=6000;

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
function forgetSync(){ const H=json(HUB); if(H){ delete H.synced; delete H.profileDirty; ls.set(HUB,JSON.stringify(H)); } }

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
  try{ await req('/auth/v1/logout',{method:'POST'}); }catch(e){}
  ls.del(SESS); forgetSync();
}

/* ---------- профиль ---------- */
async function getProfile(){
  const s=session(); if(!s) return null;
  const r=await req(`/rest/v1/profiles?select=nick,avatar&id=eq.${s.user.id}`);
  return (r&&r[0])||null;
}
/* Сохранить ник и аватарку. Ник занят → ошибка с code 'taken'. */
async function saveProfile(nick,avatar){
  const s=session(); if(!s) return;
  try{
    await req('/rest/v1/profiles?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
      body:{id:s.user.id,nick,avatar:avatar||null,updated_at:new Date().toISOString()}});
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
  const days=await req(`/rest/v1/star_days?select=day,game,stars&day=gte.${dayStr(-8)}`).catch(()=>[]);
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
  /* звёзды по дням: берём большее из двух, дальше игра прибавляет к этому */
  H.sd=H.sd||{};
  (days||[]).forEach(d=>{ const b=H.sd[d.day]=H.sd[d.day]||{}; b[d.game]=Math.max(b[d.game]||0,d.stars); });
  ls.set(HUB,JSON.stringify(H));
  return changed;
}
/* Отправить на сервер то, что изменилось с прошлой отправки */
async function push(only){
  const s=session(); if(!s||!await token()) return;
  const H=json(HUB)||{}, synced=H.synced||{}, rows=[];
  Object.entries(GAMES).forEach(([g,k])=>{
    if(only&&g!==only) return;
    const st=json(k), m=(H.games||{})[g];
    if(!st||!m||!m.t||(synced[g]&&synced[g]>=m.t)) return;
    rows.push({user_id:s.user.id,game:g,state:st,earned:Math.max(0,m.earned|0),level:Math.max(1,m.level|0),
               opened:Math.max(0,m.open|0),total:Math.max(0,m.total|0),updated_at:new Date(m.t).toISOString()});
  });
  if(rows.length) await req('/rest/v1/progress?on_conflict=user_id,game',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:rows});
  const cut=dayStr(-8), dr=[];
  Object.entries(H.sd||{}).forEach(([day,gs])=>{ if(day<cut) return;
    Object.entries(gs).forEach(([g,n])=>{ if(GAMES[g]&&(!only||g===only)) dr.push({user_id:s.user.id,day,game:g,stars:Math.min(5000,Math.max(0,n|0))}); }); });
  if(dr.length) await req('/rest/v1/star_days?on_conflict=user_id,day,game',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:dr});
  const H2=json(HUB)||{}; H2.synced=H2.synced||{};
  rows.forEach(r=>{H2.synced[r.game]=Date.parse(r.updated_at);});
  H2.lastSync=Date.now(); ls.set(HUB,JSON.stringify(H2));
}
/* Полная синхронизация: скачать, потом отправить. Возвращает true, если локальный прогресс поменялся. */
async function sync(firstLogin){
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

window.Cloud={
  user:()=>{const s=session(); return s?s.user:null;},
  online:()=>online,
  signUp,signIn,signOut,recover,fromLink,setPassword,getProfile,saveProfile,
  nickFree:n=>req('/rest/v1/rpc/nick_available',{method:'POST',body:{p_nick:n}}),
  pull,push,sync,queue,leaderboard,subscription
};
})();
