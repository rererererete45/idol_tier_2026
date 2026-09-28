/* MAP REPLAY — 월별 시장 포지셔닝 지도 재생 (IDOL_HISTORY_SUITE_V3_SPEC.md §9)
 * - 좌표는 IdolRec.logicalPointsFromRows 로 '그 달 snapshot 의 분포'에서 다시 계산한다(현재 좌표를 재사용하지 않는다).
 *   현재 IDOL MAP 과 같은 함수를 쓰므로 알고리즘이 갈라지지 않는다(2026-09 좌표 = 현재 지도 좌표는 테스트로 검증).
 * - 점은 같은 id 끼리 위치를 이어서 움직이고(CSS transition), 새로 생긴 그룹은 fade in, 사라진 그룹은 fade out 한다.
 * - prefers-reduced-motion 이면 애니메이션 없이 즉시 위치가 바뀐다.
 * - 이 모듈은 history-explorer.js 가 ctx 를 넘겨 mount 한다. window.MapReplay 로만 노출한다. */
(function (global) {
  'use strict';
  var R = global.IdolRec, HA = global.HistoryAnalytics, RH = global.RankHistory;
  var NS = 'http://www.w3.org/2000/svg';
  var ZONES = {
    'CORE LIVE': { color: '#f3727f', text: '팬덤 중심 · 라이브 강세' }, 'STAGE STAR': { color: '#ffa42b', text: '대중 확장 · 라이브 강세' },
    'PUBLIC HIT': { color: '#539df5', text: '대중 확장 · 디지털 강세' }, 'CORE DIGITAL': { color: '#a78bfa', text: '팬덤 중심 · 디지털 강세' }, 'BALANCED': { color: '#b3b3b3', text: '중앙 균형형' }
  };
  var ZONE_ORDER = ['CORE LIVE', 'STAGE STAR', 'PUBLIC HIT', 'CORE DIGITAL', 'BALANCED'];
  var SPEEDS = [0.75, 1, 1.5, 2], TRAILS = [['off', 'OFF'], ['3', '3M'], ['6', '6M'], ['12', '12M'], ['all', 'ALL']];
  var BASE_STEP = 1500;
  var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var M = null; // 현재 마운트된 인스턴스

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function mi(p) { return RH.monthIndex(p); }
  function fp(p) { return RH.fmtPeriod(p); }

  /* ---------- 좌표 (그 달 분포) ---------- */
  function computeFor(country, snap) {
    var key = 'history:' + country + ':' + snap.meta.period;
    var L = R.logicalPointsFromRows(country, HA.snapshotToMapRows(country, snap), key);
    var by = {}; L.points.forEach(function (p) { by[p.id] = p; });
    return { snap: snap, L: L, by: by, period: snap.meta.period };
  }
  function loadPeriod(p) {
    var m = M; // 로딩 도중 다른 화면으로 나가 destroy 되면 늦게 온 결과는 버린다
    if (m.cache[p]) return Promise.resolve(m.cache[p]);
    return m.ctx.snap(m.country, p).then(function (s) {
      if (!s || M !== m) return null;
      m.cache[p] = computeFor(m.country, s); return m.cache[p];
    });
  }
  function loadEvery() { // 재생 시작 시 그 국가의 모든 snapshot 을 순서대로 읽어 둔다(캐시 재사용)
    var m = M;
    if (m.everyP) return m.everyP;
    m.everyP = m.ctx.all(m.country).then(function (snaps) {
      snaps.forEach(function (s) { if (!m.cache[s.meta.period]) m.cache[s.meta.period] = computeFor(m.country, s); });
      m.snaps = snaps; return snaps;
    });
    return m.everyP;
  }

  /* ---------- 레이아웃 ---------- */
  var PAD = { l: 38, r: 22, t: 30, b: 40 };
  function measure() {
    var w = Math.max(300, Math.round(M.stage.clientWidth)), h = w < 520 ? Math.round(w * 1.08) : Math.max(380, Math.min(620, Math.round(w * 0.68)));
    M.W = w; M.H = h; M.scale = w < 520 ? 0.85 : 1.1;
    M.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); M.svg.setAttribute('height', h);
  }
  function xy(p) {
    return { x: PAD.l + p.logicalX / 100 * (M.W - PAD.l - PAD.r), y: PAD.t + (100 - p.logicalY) / 100 * (M.H - PAD.t - PAD.b) };
  }
  function radiusOf(p) { return (5 + Math.max(0, Math.min(100, p.totalPercentile)) * 0.075) * M.scale; }
  function drawBg() {
    var g = M.bg; while (g.firstChild) g.removeChild(g.firstChild);
    var x0 = PAD.l, x1 = M.W - PAD.r, y0 = PAD.t, y1 = M.H - PAD.b, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
    var quad = function (x, y, ww, hh, col) { el('rect', { x: x, y: y, width: ww, height: hh, fill: col, 'fill-opacity': 0.06 }, g); };
    quad(x0, y0, cx - x0, cy - y0, ZONES['CORE LIVE'].color); quad(cx, y0, x1 - cx, cy - y0, ZONES['STAGE STAR'].color);
    quad(cx, cy, x1 - cx, y1 - cy, ZONES['PUBLIC HIT'].color); quad(x0, cy, cx - x0, y1 - cy, ZONES['CORE DIGITAL'].color);
    var tol = 12 / 100; // BALANCED: 중앙 ±12
    el('rect', { x: cx - w * tol, y: cy - h * tol, width: w * tol * 2, height: h * tol * 2, rx: 14, fill: ZONES['BALANCED'].color, 'fill-opacity': 0.07, stroke: ZONES['BALANCED'].color, 'stroke-opacity': 0.25, 'stroke-dasharray': '3 4' }, g);
    for (var i = 1; i < 4; i++) {
      if (i === 2) continue;
      el('line', { x1: x0 + w * i / 4, y1: y0, x2: x0 + w * i / 4, y2: y1, class: 'gridl' }, g); el('line', { x1: x0, y1: y0 + h * i / 4, x2: x1, y2: y0 + h * i / 4, class: 'gridl' }, g);
    }
    el('line', { x1: cx, y1: y0, x2: cx, y2: y1, class: 'axis' }, g); el('line', { x1: x0, y1: cy, x2: x1, y2: cy, class: 'axis' }, g);
    var zt = function (t, x, y, col, anc) { var n = el('text', { x: x, y: y, class: 'zt', fill: col, 'fill-opacity': 0.8, 'text-anchor': anc }, g); n.textContent = t; };
    zt('CORE LIVE', x0 + 8, y0 + 16, ZONES['CORE LIVE'].color, 'start'); zt('STAGE STAR', x1 - 8, y0 + 16, ZONES['STAGE STAR'].color, 'end');
    zt('CORE DIGITAL', x0 + 8, y1 - 8, ZONES['CORE DIGITAL'].color, 'start'); zt('PUBLIC HIT', x1 - 8, y1 - 8, ZONES['PUBLIC HIT'].color, 'end');
    var al = function (t, x, y, rot) { var n = el('text', { x: x, y: y, class: 'al', 'text-anchor': 'middle', transform: rot ? 'rotate(' + rot + ' ' + x + ' ' + y + ')' : null }, g); n.textContent = t; };
    al('라이브 · 공연형 ↑', cx, 16); al('↓ 디지털 · 음원형', cx, M.H - 10); al('← 코어 팬덤형', 14, cy, -90); al('대중 확장형 →', M.W - 10, cy, 90);
  }

  /* ---------- 점 ---------- */
  function labelIds(d) { // 고정한 그룹 + 점수 상위 몇 팀에 이름을 붙이되, 이미 놓인 라벨과 겹치면 숨긴다
    var n = M.W < 520 ? 5 : 10, ids = {}, placed = [];
    var order = d.L.points.slice().sort(function (a, b) { return (b.id === M.pin) - (a.id === M.pin) || b.totalScore - a.totalScore || (a.id < b.id ? -1 : 1); });
    var cand = order.filter(function (p) { return p.id === M.pin; });
    if (!M.pin) cand = order.slice(0, n); // 고른 그룹이 없을 때만 점수 상위 팀에 이름을 붙인다
    cand.forEach(function (p) {
      var pos = xy(p), r = radiusOf(p), w = String(p.group).length * 6.4 + 8, right = pos.x > M.W - 110;
      var box = { x1: right ? pos.x - r - 5 - w : pos.x + r + 5, y1: pos.y - 8, x2: 0, y2: pos.y + 8 }; box.x2 = box.x1 + w;
      var hit = placed.some(function (b) { return box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1; });
      if (!hit || p.id === M.pin) { ids[p.id] = 1; placed.push(box); }
    });
    return ids;
  }
  function styleNode(node, p, pos, labeled) {
    var r = radiusOf(p), c = node.querySelector('circle'), t = node.querySelector('text');
    node.style.transform = 'translate(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px)';
    c.setAttribute('r', r.toFixed(1)); c.setAttribute('fill', M.ctx.tierColors[p.tier] || '#7c7c7c'); c.setAttribute('fill-opacity', 0.86);
    node.setAttribute('data-z', p.zone);
    node.setAttribute('aria-label', p.group + ' ' + p.tier + ' ' + p.totalScore + '점 ' + p.zone);
    if (labeled) {
      var right = pos.x > M.W - 110; t.textContent = p.group; t.setAttribute('x', right ? -(r + 5) : r + 5); t.setAttribute('y', 4); t.setAttribute('text-anchor', right ? 'end' : 'start'); t.style.display = '';
    } else t.style.display = 'none';
  }
  function dur(animate) { return reduced || !animate ? 0 : Math.round(BASE_STEP / M.speed * 0.82); }
  function render(d, animate) {
    M.cur = d; M.period = d.period;
    M.svg.style.setProperty('--dur', dur(animate) + 'ms');
    var lab = labelIds(d), seen = {}, order = d.L.points.slice().sort(function (a, b) { return a.totalScore - b.totalScore || (a.id < b.id ? -1 : 1); });
    order.forEach(function (p) {
      seen[p.id] = 1;
      var pos = xy(p), node = M.nodes[p.id];
      if (!node) {
        node = el('g', { class: 'pt enter', 'data-id': p.id, role: 'img' }, M.layer);
        el('circle', { r: 0 }, node); el('text', {}, node);
        node.style.transform = 'translate(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px)';
        M.nodes[p.id] = node;
        styleNode(node, p, pos, !!lab[p.id]);
        void node.getBoundingClientRect(); // 시작 상태를 확정한 뒤 fade in
        node.classList.remove('enter');
      } else {
        if (node._gone) { clearTimeout(node._gone); node._gone = 0; node.classList.remove('enter'); }
        styleNode(node, p, pos, !!lab[p.id]);
      }
    });
    Object.keys(M.nodes).forEach(function (id) { // 이 달에 없는 그룹은 fade out 후 제거
      if (seen[id]) return;
      var node = M.nodes[id];
      if (!node._gone) { node.classList.add('enter'); node._gone = setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); if (M && M.nodes[id] === node) delete M.nodes[id]; }, dur(animate) + 60); }
    });
    applyHighlight(); drawPin(); drawZones(); drawTrail(); syncCtl();
    var bk = (M.ctx.breaks || []).filter(function (x) { return x.to === d.period; })[0], bn = $('mrBreak');
    if (bn) { bn.hidden = !bk; if (bk) bn.innerHTML = '<b>주의 · 이 달 지도 이동은 참고만 하세요</b><br>' + fp(bk.from) + ' → ' + fp(bk.to) + ' · ' + M.ctx.esc(bk.reason); }
    if (M.live) M.live.textContent = fp(d.period) + ' ' + M.ctx.ko[M.country] + ' 시장 지도, ' + d.L.population + '팀';
  }
  function applyHighlight() {
    Object.keys(M.nodes).forEach(function (id) {
      var n = M.nodes[id], zone = n.getAttribute('data-z');
      // 그룹을 고르면 그 그룹만 또렷하게 두고 나머지는 흐리게(집중), 영역을 고르면 그 영역만 또렷하게
      n.classList.toggle('dim', (!!M.pin && id !== M.pin) || (!!M.zone && zone !== M.zone && id !== M.pin));
      n.classList.toggle('sel', id === M.pin);
      if (id === M.pin && n.parentNode.lastChild !== n) M.layer.appendChild(n);
    });
  }

  /* ---------- 궤적 ---------- */
  function trailWindow(hist) {
    if (M.trail === 'off') return [];
    var n = M.trail === 'all' ? Infinity : Number(M.trail), last = mi(M.period);
    return hist.filter(function (h) { return mi(h.period) > last - n; });
  }
  function drawTrail() {
    var g = M.trailG; while (g.firstChild) g.removeChild(g.firstChild);
    if (!M.pin || M.trail === 'off') return;
    var token = ++M.trailTok, id = M.pin, period = M.period;
    loadEvery().then(function (snaps) {
      if (!M || token !== M.trailTok) return;
      var hist = trailWindow(HA.groupHistoryUntil(snaps, id, period)), pts = [];
      hist.forEach(function (h) { var d = M.cache[h.period], p = d && d.by[id]; if (p) pts.push({ h: h, p: p, pos: xy(p) }); });
      if (pts.length < 2) return;
      var col = getComputedStyle(document.body).getPropertyValue('--acc').trim() || '#1ed760';
      for (var i = 1; i < pts.length; i++) {
        var gap = mi(pts[i].h.period) - mi(pts[i - 1].h.period) > 1;
        el('line', { x1: pts[i - 1].pos.x, y1: pts[i - 1].pos.y, x2: pts[i].pos.x, y2: pts[i].pos.y, class: 'trail-l', stroke: col, 'stroke-opacity': (0.25 + 0.6 * i / pts.length).toFixed(2), 'stroke-dasharray': gap ? '2 6' : null }, g);
      }
      var prevZone = null;
      pts.forEach(function (q, i) {
        var last = i === pts.length - 1;
        var c = el('circle', { cx: q.pos.x, cy: q.pos.y, r: last ? 7 : 4.2, fill: ZONES[q.p.zone].color, class: 'trail-p' + (last ? ' cur' : ''), 'fill-opacity': last ? 1 : (0.45 + 0.5 * i / pts.length).toFixed(2), tabindex: -1 }, g);
        c.setAttribute('data-tip', fp(q.h.period) + '|#' + q.h.rank + ' · ' + q.h.score + '점 · ' + q.h.tier + '|' + q.p.zone);
        c.setAttribute('aria-label', fp(q.h.period) + ' #' + q.h.rank + ' ' + q.h.score + '점 ' + q.p.zone);
        if (i === 0 || q.p.zone !== prevZone) { // 처음 점과 영역이 바뀐 점에 달을 표시
          var t = el('text', { x: q.pos.x, y: q.pos.y - 10, 'text-anchor': 'middle', class: 'al', fill: '#fff' }, g); t.textContent = fp(q.h.period).slice(2); t.style.fill = '#fff'; t.style.fontSize = '10px';
        }
        prevZone = q.p.zone;
      });
    });
  }

  /* ---------- 사이드 패널 ---------- */
  function zoneRuns(hist) { // 영역이 바뀐 구간 목록
    var runs = [], cur = null;
    hist.forEach(function (h) {
      var d = M.cache[h.period], p = d && d.by[M.pin]; if (!p) return;
      if (cur && cur.zone === p.zone && mi(h.period) - mi(cur.end) === 1) cur.end = h.period;
      else { cur = { zone: p.zone, start: h.period, end: h.period }; runs.push(cur); }
    });
    return runs;
  }
  function drawPin() {
    var box = $('mrPin'), d = M.cur, id = M.pin, e = M.ctx.esc;
    if (!id) {
      box.innerHTML = '<h3>FOLLOW A GROUP</h3><p class="mr-help">점을 누르면 그 그룹만 또렷하게 남고 나머지는 흐려져요. 지나온 자리(<b style="color:var(--tx)">TRAIL</b>)도 같이 그려져요. 아래 칸에서 이름으로 찾아도 돼요.</p>';
      return;
    }
    var p = d.by[id], ent = HA.entryById(d.snap, id), name = ent ? ent.group : (p ? p.group : id);
    var facts = ent
      ? fp(d.period) + ' · <b>#' + ent.rank + '</b> · ' + ent.score + '점 · ' + e(ent.tier) + '<br><span style="color:' + (p ? ZONES[p.zone].color : '#b3b3b3') + ';font-weight:800">' + (p ? p.zone : '지도 제외') + '</span>' + (p ? ' <span style="color:var(--tx3)">' + ZONES[p.zone].text + '</span>' : ' <span style="color:var(--tx3)">값이 부족해서 지도에는 없어요</span>')
      : fp(d.period) + '에는 평가 기록이 없어요.';
    var box2 = '<div class="pin-h"><b>' + e(name) + '</b><button type="button" data-unpin aria-label="선택 해제">✕</button></div><p class="pin-facts">' + facts + '</p><div id="mrPath"></div>'
      + '<div class="dcta" style="margin-top:12px"><a class="pri" href="#" data-detail="' + e(id) + '" style="min-height:42px;flex-basis:120px">' + fp(d.period) + ' 기록</a><a class="sec2" href="map?country=' + M.country + '&group=' + encodeURIComponent(name) + '" style="min-height:42px;flex-basis:120px">현재 지도</a></div>';
    box.innerHTML = box2;
    loadEvery().then(function (snaps) {
      if (!M || M.pin !== id || !$('mrPath')) return;
      var runs = zoneRuns(HA.groupHistoryUntil(snaps, id, M.period));
      $('mrPath').innerHTML = runs.length ? '<ul class="zpath" aria-label="시장 위치(영역) 이동 이력">' + runs.map(function (r) {
        return '<li><i style="background:' + ZONES[r.zone].color + '"></i>' + r.zone + '<span>' + fp(r.start).slice(2) + (r.end !== r.start ? '–' + fp(r.end).slice(2) : '') + '</span></li>';
      }).join('') + '</ul>' : '';
    });
  }
  function drawZones() {
    var d = M.cur, counts = {}; ZONE_ORDER.forEach(function (z) { counts[z] = 0; });
    d.L.points.forEach(function (p) { counts[p.zone]++; });
    $('mrZones').innerHTML = ZONE_ORDER.map(function (z) {
      return '<li><button type="button" data-zone="' + z + '" aria-pressed="' + (M.zone === z) + '" title="' + ZONES[z].text + '"><i style="background:' + ZONES[z].color + '"></i>' + z + '<b>' + counts[z] + '</b></button></li>';
    }).join('');
    $('mrZoneH').textContent = fp(d.period) + ' · ' + d.L.population + '팀' + (d.L.excluded ? ' (' + d.L.excluded + '팀 제외)' : '');
  }

  /* ---------- 컨트롤 ---------- */
  function syncCtl() {
    var ps = M.ctx.periods, i = ps.indexOf(M.period);
    $('mrSlide').value = i; $('mrOut').textContent = fp(M.period);
    $('mrPrev').disabled = i <= 0; $('mrNext').disabled = i >= ps.length - 1;
    Array.prototype.forEach.call(document.querySelectorAll('[data-speed]'), function (b) { b.setAttribute('aria-pressed', Number(b.getAttribute('data-speed')) === M.speed); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-trail]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-trail') === M.trail); });
    var pb = $('mrPlay'); pb.textContent = M.playing ? '❚❚ PAUSE' : (i >= ps.length - 1 ? '↺ REPLAY' : '▶ PLAY'); pb.setAttribute('aria-pressed', !!M.playing);
  }
  function goPeriod(p, animate, fromUser) {
    var tok = ++M.goTok, m = M;
    return loadPeriod(p).then(function (d) {
      if (!M || M !== m || tok !== M.goTok) return;
      if (!d) { setLoad(true, '이 달 기록을 불러오지 못했어요. 다른 달을 골라 주세요.'); pause(); return; }
      setLoad(false);
      if (fromUser) M.ctx.setPeriod(p);
      render(d, animate);
    });
  }
  function setLoad(on, msg) { var n = $('mrLoad'); if (!n) return; n.hidden = !on; if (msg) n.textContent = msg; }
  function pause() { M.playing = false; clearTimeout(M.timer); syncCtl(); }
  function play() {
    if (M.playing) { pause(); return; }
    var ps = M.ctx.periods;
    var pb = $('mrPlay'); pb.textContent = '불러오는 중…'; pb.disabled = true;
    loadEvery().then(function () {
      if (!M) return; pb.disabled = false;
      if (ps.indexOf(M.period) >= ps.length - 1) goPeriod(ps[0], false, true); // 끝에서 다시 누르면 처음부터
      M.playing = true; syncCtl();
      M.timer = setTimeout(step, reduced ? 900 : 350);
    }).catch(function () { if (M) { pb.disabled = false; syncCtl(); if (global.__toast) global.__toast('기록을 불러오지 못해서 재생할 수 없어요'); } });
  }
  function step() {
    if (!M || !M.playing) return;
    var ps = M.ctx.periods, i = ps.indexOf(M.period) + 1;
    if (i >= ps.length) { pause(); return; }
    goPeriod(ps[i], true, true).then(function () { if (M && M.playing) M.timer = setTimeout(step, reduced ? 900 : BASE_STEP / M.speed); });
  }
  function pinGroup(id) {
    M.pin = id || null; M.ctx.setState({ pin: M.pin });
    M.svg.classList.toggle('focus', !!M.pin);
    if (M.cur) render(M.cur, false); // 이름표(고른 그룹만)·강조·궤적을 한 번에 다시 그린다
    var pick = $('mrPick'); if (pick && !id) pick.value = '';
  }

  /* ---------- 툴팁 ---------- */
  function tipAt(node, html) {
    var t = M.tip, sr = M.stage.getBoundingClientRect(), r = node.getBoundingClientRect();
    t.innerHTML = html; t.hidden = false;
    var x = r.left + r.width / 2 - sr.left, y = r.top - sr.top;
    t.style.left = Math.max(70, Math.min(sr.width - 70, x)) + 'px'; t.style.top = Math.max(38, y) + 'px';
  }
  function showNodeTip(node) {
    var d = M.cur, id = node.getAttribute('data-id'), p = d.by[id], ent = HA.entryById(d.snap, id); if (!p || !ent) return;
    tipAt(node, '<b>' + M.ctx.esc(ent.group) + '</b><small>' + fp(d.period) + ' · #' + ent.rank + ' · ' + ent.score + '점 · ' + M.ctx.esc(ent.tier) + '</small><small style="color:' + ZONES[p.zone].color + '">' + p.zone + '</small>');
  }
  function showTrailTip(node) {
    var a = node.getAttribute('data-tip').split('|');
    tipAt(node, '<b>' + a[0] + '</b><small>' + M.ctx.esc(a[1]) + '</small><small style="color:' + ZONES[a[2]].color + '">' + a[2] + '</small>');
  }

  /* ---------- 마운트 ---------- */
  function mount(root, ctx) {
    if (M) destroy();
    var S = ctx.state;
    M = { ctx: ctx, root: root, country: S.country, cache: {}, nodes: {}, pin: S.pin || null, trail: S.trail, speed: S.speed, zone: null, playing: false, goTok: 0, trailTok: 0, timer: 0, everyP: null };
    var ps = ctx.periods, e = ctx.esc;
    root.innerHTML = '<div class="mr"><div class="mr-stage" id="mrStage"><svg class="mr-map" id="mrSvg" role="group" aria-label="' + e(ctx.ko[S.country]) + ' 아이돌 시장 포지셔닝 지도(월별)"></svg>'
      + '<div class="mr-load" id="mrLoad">지도를 계산하는 중…</div><div class="mr-tip" id="mrTip" hidden></div></div>'
      + '<aside class="mr-side"><div class="mr-card wide" id="mrPin"></div><div class="mr-card"><h3>MARKET POSITION <small id="mrZoneH" style="text-transform:none;letter-spacing:0;margin-left:6px"></small></h3><ul class="zlist" id="mrZones"></ul></div></aside></div>'
      + '<div class="mr-ctl" id="mrCtl" role="group" aria-label="지도 재생 컨트롤">'
      + '<div class="mr-slide"><input type="range" id="mrSlide" min="0" max="' + (ps.length - 1) + '" step="1" aria-label="월 선택"><output id="mrOut" for="mrSlide"></output></div>'
      + '<span class="g"><button class="ibtn" type="button" id="mrPrev" aria-label="이전 달">‹</button><button class="playbtn" type="button" id="mrPlay" aria-pressed="false">▶ PLAY</button><button class="ibtn" type="button" id="mrNext" aria-label="다음 달">›</button></span>'
      + '</div><div class="mr-opts" id="mrOpts">'
      + '<span class="g"><span class="lab">SPEED</span><span class="seg" role="group" aria-label="재생 속도">' + SPEEDS.map(function (s) { return '<button class="pill" type="button" data-speed="' + s + '" aria-pressed="false">' + s + 'x</button>'; }).join('') + '</span></span>'
      + '<span class="g"><span class="lab">TRAIL</span><span class="seg" role="group" aria-label="궤적 범위">' + TRAILS.map(function (t) { return '<button class="pill" type="button" data-trail="' + t[0] + '" aria-pressed="false">' + t[1] + '</button>'; }).join('') + '</span></span>'
      + '<input class="mr-pick" id="mrPick" list="mrGroups" placeholder="그룹 이름으로 따라가기" autocomplete="off" aria-label="그룹 찾아 따라가기"><datalist id="mrGroups"></datalist></div>'
      + '<div class="verbanner" id="mrBreak" role="note" hidden></div>'
      + '<p class="mr-disc"><b>이 지도는 그 달 자국 시장 안에서의 상대 위치예요.</b> 같은 점수여도 그 달 전체 분포가 다르면 위치가 달라질 수 있어요. 가로는 코어 팬덤 ↔ 대중, 세로는 디지털·음원 ↔ 라이브·공연이고, 위치는 우열이 아니라 성향이에요. 버블 크기는 그 달 총점이 시장에서 어느 정도인지를 뜻해요. 한국과 일본은 따로 봐요.</p>'
      + '<p class="sr" id="mrLive" aria-live="polite"></p>';
    M.stage = $('mrStage'); M.svg = $('mrSvg'); M.tip = $('mrTip'); M.live = $('mrLive');
    M.svg.classList.toggle('focus', !!M.pin);
    M.bg = el('g', null, M.svg); M.trailG = el('g', null, M.svg); M.layer = el('g', null, M.svg);
    measure(); drawBg();
    bindEvents();
    setLoad(true, '지도를 계산하는 중…');
    ctx.snap(M.country, S.period).then(function (s) {
      if (!M) return;
      if (!s) { setLoad(true, '이 달 기록을 불러오지 못했어요. 다른 달을 골라 주세요.'); return; }
      var d = M.cache[S.period] = M.cache[S.period] || computeFor(M.country, s);
      M.period = S.period; setLoad(false); render(d, false);
      $('mrGroups').innerHTML = s.groups.slice().sort(function (a, b) { return a.rank - b.rank; }).map(function (g) { return '<option value="' + e(g.group) + '"></option>'; }).join('');
      if (M.pin) loadEvery(); // 고정된 그룹의 궤적/영역 이력을 위해 미리 읽는다
      preloadNeighbors();
    });
  }
  function preloadNeighbors() { // 이웃 달을 미리 읽어 둔다
    var ps = M.ctx.periods, i = ps.indexOf(M.period);
    [i - 1, i + 1].forEach(function (k) { if (k >= 0 && k < ps.length) loadPeriod(ps[k]); });
  }
  function bindEvents() {
    var ctx = M.ctx, svg = M.svg;
    $('mrSlide').addEventListener('input', function () { pause(); goPeriod(ctx.periods[Number(this.value)], true, true); });
    $('mrPrev').addEventListener('click', function () { pause(); var i = ctx.periods.indexOf(M.period); if (i > 0) goPeriod(ctx.periods[i - 1], true, true); });
    $('mrNext').addEventListener('click', function () { pause(); var i = ctx.periods.indexOf(M.period); if (i < ctx.periods.length - 1) goPeriod(ctx.periods[i + 1], true, true); });
    $('mrPlay').addEventListener('click', play);
    M.root.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-speed]'))) { M.speed = Number(b.getAttribute('data-speed')); ctx.setState({ speed: M.speed }); if (M.playing) { clearTimeout(M.timer); M.timer = setTimeout(step, 250); } syncCtl(); return; }
      if ((b = t.closest('[data-trail]'))) { M.trail = b.getAttribute('data-trail'); ctx.setState({ trail: M.trail }); syncCtl(); drawTrail(); return; }
      if ((b = t.closest('[data-zone]'))) { var z = b.getAttribute('data-zone'); M.zone = M.zone === z ? null : z; applyHighlight(); drawZones(); return; }
      if (t.closest('[data-unpin]')) { pinGroup(null); return; }
      if ((b = t.closest('[data-detail]'))) { e.preventDefault(); e.stopPropagation(); ctx.openDetail(b.getAttribute('data-detail')); return; }
    });
    $('mrPick').addEventListener('change', function () {
      var v = this.value.trim().toLowerCase(); if (!v) return;
      var hit = M.cur.snap.groups.filter(function (g) { return g.group.toLowerCase() === v; })[0] || M.cur.snap.groups.filter(function (g) { return g.group.toLowerCase().indexOf(v) === 0; })[0] || M.cur.snap.groups.filter(function (g) { return g.group.toLowerCase().indexOf(v) !== -1; })[0];
      if (hit) { pinGroup(hit.id); this.value = hit.group; }
      else if (global.__toast) global.__toast('이 달 평가에서 ‘' + this.value + '’ 그룹을 찾지 못했어요');
    });
    // 점 클릭: 고정/해제 · 마우스 hover 툴팁
    svg.addEventListener('click', function (e) {
      var n = e.target.closest('.pt'), tp = e.target.closest('.trail-p');
      if (tp) { showTrailTip(tp); clearTimeout(M.tipT); M.tipT = setTimeout(function () { M.tip.hidden = true; }, 2600); return; }
      if (n) { var id = n.getAttribute('data-id'); pinGroup(M.pin === id ? null : id); showNodeTip(n); clearTimeout(M.tipT); M.tipT = setTimeout(function () { M.tip.hidden = true; }, 2200); return; }
      M.tip.hidden = true; if (M.zone) { M.zone = null; applyHighlight(); drawZones(); }
    });
    svg.addEventListener('pointerover', function (e) {
      if (e.pointerType !== 'mouse') return;
      var n = e.target.closest('.pt'), tp = e.target.closest('.trail-p');
      if (tp) showTrailTip(tp); else if (n) showNodeTip(n);
    });
    svg.addEventListener('pointerout', function (e) { if (e.pointerType === 'mouse' && (e.target.closest('.pt') || e.target.closest('.trail-p'))) M.tip.hidden = true; });
    if (global.ResizeObserver) {
      M.ro = new ResizeObserver(function () {
        clearTimeout(M.rt);
        M.rt = setTimeout(function () { if (!M) return; var w = Math.round(M.stage.clientWidth); if (w === M.W) return; measure(); drawBg(); if (M.cur) render(M.cur, false); }, 120);
      });
      M.ro.observe(M.stage);
    }
    M.vis = function () { if (document.hidden && M && M.playing) pause(); };
    document.addEventListener('visibilitychange', M.vis);
  }
  function destroy() {
    if (!M) return;
    clearTimeout(M.timer); clearTimeout(M.rt); clearTimeout(M.tipT);
    if (M.ro) M.ro.disconnect();
    document.removeEventListener('visibilitychange', M.vis);
    M.playing = false; M = null;
  }
  function setPeriod(p) { // 상단 월 선택기·화살표 키에서 온 변경
    if (!M) return;
    pause(); goPeriod(p, true, false);
  }

  global.MapReplay = { mount: mount, destroy: destroy, setPeriod: setPeriod, active: function () { return !!M; }, ZONES: ZONES };
})(window);
