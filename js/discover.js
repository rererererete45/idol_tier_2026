/* DISCOVER UI — "🎲 아이돌 발견하기" 모달 / 바텀시트 (SAME_SCENE_DISCOVER_SPEC.md)
 * 추천 로직은 js/idol-recommendation-core.js(IdolRec), 최애 저장은 js/idol-match.js(IdolMatch)를 그대로 쓴다.
 * Discover.open({ mode, scope, id })  — id 가 있으면 그 그룹 카드를 바로 보여준다(공유 링크). */
(function (global) {
  'use strict';
  var IM = global.IdolMatch, R = global.IdolRec;
  var script = document.currentScript, base = script && script.src ? script.src.replace(/js\/discover\.js.*$/, '') : '';

  var MODES = [
    ['auto', '✨ 자동', '#1ed760'], ['random', '🎲 완전 랜덤', '#539df5'], ['taste', '❤️ 내 취향', '#f3727f'],
    ['hiddenGem', '💎 숨은 보석', '#22d3ee'], ['expand', '🌱 취향 확장', '#7ee787'], ['hot', '🔥 HOT', '#ff7a45'], ['daily', '📅 오늘의 아이돌', '#a78bfa']
  ];
  var MODE_COLOR = {}; MODES.forEach(function (m) { MODE_COLOR[m[0]] = m[2]; });
  var SCOPES = [['ALL', '전체'], ['KR', '🇰🇷 한국'], ['JP', '🇯🇵 일본']];
  var NEED_FAV = { taste: 1, expand: 1 };

  var state = { mode: 'auto', scope: 'ALL', cur: null, opener: null, busy: false, stack: [], view: 'find', colFilter: 'all', repOffset: 0, pending: null, quickList: [] };
  var root = null, els = {};

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function reduced() { return global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function flagB(c) { return '<span class="dsc-flag ' + c.toLowerCase() + '">' + c + '</span>'; }
  function pageOf(c) { return base + IM.countries[c].page; }
  // id 를 우선하고 group 이름은 fallback/표시용
  function detailUrl(e) { return pageOf(e.country) + '?id=' + encodeURIComponent(e.id) + '&group=' + encodeURIComponent(e.name); }
  function mapUrl(e) { return base + 'map?country=' + e.country + '&id=' + encodeURIComponent(e.id) + '&group=' + encodeURIComponent(e.name); }
  var DEBUG = /[?&]debugDiscover=1/.test(location.search);
  function sceneUrl(e) { return mapUrl(e) + '&scene=1'; }
  var IMGS = null; // data/namu_images.json: {KR:{name:{img}}, JP:{...}} — 사진이 있는 그룹만 <img> 를 만든다(404 방지)
  function loadImgs() {
    if (IMGS) return Promise.resolve(IMGS);
    return fetch(base + 'data/namu_images.json').then(function (r) { return r.json(); }).catch(function () { return {}; }).then(function (j) { IMGS = j || {}; return IMGS; });
  }
  function imgOf(e) {
    var r = IMGS && IMGS[e.country] && IMGS[e.country][e.name];
    return r && r.img ? base + r.img : '';
  }

  var css = ''
    + '.dsc{position:fixed;inset:0;z-index:90;display:flex;align-items:flex-end;justify-content:center;font-family:"Figtree","Helvetica Neue",helvetica,arial,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans JP",sans-serif;color:#fff}'
    + '.dsc[hidden]{display:none}'
    + '.dsc *{box-sizing:border-box}'
    + '.dsc-bg{position:absolute;inset:0;background:rgba(0,0,0,.72);animation:dscFade .2s ease-out}'
    + '.dsc-box{position:relative;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;background:#181818;border-radius:22px 22px 0 0;padding:16px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),rgba(0,0,0,.6) 0 -12px 40px;animation:dscUp .3s cubic-bezier(.2,.8,.2,1)}'
    + '@media(min-width:640px){.dsc{align-items:center}.dsc-box{border-radius:22px;max-height:88vh}}'
    + '@keyframes dscFade{from{opacity:0}to{opacity:1}}@keyframes dscUp{from{transform:translateY(36px);opacity:0}to{transform:none;opacity:1}}'
    + '.dsc-head{display:flex;align-items:center;justify-content:space-between;gap:10px}'
    + '.dsc-head h2{margin:0;font-size:19px;font-weight:900;letter-spacing:-.01em}'
    + '.dsc-x{width:44px;height:44px;border-radius:50%;border:0;background:#252525;color:#b3b3b3;font-size:14px;cursor:pointer}.dsc-x:hover{background:#333;color:#fff}'
    + '.dsc-seg{display:flex;gap:2px;padding:3px;margin:12px 0 0;background:#121212;border-radius:9999px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}'
    + '.dsc-seg button{flex:1;min-height:44px;border:0;border-radius:9999px;background:transparent;color:#b3b3b3;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}'
    + '.dsc-seg button:hover{color:#fff}.dsc-seg button[aria-pressed="true"]{background:#1ed760;color:#000}'
    + '.dsc-modes{display:flex;flex-wrap:nowrap;gap:6px;margin:10px -18px 0;padding:0 18px 4px;overflow-x:auto;scrollbar-width:none}.dsc-modes::-webkit-scrollbar{display:none}'
    + '@media(min-width:640px){.dsc-modes{flex-wrap:wrap;margin:10px 0 0;padding:0;overflow:visible}}'
    + '.dsc-modes button{flex:none;min-height:44px;padding:0 14px;border:0;border-radius:9999px;background:#1f1f1f;color:#b3b3b3;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);transition:background .15s,color .15s,transform .12s}'
    + '.dsc-modes button:hover{color:#fff;background:#2a2a2a}.dsc-modes button:active{transform:scale(.96)}'
    + '.dsc-modes button[aria-pressed="true"]{background:var(--mc);color:#000;box-shadow:0 2px 14px color-mix(in srgb,var(--mc) 40%,transparent)}'
    + '.dsc-modes button[aria-disabled="true"]{opacity:.45}'
    + '.dsc button:focus-visible,.dsc a:focus-visible{outline:2px solid #1ed760;outline-offset:2px}'
    + '.dsc-hint{min-height:18px;margin:8px 2px 0;font-size:11.5px;font-weight:600;color:#ffa42b;line-height:1.5}'
    + '.dsc-card{--mc:#1ed760;position:relative;margin-top:8px;padding:16px;border-radius:18px;background:linear-gradient(180deg,color-mix(in srgb,var(--mc) 13%,#1f1f1f),#1f1f1f 60%);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--mc) 35%,transparent);animation:dscCard .35s cubic-bezier(.2,.8,.2,1)}'
    + '@keyframes dscCard{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}'
    + '.dsc-badge{display:inline-flex;align-items:center;min-height:28px;padding:0 12px;border-radius:9999px;background:var(--mc);color:#000;font-size:12px;font-weight:900;letter-spacing:.02em}'
    + '.dsc-top{display:flex;align-items:center;gap:14px;margin:14px 0 0}'
    + '.dsc-av{position:relative;flex:none;width:76px;height:76px;border-radius:20px;overflow:hidden;background:#2a2a2a;display:grid;place-items:center;font-size:28px;font-weight:900;color:#7c7c7c;box-shadow:0 0 0 2px var(--mc),0 10px 24px rgba(0,0,0,.5)}'
    + '.dsc-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
    + '.dsc-top h3{margin:0;font-size:22px;font-weight:900;letter-spacing:-.02em;line-height:1.2;overflow-wrap:anywhere}'
    + '.dsc-sub{margin:5px 0 0;font-size:13px;font-weight:700;color:#b3b3b3}'
    + '.dsc-flag{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 6px;border-radius:4px;vertical-align:3px;margin-left:6px;color:#000}'
    + '.dsc-flag.kr{background:#1ed760}.dsc-flag.jp{background:#f3727f}'
    + '.dsc-tags{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0}'
    + '.dsc-tags span{font-size:11.5px;font-weight:800;letter-spacing:.04em;padding:4px 10px;border-radius:9999px;background:rgba(255,255,255,.08);color:#fff}'
    + '.dsc-axis{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:14px 0 0}'
    + '.dsc-axis b{font-size:13px;font-weight:900;color:var(--mc)}.dsc-axis span{font-size:13px;font-weight:700;color:#fff}'
    + '.dsc-sent{margin:8px 0 0;font-size:13px;line-height:1.65;color:#b3b3b3}'
    + '.dsc-note{margin:10px 0 0;padding:8px 12px;border-radius:10px;background:rgba(255,164,43,.12);color:#ffcf8a;font-size:11.5px;font-weight:600;line-height:1.55}'
    + '.dsc-act{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0 0}'
    + '.dsc-act>*{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 12px;border:0;border-radius:9999px;background:transparent;color:#fff;font:inherit;font-size:12.5px;font-weight:700;letter-spacing:.02em;cursor:pointer;text-decoration:none;box-shadow:inset 0 0 0 1px #7c7c7c;transition:background .15s,transform .12s}'
    + '.dsc-act>*:hover{background:rgba(255,255,255,.07)}.dsc-act>*:active{transform:scale(.97)}'
    + '.dsc-act>*:last-child:nth-child(odd){grid-column:1/-1}'
    + '.dsc-act .grn{background:#1ed760;color:#000;box-shadow:none}.dsc-act .grn:hover{background:#3be477}'
    + '.dsc-act .fav[aria-pressed="true"]{background:rgba(243,114,127,.18);box-shadow:inset 0 0 0 1px #f3727f;color:#ffb3bb}'
    + '.dsc-nextrow{display:flex;gap:8px;margin:12px 0 0}'
    + '.dsc-prev{flex:none;width:52px;height:52px;border:0;border-radius:50%;background:#2a2a2a;color:#fff;font-size:18px;cursor:pointer;transition:background .15s,transform .12s}'
    + '.dsc-prev:hover{background:#353535}.dsc-prev:active{transform:scale(.94)}.dsc-prev[disabled]{opacity:.35;cursor:default}'
    + '.dsc-keys{display:none;margin:10px 0 0;text-align:center;font-size:11px;font-weight:600;color:#7c7c7c}'
    + '@media(hover:hover) and (min-width:640px){.dsc-keys{display:block}}'
    + '.dsc-grab{display:none;width:44px;height:5px;border-radius:3px;background:rgba(255,255,255,.22);margin:-6px auto 10px;touch-action:none}'
    + '@media(max-width:639px){.dsc-grab{display:block}}'
    + '.dsc-next{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;margin:0;flex:1;border:0;border-radius:9999px;background:#fff;color:#000;font:inherit;font-size:14px;font-weight:900;letter-spacing:.02em;cursor:pointer;transition:transform .12s,background .15s}'
    + '.dsc-next:hover{background:#e8e8e8}.dsc-next:active{transform:scale(.98)}.dsc-next[disabled]{opacity:.6;cursor:default}'
    + '.dsc-next i{font-style:normal;display:inline-block}.dsc-next.spin i{animation:dscSpin .5s linear infinite}'
    + '@keyframes dscSpin{to{transform:rotate(360deg)}}'
    + '.dsc-links{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}'
    + '.dsc-links>*{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:9999px;border:0;background:#252525;color:#b3b3b3;font:inherit;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none}'
    + '.dsc-links>*:hover{color:#fff;background:#2f2f2f}'
    + '.dsc-hist{margin:16px 0 0;padding-top:14px;border-top:1px solid #2a2a2a}'
    + '.dsc-hist h4{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#7c7c7c}'
    + '.dsc-hist h4 button{border:0;background:transparent;color:#7c7c7c;font:inherit;font-size:11px;font-weight:700;cursor:pointer;min-height:44px;padding:0 8px}.dsc-hist h4 button:hover{color:#fff}'
    + '.dsc-hl{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}.dsc-hl::-webkit-scrollbar{display:none}'
    + '.dsc-hl button{flex:none;min-height:44px;padding:0 12px;border:0;border-radius:9999px;background:#1f1f1f;color:#fff;font:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}'
    + '.dsc-hl button:hover{background:#2a2a2a}'
    + '.dsc-tabs{display:flex;gap:2px;padding:3px;margin:12px 0 0;background:#121212;border-radius:9999px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}'
    + '.dsc-tabs button{flex:1;min-height:44px;border:0;border-radius:9999px;background:transparent;color:#b3b3b3;font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;white-space:nowrap}'
    + '.dsc-tabs button:hover{color:#fff}.dsc-tabs button[aria-pressed="true"]{background:#fff;color:#000}'
    + '.dsc [hidden]{display:none!important}'
    + '.dsc-quick{margin:10px 0 0;padding:12px 14px;border-radius:14px;background:rgba(243,114,127,.1);box-shadow:inset 0 0 0 1px rgba(243,114,127,.3)}'
    + '.dsc-quick p{margin:0 0 10px;font-size:12px;line-height:1.6;color:#ffc2c8}.dsc-quick b{color:#fff}'
    + '.dsc-ql{display:flex;flex-wrap:wrap;gap:6px}'
    + '.dsc-ql button{min-height:44px;padding:0 12px;border:0;border-radius:9999px;background:#252525;color:#fff;font:inherit;font-size:12px;font-weight:700;cursor:pointer}'
    + '.dsc-ql button[aria-pressed="true"]{background:#f3727f;color:#000}'
    + '.dsc-sum{display:flex;flex-direction:column;gap:2px;margin:14px 0 0}.dsc-sum b{font-size:16px;font-weight:900}.dsc-sum span{font-size:12px;color:#7c7c7c;font-weight:600}'
    + '.dsc-cf{display:flex;gap:6px;overflow-x:auto;margin:12px -18px 0;padding:0 18px 4px;scrollbar-width:none}.dsc-cf::-webkit-scrollbar{display:none}'
    + '.dsc-cf button{flex:none;min-height:44px;padding:0 13px;border:0;border-radius:9999px;background:#1f1f1f;color:#b3b3b3;font:inherit;font-size:12px;font-weight:700;cursor:pointer}'
    + '.dsc-cf button[aria-pressed="true"]{background:#1ed760;color:#000}'
    + '.dsc-rows{display:grid;gap:6px;margin:8px 0 0}'
    + '.dsc-row{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 10px;border-radius:14px;background:#1f1f1f}'
    + '.dsc-mav{position:relative;flex:none;width:44px;height:44px;border-radius:12px;overflow:hidden;background:#2a2a2a;display:grid;place-items:center;font-weight:900;color:#7c7c7c}'
    + '.dsc-mav img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
    + '.dsc-rmid{flex:1;min-width:0}.dsc-rmid b{display:block;font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.dsc-rmid span{display:block;margin-top:2px;font-size:11px;font-weight:600;color:#7c7c7c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.dsc-rb{flex:none;min-width:44px;min-height:44px;padding:0 12px;border:0;border-radius:9999px;background:#2a2a2a;color:#fff;font:inherit;font-size:12px;font-weight:700;cursor:pointer}'
    + '.dsc-rb:hover{background:#353535}.dsc-rb.fav[aria-pressed="true"]{background:rgba(243,114,127,.2);color:#ffb3bb}.dsc-rb.wide{padding:0 14px}'
    + '.dsc-mnav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 0 0}.dsc-mnav b{font-size:15px;font-weight:900}'
    + '.dsc-mnav button{width:44px;height:44px;border:0;border-radius:50%;background:#252525;color:#fff;font-size:20px;cursor:pointer}.dsc-mnav button[disabled]{opacity:.35;cursor:default}'
    + '.dsc-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0 0}'
    + '.dsc-kpis div{padding:10px 8px;border-radius:14px;background:#1f1f1f;text-align:center}'
    + '.dsc-kpis small{display:block;font-size:10px;font-weight:800;letter-spacing:.08em;color:#7c7c7c}.dsc-kpis b{display:block;margin-top:2px;font-size:24px;font-weight:900;font-variant-numeric:tabular-nums}'
    + '.dsc-rk{margin:16px 0 8px;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#1ed760}'
    + '.dsc-bar{display:grid;grid-template-columns:96px 1fr 22px;gap:8px;align-items:center;margin:6px 0;font-size:12px;color:#b3b3b3}'
    + '.dsc-bar div{height:8px;border-radius:4px;background:#2a2a2a;overflow:hidden}.dsc-bar i{display:block;height:8px;border-radius:4px}.dsc-bar b{text-align:right;color:#fff}'
    + '.dsc-split{display:flex;height:10px;border-radius:5px;background:#f3727f;overflow:hidden}.dsc-split i{display:block;background:#1ed760}'
    + '.dsc-splt{display:flex;justify-content:space-between;margin:6px 0 0;font-size:11.5px;font-weight:700;color:#b3b3b3}'
    + '.dsc-tags.rep{margin:0}.dsc-tags.rep em{font-style:normal;color:#1ed760;margin-left:4px}'
    + '.dsc-gl{display:flex;flex-wrap:wrap;gap:6px}'
    + '.dsc-fine{margin:12px 0 0;font-size:10.5px;line-height:1.6;color:#7c7c7c}'
    + '.dsc-dbg{white-space:pre-wrap;margin:10px 0 0;padding:8px;border-radius:8px;background:#121212;color:#7c7c7c;font-size:10.5px;line-height:1.5;font-family:inherit}'
    + '.dsc-empty{padding:26px 8px;text-align:center;color:#b3b3b3;font-size:13px;line-height:1.7}'
    + '.dsc-roll h3{opacity:.55;filter:blur(.6px)}'
    + '@media(max-width:400px){.dsc-top h3{font-size:19px}.dsc-av{width:64px;height:64px}}'
    + '@media(prefers-reduced-motion:reduce){.dsc-bg,.dsc-box,.dsc-card,.dsc-next i{animation:none!important}}';

  function build() {
    if (root) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    root = document.createElement('div');
    root.className = 'dsc'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'dscT');
    root.innerHTML = '<div class="dsc-bg" data-close></div><div class="dsc-box" id="dscBox">'
      + '<div class="dsc-grab" aria-hidden="true"></div><div class="dsc-head"><h2 id="dscT">🎲 DISCOVER</h2><button type="button" class="dsc-x" data-close aria-label="DISCOVER 닫기">✕</button></div>'
      + '<div class="dsc-tabs" role="group" aria-label="화면 선택"><button type="button" data-view="find" aria-pressed="true">🎲 발견</button><button type="button" data-view="collection" aria-pressed="false">📚 컬렉션</button><button type="button" data-view="report" aria-pressed="false">📊 리포트</button></div>'
      + '<div id="dscFind"><div class="dsc-seg" role="group" aria-label="국가 범위">' + SCOPES.map(function (s) { return '<button type="button" data-scope="' + s[0] + '" aria-pressed="false">' + s[1] + '</button>'; }).join('') + '</div>'
      + '<div class="dsc-modes" role="group" aria-label="발견 방식">' + MODES.map(function (m) { return '<button type="button" data-mode="' + m[0] + '" style="--mc:' + m[2] + '" aria-pressed="false">' + m[1] + '</button>'; }).join('') + '</div>'
      + '<p class="dsc-hint" id="dscHint" aria-live="polite"></p><div class="dsc-quick" id="dscQuick" hidden></div>'
      + '<div id="dscCardWrap" aria-live="polite"></div>'
      + '<div class="dsc-hist" id="dscHist"></div></div>'
      + '<div id="dscCol" hidden></div><div id="dscRep" hidden></div></div>';
    document.body.appendChild(root);
    els.wrap = root.querySelector('#dscCardWrap'); els.hint = root.querySelector('#dscHint'); els.hist = root.querySelector('#dscHist'); els.box = root.querySelector('#dscBox'); els.find = root.querySelector('#dscFind'); els.col = root.querySelector('#dscCol'); els.rep = root.querySelector('#dscRep'); els.quick = root.querySelector('#dscQuick');

    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { close(); return; }
      var sc = e.target.closest('[data-scope]');
      if (sc) { state.scope = sc.getAttribute('data-scope'); syncControls(); next(); return; }
      var md = e.target.closest('[data-mode]');
      if (md) {
        var m = md.getAttribute('data-mode');
        if (NEED_FAV[m] && favCount() < 2) {
          state.pending = m; state.quickList = R.getFavoriteSuggestions(state.scope, 4);
          hint(''); renderQuick(); return;
        }
        state.pending = null; renderQuick();
        state.mode = m; syncControls(); next(); return;
      }
      if (e.target.closest('[data-prev]')) { prev(); return; }
      var nx = e.target.closest('[data-next]'); if (nx) { if (state.mode === 'daily') { state.mode = 'auto'; syncControls(); } next(); return; }
      var fv = e.target.closest('[data-fav]'); if (fv && state.cur) { toggleFav(fv); return; }
      var sh = e.target.closest('[data-share]'); if (sh && state.cur) { share(sh); return; }
      var vw = e.target.closest('[data-view]'); if (vw) { setView(vw.getAttribute('data-view')); return; }
      var qf = e.target.closest('[data-qfav]'); if (qf) { quickToggle(qf.getAttribute('data-qfav')); return; }
      var cf = e.target.closest('[data-cfilter]'); if (cf) { state.colFilter = cf.getAttribute('data-cfilter'); renderCollection(); return; }
      var cv = e.target.closest('[data-cfav]');
      if (cv) { var k = cv.getAttribute('data-cfav'), ix = k.indexOf('|'); IM.saveFavorite(k.slice(0, ix), k.slice(ix + 1)); renderCollection(); syncControls(); return; }
      var oi = e.target.closest('[data-open-id]'); if (oi) { setView('find'); showById(oi.getAttribute('data-open-id'), oi.getAttribute('data-open-mode')); return; }
      var rm = e.target.closest('[data-rmonth]'); if (rm) { state.repOffset = Math.max(-3, Math.min(0, state.repOffset + Number(rm.getAttribute('data-rmonth')))); renderReport(); return; }
      if (e.target.closest('[data-again]')) { setView('find'); state.mode = favCount() >= 2 ? 'taste' : 'auto'; syncControls(); next(); return; }
      var ci = e.target.closest('[data-cardimg]'); if (ci && state.cur) { saveCardImage(ci); return; }
      var hs = e.target.closest('[data-hid]'); if (hs) { showById(hs.getAttribute('data-hid'), hs.getAttribute('data-hmode')); return; }
      if (e.target.closest('[data-clear]')) { R.clearDiscoveryHistory(); renderHist(); hint('발견 기록을 지웠어요. 이제 이전에 본 그룹도 다시 나올 수 있어요.'); return; }
    });
    (function swipe() {
      var box = els.box, y0 = null, dy = 0;
      box.addEventListener('pointerdown', function (e) {
        if (window.innerWidth >= 640 || box.scrollTop > 0) return;
        if (!e.target.closest('.dsc-grab, .dsc-head') || e.target.closest('button')) return;
        y0 = e.clientY; dy = 0; try { box.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      });
      box.addEventListener('pointermove', function (e) { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); box.style.animation = 'none'; box.style.transform = 'translateY(' + dy + 'px)'; });
      function end() { if (y0 === null) return; box.style.transform = ''; box.style.animation = ''; if (dy > 90) close(); y0 = null; dy = 0; }
      box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    })();
    document.addEventListener('keydown', function (e) {
      if (root.hidden) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') trapFocus(e);
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if (state.view === 'find' && !typing && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      }
    }, true);
  }

  function trapFocus(e) {
    var f = Array.prototype.filter.call(root.querySelectorAll('button:not([disabled]),a[href]'), function (n) { return n.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function favCount() { return IM.getFavorites().length; }
  function hint(t) { els.hint.textContent = t || ''; }

  function syncControls() {
    Array.prototype.forEach.call(root.querySelectorAll('[data-scope]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-scope') === state.scope); });
    var fc = favCount();
    Array.prototype.forEach.call(root.querySelectorAll('[data-mode]'), function (b) {
      var m = b.getAttribute('data-mode');
      b.setAttribute('aria-pressed', m === state.mode);
      var dis = !!NEED_FAV[m] && fc < 2;
      if (dis) { b.setAttribute('aria-disabled', 'true'); b.title = '최애 2팀 이상 필요'; } else { b.removeAttribute('aria-disabled'); b.removeAttribute('title'); }
    });
  }

  /* ---------- 카드 ---------- */
  function cardHtml(res) {
    var e = res.ent, mc = MODE_COLOR[res.mode] || '#1ed760', why = res.reason;
    var tags = R.describeStyle(e).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
    var fav = IM.isFavorite(e.country, e.name);
    var note = (res.fellBack ? '<p class="dsc-note">' + esc(fallbackText(res)) + '</p>' : '')
      + (res.relaxed ? '<p class="dsc-note">후보가 적어서 숨은 보석 기준을 조금 넓혔어요. (총점 하위 80% 이하 · 강점 축 1개 이상)</p>' : '');
    return '<article class="dsc-card" style="--mc:' + mc + '" data-key="' + esc(e.key) + '">'
      + '<span class="dsc-badge">' + esc(why.badge) + '</span>'
      + '<div class="dsc-top"><div class="dsc-av">' + esc(e.name.charAt(0)) + (imgOf(e) ? '<img alt="" src="' + imgOf(e) + '" onerror="this.remove()">' : '') + '</div>'
      + '<div><h3>' + esc(e.name) + flagB(e.country) + '</h3><p class="dsc-sub">' + esc(e.tier) + ' · ' + e.total + '점 · ' + (e.status ? esc(e.status) : '') + '</p></div></div>'
      + (tags ? '<div class="dsc-tags">' + tags + '</div>' : '')
      + '<div class="dsc-axis"><b>' + esc(why.axis.label) + '</b><span>' + esc(why.axis.text) + '</span></div>'
      + '<p class="dsc-sent">' + esc(why.sentence) + '</p>' + note
      + (res.limited ? '<p class="dsc-note">데이터가 일부 부족하거나 검증이 덜 된 그룹이에요. 추천 신뢰도가 낮을 수 있어요.</p>' : '')
      + (DEBUG ? '<pre class="dsc-dbg">' + esc(JSON.stringify(res.debug, null, 1)) + '\nconfidence ' + (res.confidence == null ? '—' : res.confidence.toFixed(2)) + '</pre>' : '')
      + '<div class="dsc-act">'
      + '<a class="grn" target="_blank" rel="noopener noreferrer" href="' + esc(e.spotify || 'https://open.spotify.com/search/' + encodeURIComponent(e.name)) + '" aria-label="' + esc(e.name) + (e.spotify ? ' Spotify에서 듣기' : ' Spotify에서 검색하기') + '">' + (e.spotify ? 'Spotify ▶' : 'Spotify 검색 ▶') + '</a>'
      + '<a href="' + detailUrl(e) + '" aria-label="' + esc(e.name) + ' 상세보기">상세보기</a>'
      + '<a href="' + mapUrl(e) + '" aria-label="' + esc(e.name) + ' 지도에서 보기">🗺 지도</a>'
      + '<button type="button" class="fav" data-fav aria-pressed="' + fav + '" aria-label="' + esc(e.name) + ' 최애 저장 토글">' + (fav ? '♥ 저장됨' : '♡ 저장') + '</button></div>'
      + '<div class="dsc-links"><a href="' + sceneUrl(e) + '" aria-label="' + esc(e.name) + '와 비슷한 그룹을 지도에서 보기">🧬 비슷한 그룹</a><button type="button" data-share aria-label="이 발견 링크 공유하기">🔗 링크 공유</button><button type="button" data-cardimg aria-label="발견 카드를 이미지로 저장하거나 공유하기">🖼 카드 이미지</button></div>'
      + '<div class="dsc-nextrow"><button type="button" class="dsc-prev" data-prev aria-label="이전에 본 그룹으로" ' + (state.stack.length ? '' : 'disabled') + '>↩</button>'
      + '<button type="button" class="dsc-next" data-next aria-label="다른 그룹 발견하기"><i aria-hidden="true">🔄</i> 다른 그룹</button></div>'
      + '<p class="dsc-keys">← 이전 · → 다른 그룹 · Esc 닫기</p></article>';
  }
  function fallbackText(res) {
    var name = { taste: '내 취향', hiddenGem: '숨은 보석', expand: '취향 확장', hot: 'HOT', random: '완전 랜덤' };
    return (name[res.requested === 'auto' ? res.mode : res.requested] || '선택한 방식') + ' 후보가 부족해 ' + name[res.mode] + ' 방식으로 골랐어요.';
  }

  function paint(res, noSave) {
    state.cur = res;
    els.wrap.innerHTML = res ? cardHtml(res) : '<div class="dsc-empty">보여줄 수 있는 그룹이 없어요.<br>국가 범위나 발견 기록을 확인해 주세요.</div>';
    if (res && !noSave) {
      R.saveRecentDiscovery(res.ent.id);
      R.saveDiscoveryHistory({ id: res.ent.id, mode: res.mode, timestamp: Date.now() });
    }
    renderHist();
    syncControls();
    syncUrl(res);
  }

  function entOf(id) {
    var f = null;
    ['KR', 'JP'].forEach(function (c) { R.entitiesOf(c).forEach(function (e) { if (e.id === id) f = e; }); });
    return f;
  }
  function renderHist() {
    var h = R.loadDiscoveryHistory().slice(0, 8), seen = {}, items = [];
    h.forEach(function (x) { if (!seen[x.id]) { seen[x.id] = 1; var e = entOf(x.id); if (e) items.push([x, e]); } });
    els.hist.innerHTML = items.length
      ? '<h4>최근 발견 <button type="button" data-clear aria-label="발견 기록 지우기">기록 지우기</button></h4><div class="dsc-hl">'
        + items.map(function (p) { return '<button type="button" data-hid="' + esc(p[0].id) + '" data-hmode="' + esc(p[0].mode) + '">' + (p[1].country === 'KR' ? '🇰🇷' : '🇯🇵') + ' ' + esc(p[1].name) + '</button>'; }).join('') + '</div>'
      : '';
  }

  function next() {
    if (state.busy) return; // 굴리는 중에 모드/범위가 바뀌어도 마지막에 뽑을 때 현재 설정이 쓰인다
    hint('');
    if (reduced() || !state.cur) { pushPrev(); paint(R.pickDiscovery(state.mode, state.scope)); return; }
    // 주사위 굴리는 느낌: 잠깐 이름이 바뀌다 결과가 나온다
    state.busy = true;
    var btn = root.querySelector('.dsc-next');
    if (btn) { btn.classList.add('spin'); btn.disabled = true; }
    var card = els.wrap.querySelector('.dsc-card'), h3 = card && card.querySelector('h3');
    var pool = R.getDiscoverPool(state.scope, { ignoreRecent: true }), n = 0;
    if (card) card.classList.add('dsc-roll');
    var iv = setInterval(function () {
      if (h3 && pool.length) h3.firstChild.nodeValue = pool[Math.floor(Math.random() * pool.length)].name;
      if (++n >= 6) { clearInterval(iv); state.busy = false; pushPrev(); paint(R.pickDiscovery(state.mode, state.scope)); }
    }, 70);
  }

  function pushPrev() { if (state.cur) { state.stack.push(state.cur); if (state.stack.length > 20) state.stack.shift(); } }
  function prev() {
    if (state.busy || !state.stack.length) return;
    hint('');
    paint(state.stack.pop(), true); // 이미 기록된 카드를 다시 보여줄 뿐이라 기록/최근 목록은 건드리지 않는다
  }
  function showById(id, mode) {
    var res = R.discoveryFor(id, mode);
    if (res) paint(res);
  }

  function toggleFav(btn) {
    var e = state.cur.ent, on = IM.saveFavorite(e.country, e.name);
    btn.setAttribute('aria-pressed', on); btn.textContent = on ? '♥ 저장됨' : '♡ 저장';
    syncControls();
    hint(on ? '최애에 저장했어요. 2팀 이상이면 "내 취향" 발견이 열려요.' : '');
  }

  function share(btn) {
    var e = state.cur.ent, url = shareUrl(state.cur);
    var text = '🎲 IDOL DISCOVER: ' + e.name + ' (' + R.describeStyle(e).join(' · ') + ')';
    if (global.navigator.share) { global.navigator.share({ title: 'IDOL DISCOVER', text: text, url: url }).catch(function () {}); return; }
    var done = function () { var t = btn.textContent; btn.textContent = '링크 복사됨 ✓'; setTimeout(function () { btn.textContent = t; }, 1600); };
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) global.navigator.clipboard.writeText(text + '\n' + url).then(done).catch(function () { global.prompt('복사해서 공유하세요', text + ' ' + url); });
    else global.prompt('복사해서 공유하세요', text + ' ' + url);
  }

  /* ---------- 최애 빠른 추가: 내 취향/취향 확장은 최애 2팀 이상부터 ---------- */
  var QUICK_LABEL = { taste: '❤️ 내 취향', expand: '🌱 취향 확장' };
  function renderQuick() {
    var m = state.pending;
    if (!m) { els.quick.innerHTML = ''; els.quick.hidden = true; return; }
    var n = favCount();
    els.quick.hidden = false;
    els.quick.innerHTML = '<p><b>' + QUICK_LABEL[m] + '</b>은 최애가 2팀 이상일 때 열려요. (지금 ' + n + '팀) 마음에 드는 그룹을 눌러 저장하면 바로 이어서 발견해 드려요.</p>'
      + '<div class="dsc-ql">' + state.quickList.map(function (e) {
        var on = IM.isFavorite(e.country, e.name);
        return '<button type="button" data-qfav="' + esc(e.key) + '" aria-pressed="' + on + '" aria-label="' + esc(e.name) + ' 최애 ' + (on ? '해제' : '저장') + '">' + (e.country === 'KR' ? '🇰🇷' : '🇯🇵') + ' ' + esc(e.name) + '</button>';
      }).join('') + '</div>';
  }
  function quickToggle(key) {
    var i = key.indexOf('|'), on = IM.saveFavorite(key.slice(0, i), key.slice(i + 1));
    syncControls();
    if (state.pending && favCount() >= 2) {
      state.mode = state.pending; state.pending = null; renderQuick(); syncControls();
      hint('최애가 2팀 이상 모였어요. ' + (QUICK_LABEL[state.mode] || '') + ' 발견을 시작할게요.');
      next();
    } else renderQuick();
  }

  /* ---------- 화면 전환: 발견 / 컬렉션 / 리포트 ---------- */
  var MODE_NAME = { random: '🎲 랜덤', taste: '❤️ 내 취향', hiddenGem: '💎 숨은 보석', expand: '🌱 취향 확장', hot: '🔥 HOT', daily: '📅 오늘' };
  function setView(v) {
    state.view = v;
    Array.prototype.forEach.call(root.querySelectorAll('[data-view]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === v); });
    els.find.hidden = v !== 'find'; els.col.hidden = v !== 'collection'; els.rep.hidden = v !== 'report';
    if (v === 'collection') renderCollection();
    if (v === 'report') renderReport();
    els.box.scrollTop = 0;
  }
  function dateText(ts) { var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate(); }

  function renderCollection() {
    var all = R.getDiscoveryCollection(), used = {};
    all.forEach(function (c) { used[c.mode] = 1; });
    var list = state.colFilter === 'all' ? all : all.filter(function (c) { return c.mode === state.colFilter; });
    var chips = '<button type="button" data-cfilter="all" aria-pressed="' + (state.colFilter === 'all') + '">전체 ' + all.length + '</button>'
      + Object.keys(MODE_NAME).filter(function (m) { return used[m]; }).map(function (m) {
        var n = all.filter(function (c) { return c.mode === m; }).length;
        return '<button type="button" data-cfilter="' + m + '" aria-pressed="' + (state.colFilter === m) + '">' + MODE_NAME[m] + ' ' + n + '</button>';
      }).join('');
    var rows = list.map(function (c) {
      var e = c.ent, fav = IM.isFavorite(e.country, e.name);
      return '<div class="dsc-row"><div class="dsc-mav">' + esc(e.name.charAt(0)) + (imgOf(e) ? '<img alt="" src="' + imgOf(e) + '" onerror="this.remove()">' : '') + '</div>'
        + '<div class="dsc-rmid"><b>' + esc(e.name) + flagB(e.country) + '</b><span>' + esc(e.tier) + ' · ' + (MODE_NAME[c.mode] || '') + ' · ' + dateText(c.last) + (c.count > 1 ? ' · ' + c.count + '회' : '') + '</span></div>'
        + '<button type="button" class="dsc-rb" data-open-id="' + esc(e.id) + '" data-open-mode="' + esc(c.mode) + '" aria-label="' + esc(e.name) + ' 다시 보기">보기</button>'
        + '<button type="button" class="dsc-rb fav" data-cfav="' + esc(e.key) + '" aria-pressed="' + fav + '" aria-label="' + esc(e.name) + ' 최애 ' + (fav ? '해제' : '저장') + '">' + (fav ? '♥' : '♡') + '</button></div>';
    }).join('');
    els.col.innerHTML = '<div class="dsc-sum"><b>📚 내 발견 컬렉션</b><span>' + all.length + '팀을 만났어요 (최근 50번 기록 기준)</span></div>'
      + (all.length ? '<div class="dsc-cf" role="group" aria-label="발견 방식으로 거르기">' + chips + '</div><div class="dsc-rows">' + (rows || '<div class="dsc-empty">이 방식으로 발견한 그룹이 아직 없어요.</div>') + '</div>'
        : '<div class="dsc-empty">아직 발견한 그룹이 없어요.<br>발견 탭에서 🔄 다른 그룹을 눌러 보세요.</div>');
  }

  var CAT_TEXT = { live: '라이브 성향', fandom: '팬덤 성향', digital: '디지털·음원 성향', popularity: '대중적인 성향' };
  function renderReport() {
    var now = new Date(), d = new Date(now.getFullYear(), now.getMonth() + state.repOffset, 1);
    var r = R.getMonthlyReport(d.getFullYear(), d.getMonth());
    var nav = '<div class="dsc-mnav"><button type="button" data-rmonth="-1" aria-label="이전 달" ' + (state.repOffset <= -3 ? 'disabled' : '') + '>‹</button><b>' + d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 발견 리포트</b><button type="button" data-rmonth="1" aria-label="다음 달" ' + (state.repOffset >= 0 ? 'disabled' : '') + '>›</button></div>';
    if (!r.total) {
      els.rep.innerHTML = nav + '<div class="dsc-empty">이 달에는 발견 기록이 없어요.<br>' + (state.repOffset === 0 ? '발견 탭에서 그룹을 만나 보면 여기에 쌓여요.' : '') + '</div>';
      return;
    }
    var modeBars = Object.keys(r.modes).sort(function (a, b) { return r.modes[b] - r.modes[a]; }).map(function (m) {
      var pct = Math.round(r.modes[m] / r.total * 100);
      return '<div class="dsc-bar"><span>' + (MODE_NAME[m] || m) + '</span><div><i style="width:' + pct + '%;background:' + (MODE_COLOR[m] || '#1ed760') + '"></i></div><b>' + r.modes[m] + '</b></div>';
    }).join('');
    var cTot = r.countries.KR + r.countries.JP || 1, kp = Math.round(r.countries.KR / cTot * 100);
    var strongest = Object.keys(r.avg).sort(function (a, b) { return r.avg[b] - r.avg[a]; })[0];
    var tagChips = r.topTags.map(function (t) { return '<span>' + esc(t.tag) + ' <em>' + t.n + '</em></span>'; }).join('');
    var gems = r.gems.map(function (e) { return '<button type="button" class="dsc-rb wide" data-open-id="' + esc(e.id) + '" data-open-mode="hiddenGem">' + (e.country === 'KR' ? '🇰🇷' : '🇯🇵') + ' ' + esc(e.name) + '</button>'; }).join('');
    els.rep.innerHTML = nav
      + '<div class="dsc-kpis"><div><small>발견 횟수</small><b>' + r.total + '</b></div><div><small>만난 그룹</small><b>' + r.unique + '</b></div><div><small>저장한 최애</small><b>' + r.favorites + '</b></div></div>'
      + '<p class="dsc-rk">발견 방식</p>' + modeBars
      + '<p class="dsc-rk">국가 비율</p><div class="dsc-split"><i style="width:' + kp + '%"></i></div><p class="dsc-splt"><span>🇰🇷 한국 ' + r.countries.KR + '</span><span>🇯🇵 일본 ' + r.countries.JP + '</span></p>'
      + (tagChips ? '<p class="dsc-rk">많이 만난 스타일</p><div class="dsc-tags rep">' + tagChips + '</div>' : '')
      + '<p class="dsc-sent" style="margin-top:14px">이 달에는 <b style="color:#fff">' + CAT_TEXT[strongest] + '</b>이 강한 그룹을 가장 많이 만났어요.</p>'
      + (gems ? '<p class="dsc-rk">💎 이 달의 숨은 보석</p><div class="dsc-gl">' + gems + '</div>' : '')
      + '<button type="button" class="dsc-next" data-again style="margin-top:16px"><i aria-hidden="true">🔄</i> ' + (favCount() >= 2 ? '내 취향으로 더 발견하기' : '더 발견하러 가기') + '</button>'
      + '<p class="dsc-fine">발견 기록은 최근 50번까지만 저장돼서, 그 범위 안에서만 집계해요.</p>';
  }

  /* ---------- 공유 카드 이미지 (canvas → PNG) ---------- */
  function wrapText(x, text, maxW) {
    var lines = [], line = '';
    for (var i = 0; i < text.length; i++) {
      var t = line + text[i];
      if (x.measureText(t).width > maxW && line) { lines.push(line); line = text[i]; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }
  function roundRect(x, px, py, w, h, r) {
    x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
  }
  function makeCardImage(res) {
    return new Promise(function (resolve) {
      var e = res.ent, W = 1080, H = 1350, mc = MODE_COLOR[res.mode] || '#1ed760', why = res.reason;
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d'), FONT = '"Figtree","Apple SD Gothic Neo","Malgun Gothic","Noto Sans JP",sans-serif';
      var draw = function (img) {
        var bg = x.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0f1411'); bg.addColorStop(1, '#181818'); x.fillStyle = bg; x.fillRect(0, 0, W, H);
        var glow = x.createRadialGradient(W * 0.85, 60, 10, W * 0.85, 60, 720); glow.addColorStop(0, mc + '66'); glow.addColorStop(1, mc + '00'); x.fillStyle = glow; x.fillRect(0, 0, W, H);
        x.textBaseline = 'alphabetic';
        x.fillStyle = '#b3b3b3'; x.font = '800 30px ' + FONT; x.fillText('🎲 IDOL DISCOVER', 80, 120);
        // 배지
        x.font = '900 34px ' + FONT; var bw = x.measureText(why.badge).width + 56;
        x.fillStyle = mc; roundRect(x, 80, 170, bw, 68, 34); x.fill();
        x.fillStyle = '#000'; x.fillText(why.badge, 108, 216);
        // 아바타
        var ax = 80, ay = 300, as = 300;
        x.save(); roundRect(x, ax, ay, as, as, 64); x.clip();
        x.fillStyle = '#2a2a2a'; x.fillRect(ax, ay, as, as);
        if (img) { var r = Math.max(as / img.width, as / img.height); x.drawImage(img, ax + (as - img.width * r) / 2, ay + (as - img.height * r) / 2, img.width * r, img.height * r); }
        else { x.fillStyle = '#7c7c7c'; x.font = '900 130px ' + FONT; x.textAlign = 'center'; x.fillText(e.name.charAt(0), ax + as / 2, ay + as / 2 + 46); x.textAlign = 'left'; }
        x.restore(); x.lineWidth = 6; x.strokeStyle = mc; roundRect(x, ax, ay, as, as, 64); x.stroke();
        // 이름
        x.fillStyle = '#fff'; x.font = '900 84px ' + FONT;
        var nl = wrapText(x, e.name, W - 80 - 420 - 60).slice(0, 3), ny = 380;
        nl.forEach(function (t, i) { x.fillText(t, 420, ny + i * 92); });
        var y2 = ny + nl.length * 92 - 20;
        x.fillStyle = '#b3b3b3'; x.font = '700 38px ' + FONT; x.fillText(e.country === 'KR' ? '🇰🇷 한국' : '🇯🇵 일본', 420, y2 + 20);
        x.fillText(e.tier + ' · ' + e.total + '점', 420, y2 + 76);
        // 태그
        var tx = 80, ty = 700; x.font = '800 34px ' + FONT;
        R.describeStyle(e).forEach(function (t) {
          var w = x.measureText(t).width + 48;
          x.fillStyle = 'rgba(255,255,255,.1)'; roundRect(x, tx, ty, w, 66, 33); x.fill();
          x.fillStyle = '#fff'; x.fillText(t, tx + 24, ty + 45); tx += w + 14;
        });
        // 축 + 문장
        x.fillStyle = mc; x.font = '900 42px ' + FONT; x.fillText(why.axis.label, 80, 880);
        var lw = x.measureText(why.axis.label).width;
        x.fillStyle = '#fff'; x.font = '800 42px ' + FONT; x.fillText('  ' + why.axis.text, 80 + lw, 880);
        x.fillStyle = '#b3b3b3'; x.font = '600 36px ' + FONT;
        wrapText(x, why.sentence, W - 160).slice(0, 4).forEach(function (t, i) { x.fillText(t, 80, 960 + i * 58); });
        // 푸터
        x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(80, H - 210, W - 160, 2);
        x.fillStyle = '#fff'; x.font = '900 38px ' + FONT; x.fillText('여자아이돌 체급 점수표', 80, H - 140);
        x.fillStyle = '#7c7c7c'; x.font = '600 28px ' + FONT; x.fillText(base.replace(/^https?:\/\//, '').replace(/\/$/, ''), 80, H - 90);
        resolve(c);
      };
      var src = imgOf(e);
      if (!src) { draw(null); return; }
      var im = new Image(); im.onload = function () { draw(im); }; im.onerror = function () { draw(null); }; im.src = src;
    });
  }
  function saveCardImage(btn) {
    var res = state.cur; if (!res) return;
    var label = btn.textContent; btn.textContent = '만드는 중…'; btn.disabled = true;
    makeCardImage(res).then(function (c) {
      c.toBlob(function (blob) {
        btn.textContent = label; btn.disabled = false;
        if (!blob) { hint('이미지를 만들지 못했어요.'); return; }
        var file = new File([blob], 'idol-discover-' + res.ent.id + '.png', { type: 'image/png' });
        var url = shareUrl(res);
        if (global.navigator.canShare && global.navigator.canShare({ files: [file] })) {
          global.navigator.share({ files: [file], title: 'IDOL DISCOVER', text: '🎲 ' + res.ent.name, url: url }).catch(function () {});
        } else {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
          hint('카드 이미지를 저장했어요.');
        }
      }, 'image/png');
    });
  }
  function shareUrl(res) { return base + '?discover=' + encodeURIComponent(res.ent.id) + '&mode=' + encodeURIComponent(res.mode) + '&scope=' + encodeURIComponent(state.scope); }

  /* ---------- URL 상태: 지금 보는 카드가 주소에 반영된다 ---------- */
  function syncUrl(res) {
    try {
      var u = new URL(location.href);
      if (res) { u.searchParams.set('discover', res.ent.id); u.searchParams.set('mode', res.mode); u.searchParams.set('scope', state.scope); }
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* noop */ }
  }

  // HOT V2: 월별 history 가 있으면 순위 위치 백분위 이동·점수 변화·NEW PEAK 를 반영한다. 실패하면 현재기세만 쓴다.
  function loadHotSignals() {
    if (!global.RankHistory) return Promise.resolve();
    return Promise.all(['KR', 'JP'].map(function (c) { return global.RankHistory.loadAll(c); })).then(function (all) {
      var map = {};
      all.forEach(function (snaps) { if (snaps.length) Object.assign(map, global.RankHistory.deltasFromSnapshots(snaps)); });
      R.setHotSignals(map);
    }).catch(function () { R.setHotSignals(null); });
  }
  function open(opts) {
    opts = opts || {};
    build();
    Promise.all([IM.ready, loadImgs(), loadHotSignals()]).then(function () {
      if (opts.scope && ['ALL', 'KR', 'JP'].indexOf(opts.scope) >= 0) state.scope = opts.scope;
      if (opts.mode && MODE_COLOR[opts.mode]) state.mode = opts.mode;
      state.opener = document.activeElement;
      root.hidden = false; document.body.style.overflow = 'hidden';
      state.stack = []; state.pending = null; renderQuick(); setView(opts.view === 'collection' || opts.view === 'report' ? opts.view : 'find');
      syncControls();
      var res = null;
      if (opts.id) res = R.discoveryFor(opts.id, opts.mode && opts.mode !== 'auto' ? opts.mode : 'random');
      if (state.view === 'find') { if (res) paint(res); else { state.cur = null; paint(R.pickDiscovery(state.mode, state.scope)); } }
      var f = (state.view === 'find' && root.querySelector('.dsc-next')) || root.querySelector('.dsc-x'); if (f) f.focus({ preventScroll: true });
    }).catch(function () {
      if (root) root.hidden = true;
      (global.__toast || global.alert)('데이터를 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.');
    });
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true; document.body.style.overflow = '';
    try {
      var u = new URL(location.href);
      if (u.searchParams.has('discover')) { u.searchParams.delete('discover'); u.searchParams.delete('mode'); u.searchParams.delete('scope'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
    } catch (e) { /* noop */ }
    if (state.opener && state.opener.focus) try { state.opener.focus(); } catch (e2) { /* noop */ }
  }

  global.Discover = { open: open, close: close };
})(window);
