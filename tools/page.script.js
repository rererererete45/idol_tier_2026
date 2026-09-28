const LB=CFG.LB,MX=CFG.MX;
const T=[["S+",90,100],["S",80,89],["A+",70,79],["A",60,69],["B+",50,59],["B",40,49],["C+",30,39],["C",20,29],["D+",10,19],["D",0,9]];
const ti=s=>T.findIndex(t=>s>=t[1]);
const A=D.map(o=>{const s=o.v.reduce((a,b)=>a+b,0);return Object.assign({},o,{s:s,tier:T[ti(s)][0]})});
A.sort((a,b)=>b.s-a.s);
let pv=null,pr=0;A.forEach((o,i)=>{if(o.s!==pv){pr=i+1;pv=o.s}o.r=pr});

function statusBucket(s){
  if(CFG.country==='JP'){
    if(s.startsWith('해산예정'))return '해산예정';
    if(s.startsWith('활동종료'))return '활동종료';
    return '현역';
  }
  if(s.includes('신인')||s.includes('신생'))return '신인';
  if(s.includes('참고군'))return '참고군';
  if(s.startsWith('활동종료('))return '활동종료';
  if(s.startsWith('현역'))return '현역';
  if(s.includes('재결합')||s.includes('복귀')||s.includes('재개')||s.includes('리부트'))return '재편·복귀';
  return '비정기·휴지';
}
function fvals(o,f){
  if(f.bucket)return [statusBucket(o.status)];
  const v=o[f.key];
  if(v==null||v==='')return [];
  return f.split?String(v).split(f.split).map(s=>s.trim()).filter(Boolean):[String(v)];
}
const FACETS=CFG.facets.map(f=>{
  const m=new Map();
  A.forEach(o=>fvals(o,f).forEach(v=>m.set(v,(m.get(v)||0)+1)));
  const order=f.key==='tier'?T.map(t=>t[0]):f.order;
  let vals=[...m.keys()].sort((a,b)=>m.get(b)-m.get(a));
  if(order)vals=order.filter(v=>m.has(v)).concat(vals.filter(v=>!order.includes(v)));
  return Object.assign({},f,{vals:vals});
});
const F={};FACETS.forEach(f=>F[f.key]='ALL');

const avg=k=>(A.reduce((a,o)=>a+(k<0?o.s:o.v[k]),0)/A.length).toFixed(1);
function statVal(s){
  if(s.t==='count')return A.length+'팀';
  if(s.t==='avgTotal')return avg(-1);
  if(s.t==='avgMetric')return avg(s.i)+' / '+MX[s.i];
  if(s.t==='splus')return A.filter(o=>o.s>=90).length+'팀';
  if(s.t==='distinct')return new Set(A.map(o=>o[s.f])).size+'곳';
  if(s.t==='bucket')return A.filter(o=>statusBucket(o.status)===s.v).length+'팀';
  return '';
}
document.getElementById('stats').innerHTML=CFG.stats.map(s=>'<div class="stat"><p class="k">'+s.k+'</p><p class="v">'+statVal(s)+'</p></div>').join('');

const REDUCE=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!REDUCE)document.querySelectorAll('#stats .v').forEach(el=>{
  const m=el.textContent.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if(!m)return;
  const target=parseFloat(m[1]),suffix=m[2],dec=(m[1].split('.')[1]||'').length,start=performance.now(),dur=700;
  requestAnimationFrame(function step(t){
    const p=Math.min((t-start)/dur,1),eased=1-Math.pow(1-p,3);
    el.textContent=(dec?(target*eased).toFixed(dec):Math.round(target*eased))+suffix;
    if(p<1)requestAnimationFrame(step);
  });
});

let sf=-1,qs='';
document.getElementById('facetRows').innerHTML=FACETS.map(f=>'<div class="pgroup"><span class="plabel">'+esc(f.label)+'</span><div class="pills" data-facet="'+f.key+'"><button class="pill" data-v="ALL" aria-pressed="true">전체</button>'
  +f.vals.map(v=>'<button class="pill" data-v="'+esc(v)+'" aria-pressed="false">'+esc(v)+'</button>').join('')+'</div></div>').join('');
const sp=document.getElementById('sortpills');
sp.innerHTML='<button class="pill" data-s="-1" aria-pressed="true">총점</button>'+LB.map((l,i)=>'<button class="pill" data-s="'+i+'" aria-pressed="false">'+l+'</button>').join('');
if(!REDUCE)document.querySelectorAll('.pill').forEach(b=>{
  b.addEventListener('mousemove',e=>{
    const r=b.getBoundingClientRect();
    b.style.transform='translate('+((e.clientX-r.left-r.width/2)*0.15).toFixed(1)+'px,'+((e.clientY-r.top-r.height/2)*0.25).toFixed(1)+'px)';
  });
  b.addEventListener('mouseleave',()=>{b.style.transform=''});
});

const filterToggle=document.getElementById('filterToggle'),filtersPanel=document.getElementById('filtersPanel');
filterToggle.addEventListener('click',()=>{
  const open=filtersPanel.hidden;
  filtersPanel.hidden=!open;
  filterToggle.setAttribute('aria-expanded',open);
});
function updateFilterBadge(){
  const n=FACETS.filter(f=>F[f.key]!=='ALL').length;
  const b=document.getElementById('filterBadge');
  b.hidden=n===0;
  b.textContent=n;
}
document.getElementById('facetRows').addEventListener('click',e=>{
  const b=e.target.closest('.pill');
  if(!b)return;
  const box=b.closest('.pills');
  F[box.dataset.facet]=b.dataset.v;
  box.querySelectorAll('.pill').forEach(x=>x.setAttribute('aria-pressed',x===b));
  render();
  updateFilterBadge();
});

const ICN='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.6 14.4a.8.8 0 01-1.1.3c-3-1.8-6.7-2.2-11.1-1.2a.8.8 0 11-.3-1.5c4.8-1.1 8.9-.6 12.2 1.4.4.2.5.7.3 1zm1.2-2.7a1 1 0 01-1.3.3c-3.4-2.1-8.6-2.7-12.6-1.5a1 1 0 11-.6-1.9c4.6-1.4 10.3-.7 14.2 1.7.5.3.6.9.3 1.4zm.1-2.8C14 8.6 7.7 8.4 4.1 9.5a1.2 1.2 0 11-.7-2.3C7.6 5.9 14.5 6.2 19 8.8a1.2 1.2 0 01-1.2 2.1z"/></svg>';
const AIC='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 7.2a2.5 2.5 0 00-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.84.43A2.5 2.5 0 002.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 001.76 1.77C5.75 19 12 19 12 19s6.25 0 7.84-.43a2.5 2.5 0 001.76-1.77C22 15.2 22 12 22 12s0-3.2-.4-4.8zM10 15.1V8.9l5.2 3.1-5.2 3.1z"/></svg>';
const CPAL=['#1ed760','#ffa42b','#539df5','#f3727f','#a78bfa','#22d3ee'];
const cmp=new Set();
const CMPMAX=6;
const MOB=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'');
const TGT=MOB?'':' target="_blank" rel="noopener noreferrer"';
const VCHIP=/부분|추가검증|인원변동/;
const namuUrl=o=>'https://namu.wiki/w/'+encodeURIComponent(o.wiki||o.n);

function barsHTML(o){
  return LB.map((l,i)=>{
    const v=o.v[i],p=Math.round(v/MX[i]*100);
    return '<div class="br"><span>'+l+'</span><span class="trk"><span class="fil'+(p>=70?'':' lo')+'" style="width:'+p+'%"></span></span><span>'+v+'</span></div>';
  }).join('');
}
function card(o){
  const nm=encodeURIComponent(o.n);
  const verifychip=VCHIP.test(o.verify)?'<span class="chip mid">'+esc(o.verify)+'</span>':'';
  const stchip=o.status==='현역'?'':'<span class="chip">'+esc(o.status)+'</span>';
  const cmpOn=cmp.has(o.n);
  return '<article class="card" data-slug="'+esc(o.slug)+'"><div class="crow"><button class="cmpbtn'+(cmpOn?' on':'')+'" data-cmp="'+esc(o.n)+'" aria-pressed="'+cmpOn+'" aria-label="비교에 추가">'+(cmpOn?'✓':'+')+'</button><span class="rank">#'+o.r+'</span><h3 class="nm">'+esc(o.n)+'</h3><div class="tot"><span class="n">'+o.s+'</span><span class="u">/ 100</span></div></div>'
   +'<div class="meta"><span class="chip">'+o.tier+'</span>'+verifychip+stchip+'</div>'
   +'<div class="bars">'+barsHTML(o)+'</div>'
   +'<div class="acts"><a class="btn grn"'+TGT+' href="https://open.spotify.com/search/'+nm+'">'+ICN+'Spotify</a>'
   +'<a class="btn out"'+TGT+' href="https://www.youtube.com/results?search_query='+nm+'">'+AIC+'YouTube</a>'
   +'<a class="btn out"'+TGT+' href="'+namuUrl(o)+'">나무위키</a></div></article>';
}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

function render(){
  let list=A.filter(o=>(!qs||o.n.toLowerCase().includes(qs))&&FACETS.every(f=>F[f.key]==='ALL'||fvals(o,f).includes(F[f.key])));
  const board=document.getElementById('board');
  if(!list.length){board.innerHTML='';document.getElementById('empty').hidden=false;return}
  document.getElementById('empty').hidden=true;
  if(sf>=0){
    list=list.slice().sort((a,b)=>b.v[sf]-a.v[sf]||b.s-a.s);
    board.innerHTML='<section class="tsec"><div class="thead"><span class="tbadge t1">'+LB[sf]+'</span><span class="trange">'+LB[sf]+' 점수 높은 순 · 만점 '+MX[sf]+'점</span><span class="tcount">'+list.length+'팀</span></div><div class="grid">'+list.map(card).join('')+'</div></section>';
    return;
  }
  board.innerHTML=T.map((t,x)=>{
    const m=list.filter(o=>ti(o.s)===x);
    if(!m.length)return '';
    return '<section class="tsec"><div class="thead"><span class="tbadge t'+x+'">'+t[0]+'</span><span class="trange">'+t[1]+'~'+t[2]+'점</span><span class="tcount">'+m.length+'팀</span></div><div class="grid">'+m.map(card).join('')+'</div></section>';
  }).join('');
}
sp.addEventListener('click',e=>{const b=e.target.closest('.pill');if(!b)return;sf=+b.dataset.s;
  sp.querySelectorAll('.pill').forEach(x=>x.setAttribute('aria-pressed',x===b));render()});
const qi=document.getElementById('q'),cl=document.getElementById('clr');
qi.addEventListener('input',()=>{qs=qi.value.trim().toLowerCase();cl.style.display=qs?'block':'none';render()});
cl.addEventListener('click',()=>{qi.value='';qs='';cl.style.display='none';qi.focus();render()});

/* ---- 그룹 상세 ---- */
function detailHTML(o){
  const nm=encodeURIComponent(o.n);
  const initial=o.n.trim().charAt(0).toUpperCase();
  const photo='<div class="dpfoto"><span class="ph">'+esc(initial)+'</span>'+(o.img?'<img src="'+esc(o.img)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">':'')+'</div>';
  const verifychip=VCHIP.test(o.verify)?'<span class="chip mid">'+esc(o.verify)+'</span>':'';
  const info=CFG.info.map(([k,key])=>{
    let v=o[key];
    if(key==='members')v=typeof v==='number'?v+'명':v;
    if(v==null||v==='')v='-';
    return '<div class="it"><p class="k">'+esc(k)+'</p><p class="v">'+esc(v)+'</p></div>';
  }).join('');
  const noteParts=(o.note||'').split(' | ');
  const noteText=noteParts.length>1?noteParts.slice(1).join(' | '):'';
  const officialBtn=(o.link&&o.link.startsWith('http'))?'<a class="btn out"'+TGT+' href="'+esc(o.link)+'">공식 링크</a>':'';
  return '<div class="cmphead"><h2>그룹 상세</h2><button class="cmpclose" id="detailClose" aria-label="닫기">✕</button></div>'
    +'<div class="dphead">'+photo
    +'<div class="dpinfo"><h2>'+esc(o.n)+'</h2>'
    +'<div class="dpmeta"><span class="chip">'+o.tier+'</span>'+verifychip+'</div>'
    +'<div class="dpscore"><span class="n">'+o.s+'</span><span class="u">/ 100 · #'+o.r+'</span></div>'
    +(o.img?'<p class="dpsrc">사진 출처: <a href="'+namuUrl(o)+'"'+TGT+'>나무위키</a></p>':'')
    +'</div></div>'
    +'<div class="bars">'+barsHTML(o)+'</div>'
    +'<div class="dpgrid">'+info+'</div>'
    +'<div class="acts">'+officialBtn
    +'<a class="btn grn"'+TGT+' href="https://open.spotify.com/search/'+nm+'">'+ICN+'Spotify</a>'
    +'<a class="btn out"'+TGT+' href="https://www.youtube.com/results?search_query='+nm+'">'+AIC+'YouTube</a>'
    +'<a class="btn out"'+TGT+' href="'+namuUrl(o)+'">나무위키</a></div>'
    +(noteText?'<p class="dpnote">'+esc(noteText)+'</p>':'');
}
function openDetailBySlug(slug){
  const o=A.find(x=>x.slug===slug);
  if(!o)return;
  document.getElementById('detailPanel').innerHTML=detailHTML(o);
  document.getElementById('detailModal').classList.remove('hidden');
  document.getElementById('detailClose').addEventListener('click',closeDetail);
}
function closeDetail(){
  if(history.state&&history.state.slug){history.back()}
  else{document.getElementById('detailModal').classList.add('hidden')}
}
function openDetail(slug){
  if(!A.some(x=>x.slug===slug))return;
  history.pushState({slug:slug},'','#'+slug);
  openDetailBySlug(slug);
}
window.addEventListener('popstate',e=>{
  if(e.state&&e.state.slug){openDetailBySlug(e.state.slug)}
  else{document.getElementById('detailModal').classList.add('hidden')}
});
document.getElementById('detailModal').addEventListener('click',e=>{if(e.target.id==='detailModal')closeDetail()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('detailModal').classList.contains('hidden'))closeDetail()});
document.getElementById('board').addEventListener('click',e=>{
  if(e.target.closest('.cmpbtn')||e.target.closest('.acts'))return;
  const c=e.target.closest('.card');
  if(!c)return;
  openDetail(c.dataset.slug);
});
if(location.hash){
  const initSlug=decodeURIComponent(location.hash.slice(1));
  if(A.some(x=>x.slug===initSlug)){
    history.replaceState({slug:initSlug},'',location.hash);
    openDetailBySlug(initSlug);
  }
}

/* ---- 그룹 비교 모드 ---- */
function setCmpBtn(n,on){
  document.querySelectorAll('.cmpbtn[data-cmp="'+CSS.escape(n)+'"]').forEach(x=>{
    x.classList.toggle('on',on);x.setAttribute('aria-pressed',on);x.textContent=on?'✓':'+';
  });
}
function toggleCmp(n,btn){
  if(cmp.has(n)){cmp.delete(n);setCmpBtn(n,false)}
  else{
    if(cmp.size>=CMPMAX){btn.classList.add('shake');setTimeout(()=>btn.classList.remove('shake'),300);return}
    cmp.add(n);setCmpBtn(n,true);
  }
  renderTray();
}
function renderTray(){
  const tray=document.getElementById('cmptray');
  const list=[...cmp];
  document.body.classList.toggle('has-tray',list.length>0);
  tray.classList.toggle('show',list.length>0);
  document.getElementById('cmpchips').innerHTML=list.map(n=>'<span class="cmpchip"><span>'+esc(n)+'</span><button data-rm="'+esc(n)+'" aria-label="제거">✕</button></span>').join('');
  document.getElementById('cmpOpen').textContent=list.length?'비교 보기 ('+list.length+')':'비교 보기';
  if(!list.length)document.getElementById('cmpmodal').classList.add('hidden');
}
let activeCmp=null;
function polar(cx,cy,r,ang){return [cx+r*Math.cos(ang), cy+r*Math.sin(ang)]}
function buildCmpTable(){
  activeCmp=null;
  const groups=[...cmp].map(n=>A.find(o=>o.n===n)).filter(Boolean);
  const N=LB.length,cx=160,cy=160,R=108;
  const angFor=i=>i*(2*Math.PI/N)-Math.PI/2;
  let svg='<svg class="radar" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">';
  [0.25,0.5,0.75,1].forEach(f=>{
    const pts=Array.from({length:N},(_,i)=>polar(cx,cy,R*f,angFor(i)).join(',')).join(' ');
    svg+='<polygon points="'+pts+'" fill="none" stroke="var(--bd)" stroke-width="1"/>';
  });
  for(let i=0;i<N;i++){
    const ang=angFor(i);
    const [x2,y2]=polar(cx,cy,R,ang);
    svg+='<line x1="'+cx+'" y1="'+cy+'" x2="'+x2+'" y2="'+y2+'" stroke="var(--bd)" stroke-width="1"/>';
    const [lx,ly]=polar(cx,cy,R+22,ang);
    const cv=Math.cos(ang),sv=Math.sin(ang);
    const anchor=Math.abs(cv)<0.001?'middle':(cv>0?'start':'end');
    const dy=sv>0.5?10:(sv<-0.5?-4:4);
    svg+='<text x="'+lx+'" y="'+(ly+dy)+'" text-anchor="'+anchor+'" font-size="11" font-weight="700" fill="var(--tx3)">'+esc(LB[i])+'</text>';
  }
  groups.forEach((g,gi)=>{
    const col=CPAL[gi%CPAL.length];
    const pts=LB.map((l,i)=>polar(cx,cy,R*Math.min(g.v[i]/MX[i],1),angFor(i)).join(',')).join(' ');
    const dots=LB.map((l,i)=>{const [px,py]=polar(cx,cy,R*Math.min(g.v[i]/MX[i],1),angFor(i));return '<circle cx="'+px+'" cy="'+py+'" r="3" fill="'+col+'"/>'}).join('');
    svg+='<g class="rgroup" data-n="'+esc(g.n)+'"><polygon points="'+pts+'" fill="'+col+'" fill-opacity="0.16" stroke="'+col+'" stroke-width="2.5"/>'+dots+'</g>';
  });
  svg+='</svg>';
  const legend=groups.map((g,gi)=>'<button class="legitem" data-n="'+esc(g.n)+'" style="--c:'+CPAL[gi%CPAL.length]+'"><span class="dot"></span>'+esc(g.n)+'<span class="sc">'+g.s+'</span></button>').join('');
  document.getElementById('cmptable').innerHTML='<div class="radarwrap">'+svg+'</div><div class="radarlegend">'+legend+'</div>';
}
function setActiveCmp(n){
  activeCmp=activeCmp===n?null:n;
  document.querySelectorAll('.rgroup').forEach(g=>g.classList.toggle('dim',!!activeCmp&&g.dataset.n!==activeCmp));
  document.querySelectorAll('.legitem').forEach(b=>{
    b.classList.toggle('active',b.dataset.n===activeCmp);
    b.classList.toggle('dim',!!activeCmp&&b.dataset.n!==activeCmp);
  });
}
document.getElementById('cmptable').addEventListener('click',e=>{
  const t=e.target.closest('.rgroup, .legitem');
  if(!t)return;
  setActiveCmp(t.dataset.n);
});
document.getElementById('board').addEventListener('click',e=>{
  const b=e.target.closest('.cmpbtn');
  if(!b)return;
  toggleCmp(b.dataset.cmp,b);
});
document.getElementById('cmpchips').addEventListener('click',e=>{
  const b=e.target.closest('button[data-rm]');
  if(!b)return;
  cmp.delete(b.dataset.rm);setCmpBtn(b.dataset.rm,false);renderTray();
});
document.getElementById('cmpClear').addEventListener('click',()=>{
  [...cmp].forEach(n=>setCmpBtn(n,false));cmp.clear();renderTray();
});
document.getElementById('cmpOpen').addEventListener('click',()=>{
  if(!cmp.size)return;
  buildCmpTable();
  document.getElementById('cmpmodal').classList.remove('hidden');
});
document.getElementById('cmpClose').addEventListener('click',()=>document.getElementById('cmpmodal').classList.add('hidden'));
document.getElementById('cmpmodal').addEventListener('click',e=>{if(e.target.id==='cmpmodal')e.currentTarget.classList.add('hidden')});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('cmpmodal').classList.add('hidden')});

/* ---- 카드 스포트라이트 & 클릭 스파크 ---- */
if(!REDUCE){
  document.getElementById('board').addEventListener('pointermove',e=>{
    const c=e.target.closest('.card');
    if(!c)return;
    const r=c.getBoundingClientRect();
    c.style.setProperty('--mx',(e.clientX-r.left)+'px');
    c.style.setProperty('--my',(e.clientY-r.top)+'px');
  });
  document.addEventListener('click',e=>{
    const t=e.target.closest('.pill, .btn, .cmpbtn, .legitem, .cmpclose');
    if(!t)return;
    const r=t.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
    for(let i=0;i<6;i++){
      const ang=(i/6)*2*Math.PI,s=document.createElement('span');
      s.className='spark';
      s.style.setProperty('--dx',(Math.cos(ang)*26).toFixed(1)+'px');
      s.style.setProperty('--dy',(Math.sin(ang)*26).toFixed(1)+'px');
      s.style.left=cx+'px';s.style.top=cy+'px';
      document.body.appendChild(s);
      s.addEventListener('animationend',()=>s.remove());
    }
  });
}

render();
