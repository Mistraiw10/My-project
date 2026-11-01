/* Ник в шапке игр - как кнопка профиля в хабе: аватарка + ник, нажатие открывает профиль в хабе.
   Ник и аватарка общие: organika-nick, organika-avatar (выбираются в хабе). */
(function(){
const css=`.mechip{display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:3px 14px 3px 3px;max-width:220px;font:inherit;font-weight:700;color:var(--ink);cursor:pointer;line-height:1.2}
.mechip:hover{border-color:var(--accent)}
.mechip:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.mechip .ma{width:30px;height:30px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;flex:none;font-size:15px;line-height:1}
.mechip .ma.emo{background:var(--surface2);font-size:18px}
.mechip .ma.own{background:var(--surface2);overflow:hidden}
.mechip .ma img{width:100%;height:100%;object-fit:cover;display:block}
.mechip .mn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}`;
document.head.insertAdjacentHTML('beforeend','<style>'+css+'</style>');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const get=k=>{try{return localStorage.getItem(k);}catch(e){return null;}};

/* нарисовать кнопку; без ника - «Ввести ник» */
window.meChip=function(btn,nick){
  if(!btn) return;
  btn.className='mechip';
  if(!nick){ btn.innerHTML='<span class="ma" aria-hidden="true">?</span><span class="mn">Ввести ник</span>'; btn.title='Ввести ник'; return; }
  const a=get('organika-avatar'), img=/^img:/.test(a||''), src=img&&window.Cloud&&Cloud.avaSrc?Cloud.avaSrc(a):null;
  const inner=src?`<img src="${esc(src)}" alt="">`:esc(a&&!img?a:[...nick][0].toUpperCase());   // своё фото (с подпиской) или эмодзи, иначе буква ника
  btn.innerHTML=`<span class="ma${src?' own':a&&!img?' emo':''}" aria-hidden="true">${inner}</span><span class="mn">${esc(nick)}</span>`;
  btn.title='Открыть профиль';
};
/* блокировка от админа: игры закрываются (сервер и так не принимает прогресс заблокированного) */
const untilText=t=>new Date(t).getFullYear()-new Date().getFullYear()>50?'навсегда'
  :'до '+new Date(t).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
window.blockText=b=>`Аккаунт заблокирован ${untilText(b.until)}.`+(b.reason?` Причина: ${b.reason}`:'');
function showBlock(b){
  if(document.getElementById('blockGate')) return;
  const hub=location.protocol==='file:'?'hub.html':'hub';
  document.body.insertAdjacentHTML('beforeend',`<div id="blockGate" style="position:fixed;inset:0;z-index:200;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(5px);display:grid;place-items:center;padding:16px">
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px;max-width:420px;width:100%;display:flex;flex-direction:column;gap:12px;text-align:center;color:var(--ink)">
      <h2 style="margin:0;font-size:20px">Аккаунт заблокирован</h2><p style="margin:0;color:var(--muted)">${esc(blockText(b))}</p>
      <a href="${hub}" style="display:block;padding:11px 16px;border-radius:12px;font-weight:700;text-decoration:none;background:var(--accent);color:var(--accent-ink)">На главную</a></div></div>`);
}
window.addEventListener('load',()=>{
  const C=window.Cloud;
  if(new URLSearchParams(location.search).has('ref')||!C||!C.user()) return;
  const check=()=>{ const b=C.blocked(); if(b) showBlock(b); };
  check(); C.status().then(check).catch(()=>{});
});
/* Профиль - тот же, что в хабе, но открывается поверх игры: хаб в прозрачной рамке (?embed=profile).
   Когда окна закрыты, хаб присылает profile-closed. Если поменялись ник, аватарка, тема или вход - игра перезагружается. */
const snap=()=>['organika-nick','organika-avatar','organika-theme','organika-session'].map(k=>{ const v=get(k)||''; return k==='organika-session'?!!v:v; }).join('|');
let frame=null, before='', watch=null, loaded=false;
function closeFrame(fromBack){
  if(!frame) return;
  clearInterval(watch); frame.remove(); frame=null;
  try{ document.activeElement&&document.activeElement.blur(); window.focus(); }catch(e){}
  if(!fromBack&&history.state&&history.state.mePf) history.back();   // убрать запись, которую добавил профиль
  if(snap()!==before) location.reload();
}
/* «Назад» на телефоне, пока открыт профиль, закрывает профиль, а не уводит рамку на пустую страницу */
window.addEventListener('popstate',()=>{ if(frame) closeFrame(true); });
window.goProfile=function(game){
  if(frame) return;
  before=snap();
  frame=document.createElement('iframe');
  frame.title='Профиль';
  frame.src=(location.protocol==='file:'?'hub.html':'hub')+'?embed=profile'+(game?'&from='+encodeURIComponent(game):'');
  frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:300;background:transparent;color-scheme:normal';
  frame.setAttribute('allowtransparency','true');
  loaded=false; frame.addEventListener('load',()=>{ loaded=true; });
  document.body.appendChild(frame);
  try{ history.pushState({mePf:1},''); }catch(e){}
  /* страховка: рамка прозрачная, и если она останется без открытого окна, игра перестанет нажиматься.
     Поэтому смотрим в неё сами: окна закрыты, хаб ушёл со страницы профиля или не открылся - убираем. */
  const t0=Date.now();
  watch=setInterval(()=>{
    if(!frame) return clearInterval(watch);
    let d=null; try{ d=frame.contentDocument; }catch(e){ return closeFrame(); }
    if(!loaded||!d||d.readyState!=='complete') return Date.now()-t0>15000&&closeFrame();
    if(!/embed=profile/.test(d.location.href)) return closeFrame();   // рамку увели со страницы профиля (например, на пустую)
    const ovs=[...d.querySelectorAll('.ov')];
    if(Date.now()-t0>1500&&!ovs.some(o=>!o.hidden&&d.defaultView.getComputedStyle(o).display!=='none')) closeFrame();
  },300);
};
window.addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data||e.data.organika!=='profile-closed'||!frame) return;
  closeFrame();
});
})();
