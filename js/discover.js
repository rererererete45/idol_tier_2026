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

  var state = { mode: 'auto', scope: 'ALL', cur: null, opener: null, busy: false };
  var root = null, els = {};

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function reduced() { return global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function flagB(c) { return '<span class="dsc-flag ' + c.toLowerCase() + '">' + c + '</span>'; }
  function pageOf(c) { return base + IM.countries[c].page; }
  function detailUrl(e) { return pageOf(e.country) + '?group=' + encodeURIComponent(e.name); }
  function mapUrl(e) { return base + 'idol-map.html?country=' + e.country + '&group=' + encodeURIComponent(e.name); }
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
    + '.dsc-x{width:40px;height:40px;border-radius:50%;border:0;background:#252525;color:#b3b3b3;font-size:14px;cursor:pointer}.dsc-x:hover{background:#333;color:#fff}'
    + '.dsc-seg{display:flex;gap:2px;padding:3px;margin:12px 0 0;background:#121212;border-radius:9999px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}'
    + '.dsc-seg button{flex:1;min-height:40px;border:0;border-radius:9999px;background:transparent;color:#b3b3b3;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}'
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
    + '.dsc-next{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:52px;margin:12px 0 0;border:0;border-radius:9999px;background:#fff;color:#000;font:inherit;font-size:14px;font-weight:900;letter-spacing:.02em;cursor:pointer;transition:transform .12s,background .15s}'
    + '.dsc-next:hover{background:#e8e8e8}.dsc-next:active{transform:scale(.98)}.dsc-next[disabled]{opacity:.6;cursor:default}'
    + '.dsc-next i{font-style:normal;display:inline-block}.dsc-next.spin i{animation:dscSpin .5s linear infinite}'
    + '@keyframes dscSpin{to{transform:rotate(360deg)}}'
    + '.dsc-links{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}'
    + '.dsc-links>*{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:9999px;border:0;background:#252525;color:#b3b3b3;font:inherit;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none}'
    + '.dsc-links>*:hover{color:#fff;background:#2f2f2f}'
    + '.dsc-hist{margin:16px 0 0;padding-top:14px;border-top:1px solid #2a2a2a}'
    + '.dsc-hist h4{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#7c7c7c}'
    + '.dsc-hist h4 button{border:0;background:transparent;color:#7c7c7c;font:inherit;font-size:11px;font-weight:700;cursor:pointer;min-height:32px;padding:0 4px}.dsc-hist h4 button:hover{color:#fff}'
    + '.dsc-hl{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}.dsc-hl::-webkit-scrollbar{display:none}'
    + '.dsc-hl button{flex:none;min-height:40px;padding:0 12px;border:0;border-radius:9999px;background:#1f1f1f;color:#fff;font:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}'
    + '.dsc-hl button:hover{background:#2a2a2a}'
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
      + '<div class="dsc-head"><h2 id="dscT">🎲 DISCOVER</h2><button type="button" class="dsc-x" data-close aria-label="DISCOVER 닫기">✕</button></div>'
      + '<div class="dsc-seg" role="group" aria-label="국가 범위">' + SCOPES.map(function (s) { return '<button type="button" data-scope="' + s[0] + '" aria-pressed="false">' + s[1] + '</button>'; }).join('') + '</div>'
      + '<div class="dsc-modes" role="group" aria-label="발견 방식">' + MODES.map(function (m) { return '<button type="button" data-mode="' + m[0] + '" style="--mc:' + m[2] + '" aria-pressed="false">' + m[1] + '</button>'; }).join('') + '</div>'
      + '<p class="dsc-hint" id="dscHint" aria-live="polite"></p>'
      + '<div id="dscCardWrap" aria-live="polite"></div>'
      + '<div class="dsc-hist" id="dscHist"></div></div>';
    document.body.appendChild(root);
    els.wrap = root.querySelector('#dscCardWrap'); els.hint = root.querySelector('#dscHint'); els.hist = root.querySelector('#dscHist'); els.box = root.querySelector('#dscBox');

    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { close(); return; }
      var sc = e.target.closest('[data-scope]');
      if (sc) { state.scope = sc.getAttribute('data-scope'); syncControls(); next(); return; }
      var md = e.target.closest('[data-mode]');
      if (md) {
        var m = md.getAttribute('data-mode');
        if (NEED_FAV[m] && favCount() < 2) { hint('최애를 2팀 이상 저장하면 사용할 수 있어요. 카드의 ♡ 저장으로 최애를 모아 보세요.'); return; }
        state.mode = m; syncControls(); next(); return;
      }
      var nx = e.target.closest('[data-next]'); if (nx) { if (state.mode === 'daily') { state.mode = 'auto'; syncControls(); } next(); return; }
      var fv = e.target.closest('[data-fav]'); if (fv && state.cur) { toggleFav(fv); return; }
      var sh = e.target.closest('[data-share]'); if (sh && state.cur) { share(sh); return; }
      var hs = e.target.closest('[data-hid]'); if (hs) { showById(hs.getAttribute('data-hid'), hs.getAttribute('data-hmode')); return; }
      if (e.target.closest('[data-clear]')) { R.clearDiscoveryHistory(); renderHist(); hint('발견 기록을 지웠어요. 이제 이전에 본 그룹도 다시 나올 수 있어요.'); return; }
    });
    document.addEventListener('keydown', function (e) {
      if (root.hidden) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') trapFocus(e);
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
    var note = res.fellBack ? '<p class="dsc-note">' + esc(fallbackText(res)) + '</p>' : '';
    return '<article class="dsc-card" style="--mc:' + mc + '" data-key="' + esc(e.key) + '">'
      + '<span class="dsc-badge">' + esc(why.badge) + '</span>'
      + '<div class="dsc-top"><div class="dsc-av">' + esc(e.name.charAt(0)) + (imgOf(e) ? '<img alt="" src="' + imgOf(e) + '" onerror="this.remove()">' : '') + '</div>'
      + '<div><h3>' + esc(e.name) + flagB(e.country) + '</h3><p class="dsc-sub">' + esc(e.tier) + ' · ' + e.total + '점 · ' + (e.status ? esc(e.status) : '') + '</p></div></div>'
      + (tags ? '<div class="dsc-tags">' + tags + '</div>' : '')
      + '<div class="dsc-axis"><b>' + esc(why.axis.label) + '</b><span>' + esc(why.axis.text) + '</span></div>'
      + '<p class="dsc-sent">' + esc(why.sentence) + '</p>' + note
      + '<div class="dsc-act">'
      + (e.spotify ? '<a class="grn" target="_blank" rel="noopener noreferrer" href="' + esc(e.spotify) + '" aria-label="' + esc(e.name) + ' Spotify에서 듣기">Spotify ▶</a>' : '')
      + '<a href="' + detailUrl(e) + '" aria-label="' + esc(e.name) + ' 상세보기">상세보기</a>'
      + '<a href="' + mapUrl(e) + '" aria-label="' + esc(e.name) + ' 지도에서 보기">🗺 지도</a>'
      + '<button type="button" class="fav" data-fav aria-pressed="' + fav + '" aria-label="' + esc(e.name) + ' 최애 저장 토글">' + (fav ? '♥ 저장됨' : '♡ 저장') + '</button></div>'
      + '<div class="dsc-links"><a href="' + sceneUrl(e) + '" aria-label="' + esc(e.name) + '와 비슷한 그룹을 지도에서 보기">🧬 비슷한 그룹</a><button type="button" data-share aria-label="이 발견 공유하기">🔗 공유</button></div>'
      + '<button type="button" class="dsc-next" data-next aria-label="다른 그룹 발견하기"><i aria-hidden="true">🔄</i> 다른 그룹</button></article>';
  }
  function fallbackText(res) {
    var name = { taste: '내 취향', hiddenGem: '숨은 보석', expand: '취향 확장', hot: 'HOT', random: '완전 랜덤' };
    return (name[res.requested === 'auto' ? res.mode : res.requested] || '선택한 방식') + ' 후보가 부족해 ' + name[res.mode] + ' 방식으로 골랐어요.';
  }

  function paint(res, animate) {
    state.cur = res;
    els.wrap.innerHTML = res ? cardHtml(res) : '<div class="dsc-empty">보여줄 수 있는 그룹이 없어요.<br>국가 범위나 발견 기록을 확인해 주세요.</div>';
    if (res) {
      R.saveRecentDiscovery(res.ent.id);
      R.saveDiscoveryHistory({ id: res.ent.id, mode: res.mode, timestamp: Date.now() });
    }
    renderHist();
    syncControls();
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
    if (state.busy) return;
    hint('');
    var res = R.pickDiscovery(state.mode, state.scope);
    var btn = root.querySelector('.dsc-next');
    if (reduced() || !state.cur || !res) { paint(res); return; }
    // 주사위 굴리는 느낌: 잠깐 이름이 바뀌다 결과가 나온다
    state.busy = true;
    if (btn) { btn.classList.add('spin'); btn.disabled = true; }
    var card = els.wrap.querySelector('.dsc-card'), h3 = card && card.querySelector('h3');
    var pool = R.getDiscoverPool(state.scope, { ignoreRecent: true }), n = 0;
    if (card) card.classList.add('dsc-roll');
    var iv = setInterval(function () {
      if (h3 && pool.length) h3.firstChild.nodeValue = pool[Math.floor(Math.random() * pool.length)].name;
      if (++n >= 6) { clearInterval(iv); state.busy = false; paint(res); }
    }, 70);
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
    var e = state.cur.ent, url = base + 'index.html?discover=' + encodeURIComponent(e.id) + '&mode=' + encodeURIComponent(state.cur.mode);
    var text = '🎲 IDOL DISCOVER: ' + e.name + ' (' + R.describeStyle(e).join(' · ') + ')';
    if (global.navigator.share) { global.navigator.share({ title: 'IDOL DISCOVER', text: text, url: url }).catch(function () {}); return; }
    var done = function () { var t = btn.textContent; btn.textContent = '링크 복사됨 ✓'; setTimeout(function () { btn.textContent = t; }, 1600); };
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) global.navigator.clipboard.writeText(text + '\n' + url).then(done).catch(function () { global.prompt('복사해서 공유하세요', text + ' ' + url); });
    else global.prompt('복사해서 공유하세요', text + ' ' + url);
  }

  function open(opts) {
    opts = opts || {};
    build();
    Promise.all([IM.ready, loadImgs()]).then(function () {
      if (opts.scope && ['ALL', 'KR', 'JP'].indexOf(opts.scope) >= 0) state.scope = opts.scope;
      if (opts.mode && MODE_COLOR[opts.mode]) state.mode = opts.mode;
      state.opener = document.activeElement;
      root.hidden = false; document.body.style.overflow = 'hidden';
      syncControls();
      var res = null;
      if (opts.id) res = R.discoveryFor(opts.id, opts.mode && opts.mode !== 'auto' ? opts.mode : 'random');
      if (res) paint(res); else { state.cur = null; paint(R.pickDiscovery(state.mode, state.scope)); }
      var f = root.querySelector('.dsc-next') || root.querySelector('.dsc-x'); if (f) f.focus({ preventScroll: true });
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
