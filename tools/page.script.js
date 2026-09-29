const QS=new URLSearchParams(location.search);
const TUNE=QS.get('tune')==='1';
const LB=CFG.LB,MX=CFG.MX;
const T=[["S+",90,100],["S",80,89],["A+",70,79],["A",60,69],["B+",50,59],["B",40,49],["C+",30,39],["C",20,29],["D+",10,19],["D",0,9]];
const ti=s=>T.findIndex(t=>s>=t[1]);
const A=D.map(o=>{const s=o.v.reduce((a,b)=>a+b,0);return Object.assign({},o,{s:s,tier:T[ti(s)][0]})});
const MI=CFG.country==='KR'?5:4; // 현재기세 항목 위치
A.sort((a,b)=>b.s-a.s||b.v[MI]-a.v[MI]||String(a.id).localeCompare(String(b.id)));
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

/* ---- 미니/상세 레이더: 항목별 만점 대비 0~100 정규화(총점 축은 넣지 않는다) ---- */
const TIER_COLORS={'S+':'#1ed760','S':'#36e0a0','A+':'#22d3ee','A':'#38a8f8','B+':'#5b8def','B':'#7c7cf0','C+':'#a78bfa','C':'#b592e8','D+':'#8b95a7','D':'#5f6b7d'};
const tierClr=o=>TIER_COLORS[o.tier]||'#7c7c7c';
const normVals=o=>LB.map((l,i)=>Math.max(0,Math.min(1,o.v[i]/MX[i])));
function polar(cx,cy,r,ang){return [cx+r*Math.cos(ang), cy+r*Math.sin(ang)]}
function miniRadarSVG(o){
  const N=LB.length,cx=32,cy=32,R=24,col=tierClr(o),ang=i=>i*(2*Math.PI/N)-Math.PI/2,nv=normVals(o);
  let svg='<svg viewBox="0 0 64 64" role="img" aria-label="'+esc(o.n)+' 능력치: '+LB.map((l,i)=>l+' '+Math.round(nv[i]*100)).join(', ')+'">';
  [0.5,1].forEach(f=>{svg+='<polygon points="'+Array.from({length:N},(_,i)=>polar(cx,cy,R*f,ang(i)).map(v=>v.toFixed(1)).join(',')).join(' ')+'" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1"/>'});
  const pts=nv.map((v,i)=>polar(cx,cy,R*Math.max(0.05,v),ang(i)).map(x=>x.toFixed(1)).join(',')).join(' ');
  return svg+'<polygon points="'+pts+'" fill="'+col+'" fill-opacity="0.32" stroke="'+col+'" stroke-width="1.6"/></svg>';
}
function bigRadarSVG(o){
  const N=LB.length,cx=110,cy=104,R=78,col=tierClr(o),ang=i=>i*(2*Math.PI/N)-Math.PI/2,nv=normVals(o);
  let svg='<svg viewBox="0 0 220 220" role="img" aria-label="'+esc(o.n)+' 능력치: '+LB.map((l,i)=>l+' '+Math.round(nv[i]*100)).join(', ')+'">';
  [0.33,0.66,1].forEach(f=>{svg+='<polygon points="'+Array.from({length:N},(_,i)=>polar(cx,cy,R*f,ang(i)).map(v=>v.toFixed(1)).join(',')).join(' ')+'" fill="none" stroke="var(--bd)" stroke-width="1"/>'});
  for(let i=0;i<N;i++){
    const [x2,y2]=polar(cx,cy,R,ang(i));
    svg+='<line x1="'+cx+'" y1="'+cy+'" x2="'+x2.toFixed(1)+'" y2="'+y2.toFixed(1)+'" stroke="var(--bd)" stroke-width="1"/>';
    const [lx,ly]=polar(cx,cy,R+18,ang(i)),cv=Math.cos(ang(i)),sv=Math.sin(ang(i));
    const anchor=Math.abs(cv)<0.05?'middle':(cv>0?'start':'end'),dy=sv>0.5?9:(sv<-0.5?-3:4);
    svg+='<text x="'+lx.toFixed(1)+'" y="'+(ly+dy).toFixed(1)+'" text-anchor="'+anchor+'" font-size="11" font-weight="700" fill="var(--tx3)">'+esc(LB[i])+'</text>';
  }
  const pts=nv.map((v,i)=>polar(cx,cy,R*Math.max(0.04,v),ang(i)).map(x=>x.toFixed(1)).join(',')).join(' ');
  return svg+'<polygon points="'+pts+'" fill="'+col+'" fill-opacity="0.22" stroke="'+col+'" stroke-width="2.5"/></svg>';
}
function styleLine(o){return (o.style||'').split('/').map(s=>s.trim()).filter(Boolean).slice(0,3).join(' · ')}
let HD3=null; // 최근 3개월(4개 snapshot) 순위 변동. 없으면 표시하지 않는다
function trendText(o){
  if(!HD3)return '';
  const d=HD3[o.id];
  if(!d)return '';
  if(d.kind==='up')return '최근 3개월 ▲'+d.n;
  if(d.kind==='down')return '최근 3개월 ▼'+d.n;
  if(d.kind==='new')return '최근 3개월 NEW';
  if(d.kind==='same')return '최근 3개월 –';
  return '';
}

function barsHTML(o){
  return LB.map((l,i)=>{
    const v=o.v[i],p=Math.round(v/MX[i]*100);
    return '<div class="br"><span>'+l+'</span><span class="trk"><span class="fil'+(p>=70?'':' lo')+'" style="width:'+p+'%"></span></span><span>'+v+'</span></div>';
  }).join('');
}
let HD=null; // 전월 대비 순위 변동(id -> delta). 로딩 전/실패 시 null
function rkBadge(o){return HD&&window.RankHistory?RankHistory.renderRankDeltaBadge(HD[o.id]):''}
// RankingProfileRow: 큰 아이콘 카드 대신 한 줄 프로필 바. 사진은 식별 정보이고 순위·티어·점수·능력치가 콘텐츠다.
function card(o){
  const cmpOn=cmp.has(o.n);
  const fav=!!(window.IdolMatch&&IdolMatch.isFavorite(CFG.country,o.id));
  const initial=o.n.trim().charAt(0).toUpperCase();
  const photo='<span class="rphoto">'+esc(initial)+(o.img?'<img src="'+esc(o.img)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'')+'</span>';
  const line2=[styleLine(o),trendText(o)].filter(Boolean).join('  ·  ');
  return '<article class="card" tabindex="0" data-slug="'+esc(o.slug)+'">'
   +'<button class="cmpbtn'+(cmpOn?' on':'')+'" data-cmp="'+esc(o.n)+'" aria-pressed="'+cmpOn+'" aria-label="비교에 추가">'+(cmpOn?'✓':'+')+'</button>'
   +'<span class="rankcol"><span class="rank">#'+o.r+'</span><span class="rkslot">'+rkBadge(o)+'</span></span>'
   +photo
   +'<div class="rbody"><p class="rline1"><span class="nm">'+esc(o.n)+'</span><span class="rtier" style="color:'+tierClr(o)+'">'+esc(o.tier)+'</span></p>'
   +(line2?'<p class="rline2">'+esc(line2)+'</p>':'')+'</div>'
   +'<span class="rradar">'+miniRadarSVG(o)+'</span>'
   +'<span class="rscorecol"><span class="tot"><span class="n">'+o.s+'</span><span class="u">/100</span></span>'
   +(window.IdolMatch?'<button type="button" class="favmini" data-fav="'+esc(o.id)+'" aria-pressed="'+fav+'" aria-label="'+esc(o.n)+' 최애 '+(fav?'해제':'저장')+'">'+(fav?'♥':'♡')+'</button>':'')+'</span>'
   +'</article>';
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
    if(key==='songs'&&o.tracks&&o.tracks.length){
      return '<div class="it wide"><p class="k">'+esc(k)+' · Spotify</p><p class="v tracks">'+o.tracks.map(t=>'<a class="trklink"'+TGT+' href="'+esc(t[1])+'">'+ICN+esc(t[0])+'</a>').join('')+'</p></div>';
    }
    if(v==null||v==='')v='-';
    return '<div class="it"><p class="k">'+esc(k)+'</p><p class="v">'+esc(v)+'</p></div>';
  }).join('');
  const noteParts=(o.note||'').split(' | ');
  const noteText=noteParts.length>1?noteParts.slice(1).join(' | '):'';
  const officialBtn=(o.link&&o.link.startsWith('http'))?'<a class="btn out"'+TGT+' href="'+esc(o.link)+'">공식 링크</a>':'';
  const isFav=window.IdolMatch&&IdolMatch.isFavorite(CFG.country,o.n);
  const order=[...document.querySelectorAll('#board .card')].map(c=>c.dataset.slug),oi=order.indexOf(o.slug);
  const nav=oi>=0&&order.length>1?'<span class="dcount" aria-live="polite">'+(oi+1)+' / '+order.length+'</span><button class="cmpclose navbtn" id="dPrev" aria-label="이전 그룹" '+(oi<=0?'disabled':'')+' data-slug="'+esc(order[oi-1]||'')+'">‹</button><button class="cmpclose navbtn" id="dNext" aria-label="다음 그룹" '+(oi>=order.length-1?'disabled':'')+' data-slug="'+esc(order[oi+1]||'')+'">›</button>':'';
  return '<div class="cmphead"><h2>그룹 상세</h2><div class="headact">'+nav+'<button class="favbtn" id="favBtn" aria-pressed="'+!!isFav+'" aria-label="'+esc(o.n)+' 최애로 저장">'+(isFav?'♥ 최애':'♡ 최애')+'</button><button class="cmpclose" id="dShare" aria-label="이 그룹 링크 공유">🔗</button><button class="cmpclose" id="detailClose" aria-label="닫기">✕</button></div></div>'
    +'<div class="dphead">'+photo
    +'<div class="dpinfo"><h2>'+esc(o.n)+'</h2>'
    +'<div class="dpmeta"><span class="chip">'+o.tier+'</span>'+verifychip+'</div>'
    +'<div class="dpscore"><span class="n">'+o.s+'</span><span class="u">/ 100 · #'+o.r+'</span>'+rkBadge(o)+'</div>'
    +'<a class="maplink" href="map?country='+CFG.country+'&group='+encodeURIComponent(o.n)+'">IDOL MAP에서 위치 보기 →</a>'
    +(o.img?'<p class="dpsrc">사진 출처: <a href="'+(o.imgpage?esc(o.imgpage):namuUrl(o))+'"'+TGT+'>'+(o.imgpage?'공식 사이트':'나무위키')+'</a></p>':'')
    +'</div></div>'
    +'<nav class="djump" aria-label="상세 섹션 바로가기"><button type="button" data-jump="scenebox">🧬 비슷한 '+(CFG.country==='KR'?'한국':'일본')+' 그룹</button><button type="button" data-jump="matchbox">'+CFG.other.label+' 취향</button><button type="button" data-jump="histbox">📈 순위 추이</button></nav>'
    +'<div class="dpradar">'+bigRadarSVG(o)+'</div>'
    +'<div class="bars">'+barsHTML(o)+'</div>'
    +'<div class="dpgrid">'+info+'</div>'
    +((o.intro||o.editor)?'<div class="dpedit">'
      +(o.intro?'<p class="dpedit-v">'+esc(o.intro)+'</p>':'')
      +(o.editor?'<p class="dpedit-k">에디터 코멘트</p><p class="dpedit-v">'+esc(o.editor)+'</p>':'')
      +'</div>':'')
    +'<div class="acts">'+officialBtn
    +'<a class="btn grn"'+TGT+' href="https://open.spotify.com/search/'+nm+'">'+ICN+'Spotify</a>'
    +'<a class="btn out"'+TGT+' href="https://www.youtube.com/results?search_query='+nm+'">'+AIC+'YouTube</a>'
    +'<a class="btn out"'+TGT+' href="'+namuUrl(o)+'">나무위키</a></div>'
    +(noteText?'<p class="dpnote">'+esc(noteText)+'</p>':'')
    +'<section class="scenebox" id="scenebox" data-n="'+esc(o.n)+'"></section>'
    +'<section class="matchbox" id="matchbox" data-n="'+esc(o.n)+'"><h3 class="mtitle">'+flagB(CFG.other.code)+' '+CFG.other.label+'에서 비슷한 취향 찾기</h3><p class="mnote">불러오는 중…</p></section>'
    +'<section class="histbox" id="histbox" data-id="'+esc(o.id)+'"></section>';
}
function openDetailBySlug(slug){
  const o=A.find(x=>x.slug===slug);
  if(!o)return;
  document.getElementById('detailPanel').innerHTML=detailHTML(o);
  document.body.setAttribute('data-nav-group',o.n);
  document.getElementById('detailModal').classList.remove('hidden');
  document.getElementById('detailClose').addEventListener('click',closeDetail);
  const fb=document.getElementById('favBtn');
  fb.addEventListener('click',()=>{toggleFavById(o.id,o.n)});
  ['dPrev','dNext'].forEach(id=>{const b=document.getElementById(id);if(b)b.addEventListener('click',()=>stepDetail(b.dataset.slug))});
  document.getElementById('dShare').addEventListener('click',()=>shareGroup(o));
  document.querySelector('.djump').addEventListener('click',e=>{const j=e.target.closest('[data-jump]');if(!j)return;const t=document.getElementById(j.dataset.jump);if(t&&!t.hidden)t.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})});
  renderMatchSection(o);
  if(window.SameScene)SameScene.render(document.getElementById('scenebox'),{country:CFG.country,name:o.n,id:o.id,onOpen:sceneOpen});
  if(window.RankHistory)RankHistory.renderDetail(document.getElementById('histbox'),{country:CFG.country,id:o.id,name:o.n});
}
// SAME SCENE 카드에서 다른 그룹 상세로: 기록을 쌓지 않고 모달 내용만 바꾼다.
function toggleFavById(id,name){
  if(!window.IdolMatch)return;
  const o=A.find(x=>x.id===id),on=IdolMatch.saveFavorite(CFG.country,id);
  const nm=name||(o&&o.n)||id;
  document.querySelectorAll('.favmini[data-fav="'+CSS.escape(id)+'"]').forEach(b=>{b.setAttribute('aria-pressed',on);b.textContent=on?'♥':'♡';b.setAttribute('aria-label',nm+' 최애 '+(on?'해제':'저장'))});
  const fb=document.getElementById('favBtn');
  if(fb&&document.querySelector('.dpinfo h2')&&document.querySelector('.dpinfo h2').textContent===nm){fb.setAttribute('aria-pressed',on);fb.textContent=on?'♥ 최애':'♡ 최애'}
  updateFavbar();
  if(window.__toast)window.__toast(on?'♥ '+nm+' 최애에 저장했어요':nm+' 최애에서 뺐어요');
}
function stepDetail(slug){
  if(!slug)return;
  history.replaceState({slug:slug,pushed:history.state&&history.state.pushed?1:0},'','#'+slug);
  openDetailBySlug(slug);
  let n=document.getElementById('detailPanel');
  while(n){if(n.scrollHeight>n.clientHeight+1&&getComputedStyle(n).overflowY!=='visible'){n.scrollTop=0;break}n=n.parentElement}
}
function shareGroup(o){
  const url=location.href.split(/[?#]/)[0]+'?id='+encodeURIComponent(o.id)+'&group='+encodeURIComponent(o.n),text=o.n+' · '+o.tier+' '+o.s+'점 (#'+o.r+')';
  if(navigator.share){navigator.share({title:o.n,text:text,url:url}).catch(()=>{});return}
  const done=()=>{if(window.__toast)window.__toast('링크를 복사했어요')};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(url).then(done).catch(()=>window.prompt('복사해서 공유하세요',url));
  else window.prompt('복사해서 공유하세요',url);
}
function sceneOpen(name){
  const t=A.find(x=>x.n===name);
  if(!t)return;
  history.replaceState({slug:t.slug,pushed:history.state&&history.state.pushed?1:0},'','#'+t.slug);
  openDetailBySlug(t.slug);
  let n=document.getElementById('detailPanel');
  while(n){if(n.scrollHeight>n.clientHeight+1&&getComputedStyle(n).overflowY!=='visible'){n.scrollTop=0;break}n=n.parentElement}
}
function closeDetail(){
  // 카드를 눌러 우리가 push 한 기록이면 한 칸만 뒤로, 딥링크로 열었다면 기록을 건드리지 않고 닫는다.
  if(history.state&&history.state.pushed){history.back()}
  else{
    document.getElementById('detailModal').classList.add('hidden');
    document.body.removeAttribute('data-nav-group');
    if(location.hash||QS.get('group'))history.replaceState(null,'',location.pathname);
    restoreFocus();
  }
}
let lastCardSlug=null;
function restoreFocus(){
  if(!lastCardSlug)return;
  const c=document.querySelector('#board .card[data-slug="'+CSS.escape(lastCardSlug)+'"]');
  if(c)c.focus({preventScroll:true});
}
function openDetail(slug){
  lastCardSlug=slug;
  if(!A.some(x=>x.slug===slug))return;
  history.pushState({slug:slug,pushed:1},'','#'+slug);
  openDetailBySlug(slug);
}
window.addEventListener('popstate',e=>{
  if(e.state&&e.state.slug){openDetailBySlug(e.state.slug)}
  else{document.getElementById('detailModal').classList.add('hidden');document.body.removeAttribute('data-nav-group');restoreFocus()}
});
document.getElementById('detailModal').addEventListener('click',e=>{if(e.target.id==='detailModal')closeDetail()});
document.addEventListener('keydown',e=>{
  const open=!document.getElementById('detailModal').classList.contains('hidden');
  if(e.key==='Escape'&&open)closeDetail();
  if(open&&(e.key==='ArrowLeft'||e.key==='ArrowRight')&&!/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')&&!e.altKey&&!e.ctrlKey&&!e.metaKey){
    const b=document.getElementById(e.key==='ArrowLeft'?'dPrev':'dNext');
    if(b&&!b.disabled){e.preventDefault();stepDetail(b.dataset.slug)}
  }
});
document.getElementById('board').addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('card')){e.preventDefault();lastCardSlug=e.target.dataset.slug;openDetail(e.target.dataset.slug)}
});
document.getElementById('board').addEventListener('click',e=>{
  const fm=e.target.closest('.favmini');
  if(fm){toggleFavById(fm.dataset.fav);return}
  if(e.target.closest('.cmpbtn')||e.target.closest('.acts'))return;
  const c=e.target.closest('.card');
  if(!c)return;
  openDetail(c.dataset.slug);
});
const qGroup=QS.get('group'),qId=QS.get('id');
if(qGroup||qId){
  const t=(qId&&A.find(x=>x.id===qId))||A.find(x=>x.n===qGroup||x.slug===qGroup);
  if(t){
    history.replaceState({slug:t.slug},'',location.pathname+'#'+t.slug);
    openDetailBySlug(t.slug);
  }
}else if(location.hash){
  const initSlug=decodeURIComponent(location.hash.slice(1));
  if(A.some(x=>x.slug===initSlug)){
    history.replaceState({slug:initSlug},'',location.hash);
    openDetailBySlug(initSlug);
  }
}

/* ---- IDOL MATCH ---- */
const MEDALS=['🥇','🥈','🥉','4','5'];
function flagB(c){return '<span class="flagb flag-'+c.toLowerCase()+'">'+c+'</span>'}
const INC_KEY='idolMatchIncludeEnded';
const includeEnded=()=>{try{return localStorage.getItem(INC_KEY)==='1'}catch(e){return false}};
const setIncludeEnded=v=>{try{localStorage.setItem(INC_KEY,v?'1':'0')}catch(e){}};
const AXES=[['popularity','대중성'],['fandom','팬덤'],['live','라이브'],['digital','디지털'],['momentum','기세']];
const WLABEL={style:'스타일',live:'라이브',fandom:'팬덤',popularity:'대중성',digital:'디지털',momentum:'기세',activity:'활동형태'};
function matchUrl(g){return CFG.other.page+'?id='+encodeURIComponent(g.id)+'&group='+encodeURIComponent(g.name)}
const DEBUGM=QS.get('debugMatch')==='1';
const NOPROB='추천 알고리즘의 상대 유사도 점수이며 확률이 아닙니다.';
const v100=v=>v==null?0:v;
const MPAL=['#f3727f','#ffa42b','#539df5','#a78bfa','#22d3ee','#e879f9'];
function tasteRadar(a,an,items){
  const N=AXES.length,cx=130,cy=126,R=78,ang=i=>i*(2*Math.PI/N)-Math.PI/2;
  let svg='<svg class="mradar" viewBox="0 0 260 252" role="img" aria-label="취향 프로필 비교 차트">';
  [0.5,1].forEach(f=>{svg+='<polygon points="'+AXES.map((_,i)=>polar(cx,cy,R*f,ang(i)).join(',')).join(' ')+'" fill="none" stroke="var(--bd)" stroke-width="1"/>'});
  AXES.forEach(([k,l],i)=>{
    const [x,y]=polar(cx,cy,R,ang(i)),[lx,ly]=polar(cx,cy,R+18,ang(i)),cv=Math.cos(ang(i));
    svg+='<line x1="'+cx+'" y1="'+cy+'" x2="'+x+'" y2="'+y+'" stroke="var(--bd)" stroke-width="1"/><text x="'+lx+'" y="'+(ly+4)+'" text-anchor="'+(Math.abs(cv)<0.01?'middle':cv>0?'start':'end')+'" font-size="10.5" font-weight="700" fill="var(--tx3)">'+l+'</text>';
  });
  const pts=v=>AXES.map(([k],i)=>polar(cx,cy,R*Math.max(0.03,v100(v[k])/100),ang(i)).join(',')).join(' ');
  items.forEach((it,i)=>{const c=MPAL[i%MPAL.length];svg+='<g class="rgroup" data-i="'+i+'"><polygon points="'+pts(it.vec)+'" fill="'+c+'" fill-opacity="0.14" stroke="'+c+'" stroke-width="2"/></g>'});
  svg+='<polygon points="'+pts(a)+'" fill="#1ed760" fill-opacity="0.22" stroke="#1ed760" stroke-width="3"/></svg>';
  const leg='<span class="mleg-me"><span style="color:var(--green)">●</span> '+esc(an)+' (내 선택)</span>'
    +items.map((it,i)=>'<button type="button" class="legitem" data-i="'+i+'" style="--c:'+MPAL[i%MPAL.length]+'" aria-pressed="false" aria-label="'+esc(it.name)+' 강조해서 보기"><span class="dot"></span>'+esc(it.name)+'<span class="sc">'+it.score+'</span></button>').join('');
  return '<div class="mradarwrap">'+svg+'<div class="mleglist">'+leg+'</div></div>';
}
function mprofHighlight(box,i){
  const cur=box.dataset.hl===String(i)?'':String(i);
  box.dataset.hl=cur;
  box.querySelectorAll('.mradar .rgroup').forEach(g=>g.classList.toggle('dim',cur!==''&&g.dataset.i!==cur));
  box.querySelectorAll('.mprof .legitem').forEach(b=>{
    const on=b.dataset.i===cur;
    b.classList.toggle('active',on);b.classList.toggle('dim',cur!==''&&!on);b.setAttribute('aria-pressed',on);
  });
}
function matchCard(m,i){
  const g=m.group,label=esc(g.name);
  const sp=g.spotify?'<a class="btn grn"'+TGT+' href="'+esc(g.spotify)+'" aria-label="'+label+' Spotify에서 듣기">Spotify ▶</a>':'';
  const bd=(TUNE||DEBUGM)?'<p class="mlog">'+Object.keys(m.breakdown).map(k=>k+' '+(m.breakdown[k]==null?'—':Math.round(m.breakdown[k]))).join(' · ')+'</p>':'';
  const dbg=DEBUGM&&m.debug?'<pre class="mlog dbgm">'+esc('가중치(재정규화 전) '+JSON.stringify(m.debug.usedWeights)+'\n결측 '+JSON.stringify(m.debug.missing)+' · coverage '+m.debug.coverage+' · confidence '+m.debug.confidence+'\n보정점수 '+m.debug.rankingScore+' · 다양성 감점 '+m.debug.diversityPenalty+' · tie-break '+m.debug.tieBreak+(m.bestFavorite?'\n가장 잘 맞는 최애 '+m.bestFavorite.name:''))+'</pre>':'';
  const flags=(m.limited?'<span class="chip mid" title="데이터가 일부 부족하거나 검증이 덜 된 그룹이에요">데이터 제한</span> ':'')+(m.relaxed?'<span class="chip" title="기준을 조금 낮춰 고른 취향 확장 후보예요">취향 확장</span> ':'')+'<span class="mconf" title="결과 신뢰도(데이터 완성도×검증상태)">신뢰도 '+m.confidenceLabel+'</span>';
  return '<article class="mcard"><div class="mtop"><span class="mmedal" aria-hidden="true">'+MEDALS[i]+'</span><div class="mname">'+label+'</div><div class="mpct" title="'+NOPROB+'" aria-label="유사도 '+m.score+'점. '+NOPROB+'"><b>'+m.score+'</b><span>MATCH</span></div></div>'
    +'<p class="mtags">'+esc(m.tags.join(' · '))+'</p><p class="mreason">'+esc(m.reasons.join('. '))+'</p><p class="mflags">'+flags+'</p>'+bd+dbg
    +'<div class="mact"><a class="btn out" href="'+matchUrl(g)+'" aria-label="'+label+' 상세보기">상세보기</a>'+sp+'</div></article>';
}
function gemRow(m){
  return '<div class="mgem"><div class="mname">'+esc(m.group.name)+'</div><div class="gp" title="'+NOPROB+'" aria-label="유사도 '+m.score+'점">'+m.score+'<small>MATCH</small></div><a class="mlink" href="'+matchUrl(m.group)+'" aria-label="'+esc(m.group.name)+' 상세보기">상세보기</a></div>';
}
function tuneHTML(){
  const w=IdolMatch.getWeights();
  return '<details class="mtune" open><summary>튜닝 (관리용)</summary>'+Object.keys(WLABEL).map(k=>'<label class="mrow">'+WLABEL[k]+'<input type="range" min="0" max="100" value="'+Math.round(w[k]*100)+'" data-w="'+k+'"><output>'+Math.round(w[k]*100)+'</output></label>').join('')
    +'<button class="mshare" type="button" id="tuneReset">기본값으로</button><p class="mnote">가중치는 합이 100%가 되도록 자동 정규화되며, 각 카드 아래에 항목별 유사도 로그가 표시됩니다(콘솔에도 출력).</p></details>';
}
function matchBody(o,r){
  let h='<div class="mctl"><label class="mchk"><input type="checkbox" id="incEnded"'+(includeEnded()?' checked':'')+'> 활동종료 그룹 포함</label><span class="mbtns"><a class="mshare" href="map?country='+CFG.country+'&group='+encodeURIComponent(o.n)+'&match=1">지도에서 보기</a> <button class="mshare" type="button" id="shareBtn">결과 공유</button></span></div>'
    +(r.notice?'<p class="mnote" style="margin:0 0 10px;color:var(--warn)">'+esc(r.notice)+'</p>':'')
    +'<div class="mlist">'+r.top.map(matchCard).join('')+'</div>';
  if(!r.top.length)h+='<p class="mnote">기준을 통과한 비슷한 팀이 아직 없어요.</p>';
  if(r.hidden.length)h+='<p class="mgemt">💎 숨은 취향 발견</p><div class="mlist">'+r.hidden.map(gemRow).join('')+'</div>';
  const cmpItems=r.top.concat(r.hidden).map(m=>({name:m.group.name,vec:m.group.vec,score:m.score}));
  if(cmpItems.length)h+='<details class="mprof"><summary>취향 프로필 비교 보기 ('+cmpItems.length+'팀)</summary>'+tasteRadar(r.source.vec,o.n,cmpItems)+'<p class="mnote">추천된 그룹(TOP 3 + 숨은 취향)을 모두 겹쳐 보여줘요. 이름을 누르면 그 그룹만 강조돼요. 각 축은 해당 나라 안에서의 상대 위치(백분위)예요.</p></details>';
  return h+'<p class="mnote">스타일·라이브·팬덤·대중성 성향을 각 시장 안에서의 상대 위치(백분위)로 비교한 취향 유사도예요. MATCH 숫자는 '+NOPROB+' 총점 비교가 아니에요. 데이터가 없는 항목은 계산에서 빼고 남은 항목만으로 다시 가중했어요.</p>';
}
function shareMatches(o,r,btn){
  const base=location.href.split(/[?#]/)[0],url=base+'?id='+encodeURIComponent(o.id)+'&group='+encodeURIComponent(o.n);
  const text=o.n+'와(과) 비슷한 '+CFG.other.label+' 아이돌: '+r.top.map(m=>m.group.name+' (유사도 '+m.score+')').join(', ');
  if(navigator.share){navigator.share({title:'IDOL MATCH',text:text,url:url}).catch(()=>{});return}
  const done=()=>{const t=btn.textContent;btn.textContent='링크 복사됨 ✓';setTimeout(()=>{btn.textContent=t},1600)};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text+'\n'+url).then(done).catch(()=>window.prompt('복사해서 공유하세요',text+' '+url));
  else window.prompt('복사해서 공유하세요',text+' '+url);
}
function renderMatchSection(o){
  const box=document.getElementById('matchbox');
  if(!box)return;
  if(!window.IdolMatch){box.innerHTML='';return}
  IdolMatch.ready.then(()=>{
    if(!box.isConnected||box.dataset.n!==o.n)return;
    box.innerHTML='<h3 class="mtitle">'+flagB(CFG.other.code)+' '+CFG.other.label+'에서 비슷한 취향 찾기</h3>'+(TUNE?tuneHTML():'')+'<div id="mbody"></div>';
    let last=null;
    const paint=()=>{
      const r=IdolMatch.getMatches(CFG.country,o.n,{includeEnded:includeEnded()});
      last=r;
      box.querySelector('#mbody').innerHTML=r&&r.top.length?matchBody(o,r):'<p class="mnote">추천 결과가 없어요.</p>';
      if((TUNE||DEBUGM)&&r)console.table(r.top.map(m=>Object.assign({group:m.group.name,score:m.score,coverage:+m.coverage.toFixed(2),confidence:+m.confidence.toFixed(2)},m.breakdown)));
    };
    paint();
    box.addEventListener('change',e=>{if(e.target.id==='incEnded'){setIncludeEnded(e.target.checked);paint()}});
    box.addEventListener('click',e=>{
      const sh=e.target.closest('#shareBtn');
      if(sh&&last)shareMatches(o,last,sh);
      const hl=e.target.closest('.mprof .legitem, .mprof .rgroup');
      if(hl)mprofHighlight(box,hl.dataset.i);
      if(e.target.id==='tuneReset'){IdolMatch.resetWeights();box.querySelector('.mtune').outerHTML=tuneHTML();paint()}
    });
    box.addEventListener('input',e=>{
      if(!e.target.dataset.w)return;
      const w={};
      box.querySelectorAll('input[data-w]').forEach(i=>{w[i.dataset.w]=+i.value;i.nextElementSibling.textContent=i.value});
      IdolMatch.setWeights(w);paint();
    });
  }).catch(()=>{if(box.isConnected)box.innerHTML='<p class="mnote">추천 데이터를 불러오지 못했어요.</p>'});
}
function myFavs(){return window.IdolMatch?IdolMatch.getFavorites().filter(f=>f.country===CFG.country):[]}
function updateFavbar(){
  const bar=document.getElementById('favbar'),f=myFavs();
  bar.hidden=f.length<2;
  if(f.length<2)return;
  document.getElementById('favtext').innerHTML='<b>♥</b> 내 최애 '+f.length+'팀';
  document.getElementById('favGo').textContent='내 취향으로 '+CFG.other.label+' 아이돌 찾기';
}
document.getElementById('favGo').addEventListener('click',()=>{
  const f=myFavs();
  if(f.length<2)return;
  IdolMatch.ready.then(()=>{
    const r=IdolMatch.getFavoriteMatches(f,CFG.other.code,5,includeEnded());
    if(!r)return;
    document.getElementById('detailPanel').innerHTML='<div class="cmphead"><h2>내 취향으로 찾기</h2><div class="headact"><button class="cmpclose" id="detailClose" aria-label="닫기">✕</button></div></div>'
      +'<div class="favchips">'+r.groups.map(g=>'<span class="chip">♥ '+esc(g.name)+'</span>').join('')+'</div>'
      +(r.clusters?'<p class="mnote" style="margin:8px 0 0">최애가 서로 다른 두 취향으로 나뉘어서, 취향별로 따로 추천해요.</p>'+r.clusters.map(c=>'<h3 class="mtitle" style="margin-top:16px">'+esc(c.label)+'<span class="sub2">'+c.groups.map(g=>esc(g.name)).join(' · ')+'</span></h3><div class="mlist">'+c.matches.map(matchCard).join('')+'</div>').join('')
        :'<h3 class="mtitle">'+flagB(CFG.other.code)+' '+CFG.other.label+' 아이돌 TOP 5</h3><div class="mlist">'+r.matches.map(matchCard).join('')+'</div>')
      +'<p class="mnote">후보마다 (가장 잘 맞는 최애 0.55 + 상위 2개 평균 0.45)로 계산해서, 서로 다른 최애를 평균내 엉뚱한 중간 취향으로 뭉개지 않아요. MATCH 숫자는 '+NOPROB+(includeEnded()?'':' (활동종료 그룹 제외)')+'</p>';
    document.getElementById('detailModal').classList.remove('hidden');
    document.getElementById('detailClose').addEventListener('click',()=>document.getElementById('detailModal').classList.add('hidden'));
  });
});
document.getElementById('favClear').addEventListener('click',()=>{IdolMatch.clearFavorites(CFG.country);updateFavbar()});
window.addEventListener('storage',updateFavbar);
window.addEventListener('idolfav',()=>{
  updateFavbar();
  document.querySelectorAll('.favmini').forEach(b=>{const on=IdolMatch.isFavorite(CFG.country,b.dataset.fav);b.setAttribute('aria-pressed',on);b.textContent=on?'♥':'♡'});
});
if(window.IdolMatch)IdolMatch.ready.then(()=>{document.querySelectorAll('.favmini').forEach(b=>{const on=IdolMatch.isFavorite(CFG.country,b.dataset.fav);b.setAttribute('aria-pressed',on);b.textContent=on?'♥':'♡'});updateFavbar()});
updateFavbar();

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
  document.getElementById('cmptable').innerHTML='<div class="radarwrap">'+svg+'</div><div class="radarlegend">'+legend+'</div><div id="cmptrend"></div>';
  if(window.RankHistory)RankHistory.renderCompareTrend(document.getElementById('cmptrend'),CFG.country,groups.map((g,gi)=>({id:g.id,name:g.n,color:CPAL[gi%CPAL.length]})));
}
function setActiveCmp(n){
  activeCmp=activeCmp===n?null:n;
  document.querySelectorAll('#cmptable .rgroup').forEach(g=>g.classList.toggle('dim',!!activeCmp&&g.dataset.n!==activeCmp));
  document.querySelectorAll('#cmptable .legitem').forEach(b=>{
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
if(QS.get('compare')){
  QS.get('compare').split(',').map(x=>x.trim()).forEach(n=>{if(A.some(o=>o.n===n)&&!cmp.has(n)&&cmp.size<CMPMAX)cmp.add(n)});
  if(cmp.size>=2){
    render();renderTray();buildCmpTable();
    document.getElementById('cmpmodal').classList.remove('hidden');
  }
}

/* ---- 순위 변동(월별 history): 현재월+이전월 snapshot 만 먼저 읽어 카드의 ▲▼NEW 를 계산한다. 실패하면 기존 화면 그대로. ---- */
if(window.RankHistory){
  RankHistory.loadDeltas(CFG.country).then(m=>{
    if(!m){document.getElementById('board').classList.add('nohist');return}
    HD=m;render();
    const open=document.getElementById('detailModal');
    if(!open.classList.contains('hidden')){const cur=A.find(x=>x.n===document.body.getAttribute('data-nav-group'));if(cur){const s=document.querySelector('.dpscore');if(s&&!s.querySelector('.rkd'))s.insertAdjacentHTML('beforeend',rkBadge(cur))}}
  });
  // 최근 3개월 변화(선택 표시): 4개 snapshot 만 더 읽는다. 데이터가 부족하면 조용히 생략.
  RankHistory.loadRecent(CFG.country,4).then(snaps=>{
    if(snaps.length<4)return;
    const first=snaps[0],last=snaps[snaps.length-1],idx={};
    first.groups.forEach(g=>{idx[g.id]=g});
    const m={};
    last.groups.forEach(g=>{m[g.id]=RankHistory.getRankDelta(g,idx[g.id],true)});
    HD3=m;render();
  }).catch(()=>{});
}

/* ---- 보기 방식(자세히/간단히): localStorage 에 저장, DOM 을 다시 그리지 않고 클래스만 바꾼다 ---- */
const VIEW_KEY='idolRankingView';
function getView(){try{const v=localStorage.getItem(VIEW_KEY);return v==='compact'?'compact':'visual'}catch(e){return 'visual'}}
function setView(v){
  try{localStorage.setItem(VIEW_KEY,v)}catch(e){/* noop */}
  document.getElementById('board').classList.toggle('compact',v==='compact');
  document.getElementById('viewVisual').setAttribute('aria-pressed',v==='visual');
  document.getElementById('viewCompact').setAttribute('aria-pressed',v==='compact');
}
document.getElementById('viewVisual').addEventListener('click',()=>setView('visual'));
document.getElementById('viewCompact').addEventListener('click',()=>setView('compact'));
setView(getView());
