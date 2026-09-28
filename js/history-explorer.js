/* HISTORY EXPLORER — TIME MACHINE · MOVERS · RECORD BOOK · MAP REPLAY 화면 (IDOL_HISTORY_SUITE_V3_SPEC.md)
 * - 계산은 HistoryAnalytics(순수 함수), 로딩은 RankHistory(캐시)를 그대로 쓴다. 이 파일은 상태·URL·렌더만 맡는다.
 * - 선택 상태(국가/월/보기/필터/열린 그룹)는 주소에 저장된다. 월을 넘기거나 필터를 바꾸는 것은 replaceState,
 *   보기 전환·국가 전환·상세 열기는 pushState 라서 뒤로가기는 '보기 단위'로만 쌓인다(사이트 전체의 뒤로가기 50번 문제를 만들지 않는다).
 * - 순위·점수는 snapshot 원본 그대로 보여 주고, 원인을 추측하는 문장은 쓰지 않는다('평가항목상 주요 변화'). */
(function () {
  'use strict';
  var RH = window.RankHistory, HA = window.HistoryAnalytics;
  var DEBUG = new URLSearchParams(location.search).get('debugHistory') === '1';
  var script = document.currentScript, BASE = script && script.src ? script.src.replace(/js\/history-explorer\.js.*$/, '') : '';
  var V = '20260945';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var fp = RH.fmtPeriod, sg = HA.fmtSigned;

  var TIER_COLORS = { 'S+': '#1ed760', 'S': '#36e0a0', 'A+': '#22d3ee', 'A': '#38a8f8', 'B+': '#5b8def', 'B': '#7c7cf0', 'C+': '#a78bfa', 'C': '#b592e8', 'D+': '#8b95a7', 'D': '#5f6b7d' };
  var VIEWS = ['timeline', 'movers', 'records', 'map'];
  var VIEW_NAME = { timeline: 'TIME MACHINE', movers: 'MOVERS', records: 'RECORD BOOK', map: 'MAP REPLAY' };
  var EN = { KR: 'KOREA', JP: 'JAPAN' }, KO = HA.COUNTRY_NAME, PAGE = { KR: 'kr', JP: 'jp' };
  var MCATS = [
    { key: 'rankUp', label: 'RANK UP', desc: '순위가 오른 그룹. 상대 위치가 많이 오른 순서예요' },
    { key: 'rankDown', label: 'RANK DOWN', desc: '순위가 내려간 그룹. 순위가 내려갔다고 인기가 떨어진 건 아니에요' },
    { key: 'scoreUp', label: 'SCORE UP', desc: '총점이 오른 그룹, 많이 오른 순서' },
    { key: 'scoreDown', label: 'SCORE DOWN', desc: '총점이 내려간 그룹, 많이 내려간 순서' },
    { key: 'momentumUp', label: 'MOMENTUM UP', desc: '현재기세 점수가 오른 그룹, 많이 오른 순서' },
    { key: 'tierUp', label: 'TIER UP', desc: '티어가 오른 그룹, 많이 오른 순서' },
    { key: 'newPeak', label: 'NEW PEAK', desc: '지금까지의 자기 최고 순위를 넘어선 그룹' },
    { key: 'newEntry', label: 'NEW ENTRY', desc: '비교 시작 때는 없다가 새로 들어온 그룹' }
  ];
  var RANGES = [['all', '전체'], ['2025', '2025'], ['2026', '2026 YTD']];

  /* ---------- 상태 / URL ---------- */
  var S = { country: 'KR', period: null, view: 'timeline', from: null, mcat: null, cat: 'rank', range: 'all', q: '', group: null, pin: null, trail: '6', speed: 1 };
  var BR = { KR: [], JP: [] }; // data/history/breaks.json (구간 경계)
  var IDX = null, TOK = 0, main = null, modalOpener = null, modalPushed = false, DET = null;
  var TL = { q: '', tier: 'ALL' };
  var MV = { limit: 10 };

  function prefCountry() { try { var v = localStorage.getItem('idolHistoryCountry'); return v === 'KR' || v === 'JP' ? v : null; } catch (e) { return null; } }
  function savePref() { try { localStorage.setItem('idolHistoryCountry', S.country); } catch (e) { /* noop */ } }
  function periods() { return IDX[S.country]; }
  function latest() { var p = periods(); return p[p.length - 1]; }

  function readUrl() {
    var q = new URLSearchParams(location.search), c = q.get('country');
    if (c !== 'KR' && c !== 'JP') c = prefCountry() || 'KR';
    S.country = c;
    var ps = IDX[c], p = q.get('period');
    S.period = ps.indexOf(p) >= 0 ? p : ps[ps.length - 1];
    var v = q.get('view'); S.view = VIEWS.indexOf(v) >= 0 ? v : 'timeline';
    var f = q.get('from'); S.from = f && ps.indexOf(f) >= 0 && RH.monthIndex(f) < RH.monthIndex(S.period) ? f : null;
    S.mcat = MCATS.some(function (m) { return m.key === q.get('mcat'); }) ? q.get('mcat') : null;
    S.cat = HA.CATEGORIES.some(function (m) { return m.key === q.get('cat'); }) ? q.get('cat') : 'rank';
    S.range = RANGES.some(function (r) { return r[0] === q.get('range'); }) ? q.get('range') : 'all';
    S.q = (q.get('q') || '').slice(0, 40);
    S.group = q.get('group') || null;
    S.pin = q.get('pin') || null;
    S.trail = ['off', '3', '6', '12', 'all'].indexOf(q.get('trail')) >= 0 ? q.get('trail') : '6';
    S.speed = [0.75, 1, 1.5, 2].indexOf(Number(q.get('speed'))) >= 0 ? Number(q.get('speed')) : 1;
  }
  function urlFor(o) {
    var s = Object.assign({}, S, o || {}), q = new URLSearchParams();
    q.set('country', s.country);
    if (s.view !== 'records') q.set('period', s.period);
    q.set('view', s.view);
    if (s.view === 'movers') { if (s.from) q.set('from', s.from); if (s.mcat) q.set('mcat', s.mcat); }
    if (s.view === 'records') { if (s.range !== 'all') q.set('range', s.range); if (s.cat !== 'rank') q.set('cat', s.cat); if (s.q) q.set('q', s.q); }
    if (s.view === 'map') { if (s.pin) q.set('pin', s.pin); if (s.trail !== '6') q.set('trail', s.trail); if (s.speed !== 1) q.set('speed', s.speed); }
    if (s.group) q.set('group', s.group);
    return location.pathname + '?' + q.toString();
  }
  function commit(push) {
    try { history[push ? 'pushState' : 'replaceState'](null, '', urlFor()); } catch (e) { /* noop */ }
  }
  // 보기/국가/상세처럼 '화면 단위'로 바뀌는 것은 push, 월·필터처럼 연속 조작은 replace
  function go(patch, push) { Object.assign(S, patch); commit(push); render(); }
  function setPeriod(p, replaceOnly) {
    if (!p || p === S.period) return;
    S.period = p;
    if (S.from && RH.monthIndex(S.from) >= RH.monthIndex(p)) S.from = null;
    commit(false);
    if (S.view === 'map' && window.MapReplay && window.MapReplay.active()) { syncControls(); window.MapReplay.setPeriod(p); } else render();
  }
  function stepPeriod(d) {
    var ps = periods(), i = ps.indexOf(S.period) + d;
    if (i >= 0 && i < ps.length) setPeriod(ps[i]);
  }

  /* ---------- 로딩 ---------- */
  function snap(c, p) { return RH.loadCountrySnapshot(c, p); }
  function allSnaps(c) { return RH.loadAll(c); }
  function scriptLoad(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = BASE + src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  var mapP = null;
  function ensureMap() {
    if (!mapP) {
      var p = Promise.resolve();
      if (!window.IdolMatch) p = p.then(function () { return scriptLoad('js/idol-match.js?v=' + V); });
      if (!window.IdolRec) p = p.then(function () { return scriptLoad('js/idol-recommendation-core.js?v=' + V); });
      if (!window.MapReplay) p = p.then(function () { return scriptLoad('js/map-replay.js?v=' + V); });
      mapP = p.then(function () { return window.IdolMatch.ready; }).catch(function (e) { mapP = null; throw e; });
    }
    return mapP;
  }

  /* ---------- 공통 렌더 조각 ---------- */
  function tierChip(t) { return '<span class="chip" style="background:' + (TIER_COLORS[t] || '#777') + '">' + esc(t) + '</span>'; }
  function badge(r) { return RH.renderRankDeltaBadge({ kind: r.kind, n: r.n, scoreDelta: r.scoreDelta }); }
  function pctTxt(v) { return v === null || v === undefined ? '–' : sg(v, 1) + '%p'; }
  function metricBars(country, g) {
    return HA.metricDefs(country).map(function (d) {
      var v = g.metrics ? g.metrics[d.key] : null;
      return '<i style="height:' + (v == null ? 0 : Math.max(6, Math.round(v / d.max * 100))) + '%" title="' + esc(d.label) + ' ' + v + '/' + d.max + '"></i>';
    }).join('');
  }
  function whyChips(mdelta) {
    if (!mdelta || !mdelta.comparable) return '<p class="note" style="margin:0">비교할 세부 항목이 없어요.</p>';
    if (!mdelta.changes.length) return '<p class="note" style="margin:0">세부 항목 점수는 지난달과 같아요.</p>';
    var na = mdelta.items.filter(function (i) { return i.delta === null; });
    return '<ul class="wy">' + mdelta.changes.map(function (c) {
      return '<li class="' + (c.delta > 0 ? 'up' : 'dn') + '" title="' + esc(c.label) + ' ' + c.prev + ' → ' + c.cur + '">' + (c.delta > 0 ? '▲' : '▼') + ' ' + esc(c.label) + ' ' + sg(c.delta) + '</li>';
    }).join('') + na.map(function (i) { return '<li class="na">' + esc(i.label) + ' N/A</li>'; }).join('') + '</ul>';
  }
  function moveTitle(r, prevP) {
    if (r.kind === 'none') return '첫 기록';
    if (r.kind === 'new') return 'NEW — 이번 달 새로 진입';
    return '지난달 #' + r.prev.rank + ' → #' + r.cur.rank + (r.scoreDelta !== null ? ' · 점수 ' + sg(r.scoreDelta) : '') + (r.movement !== null ? ' · 상대 위치 ' + pctTxt(r.movementPct) : '');
  }
  // 평가 기준·자료 갱신으로 보이는 구간(breaks.json)을 지나는 화면에는 이유를 밝힌다(값은 그대로 두고 표시만 한다)
  function breakBanner(list, lead) {
    if (!list || !list.length) return '';
    return '<div class="verbanner" role="note"><b>주의 · ' + esc(lead) + '</b><br>' + list.map(function (b) {
      return fp(b.from) + ' → ' + fp(b.to) + ' · ' + esc(b.reason) + ' <span style="opacity:.75">(' + esc(b.evidence) + ')</span>';
    }).join('<br>') + '</div>';
  }
  function showError(title, sub, retry) {
    main.innerHTML = '<div class="empty err"><b>' + esc(title) + '</b>' + esc(sub || '') + (retry ? '<br><button class="pill" type="button" data-retry style="box-shadow:inset 0 0 0 1px var(--bd)">다시 시도</button>' : '') + '</div>';
    main.setAttribute('aria-busy', 'false');
  }
  function skeleton() { main.innerHTML = '<div class="skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>'; }
  function debugSnap(c, p, s) {
    var v = HA.validateSnapshot(c, p, s);
    if (v.errors.length || v.warnings.length) console.warn('[history] ' + c + ' ' + p, v);
  }

  /* ---------- 상단 컨트롤 ---------- */
  function syncControls() {
    var c = S.country, ps = periods(), first = ps[0], last = ps[ps.length - 1];
    document.body.setAttribute('data-country', c);
    Array.prototype.forEach.call(document.querySelectorAll('[data-country]'), function (b) { if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', b.getAttribute('data-country') === c); });
    var sel = $('hxPeriod');
    if (sel.getAttribute('data-c') !== c) {
      sel.setAttribute('data-c', c);
      sel.innerHTML = ps.slice().reverse().map(function (p) { return '<option value="' + p + '">' + fp(p) + '</option>'; }).join('');
      buildRail();
    }
    sel.value = S.period;
    var i = ps.indexOf(S.period);
    $('hxPrev').disabled = i <= 0; $('hxNext').disabled = i >= ps.length - 1;
    $('hxLatest').hidden = S.period === last;
    var rec = S.view === 'records';
    $('hxMnav').hidden = rec; $('hxRail').hidden = rec;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { var on = t.getAttribute('data-view') === S.view; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    Array.prototype.forEach.call($('hxRail').querySelectorAll('button'), function (b) { b.removeAttribute('aria-current'); if (b.getAttribute('data-p') === S.period) b.setAttribute('aria-current', 'true'); });
    var cur = $('hxRail').querySelector('[aria-current]');
    if (cur && !rec) { var r = $('hxRail'); r.scrollLeft = cur.offsetLeft - r.clientWidth / 2 + cur.clientWidth / 2; }
    $('hxEyebrow').textContent = 'HISTORY · ' + fp(first) + ' – ' + fp(last) + ' · ' + ps.length + ' MONTHS';
    document.title = (S.view === 'records' ? 'RECORD BOOK' : fp(S.period) + ' ' + VIEW_NAME[S.view]) + ' · ' + KO[c] + ' · HISTORY';
  }
  function buildRail() {
    var ps = periods(), h = '', prevY = '';
    ps.forEach(function (p) {
      var y = p.slice(0, 4), m = p.slice(5);
      h += '<button type="button" data-p="' + p + '" aria-label="' + fp(p) + '"><small>' + (y !== prevY ? y : '') + '</small><b>' + m + '</b></button>';
      prevY = y;
    });
    $('hxRail').innerHTML = h;
  }

  /* ================= TIME MACHINE ================= */
  function viewTimeline(tok) {
    var c = S.country, p = S.period, pp = HA.previousPeriod(periods(), p);
    return Promise.all([snap(c, p), pp ? snap(c, pp) : Promise.resolve(null)]).then(function (r) {
      if (tok !== TOK) return;
      var cur = r[0], prev = r[1];
      if (!cur) return showError('이 달 기록을 불러오지 못했어요.', '다른 달을 골라 주세요.', true);
      if (DEBUG) debugSnap(c, p, cur);
      var cmp = HA.compareSnapshots(c, prev, cur, { breaks: BR[c] });
      DET = null;
      main.innerHTML = timelineHtml(c, p, pp, cur, prev, cmp);
      drawRanking(cmp);
    });
  }
  function timelineHtml(c, p, pp, cur, prev, cmp) {
    var gs = cur.groups, n = gs.length, tiers = {};
    gs.forEach(function (g) { tiers[g.tier] = (tiers[g.tier] || 0) + 1; });
    var top = gs.filter(function (g) { return g.rank === 1; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var avg = gs.reduce(function (a, g) { return a + g.score; }, 0) / n;
    var sCnt = (tiers['S+'] || 0) + (tiers['S'] || 0);
    var prevMissing = !!pp && !prev;
    var top5 = cmp.rows.filter(function (r) { return r.cur.rank <= 5; }).sort(function (a, b) { return a.cur.rank - b.cur.rank || (a.id < b.id ? -1 : 1); });
    var firstTxt = !pp ? '첫 기록' : prevMissing ? '지난달 기록 없음' : '지난달 ' + cmp.prevPop + '팀';
    var h = '<section class="tm-hero"><p class="k">MONTHLY SNAPSHOT</p><h2><span class="big">' + fp(p) + '</span><span class="what">' + EN[c] + ' — MONTHLY ARCHIVE</span></h2>'
      + '<p class="lead">그 달에 매겨진 순위와 점수 그대로예요. 지금 기준으로 다시 계산하지 않았어요.</p></section>';
    if (prevMissing) h += '<p class="note">지난달(' + fp(pp) + ') 기록을 불러오지 못해서 순위 변동은 못 보여줘요.</p>';
    h += breakBanner(cmp.breaks, '이 달 순위 변동은 참고만 하세요');
    h += '<div class="kpis">'
      + '<div class="kpi"><small>평가 팀 수</small><b>' + n + '<span style="font-size:15px;font-weight:800;color:var(--tx2)"> 팀</span></b><em>' + firstTxt + '</em></div>'
      + '<div class="kpi"><small>' + (top.length > 1 ? '공동 1위' : '1위') + '</small><b class="txt">' + top.map(function (g) { return esc(g.group); }).join(' · ') + '</b><em>' + top[0].score + '점 · ' + esc(top[0].tier) + '</em></div>'
      + '<div class="kpi"><small>평균 점수</small><b>' + avg.toFixed(1) + '</b><em>' + esc(KO[c]) + ' 안에서만 비교해요</em></div>'
      + '<div class="kpi"><small>S+ / S 팀</small><b>' + sCnt + '</b><em>S+ ' + (tiers['S+'] || 0) + ' · S ' + (tiers['S'] || 0) + '</em></div>'
      + '<div class="kpi"><small>신규 진입</small><b>' + (cmp.first ? '–' : cmp.newEntries.length) + '</b><em>' + (cmp.first ? '비교할 지난달 기록 없음' : cmp.exits.length ? '빠진 팀 ' + cmp.exits.length + '팀' : '지난달 대비') + '</em></div>'
      + '</div>';
    // 티어 분포
    var tk = HA.TIERS.filter(function (t) { return tiers[t]; });
    h += '<section class="sec"><h2>TIER DISTRIBUTION <small>' + esc(KO[c]) + ' ' + fp(p) + ' 기준</small></h2><div class="tierbar" role="img" aria-label="티어 분포: ' + tk.map(function (t) { return t + ' ' + tiers[t] + '팀'; }).join(', ') + '">'
      + tk.map(function (t) { return '<i style="flex:' + tiers[t] + ';background:' + TIER_COLORS[t] + '" title="' + t + ' ' + tiers[t] + '팀"></i>'; }).join('') + '</div>'
      + '<ul class="tiersleg">' + tk.map(function (t) { return '<li><i style="background:' + TIER_COLORS[t] + '"></i>' + t + ' <b>' + tiers[t] + '</b></li>'; }).join('') + '</ul></section>';
    // TOP 5
    h += '<section class="sec"><h2>TOP 5 RANKS <small>' + (top5.length > 5 ? '공동 순위를 모두 표시해 ' + top5.length + '팀' : '5위권') + '</small></h2><ol class="t5">'
      + top5.map(function (r) {
        return '<li><button type="button" data-open="' + r.id + '" title="' + esc(moveTitle(r)) + '"><span class="n">' + r.cur.rank + '</span><span class="nm">' + esc(r.group) + '</span><span class="sc">' + r.cur.score + '점 ' + tierChip(r.cur.tier) + ' ' + badge(r) + '</span></button></li>';
      }).join('') + '</ol></section>';
    if (!cmp.first && cmp.newEntries.length) {
      h += '<section class="sec"><h2>NEW ENTRIES <small>이번 달 처음 들어온 그룹</small></h2><ul class="newlist">'
        + cmp.newEntries.map(function (r) { return '<li><button type="button" data-open="' + r.id + '">NEW · ' + esc(r.group) + ' <span style="color:var(--tx2)">#' + r.cur.rank + '</span></button></li>'; }).join('') + '</ul></section>';
    }
    // 전체 순위
    var tierBtns = ['ALL'].concat(tk).map(function (t) { return '<button type="button" data-tier="' + t + '" aria-pressed="' + (TL.tier === t) + '">' + (t === 'ALL' ? '전체' : t) + '</button>'; }).join('');
    h += '<section class="sec"><h2>FULL RANKING <small id="rkCount"></small></h2>'
      + '<div class="filt"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"/></svg><input id="tlQ" type="search" placeholder="그룹 이름 찾기" autocomplete="off" value="' + esc(TL.q) + '" aria-label="그룹 이름 검색"></label><div class="tchips" role="group" aria-label="티어 필터">' + tierBtns + '</div></div>'
      + '<ol class="rk" id="rkList"></ol>'
      + '<p class="note">순위는 그 달에 매긴 값 그대로예요(T는 공동 순위). 변동 배지는 <b>' + (pp ? fp(pp) + ' 대비' : '비교할 지난달 기록 없음') + '</b>예요. 순위가 내려갔다고 인기가 떨어진 건 아니에요. 한국과 일본은 기준이 달라서 서로 비교하지 않아요.</p></section>';
    if (DEBUG) h += '<details class="note"><summary>debug</summary>' + esc(JSON.stringify(HA.validateSnapshot(c, p, cur))) + '</details>';
    return h;
  }
  function drawRanking(cmp) {
    DETCMP = cmp;
    var q = TL.q.trim().toLowerCase(), list = $('rkList');
    if (!list) return;
    var rank = {}; cmp.rows.forEach(function (r) { rank[r.cur.rank] = (rank[r.cur.rank] || 0) + 1; });
    var rows = cmp.rows.slice().sort(function (a, b) { return a.cur.rank - b.cur.rank || (a.id < b.id ? -1 : 1); })
      .filter(function (r) { return (TL.tier === 'ALL' || r.cur.tier === TL.tier) && (!q || r.group.toLowerCase().indexOf(q) !== -1); });
    $('rkCount').textContent = rows.length + '팀' + (rows.length !== cmp.rows.length ? ' / ' + cmp.rows.length + '팀' : '') + ' · 누르면 그 달 상세';
    list.innerHTML = rows.length ? rows.map(function (r) {
      var g = r.cur, sd = r.scoreDelta;
      return '<li><button type="button" class="row" data-open="' + r.id + '" title="' + esc(r.group + ' · ' + moveTitle(r)) + '">'
        + '<span class="rkn' + (g.rank <= 3 ? ' top' : '') + (rank[g.rank] > 1 ? ' tie' : '') + '">' + g.rank + '</span><span>' + badge(r) + '</span>'
        + '<span class="nm">' + esc(r.group) + '</span><span class="mb" aria-hidden="true">' + metricBars(cmp.country, g) + '</span><span class="tr">' + tierChip(g.tier) + '</span>'
        + '<span class="sc">' + g.score + '<small class="' + (sd > 0 ? 'up' : sd < 0 ? 'dn' : '') + '"><span class="tt">' + esc(g.tier) + '</span>' + (sd === null || sd === undefined ? '' : ' ' + sg(sd)) + '</small></span></button></li>';
    }).join('') : '<li class="empty">조건에 맞는 그룹이 없어요.<br><button class="pill" type="button" data-clear style="box-shadow:inset 0 0 0 1px var(--bd)">필터 지우기</button></li>';
  }

  /* ================= 과거 상세 (HISTORICAL DETAIL) ================= */
  function openDetail(id, tab) {
    var c = S.country;
    modalOpener = document.activeElement;
    if (!modalPushed && !S.group) { S.group = id; commit(true); modalPushed = true; } else { S.group = id; commit(false); }
    showDetail(id, tab || 'summary');
  }
  function closeDetail(fromPop) {
    if (!S.group && $('hxModal').hidden) return;
    var pushed = modalPushed;
    modalPushed = false; S.group = null;
    if (!fromPop) { if (pushed) { history.back(); } else commit(false); }
    hideModal();
  }
  function hideModal() {
    $('hxModal').hidden = true; document.body.classList.remove('lock'); DET = null;
    if (modalOpener && modalOpener.focus && document.contains(modalOpener)) modalOpener.focus({ preventScroll: true });
    modalOpener = null;
  }
  function detailBase(id) {
    var c = S.country, p = S.period, ps = periods(), pp = HA.previousPeriod(ps, p);
    return Promise.all([snap(c, p), pp ? snap(c, pp) : Promise.resolve(null)]).then(function (r) {
      var cur = r[0], prev = r[1]; if (!cur) return null;
      var e = HA.entryById(cur, id); if (!e) return { missing: true };
      var cmp = HA.compareSnapshots(c, prev, cur, { breaks: BR[c] }), row = cmp.rows.filter(function (x) { return x.id === id; })[0];
      var order = cur.groups.slice().sort(function (a, b) { return a.rank - b.rank || (a.id < b.id ? -1 : 1); }).map(function (g) { return { id: g.id, name: g.group, rank: g.rank }; });
      return { country: c, period: p, prevP: pp, prevMissing: !!pp && !prev, id: id, cur: e, prev: prev, cmp: cmp, row: row, order: order, hist: null };
    });
  }
  function showDetail(id, tab) {
    var sheet = $('hxSheet'), modal = $('hxModal');
    modal.hidden = false; document.body.classList.add('lock');
    var token = ++TOK_D;
    if (!DET || DET.id !== id || DET.period !== S.period || DET.country !== S.country) {
      sheet.innerHTML = '<div class="hx-sh-body"><div class="skel" aria-hidden="true"><i></i><i></i></div></div>';
      DET = null;
    }
    detailBase(id).then(function (d) {
      if (token !== TOK_D) return;
      if (!d || d.missing) {
        sheet.innerHTML = '<div class="hx-sh-head"><div class="tt"><p class="ey">' + fp(S.period) + ' ARCHIVE</p><h2 id="hxDlgTitle">기록 없음</h2></div><button class="hx-sh-x" type="button" data-close aria-label="닫기">✕</button></div><div class="hx-sh-body"><p class="note">' + (d ? '이 그룹은 ' + fp(S.period) + '에는 평가에 없었어요.' : '이 달 기록을 불러오지 못했어요.') + '</p></div>';
        focusSheet(); return;
      }
      DET = d; d.tab = tab; renderDetail();
      focusSheet();
      allSnaps(d.country).then(function (snaps) {
        if (token !== TOK_D || !DET || DET.id !== d.id) return;
        DET.hist = HA.groupHistoryUntil(snaps, d.id, d.period); DET.snaps = snaps;
        renderDetail(true);
      });
    });
  }
  var TOK_D = 0;
  function focusSheet() { var x = $('hxSheet').querySelector('[data-close]'); if (x) x.focus({ preventScroll: true }); }
  function renderDetail(keepScroll) {
    var d = DET, sheet = $('hxSheet'); if (!d) return;
    var ae = document.activeElement, fk = null;
    if (ae && sheet.contains(ae)) fk = ae.hasAttribute('data-close') ? '[data-close]' : ae.getAttribute('data-dtab') ? '[data-dtab="' + ae.getAttribute('data-dtab') + '"]' : null;
    var y = sheet.scrollTop, r = d.row, e = d.cur, i = d.order.map(function (o) { return o.id; }).indexOf(d.id), pv = d.order[i - 1], nx = d.order[i + 1];
    var tabs = [['summary', 'SUMMARY'], ['metrics', 'METRICS'], ['career', 'CAREER LINE']];
    var h = '<div class="hx-sh-head"><div class="tt"><p class="ey">' + fp(d.period) + ' ARCHIVE · ' + EN[d.country] + '</p><h2 id="hxDlgTitle">' + esc(e.group) + '</h2></div><button class="hx-sh-x" type="button" data-close aria-label="닫기">✕</button></div>'
      + '<div class="hx-sh-nav"><button type="button" data-open="' + (pv ? pv.id : '') + '"' + (pv ? '' : ' disabled') + ' aria-label="한 순위 위 그룹">' + (pv ? '‹ #' + pv.rank + ' ' + esc(pv.name) : '‹') + '</button><button type="button" data-open="' + (nx ? nx.id : '') + '"' + (nx ? '' : ' disabled') + ' aria-label="한 순위 아래 그룹">' + (nx ? '#' + nx.rank + ' ' + esc(nx.name) + ' ›' : '›') + '</button></div>'
      + '<div class="hx-sh-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-dtab="' + t[0] + '" aria-selected="' + (d.tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>'
      + '<div class="hx-sh-body" id="hxDBody">' + detailTab(d) + '</div>';
    sheet.innerHTML = h;
    if (keepScroll) sheet.scrollTop = y;
    if (fk) { var fn = sheet.querySelector(fk); if (fn) fn.focus({ preventScroll: true }); }
  }
  function detailTab(d) {
    var r = d.row, e = d.cur, c = d.country;
    if (d.tab === 'metrics') {
      var defs = HA.metricDefs(c), md = r.metric;
      return defs.map(function (df, i) {
        var v = e.metrics ? e.metrics[df.key] : null, it = md && md.items ? md.items[i] : null;
        return '<div class="mrow"><span class="lb">' + esc(df.label) + '</span><span class="bar"><i style="width:' + (v == null ? 0 : Math.round(v / df.max * 100)) + '%"></i></span><span class="vv">' + (v == null ? '–' : v) + '<small>/' + df.max + '</small>' + (it && it.delta !== null && it.delta !== 0 ? ' <span style="color:' + (it.delta > 0 ? 'var(--green)' : 'var(--sakura)') + '">' + (it.delta > 0 ? '▲' : '▼') + Math.abs(it.delta) + '</span>' : '') + '</span></div>';
      }).join('') + '<p class="dnote">막대는 항목별 만점 대비 점수, ▲▼는 ' + (d.prevP ? fp(d.prevP) : '지난달') + ' 대비 변화예요.</p>';
    }
    if (d.tab === 'career') {
      if (!d.hist) return '<p class="note">기록을 불러오는 중…</p>';
      if (d.hist.length < 2) return '<div class="empty"><b>첫 기록</b>' + fp(d.period) + '까지 기록이 한 달뿐이라 그래프는 다음 달부터 그려져요.</div>';
      var rs = [{ name: '순위', color: '#1ed760', points: d.hist.map(function (h) { return { p: h.period, v: h.rank }; }) }];
      var ss = [{ name: '점수', color: '#539df5', points: d.hist.map(function (h) { return { p: h.period, v: h.score }; }) }];
      return '<p class="dnote" style="margin:0 0 6px"><b style="color:var(--tx)">' + fp(d.hist[0].period) + ' – ' + fp(d.period) + '</b> · ' + d.hist.length + '개월 기록. ' + fp(d.period) + ' 이후 기록은 뺐어요.</p>'
        + '<p class="rh-k">순위 <small>1위가 위쪽</small></p>' + RH.lineChart({ series: rs, invert: true, rank: true, label: fp(d.period) + '까지의 월별 순위 추이 차트' })
        + '<p class="rh-k">점수 <small>이 그룹 자신의 월별 점수</small></p>' + RH.lineChart({ series: ss, invert: false, rank: false, h: 150, label: fp(d.period) + '까지의 월별 점수 추이 차트' })
        + '<details class="ctab"><summary>표로 보기</summary><table><thead><tr><th>기간</th><th>순위</th><th>티어</th><th>점수</th></tr></thead><tbody>'
        + d.hist.slice().reverse().map(function (h) { return '<tr><td>' + fp(h.period) + '</td><td>#' + h.rank + '</td><td>' + esc(h.tier) + '</td><td>' + h.score + '</td></tr>'; }).join('') + '</tbody></table></details>';
    }
    // SUMMARY
    var best = d.hist && d.hist.length ? RH.getBestRank(d.hist) : null;
    var prevTxt = r.kind === 'none' ? '첫 기록' : r.kind === 'new' ? 'NEW' : '#' + r.prev.rank;
    var prevSub = r.kind === 'none' ? '비교할 지난달 기록 없음' : r.kind === 'new' ? '지난달 기록 없음' : fp(d.prevP) + (r.movement !== null ? ' · 상대 위치 ' + pctTxt(r.movementPct) : '');
    var h = '<div class="dsum"><span class="rk1">#' + e.rank + '</span>' + badge(r) + '<span class="sc1">' + e.score + '점</span>' + tierChip(e.tier) + '</div>'
      + '<dl class="dfacts">'
      + '<div><dt>지난달</dt><dd>' + prevTxt + '<small>' + esc(prevSub) + '</small></dd></div>'
      + '<div><dt>당시까지 최고</dt><dd>' + (best ? '#' + best.rank : '…') + '<small>' + (best ? fp(best.period) + (best.rank === e.rank && best.period === d.period ? ' · 이번 달' : '') : '불러오는 중') + '</small></dd></div>'
      + '<div><dt>기록 기간</dt><dd>' + (d.hist && d.hist.length ? fp(d.hist[0].period) + '–' + fp(d.period).slice(2) : '…') + '<small>' + (d.hist ? d.hist.length + '개월 (이후 기록 제외)' : '불러오는 중') + '</small></dd></div>'
      + '<div><dt>평가 팀 수</dt><dd>' + d.cmp.curPop + '팀<small>' + (d.prev ? '지난달 ' + d.cmp.prevPop + '팀' : '첫 기록') + '</small></dd></div>'
      + '</dl>';
    h += '<div class="dwhy"><h3>WHY IT MOVED · 달라진 항목</h3>';
    if (d.prevMissing) h += '<p class="note" style="margin:0">지난달 기록을 불러오지 못해 변화를 계산하지 못했어요.</p>';
    else if (r.kind === 'none') h += '<p class="note" style="margin:0"><b>첫 기록</b> · 비교할 지난달 기록이 없어요.</p>';
    else if (r.kind === 'new') h += '<p class="note" style="margin:0">이번 달 처음 들어와서 비교할 지난달 기록이 없어요.</p>';
    else {
      if (d.cmp.breaks.length) h += breakBanner(d.cmp.breaks, '이 달 변화는 참고만 하세요');
      h += '<p class="dline">총점 <b>' + r.prev.score + ' → ' + e.score + '</b> (' + sg(r.scoreDelta) + ') · 순위 <b>#' + r.prev.rank + ' → #' + e.rank + '</b>' + (r.tier.dir && r.tier.dir !== 'same' ? ' · 티어 ' + esc(r.tier.from) + ' → ' + esc(r.tier.to) : '') + '</p>' + whyChips(r.metric);
      if (r.movement !== null) h += '<p class="dnote">' + esc(KO[d.country]) + ' 안에서의 상대 위치는 <b style="color:var(--tx2)">' + pctTxt(r.movementPct) + '</b> 바뀌었어요' + (d.cmp.prevPop !== d.cmp.curPop ? '(팀 수 ' + d.cmp.prevPop + ' → ' + d.cmp.curPop + ' 반영)' : '') + '. 어떤 항목이 달라졌는지만 알 수 있고, 왜 그랬는지는 이 데이터로 알 수 없어요.</p>';
      if (r.metric.mismatch) h += '<p class="dnote" style="color:var(--warn)">세부 항목 합과 총점 변화가 달라요. 데이터 확인이 필요해요.</p>';
    }
    h += '</div>';
    h += '<div class="dcta"><a class="pri" href="' + PAGE[d.country] + '?id=' + encodeURIComponent(d.id) + '&group=' + encodeURIComponent(e.group) + '">현재 기록 보기 →</a>'
      + '<a class="sec2" data-go-map="' + d.id + '" href="' + urlFor({ view: 'map', pin: d.id, group: null }) + '">' + fp(d.period) + ' 지도에서 보기</a></div>';
    return h;
  }

  /* ================= MOVERS ================= */
  function moverFrom(to) {
    var ps = periods();
    if (S.from && RH.monthIndex(S.from) < RH.monthIndex(to) && ps.indexOf(S.from) >= 0) return S.from;
    return HA.previousPeriod(ps, to);
  }
  function presetFrom(to, n) {
    var ps = periods(), t = RH.monthIndex(to) - n, best = null;
    ps.forEach(function (p) { if (RH.monthIndex(p) <= t && RH.monthIndex(p) < RH.monthIndex(to)) best = p; });
    return best;
  }
  function viewMovers(tok) {
    var c = S.country, to = S.period, from = moverFrom(to), ps = periods();
    if (!from) {
      main.innerHTML = '<div class="empty"><b>첫 기록</b>' + fp(to) + '이 가장 처음 기록이라 비교할 지난달이 없어요.<br><button class="pill" type="button" data-setperiod="' + ps[1] + '" style="box-shadow:inset 0 0 0 1px var(--bd)">' + fp(ps[1]) + ' 보기</button></div>';
      return;
    }
    return Promise.all([snap(c, from), snap(c, to)]).then(function (r) {
      if (tok !== TOK) return;
      if (!r[0] || !r[1]) return showError('비교할 기록을 불러오지 못했어요.', fp(from) + ' 또는 ' + fp(to) + ' 기록을 읽지 못했어요. 다른 달을 골라 주세요.', true);
      if (DEBUG) { debugSnap(c, from, r[0]); debugSnap(c, to, r[1]); }
      var cmp0 = HA.compareSnapshots(c, r[0], r[1], { breaks: BR[c] });
      MVD = { c: c, from: from, to: to, snapFrom: r[0], snapTo: r[1], cmp: cmp0, mv: HA.computeMovers(cmp0), watch: null, ready: false };
      drawMovers(tok);
      allSnaps(c).then(function (snaps) { // NEW PEAK / EDITOR'S WATCH 는 이전 기록 전체가 필요해서 뒤에 채운다
        if (tok !== TOK || !MVD || MVD.to !== to || MVD.from !== from) return;
        var cmp1 = HA.compareSnapshots(c, r[0], r[1], { history: snaps, breaks: BR[c] });
        MVD.cmp = cmp1; MVD.mv = HA.computeMovers(cmp1); MVD.watch = HA.computeEditorsWatch(c, snaps, to, BR[c]); MVD.ready = true; MVD.snaps = snaps;
        drawMovers(tok);
      });
    });
  }
  var MVD = null;
  function drawMovers(tok) {
    if (tok !== TOK || !MVD) return;
    var d = MVD, c = d.c, ps = periods(), mv = d.mv, cmp = d.cmp, span = RH.monthIndex(d.to) - RH.monthIndex(d.from);
    var cat = S.mcat;
    if (!cat || (!d.ready && cat === 'newPeak')) { cat = MCATS.filter(function (m) { return mv.counts[m.key] > 0 && (d.ready || m.key !== 'newPeak'); })[0]; cat = cat ? cat.key : 'rankUp'; }
    var fromOpts = ps.filter(function (p) { return RH.monthIndex(p) < RH.monthIndex(d.to); }).reverse();
    var presets = [['전월', 1], ['3개월', 3], ['6개월', 6], ['12개월', 12]].map(function (x) { var f = presetFrom(d.to, x[1]); return f ? '<button class="pill" type="button" data-mfrom="' + f + '" aria-pressed="' + (f === d.from && span === RH.monthIndex(d.to) - RH.monthIndex(f)) + '">' + x[0] + '</button>' : ''; }).join('')
      + '<button class="pill" type="button" data-mfrom="' + ps[0] + '" aria-pressed="' + (d.from === ps[0] && d.from !== presetFrom(d.to, 12)) + '">처음부터</button>';
    var h = '<div class="cmpbar"><span class="lab">FROM</span><select class="sel" id="mvFrom" aria-label="비교 시작 월">' + fromOpts.map(function (p) { return '<option value="' + p + '"' + (p === d.from ? ' selected' : '') + '>' + fp(p) + '</option>'; }).join('') + '</select>'
      + '<span class="arrow" aria-hidden="true">→</span><span class="lab">TO</span><strong style="font-size:15px;font-variant-numeric:tabular-nums">' + fp(d.to) + '</strong>'
      + '<span class="grow"></span><div class="seg" role="group" aria-label="비교 기간 프리셋">' + presets + '</div></div>';
    h += '<p class="cmpsum"><b>' + fp(d.from) + ' → ' + fp(d.to) + '</b> · ' + esc(KO[c]) + ' 평가 ' + cmp.prevPop + '팀 → ' + cmp.curPop + '팀'
      + (cmp.exits.length ? ' · 빠진 팀 ' + cmp.exits.length + '팀' : '') + (span > 1 ? '<br><span style="color:var(--tx3);font-size:12.5px">' + span + '개월 동안 쌓인 변화예요. RECORD BOOK의 한 달 기준 기록과는 달라요.</span>' : '') + '</p>';
    h += breakBanner(cmp.breaks, '이 비교에는 점수가 크게 뒤바뀐 구간이 들어 있어요');
    h += '<div class="mcats" role="group" aria-label="변화 유형">' + MCATS.map(function (m) {
      var wait = m.key === 'newPeak' && !d.ready;
      return '<button type="button" data-mcat="' + m.key + '" aria-pressed="' + (m.key === cat) + '"' + (wait ? ' disabled title="이전 기록을 불러오는 중"' : '') + '>' + m.label + '<b>' + (wait ? '…' : mv.counts[m.key]) + '</b></button>';
    }).join('') + '</div>';
    var meta = MCATS.filter(function (m) { return m.key === cat; })[0], list = mv[cat] || [];
    h += '<p class="note" style="margin-top:10px">' + esc(meta.desc) + '</p>';
    if (!list.length) h += '<div class="empty" style="margin-top:12px"><b>해당하는 그룹이 없어요</b>' + (cat === 'newPeak' && !d.ready ? '이전 기록을 불러오고 있어요.' : '이 기간엔 해당하는 그룹이 없어요.') + '</div>';
    else h += '<ol class="mlist">' + list.slice(0, MV.limit).map(function (r) { return moverCard(r, cat, d); }).join('') + '</ol>'
      + (list.length > MV.limit ? '<button class="hx-more" type="button" data-mmore>더 보기 (' + (list.length - MV.limit) + '팀 더)</button>' : '');
    // EDITOR'S WATCH
    h += '<section class="sec"><h2>EDITOR\'S WATCH <small>' + fp(d.to) + ' 기준 · 추천이 아니라, 아래 조건에 맞는 그룹만 모았어요</small></h2>';
    if (!d.ready) h += '<p class="note">이전 기록을 불러오는 중…</p>';
    else if (!d.watch.ready) h += '<p class="note">' + esc(d.watch.reason) + '.</p>';
    else if (!d.watch.cards.length) h += '<div class="empty"><b>해당하는 그룹이 없어요</b>이번 달엔 아래 조건에 맞는 그룹이 없어요.</div>' + watchRules();
    else {
      h += d.watch.rules.map(function (rule) {
        var cs = d.watch.cards.filter(function (x) { return x.rule === rule.key; });
        if (!cs.length) return '';
        return '<div class="wgroup"><h3>' + rule.title + ' <span style="color:var(--tx3);font-weight:700">· ' + cs.length + '팀</span></h3><p>' + esc(rule.rule) + '</p><div class="watch">' + cs.slice(0, 6).map(function (x) {
          return '<div class="wc"><span class="rule">' + rule.title + '</span><div class="who"><button type="button" data-open="' + x.id + '">' + esc(x.group) + '</button>' + tierChip(x.tier) + '<span style="color:var(--tx3);font-size:12px;font-weight:800">#' + x.rank + '</span></div><div class="fact">' + esc(x.fact) + '</div>'
            + (x.detail.length ? '<ul class="det">' + x.detail.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') + '<div class="why">조건: ' + esc(rule.rule) + '</div></div>';
        }).join('') + '</div>' + (cs.length > 6 ? '<p class="note">외 ' + (cs.length - 6) + '팀</p>' : '') + '</div>';
      }).join('');
    }
    h += '</section>';
    if (DEBUG) {
      var contra = cmp.rows.filter(function (r) { return r.movement !== null && r.rawDelta !== 0 && (r.rawDelta > 0) !== (r.movement > 0); }).length;
      var mm = cmp.rows.filter(function (r) { return r.metric && r.metric.mismatch; }).length;
      h += '<details class="note" open><summary>debug</summary>raw/percentile 부호 불일치 ' + contra + '행 · metric 합 불일치 ' + mm + '행 · newPeakReady ' + mv.newPeakReady + '</details>';
    }
    main.innerHTML = h;
  }
  function watchRules() { return '<div class="wgroup" style="margin-top:14px">' + HA.WATCH_RULES.map(function (r) { return '<p style="margin:0 0 6px"><b style="color:var(--gold);font-size:11px;letter-spacing:.12em">' + r.title + '</b> · ' + esc(r.rule) + '</p>'; }).join('') + '</div>'; }
  function moverCard(r, cat, d) {
    var c = d.c, g = r.cur, p = r.prev, big, lines = [];
    var posLine = r.movement !== null ? '상대 위치 <b>' + pctTxt(r.movementPct) + '</b>' + (d.cmp.prevPop !== d.cmp.curPop ? ' <span style="color:var(--tx3)">(팀 수 ' + d.cmp.prevPop + ' → ' + d.cmp.curPop + ' 반영)</span>' : '') : '';
    var scoreLine = r.scoreDelta !== null ? '<b>' + p.score + ' → ' + g.score + '점</b> (' + sg(r.scoreDelta) + ')' : '';
    var rankBig = '<span class="mv-rk">' + (p ? '#' + p.rank + '<i>→</i>' : '') + '#' + g.rank + '</span>' + badge(r);
    if (cat === 'scoreUp' || cat === 'scoreDown') { big = '<span class="mv-rk">' + p.score + '<i>→</i>' + g.score + '점</span><span style="font-weight:900">' + sg(r.scoreDelta) + '</span>'; lines = ['순위 <b>#' + p.rank + ' → #' + g.rank + '</b> ' + badge(r), posLine]; }
    else if (cat === 'momentumUp') {
      var mi = r.metric.items.filter(function (x) { return x.key === 'momentum'; })[0];
      big = '<span class="mv-rk">현재기세 ' + mi.prev + '<i>→</i>' + mi.cur + '</span><span style="font-weight:900;color:var(--green)">▲' + mi.delta + '</span>'; lines = ['순위 <b>#' + p.rank + ' → #' + g.rank + '</b> ' + badge(r), scoreLine];
    } else if (cat === 'tierUp') { big = '<span class="mv-rk">' + esc(r.tier.from) + '<i>→</i>' + esc(r.tier.to) + '</span><span style="font-weight:800;color:var(--tx2)">' + r.tier.steps + '단계 상승</span>'; lines = ['순위 <b>#' + p.rank + ' → #' + g.rank + '</b> ' + badge(r), scoreLine]; }
    else if (cat === 'newPeak') { big = '<span class="mv-rk">최고 #' + r.bestBefore + '<i>→</i>#' + g.rank + '</span><span style="font-weight:800;color:var(--gold)">NEW PEAK</span>'; lines = [fp(d.from) + '까지의 최고 순위보다 높아졌어요', scoreLine]; }
    else if (cat === 'newEntry') { big = '<span class="mv-rk">#' + g.rank + '</span><span class="rkd new">NEW</span>'; lines = [esc(g.tier) + ' 티어, ' + g.score + '점으로 들어왔어요', fp(d.from) + '에는 없던 그룹이에요']; }
    else { big = rankBig; lines = [posLine, scoreLine]; }
    if (cat !== 'tierUp' && cat !== 'newEntry' && r.tier.dir === 'up') lines.push('티어 <b>' + esc(r.tier.from) + ' → ' + esc(r.tier.to) + '</b>');
    if (cat !== 'tierUp' && cat !== 'newEntry' && r.tier.dir === 'down') lines.push('티어 <b>' + esc(r.tier.from) + ' → ' + esc(r.tier.to) + '</b>');
    var why = cat === 'newEntry' ? '' : '<div class="mv-why"><h4>달라진 항목</h4>' + whyChips(r.metric) + '</div>';
    return '<li class="mv"><div class="mv-h"><span class="n">' + g.rank + '</span><button type="button" data-open="' + r.id + '" title="' + esc(r.group) + ' 그 달 기록 보기">' + esc(r.group) + '</button>' + tierChip(g.tier) + '</div>'
      + '<div class="mv-big">' + big + '</div><ul class="mv-facts">' + lines.filter(Boolean).map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>' + why + '</li>';
  }

  /* ================= RECORD BOOK ================= */
  var RECS = {}, RECV = null;
  function viewRecords(tok) {
    var c = S.country;
    return allSnaps(c).then(function (snaps) {
      if (tok !== TOK) return;
      if (!snaps.length) return showError('기록을 불러오지 못했어요.', '잠시 뒤에 다시 해 보세요.', true);
      var key = c + '|' + S.range + '|' + snaps.length;
      if (!RECS[key]) RECS[key] = HA.computeRecords(c, snaps, { range: S.range, breaks: BR[c] });
      var rec = RECS[key];
      if (DEBUG) snaps.forEach(function (s) { debugSnap(c, s.meta.period, s); });
      RECV = { rec: rec, snaps: snaps };
      drawRecords(rec, snaps);
    });
  }
  function drawRecords(rec, snaps) {
    var c = S.country, ps = periods(), q = S.q.trim().toLowerCase();
    var cats = HA.CATEGORIES.map(function (m) { return '<button class="pill" type="button" data-rcat="' + m.key + '" aria-pressed="' + (S.cat === m.key) + '">' + m.label + '</button>'; }).join('');
    var ranges = RANGES.map(function (r) { return '<button class="pill" type="button" data-rrange="' + r[0] + '" aria-pressed="' + (S.range === r[0]) + '">' + r[1] + '</button>'; }).join('');
    var h = '<p class="rec-lead"><b style="color:var(--tx)">RECORD BOOK</b> · 남아 있는 기록을 그대로 집계한 결과예요. 사람이 고른 게 아니라 ' + esc(KO[c]) + ' ' + rec.periods.length + '개월치 전체에 같은 기준을 적용했어요.</p>';
    h += '<div class="rec-bar"><div class="seg" role="group" aria-label="기간">' + ranges + '</div><div class="seg" role="group" aria-label="기록 종류">' + cats + '</div>'
      + '<label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"/></svg><input id="recQ" type="search" placeholder="그룹 기록 찾기" autocomplete="off" value="' + esc(S.q) + '" aria-label="그룹 기록 검색"></label></div>';
    h += breakBanner(rec.breaks, '기록에서 뺀 구간');
    if (rec.versions.length) h += '<div class="verbanner"><b>주의 · </b>평가 기준 버전이 바뀐 구간: ' + rec.versions.map(function (v) { return fp(v.from) + ' → ' + fp(v.to) + ' (' + v.diff.map(function (x) { return x.field + ' ' + x.from + '→' + x.to; }).join(', ') + ')'; }).join(' / ') + '. 이 앞뒤 값은 바로 비교하지 마세요.</div>';
    var matches = q ? rec.groups.filter(function (g) { return g.group.toLowerCase().indexOf(q) !== -1; }).slice(0, 3) : [];
    var hit = {}; matches.forEach(function (g) { hit[g.id] = 1; });
    if (q && !matches.length) h += '<div class="empty" style="margin-top:14px"><b>‘' + esc(S.q) + '’ 기록이 없어요</b>이 기간엔 그런 이름의 그룹이 없어요.</div>';
    matches.forEach(function (g) { h += groupRecordCard(g, rec, c); });
    var boards = rec.boards.filter(function (b) { return b.cat === S.cat; });
    h += '<div class="boards">' + boards.map(function (b) {
      return '<section class="board" aria-label="' + esc(b.title) + '"><h3>' + esc(b.title) + '</h3><p class="rule">' + esc(b.rule) + '</p>'
        + (b.rows.length ? '<ol>' + b.rows.map(function (r, i) {
          var open = r.periods && r.periods.length;
          return '<li><button type="button" class="r' + (hit[r.id] ? ' hit' : '') + '" data-brow="' + b.key + '|' + r.id + '" aria-expanded="false"' + (open ? '' : ' data-static="1"') + '><span class="p">' + r.pos + '</span><span class="g">' + esc(r.group) + '</span><span class="v">' + esc(r.text) + '</span></button></li>';
        }).join('') + '</ol>' : '<p class="none">이 기간에는 해당 기록이 없어요.</p>')
        + '</section>';
    }).join('') + '</div>';
    h += '<p class="note">값이 같으면 공동 순위예요. 연속 기록은 달이 이어져야 하고, 기록이 없는 달이 끼면 끊겨요. 한국과 일본은 따로 집계해요. <b>기록 기간은 이 사이트에 기록된 기간이라 실제 활동 기간과 다를 수 있어요.</b></p>';
    main.innerHTML = h;
    main._rec = rec;
  }
  function groupRecordCard(g, rec, c) {
    var per = function (a) { return a && a.length ? fp(a[0]) + (a.length > 1 ? ' 외 ' + (a.length - 1) + '개월' : '') : ''; };
    function dd(dt, v, sub) { return '<div><dt>' + dt + '</dt><dd>' + v + (sub ? '<small>' + sub + '</small>' : '') + '</dd></div>'; }
    var st = function (s) { return s ? '최장 연속 ' + s.length + '개월 (' + fp(s.start) + (s.length > 1 ? '–' + fp(s.end).slice(2) : '') + ')' : '연속 기록 없음'; };
    var cells = dd('기록 기간', fp(g.first) + '–' + fp(g.latest).slice(2), g.months + '개월 · 커버리지 ' + Math.round((g.coverage || 0) * 100) + '%')
      + dd('1위', g.rank1.months + '개월', g.rank1.months ? st(g.rank1.streak) : '기록 없음')
      + dd('TOP 5', g.top5.months + '개월', g.top5.months ? st(g.top5.streak) : '기록 없음')
      + dd('TOP 10', g.top10.months + '개월', g.top10.months ? st(g.top10.streak) : '기록 없음')
      + dd('최고 순위', '#' + g.bestRank.rank, fp(g.bestRank.first) + ' 최초 · ' + g.bestRank.periods.length + '개월')
      + dd('최고 점수', g.maxScore.score + '점', fp(g.maxScore.first) + ' 최초')
      + dd('단월 최대 점수 상승', g.scoreGain ? sg(g.scoreGain.value) + '점' : '–', g.scoreGain ? fp(g.scoreGain.period) : '')
      + dd('단월 최대 순위 상승', g.rankUp ? '▲' + g.rankUp.rawDelta : '–', g.rankUp ? '#' + g.rankUp.prevRank + ' → #' + g.rankUp.rank + ' · ' + pctTxt(g.rankUp.movementPct) + ' (' + fp(g.rankUp.period) + ')' : '')
      + dd('NEW PEAK', g.newPeaks.count + '회', per(g.newPeaks.periods))
      + dd('티어 승격', g.tierUps.count + '회', per(g.tierUps.periods))
      + dd('S+ / S 체류', g.tierMonths.sTier.length + '개월', 'A+ 이상 ' + g.tierMonths.aPlus.length + '개월');
    return '<section class="grec" aria-label="' + esc(g.group) + ' 기록"><h3>' + esc(g.group) + '</h3><p class="sub2">GROUP RECORD · ' + esc(KO[c]) + ' · ' + (RANGES.filter(function (r) { return r[0] === S.range; })[0][1]) + ' · <a data-go="' + esc(urlFor({ view: 'timeline', period: g.latest, group: g.id })) + '" href="' + urlFor({ view: 'timeline', period: g.latest, group: g.id }) + '" style="text-decoration:underline">' + fp(g.latest) + ' 기록 보기</a></p><dl>' + cells + '</dl></section>';
  }

  /* ================= MAP REPLAY ================= */
  function viewMap(tok) {
    main.innerHTML = '<div class="empty" id="mrLoad"><b>지도를 불러오는 중…</b>그 달 분포로 위치를 계산하고 있어요.</div>';
    return ensureMap().then(function () {
      if (tok !== TOK) return;
      main.innerHTML = '';
      window.MapReplay.mount(main, {
        state: S, periods: periods(), breaks: BR[S.country], snap: snap, all: allSnaps, tierColors: TIER_COLORS, esc: esc, pageOf: PAGE, en: EN, ko: KO,
        setPeriod: function (p) { if (p !== S.period) { S.period = p; commit(false); syncControls(); } },
        setState: function (patch) { Object.assign(S, patch); commit(false); },
        openDetail: function (id) { go({ view: 'timeline', group: id }, true); modalPushed = true; },
        urlFor: urlFor
      });
    }).catch(function () {
      if (tok === TOK) showError('지도를 불러오지 못했어요.', '네트워크를 확인하고 다시 시도해 주세요.', true);
    });
  }
  function destroyMap() { if (window.MapReplay && window.MapReplay.active()) window.MapReplay.destroy(); }

  /* ================= render ================= */
  function render() {
    var tok = ++TOK, key = S.view + '|' + S.country;
    syncControls();
    if (S.view !== 'map') destroyMap();
    main.setAttribute('aria-busy', 'true');
    if (main.getAttribute('data-key') !== key) { skeleton(); main.setAttribute('data-key', key); }
    if (S.view === 'movers' && main._last !== key) MV.limit = 10;
    main._last = key;
    var fn = { timeline: viewTimeline, movers: viewMovers, records: viewRecords, map: viewMap }[S.view];
    var done = function () { if (tok === TOK) main.setAttribute('aria-busy', 'false'); };
    Promise.resolve().then(function () { return fn(tok); }).catch(function (e) {
      if (window.console) console.error(e);
      if (tok === TOK) showError('화면을 만들지 못했어요.', '잠시 뒤에 다시 해 보세요.', true);
    }).then(done);
    if (S.group && S.view !== 'map') { if (S.view === 'timeline' || S.view === 'movers' || S.view === 'records') showDetail(S.group, DET && DET.tab || 'summary'); }
    else if (!S.group && !$('hxModal').hidden) hideModal();
  }

  /* ---------- 이벤트 ---------- */
  function copyLink() {
    var url = location.href;
    var ok = function () { if (window.__toast) window.__toast('링크를 복사했어요'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { fallbackCopy(url, ok); });
    else fallbackCopy(url, ok);
  }
  function fallbackCopy(text, ok) {
    var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); ok(); } catch (e) { window.prompt('링크를 복사해 주세요', text); }
    document.body.removeChild(t);
  }
  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      var b = t.closest && t.closest('[data-country]');
      if (b && b.tagName === 'BUTTON' && b.closest('#hxBar')) { var c = b.getAttribute('data-country'); if (c !== S.country) { TL.q = ''; TL.tier = 'ALL'; S.pin = null; S.from = null; S.mcat = null; S.q = ''; S.group = null; S.country = c; savePref(); if (IDX[c].indexOf(S.period) < 0) S.period = IDX[c][IDX[c].length - 1]; commit(true); render(); } return; }
      if ((b = t.closest('.tab'))) { var v = b.getAttribute('data-view'); if (v !== S.view) go({ view: v, group: null }, true); return; }
      if ((b = t.closest('#hxRail button'))) { setPeriod(b.getAttribute('data-p')); return; }
      if (t.closest('#hxPrev')) { stepPeriod(-1); return; }
      if (t.closest('#hxNext')) { stepPeriod(1); return; }
      if (t.closest('#hxLatest')) { setPeriod(latest()); return; }
      if (t.closest('#hxShare')) { copyLink(); return; }
    });
    $('hxPeriod').addEventListener('change', function () { setPeriod(this.value); });
    $('hxBar').addEventListener('keydown', function (e) { // 탭 목록은 좌우 화살표로 이동
      var tab = e.target.closest && e.target.closest('.tab');
      if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab')), i = tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1);
      if (i >= 0 && i < tabs.length) { e.preventDefault(); e.stopPropagation(); tabs[i].focus(); tabs[i].click(); }
    });
    // 본문 위임
    main.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-open]'))) { var id = b.getAttribute('data-open'); if (id) openDetail(id); return; }
      if ((b = t.closest('[data-tier]'))) { TL.tier = b.getAttribute('data-tier'); Array.prototype.forEach.call(main.querySelectorAll('[data-tier]'), function (x) { x.setAttribute('aria-pressed', x === b); }); redrawRank(); return; }
      if (t.closest('[data-clear]')) { TL.q = ''; TL.tier = 'ALL'; render(); return; }
      if (t.closest('[data-retry]')) { render(); return; }
      if ((b = t.closest('[data-setperiod]'))) { setPeriod(b.getAttribute('data-setperiod')); return; }
      if ((b = t.closest('[data-mfrom]'))) { go2({ from: b.getAttribute('data-mfrom') }); return; }
      if ((b = t.closest('[data-mcat]'))) { MV.limit = 10; go2({ mcat: b.getAttribute('data-mcat') }); return; }
      if (t.closest('[data-mmore]')) { MV.limit += 20; drawMovers(TOK); return; }
      if ((b = t.closest('[data-rcat]'))) { go2({ cat: b.getAttribute('data-rcat') }); return; }
      if ((b = t.closest('[data-rrange]'))) { go2({ range: b.getAttribute('data-rrange') }); return; }
      if ((b = t.closest('[data-brow]'))) { toggleBoardRow(b); return; }
      if ((b = t.closest('[data-go]'))) { e.preventDefault(); var u = b.getAttribute('data-go'); history.pushState(null, '', u); readUrl(); render(); return; }
      if ((b = t.closest('a[data-goto]'))) { e.preventDefault(); go({ view: 'timeline', period: b.getAttribute('data-goto'), group: null }, true); return; }
    });
    main.addEventListener('input', function (e) {
      if (e.target.id === 'tlQ') { TL.q = e.target.value; redrawRank(); }
      if (e.target.id === 'recQ') {
        S.q = e.target.value; clearTimeout(bind._t);
        bind._t = setTimeout(function () { // 캐시된 계산 결과로 바로 다시 그린다(입력 포커스 유지)
          commit(false); if (!RECV) return;
          var y = window.scrollY; drawRecords(RECV.rec, RECV.snaps); window.scrollTo(0, y);
          var i = $('recQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
        }, 220);
      }
    });
    main.addEventListener('change', function (e) { if (e.target.id === 'mvFrom') go2({ from: e.target.value }); });
    // 상세 모달
    var modal = $('hxModal');
    modal.addEventListener('click', function (e) {
      var t = e.target, b;
      if (t === modal || t.closest('[data-close]')) { closeDetail(); return; }
      if ((b = t.closest('[data-dtab]'))) { if (DET) { DET.tab = b.getAttribute('data-dtab'); renderDetail(); var sel = $('hxSheet').querySelector('[aria-selected="true"]'); if (sel) sel.focus({ preventScroll: true }); } return; }
      if ((b = t.closest('[data-open]'))) { var id = b.getAttribute('data-open'); if (id && !b.disabled) { S.group = id; commit(false); showDetail(id, DET ? DET.tab : 'summary'); } return; }
      if ((b = t.closest('[data-go-map]'))) { e.preventDefault(); modalPushed = false; var id2 = b.getAttribute('data-go-map'); hideModal(); go({ view: 'map', pin: id2, group: null }, true); return; }
    });
    document.addEventListener('keydown', function (e) {
      var tag = (document.activeElement || {}).tagName || '';
      if (!$('hxModal').hidden) {
        if (e.key === 'Escape') { e.preventDefault(); closeDetail(); return; }
        if (e.key === 'Tab') { // 포커스를 시트 안에 가둔다
          var f = Array.prototype.slice.call($('hxSheet').querySelectorAll('button:not(:disabled),a[href],summary,[tabindex="0"]')).filter(function (x) { return x.offsetParent !== null; });
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        return;
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.ctrlKey || e.metaKey || e.altKey || S.view === 'records') return;
      if (e.key === 'ArrowLeft') { if (document.activeElement && document.activeElement.classList.contains('tab')) return; e.preventDefault(); stepPeriod(-1); }
      else if (e.key === 'ArrowRight') { if (document.activeElement && document.activeElement.classList.contains('tab')) return; e.preventDefault(); stepPeriod(1); }
    });
    window.addEventListener('popstate', function () {
      var before = mainKey(); readUrl(); modalPushed = false;
      if (mainKey() === before) { // 상세 팝업만 열리거나 닫힌 경우
        if (S.group) showDetail(S.group, DET && DET.tab || 'summary'); else if (!$('hxModal').hidden) hideModal();
        return;
      }
      render();
    });
  }
  function mainKey() { return JSON.stringify([S.country, S.period, S.view, S.from, S.mcat, S.cat, S.range, S.q, S.pin, S.trail, S.speed]); }
  function go2(patch) { Object.assign(S, patch); commit(false); render(); }
  var DETCMP = null; // 타임라인이 마지막으로 계산한 비교 결과(필터 입력마다 다시 계산하지 않는다)
  function redrawRank() { if (DETCMP) drawRanking(DETCMP); }
  function toggleBoardRow(btn) {
    if (btn.getAttribute('data-static')) return;
    var open = btn.getAttribute('aria-expanded') === 'true', li = btn.parentNode, next = li.querySelector('.pr');
    if (open) { btn.setAttribute('aria-expanded', 'false'); if (next) next.remove(); return; }
    var parts = btn.getAttribute('data-brow').split('|'), rec = main._rec;
    var b = rec.boards.filter(function (x) { return x.key === parts[0]; })[0], r = b.rows.filter(function (x) { return x.id === parts[1]; })[0];
    btn.setAttribute('aria-expanded', 'true');
    var div = document.createElement('div'); div.className = 'pr';
    div.innerHTML = r.periods.map(function (p) { return '<a href="' + urlFor({ view: 'timeline', period: p, group: null }) + '" data-goto="' + p + '" title="' + fp(p) + ' 기록 보기">' + fp(p) + '</a>'; }).join('');
    li.appendChild(div);
  }

  /* ---------- 시작 ---------- */
  function start() {
    main = $('hxMain');
    Promise.all([RH.loadHistoryIndex(), RH.loadBreaks()]).then(function (r) {
      var idx = r[0]; BR = r[1] || BR;
      if (!idx || !Array.isArray(idx.KR) || !Array.isArray(idx.JP) || !idx.KR.length || !idx.JP.length) {
        main.innerHTML = '<div class="empty err"><b>월별 기록 목록을 불러오지 못했어요.</b>새로고침해 보세요. 한국·일본 티어리스트는 그대로 볼 수 있어요.<br><a class="pill" href="kr" style="display:inline-flex;align-items:center;margin-top:12px;box-shadow:inset 0 0 0 1px var(--bd)">한국 점수표</a> <a class="pill" href="jp" style="display:inline-flex;align-items:center;margin-top:12px;box-shadow:inset 0 0 0 1px var(--bd)">일본 점수표</a></div>';
        main.setAttribute('aria-busy', 'false'); return;
      }
      idx = { KR: HA.sortPeriods(idx.KR), JP: HA.sortPeriods(idx.JP) };
      if (DEBUG) { var er = HA.validateIndex(idx.KR).concat(HA.validateIndex(idx.JP)); if (er.length) console.warn('[history] index', er); }
      IDX = idx;
      bind(); readUrl(); commit(false); render();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
