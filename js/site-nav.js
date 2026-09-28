/* 공통 상단 내비게이션: 홈 · 한국 · 일본 · IDOL MAP · 검색 · 최애 · 이전 화면
 * - 사이트 안 이동은 location.replace 로 하고, "이전 화면" 스택은 sessionStorage 에 따로 둔다.
 *   (브라우저 뒤로가기 기록이 링크를 탈 때마다 쌓이지 않는다.)
 * - REPLACE_NAV=false 로 바꾸면 예전처럼 브라우저 기록에 쌓인다. */
(function () {
  'use strict';
  var REPLACE_NAV = true, STACK_KEY = 'idolNavStack', FAV_KEY = 'idolTierFavorites', MAXSTACK = 40;
  var script = document.currentScript, base = '';
  if (script && script.src) base = script.src.replace(/js\/site-nav\.js.*$/, '');

  var PAGES = { home: 'index.html', kr: 'kr-idol-tier-2026-09.html', jp: 'jp-idol-tier-2026-09.html', map: 'idol-map.html' };
  function pageKey(path) {
    if (/idol-map\.html$/.test(path)) return 'map';
    if (/kr-idol-tier/.test(path)) return 'kr';
    if (/jp-idol-tier/.test(path)) return 'jp';
    return 'home';
  }
  var NAMES = { home: '홈', kr: '한국', jp: '일본', map: 'IDOL MAP' };
  var here = pageKey(location.pathname);

  /* ---------- 이전 화면 스택 ---------- */
  function readStack() { try { var v = JSON.parse(sessionStorage.getItem(STACK_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function writeStack(v) { try { sessionStorage.setItem(STACK_KEY, JSON.stringify(v.slice(-MAXSTACK))); } catch (e) { /* noop */ } }
  function groupNow() { // 페이지가 body[data-nav-group]에 열린 그룹 이름을 알려 준다
    return document.body.getAttribute('data-nav-group') || new URLSearchParams(location.search).get('group');
  }
  function labelNow() { var g = groupNow(); return NAMES[here] + (g ? ' · ' + g : ''); }
  function pushHere() {
    var s = readStack(), cur = location.href;
    if (s.length && s[s.length - 1].u === cur) return;
    s.push({ u: cur, l: labelNow() });
    writeStack(s);
  }
  function go(url) {
    if (REPLACE_NAV) location.replace(url); else location.assign(url);
  }

  /* ---------- 스타일 ---------- */
  var css = ''
    + '#sitenav{position:sticky;top:0;z-index:25;background:rgba(18,18,18,.86);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 0 rgba(255,255,255,.07);font-family:"Figtree","Helvetica Neue",helvetica,arial,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans JP",sans-serif}'
    + '#sitenav *{box-sizing:border-box}'
    + '.sn-in{max-width:1360px;margin:0 auto;padding:0 14px;height:52px;display:flex;align-items:center;gap:6px}'
    + '.sn-b{display:inline-flex;align-items:center;gap:6px;height:44px;padding:0 13px;border-radius:9999px;border:0;background:transparent;color:#b3b3b3;font:inherit;font-size:13px;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap;justify-content:center;min-width:44px;transition:background .15s,color .15s}'
    + '.sn-b:hover{background:rgba(255,255,255,.08);color:#fff}'
    + '.sn-b:focus-visible{outline:2px solid #1ed760;outline-offset:2px}'
    + '.sn-b[aria-current="page"]{background:#1ed760;color:#000}'
    + '.sn-b svg{width:16px;height:16px;fill:currentColor;flex:none}'
    + '.sn-home{color:#fff;font-weight:900;letter-spacing:-.01em}'
    + '.sn-skip{position:absolute;left:8px;top:-60px;z-index:70;padding:10px 16px;border-radius:9999px;background:#1ed760;color:#000;font-size:13px;font-weight:800;text-decoration:none;transition:top .15s}.sn-skip:focus{top:8px}'
    + '.sn-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:120;max-width:calc(100vw - 32px);padding:12px 18px;border-radius:14px;background:#2a2a2a;color:#fff;font-weight:700;font-size:13px;line-height:1.5;box-shadow:rgba(0,0,0,.6) 0 10px 30px,inset 0 0 0 1px rgba(255,255,255,.12)}'
    + '.wrap:focus{outline:none}'
    + '.sn-back{max-width:150px;padding:0 12px 0 9px;background:rgba(255,255,255,.07);color:#fff}'
    + '.sn-back span{overflow:hidden;text-overflow:ellipsis}'
    + '.sn-back[hidden]{display:none}'
    + '.sn-b .sm{display:none}'
    + '.sn-links{display:flex;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none}'
    + '.sn-links::-webkit-scrollbar{display:none}'
    + '.sn-sp{flex:1}'
    + '.sn-disc{background:linear-gradient(135deg,rgba(30,215,96,.22),rgba(83,157,245,.22));color:#fff;box-shadow:inset 0 0 0 1px rgba(30,215,96,.4)}'
    + '.sn-disc:hover{background:linear-gradient(135deg,rgba(30,215,96,.34),rgba(83,157,245,.34))}'
    + '.sn-fav b{font-weight:800;font-variant-numeric:tabular-nums}'
    + '.sn-fav .h{color:#f3727f}'
    + '.sn-sr{display:none;border-top:1px solid rgba(255,255,255,.07);background:#181818;padding:10px 14px 14px}'
    + '.sn-sr.on{display:block}'
    + '.sn-sr-in{max-width:640px;margin:0 auto}'
    + '.sn-sr input{width:100%;height:44px;border:0;border-radius:9999px;background:#121212;color:#fff;font:inherit;font-size:14px;padding:0 18px;box-shadow:inset 0 0 0 1px #4d4d4d;outline:0}'
    + '.sn-sr input:focus{box-shadow:inset 0 0 0 1.5px #1ed760}'
    + '.sn-res{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:4px;max-height:46vh;overflow-y:auto}'
    + '.sn-res a{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-radius:12px;background:#1f1f1f;color:#fff;text-decoration:none;font-size:14px;font-weight:700}'
    + '.sn-res a:hover,.sn-res a.on{background:#2a2a2a}'
    + '.sn-res .f{font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 6px;border-radius:4px;color:#000}'
    + '.sn-res .f.kr{background:#1ed760}.sn-res .f.jp{background:#f3727f}'
    + '.sn-res small{margin-left:auto;color:#7c7c7c;font-weight:700;font-size:12px}'
    + '.sn-res .none{padding:12px 14px;color:#7c7c7c;font-size:13px}'
    + '.sn-res .act{background:transparent;box-shadow:inset 0 0 0 1px #333}'
    + '.sn-top{position:fixed;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:35;width:44px;height:44px;border-radius:50%;border:0;background:#252525;color:#fff;font-size:18px;cursor:pointer;box-shadow:rgba(0,0,0,.5) 0 6px 18px;opacity:0;pointer-events:none;transition:opacity .2s,transform .15s}'
    + '.sn-top.on{opacity:1;pointer-events:auto}.sn-top:hover{background:#333}.sn-top:active{transform:scale(.92)}'
    + '@media(max-width:560px){.sn-disc .t{display:none}.sn-in{padding:0 8px;gap:2px}.sn-b{padding:0 10px;font-size:12.5px}.sn-home span{display:none}.sn-back{padding:0 10px}.sn-back span{display:none}.sn-b .sm{display:inline}.sn-b .lg{display:none}.sn-fav .t{display:none}}'
    + '@media(prefers-reduced-motion:reduce){.sn-b,.sn-top{transition:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------- DOM ---------- */
  var HOUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 8h-2.5v9h-5v-6h-3v6h-5v-9H3z"/></svg>';
  var SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"/></svg>';
  function link(key, inner, extra) {
    return '<a class="sn-b' + (extra ? ' ' + extra : '') + '" href="' + base + PAGES[key] + '"' + (here === key ? ' aria-current="page"' : '') + '>' + inner + '</a>';
  }
  var nav = document.createElement('nav');
  nav.id = 'sitenav'; nav.setAttribute('aria-label', '사이트 이동');
  nav.innerHTML = '<a class="sn-skip" href="#main">본문 바로가기</a><div class="sn-in">'
    + '<button class="sn-b sn-back" id="snBack" type="button" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 5.4L14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg><span></span></button>'
    + link('home', HOUSE + '<span>홈</span>', 'sn-home')
    + '<div class="sn-links">' + link('kr', '🇰🇷 한국') + link('jp', '🇯🇵 일본') + link('map', '<span class="lg">IDOL MAP</span><span class="sm">지도</span>') + '</div>'
    + '<span class="sn-sp"></span>'
    + '<button class="sn-b sn-disc" id="snDisc" type="button" data-discover aria-label="DISCOVER 아이돌 발견하기">🎲<span class="t">DISCOVER</span></button>'
    + '<button class="sn-b" id="snSearch" type="button" aria-label="그룹 검색" aria-expanded="false">' + SEARCH + '</button>'
    + '<a class="sn-b sn-fav" href="' + base + PAGES.map + '?country=ALL&preset=MINE" aria-label="내 최애 보기"><span class="h">♥</span><b id="snFav">0</b><span class="t">최애</span></a>'
    + '</div>'
    + '<div class="sn-sr" id="snSr"><div class="sn-sr-in"><input id="snQ" type="search" placeholder="그룹 이름 검색 (한국·일본 전체)" autocomplete="off" aria-label="그룹 검색"><ul class="sn-res" id="snRes"></ul></div></div>';
  document.body.insertBefore(nav, document.body.firstChild);
  document.addEventListener('DOMContentLoaded', function () { var w = document.querySelector('.wrap'); if (w && !w.id) { w.id = 'main'; w.setAttribute('tabindex', '-1'); } });
  window.__toast = function (msg) {
    var t = document.createElement('div'); t.className = 'sn-toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
  };
  var top = document.createElement('button');
  top.className = 'sn-top'; top.type = 'button'; top.setAttribute('aria-label', '맨 위로'); top.textContent = '↑';
  document.body.appendChild(top);
  top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  window.addEventListener('scroll', function () { top.classList.toggle('on', window.scrollY > 900); }, { passive: true });

  /* 이전 화면 버튼 */
  var backBtn = document.getElementById('snBack');
  function syncBack() {
    var s = readStack();
    // 현재 화면과 같은 항목은 건너뛴다
    while (s.length && s[s.length - 1].u === location.href) s.pop();
    var t = s[s.length - 1];
    backBtn.hidden = !t;
    if (t) { backBtn.querySelector('span').textContent = t.l; backBtn.title = '이전 화면: ' + t.l; }
  }
  backBtn.addEventListener('click', function () {
    var s = readStack();
    while (s.length && s[s.length - 1].u === location.href) s.pop();
    var t = s.pop(); writeStack(s);
    if (t) go(t.u);
  });
  syncBack();
  window.addEventListener('pageshow', syncBack);

  /* 최애 개수 */
  function favCount() { try { var v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return Array.isArray(v) ? v.length : 0; } catch (e) { return 0; } }
  function syncFav() { document.getElementById('snFav').textContent = favCount(); }
  syncFav();
  window.addEventListener('storage', syncFav); window.addEventListener('idolfav', syncFav); window.addEventListener('pageshow', syncFav);

  /* ---------- 사이트 안 링크는 기록을 쌓지 않고 이동 ---------- */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target.closest && e.target.closest('[data-discover]')) { e.preventDefault(); window.openDiscover(); return; }
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var u; try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (u.origin !== location.origin) return;
    if (!/(\.html|\/)$/.test(u.pathname)) return;
    if (u.pathname === location.pathname && u.search === location.search) return; // 같은 화면(해시만 다른 경우 등)은 그대로
    e.preventDefault();
    pushHere();
    go(u.href);
  });

  /* ---------- DISCOVER: 필요한 스크립트를 처음 눌렀을 때만 불러온다 ---------- */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = base + src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  var discP = null;
  window.openDiscover = function (opts) {
    if (!discP) {
      var p = Promise.resolve();
      if (!window.IdolMatch) p = p.then(function () { return loadScript('js/idol-match.js?v=20260935'); });
      if (!window.IdolRec) p = p.then(function () { return loadScript('js/idol-recommendation-core.js?v=20260935'); });
      if (!window.Discover) p = p.then(function () { return loadScript('js/discover.js?v=20260935'); });
      discP = p;
    }
    discP.then(function () { window.Discover.open(opts); }).catch(function () { discP = null; window.__toast('발견 기능을 불러오지 못했어요. 네트워크를 확인하고 다시 눌러 주세요.'); });
  };
  (function autoOpen() {
    var qp = new URLSearchParams(location.search);
    if (!qp.has('discover')) return;
    var v = qp.get('discover');
    var view = v === 'collection' || v === 'report' ? v : undefined;
    var go = function () { window.openDiscover({ id: v && v !== '1' && !view ? v : null, view: view, mode: qp.get('mode') || undefined, scope: qp.get('scope') || undefined }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  })();

  /* ---------- 그룹 검색 ---------- */
  var sr = document.getElementById('snSr'), q = document.getElementById('snQ'), res = document.getElementById('snRes'), sBtn = document.getElementById('snSearch');
  var IDX = null, loading = false, active = -1;
  function loadIdx() {
    if (IDX || loading) return; loading = true;
    Promise.all([fetch(base + 'data/kr_db.json').then(function (r) { return r.json(); }), fetch(base + 'data/jp_db.json').then(function (r) { return r.json(); })]).then(function (r) {
      var kr = r[0].korea || r[0], jp = r[1].japan || r[1];
      IDX = [];
      (Array.isArray(kr) ? kr : []).forEach(function (g) { IDX.push({ c: 'kr', n: g['그룹'], t: g['티어'], s: g['총점'] }); });
      (Array.isArray(jp) ? jp : []).forEach(function (g) { IDX.push({ c: 'jp', n: g['그룹'], t: g['티어'], s: g['총점'] }); });
      render();
    }).catch(function () { IDX = []; loading = false; render(); });
  }
  function urlOf(x) { return base + PAGES[x.c] + '?group=' + encodeURIComponent(x.n); }
  function render() {
    var v = q.value.trim().toLowerCase(), list;
    if (!IDX) { res.innerHTML = '<li class="none">불러오는 중…</li>'; return; }
    if (!v) list = IDX.slice().sort(function (a, b) { return b.s - a.s; }).slice(0, 6);
    else list = IDX.filter(function (x) { return x.n.toLowerCase().indexOf(v) !== -1; }).sort(function (a, b) { return (a.n.toLowerCase().indexOf(v) === 0 ? 0 : 1) - (b.n.toLowerCase().indexOf(v) === 0 ? 0 : 1) || b.s - a.s; }).slice(0, 8);
    active = list.length ? 0 : -1;
    res.innerHTML = (list.length ? list.map(function (x, i) {
      return '<li><a href="' + urlOf(x) + '" class="' + (i === 0 ? 'on' : '') + '"><span class="f ' + x.c + '">' + x.c.toUpperCase() + '</span>' + x.n.replace(/[&<>]/g, '') + '<small>' + x.t + ' · ' + x.s + '</small></a></li>';
    }).join('') : '<li class="none">검색 결과가 없어요.</li>')
      + (v ? '' : '<li class="none" style="padding:6px 14px">체급 상위 그룹이에요. 이름을 입력해 보세요.</li>');
  }
  function toggleSearch(on) {
    sr.classList.toggle('on', on); sBtn.setAttribute('aria-expanded', on);
    if (on) { loadIdx(); render(); q.focus(); } else q.blur();
  }
  sBtn.addEventListener('click', function () { toggleSearch(!sr.classList.contains('on')); });
  q.addEventListener('input', render);
  q.addEventListener('keydown', function (e) {
    var items = res.querySelectorAll('a');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      Array.prototype.forEach.call(items, function (a, i) { a.classList.toggle('on', i === active); });
    } else if (e.key === 'Enter' && items[active]) { e.preventDefault(); items[active].click(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sr.classList.contains('on')) { toggleSearch(false); return; }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleSearch(true); }
  });
  document.addEventListener('click', function (e) {
    if (sr.classList.contains('on') && !nav.contains(e.target)) toggleSearch(false);
  });
})();
