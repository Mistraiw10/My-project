/* Жизни: один запас на Алкены, Алкины, Алкадиены и Цепочки (в Аромадоме жизни бесконечные).
   5 жизней, ошибка забирает одну, новая появляется каждые 10 минут.
   Работают без интернета по часам устройства; перевод часов назад время не отматывает.
   Журнал ошибок (log) нужен для будущей сверки с сервером по его часам.
   С подпиской (organika-hub.premiumUntil в будущем) жизни не тратятся. */
(function(){
const KEY='organika-lives', MAX=5, STEP=10*60*1000;
const fresh=()=>({n:MAX,t:0,seen:0,log:[]});
const load=()=>{ try{ return Object.assign(fresh(),JSON.parse(localStorage.getItem(KEY)||'null')||{}); }catch(e){ return fresh(); } };
const store=L=>{ try{ localStorage.setItem(KEY,JSON.stringify(L)); }catch(e){} };
function premium(){ try{ const H=JSON.parse(localStorage.getItem('organika-hub')||'{}'); return (H.premiumUntil||0)>Date.now(); }catch(e){ return false; } }

/* сколько жизней сейчас и от какого момента идёт отсчёт следующей */
function calc(){
  const L=load(), real=Date.now();
  if(real>(L.seen||0)){ L.seen=real; store(L); }
  const now=Math.max(real,L.seen);
  if(L.n>=MAX) return {L,cur:MAX,anchor:now,now};
  const k=Math.max(0,Math.floor((now-L.t)/STEP));
  if(L.n+k>=MAX) return {L,cur:MAX,anchor:now,now};
  return {L,cur:L.n+k,anchor:L.t+k*STEP,now};
}
function left(){ return premium()?Infinity:calc().cur; }
function spend(game){
  if(premium()) return;
  const s=calc(); if(s.cur<=0) return;
  const L=s.L;
  L.n=s.cur-1; L.t=s.cur>=MAX?s.now:s.anchor; L.seen=s.now;
  L.log=(L.log||[]).concat({g:game,t:s.now}).slice(-300);
  store(L);
}
function msLeft(){ const s=calc(); return s.cur>=MAX?0:Math.max(0,s.anchor+STEP-s.now); }
const fmt=ms=>{ const t=Math.ceil(ms/1000), m=Math.floor(t/60), s=t%60; return m+':'+String(s).padStart(2,'0'); };

window.Lives={MAX,left,spend,premium,msLeft,wait:()=>fmt(msLeft())};
/* Для достижения «Реагент-мастер»: серия верных ответов на вопросы о реагентах во всех играх (organika-hub.rgRun / rgBest).
   type - вид вопроса (rg - реагент), остальные вопросы серию не трогают. */
window.rgTrack=function(type,ok){
  if(type!=='rg') return;
  try{ const H=JSON.parse(localStorage.getItem('organika-hub')||'{}'); H.rgRun=ok?(H.rgRun|0)+1:0; H.rgBest=Math.max(H.rgBest|0,H.rgRun);
    localStorage.setItem('organika-hub',JSON.stringify(H)); }catch(e){}
};
})();
