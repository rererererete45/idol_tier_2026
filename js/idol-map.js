/* IDOL MAP — 시장 포지셔닝 지도 (IDOL_MAP_SPEC.md)
 * X: 코어 팬덤 ↔ 대중 확장, Y: 디지털 ↔ 라이브. 좌표에는 총점·현재기세를 쓰지 않는다.
 * 국가별 percentile → X_RAW/Y_RAW → robust z + tanh 로 화면 좌표를 만든다.
 * 정규화/스타일 태그/최애 저장/추천은 js/idol-match.js(window.IdolMatch)를 재사용한다. */
(function () {
  'use strict';
  var IM = window.IdolMatch;
  var R = window.IdolRec; // 논리 좌표·통계는 idol-recommendation-core.js 와 공유
  var Q = new URLSearchParams(location.search);
  var DEBUG = Q.get('debugMap') === '1';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var TIER_COLORS = { 'S+': '#1ed760', 'S': '#36e0a0', 'A+': '#22d3ee', 'A': '#38a8f8', 'B+': '#5b8def', 'B': '#7c7cf0', 'C+': '#a78bfa', 'C': '#b592e8', 'D+': '#8b95a7', 'D': '#5f6b7d' };
  var ZONE_META = {
    'CORE LIVE': { color: '#f3727f', text: '팬덤 중심 · 라이브 강세' },
    'STAGE STAR': { color: '#ffa42b', text: '대중 확장 · 라이브 강세' },
    'PUBLIC HIT': { color: '#539df5', text: '대중 확장 · 디지털 강세' },
    'CORE DIGITAL': { color: '#a78bfa', text: '팬덤 중심 · 디지털 강세' },
    'BALANCED': { color: '#b3b3b3', text: '중앙 균형형' }
  };
  var ZONE_ORDER = ['CORE LIVE', 'STAGE STAR', 'PUBLIC HIT', 'CORE DIGITAL', 'BALANCED'];
  var TIER_ORDER = ['S+', 'S', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D'];
  var STYLE_CATS = [
    { key: 'POP_ROYAL', label: 'POP / 왕도', color: '#1ed760', tags: { '팝': 1, '왕도': 1, '청춘': 1, '글로벌': 0.5, '세련됨': 0.5, '레트로': 0.4 } },
    { key: 'KAWAII_CLEAN', label: 'KAWAII / 청순', color: '#f3727f', tags: { '카와이': 1, '청순': 1, '몽환': 0.5 } },
    { key: 'PERFORMANCE', label: 'PERFORMANCE / 걸크러시', color: '#ffa42b', tags: { '퍼포먼스': 1, '걸크러시': 1, '쿨': 1 } },
    { key: 'HIPHOP_RNB', label: 'HIPHOP / R&B', color: '#facc15', tags: { '힙합': 1, 'R&B': 1, '보컬': 1 } },
    { key: 'ROCK_BAND', label: 'ROCK / BAND', color: '#539df5', tags: { '록': 1, '밴드': 1 } },
    { key: 'DARK_ALT', label: 'DARK / ALTERNATIVE', color: '#a78bfa', tags: { '다크': 1, '얼터너티브': 1, '서브컬처': 1 } },
    { key: 'ELECTRO', label: 'ELECTRO / EXPERIMENTAL', color: '#22d3ee', tags: { '일렉트로': 1, '실험적': 1 } }
  ];
  var ZONE_TEXT = {
    'CORE LIVE': '팬덤 중심 · 라이브 강세', 'STAGE STAR': '대중 확장 · 라이브 강세',
    'PUBLIC HIT': '대중 확장 · 디지털 강세', 'CORE DIGITAL': '팬덤 중심 · 디지털 강세', 'BALANCED': '중앙 균형형'
  };

  /* ---------- 통계/좌표 ---------- */
  function bubbleRadius(totalPct) { return Math.max(7, Math.min(16, 7 + totalPct * 0.09)); }
  function momentumGlow(p) { return p < 40 ? 0 : p < 70 ? 1 : p < 90 ? 2 : 3; }
  function hashString(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return h;
  }
  function styleCategory(tags) {
    var best = null, bestScore = 0;
    STYLE_CATS.forEach(function (c) {
      var s = 0;
      (tags || []).forEach(function (t) { s += c.tags[t] || 0; });
      if (s > bestScore) { bestScore = s; best = c.key; }
    });
    return best || 'ETC';
  }
  function catOf(key) { return STYLE_CATS.filter(function (c) { return c.key === key; })[0] || { key: 'ETC', label: '기타', color: '#7c7c7c' }; }

  // 논리 좌표(baseX/baseY)는 IdolRec.logicalPoints 에서 오고, 여기서는 표시용 지터·충돌 보정만 얹는다.
  function buildPoints(country) {
    var L = R.logicalPoints(country);
    var pts = L.points.map(function (l) {
      var g = IM.getGroup(country, l.group);
      var p = Object.assign({}, l, {
        radius: bubbleRadius(l.totalPercentile), glow: momentumGlow(l.mom),
        styleCategory: styleCategory(g && g.styleTags), status: g ? g.status : '', spotify: g ? g.spotify : '', slug: g ? g.slug : ''
      });
      var h = hashString(p.key), jx = ((h & 0xffff) / 0xffff * 2 - 1) * 1.2, jy = (((h >>> 16) & 0xffff) / 0xffff * 2 - 1) * 1.2;
      p.screenX = Math.max(6, Math.min(94, p.baseX + jx)); p.screenY = Math.max(6, Math.min(94, p.baseY + jy));
      return p;
    });
    resolveCollisions(pts);
    return { points: pts, excluded: L.excluded };
  }

  // 초기 배치 때 한 번만: 겹침을 줄이되 데이터 좌표(baseX/Y)에서 3.5%p 이상 벗어나지 않게 한다.
  function resolveCollisions(pts) {
    var MAXD = 3.5, PXPCT = 6.4;
    for (var it = 0; it < 60; it++) {
      var moved = false;
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) {
          var a = pts[i], b = pts[j];
          var dx = b.screenX - a.screenX, dy = b.screenY - a.screenY;
          var min = (a.radius + b.radius) * 0.62 / PXPCT;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d >= min) continue;
          if (d < 1e-6) { var hh = hashString(a.key + b.key); dx = Math.cos(hh); dy = Math.sin(hh); d = 1; }
          var push = (min - d) / 2, ux = dx / d, uy = dy / d;
          a.screenX -= ux * push; a.screenY -= uy * push; b.screenX += ux * push; b.screenY += uy * push;
          moved = true;
        }
      }
      pts.forEach(function (p) {
        var ox = p.screenX - p.baseX, oy = p.screenY - p.baseY, od = Math.sqrt(ox * ox + oy * oy);
        if (od > MAXD) { p.screenX = p.baseX + ox / od * MAXD; p.screenY = p.baseY + oy / od * MAXD; }
        p.screenX = Math.max(5, Math.min(95, p.screenX)); p.screenY = Math.max(5, Math.min(95, p.screenY));
      });
      if (!moved) break;
    }
  }

  function generatePositionExplanation(p) {
    var xd = p.pub - p.fan, yd = p.live - p.dig, out = [];
    if (xd > 10) out.push('대중 확장력이 코어 팬덤력보다 상대적으로 높아 PUBLIC 방향에 위치합니다.');
    else if (xd < -10) out.push('코어 팬덤력이 대중 확장력보다 상대적으로 높아 FANDOM 방향에 위치합니다.');
    else out.push('대중성과 팬덤이 비슷한 수준이라 X축 중앙에 가깝습니다.');
    if (yd > 10) out.push('디지털·음원 지표보다 공연력이 상대적으로 강해 LIVE 방향에 위치합니다.');
    else if (yd < -10) out.push('공연력보다 디지털·' + (p.country === 'KR' ? '글로벌' : 'SNS') + ' 지표가 상대적으로 강해 DIGITAL 방향에 위치합니다.');
    else out.push('공연력과 디지털 지표가 비슷한 수준이라 Y축 중앙에 가깝습니다.');
    return out;
  }

  /* ---------- 상태 ---------- */
  var DATA = { KR: null, JP: null };
  var S = {
    mode: 'KR', preset: 'ALL', color: 'tier', sel: null, hover: null, compare: false, cmp: [], match: null, scene: null,
    scale: 1, tx: 0, ty: 0, W: 0, H: 0, sf: 1, query: '', zone: null, enter: true, vis: [], lab: {}
  };
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = window.matchMedia && matchMedia('(pointer:fine)').matches;
  var el = {};
  var PAD = { l: 34, r: 34, t: 48, b: 38 };

  function $(id) { return document.getElementById(id); }
  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pageOf(c) { return IM.countries[c].page; }
  function detailUrl(p) { return pageOf(p.country) + '?group=' + encodeURIComponent(p.group); }

  function activePoints() {
    var list = [];
    if (S.mode === 'KR' || S.mode === 'ALL') list = list.concat(DATA.KR.points);
    if (S.mode === 'JP' || S.mode === 'ALL') list = list.concat(DATA.JP.points);
    return list;
  }
  var byKey = {};
  function favSet() {
    var m = {};
    IM.getFavorites().forEach(function (f) { m[f.country + '|' + f.group] = 1; });
    return m;
  }
  function passesPreset(p, favs) {
    if (S.preset === 'HOT') return p.mom >= 80;
    if (S.preset === 'GEM') return p.totalPercentile < 60 && Math.max(p.pub, p.fan, p.live, p.dig) >= 80;
    if (S.preset === 'MINE') return !!favs[p.key];
    return true;
  }
  function passesQuery(p) { return !S.query || p.group.toLowerCase().indexOf(S.query) !== -1; }
  function curSet() { return S.match || S.scene; }
  function passesZone(p) { return !S.zone || p.zone === S.zone; }
  function isVisible(p, favs) { return passesPreset(p, favs) && passesQuery(p) && passesZone(p); }
  function colorOf(p) { return S.color === 'style' ? catOf(p.styleCategory).color : (TIER_COLORS[p.tier] || '#7c7c7c'); }

  /* ---------- 렌더 ---------- */
  function plot() { return { w: S.W - PAD.l - PAD.r, h: S.H - PAD.t - PAD.b }; }
  function toPx(p) {
    var pl = plot();
    return { x: PAD.l + p.screenX / 100 * pl.w, y: PAD.t + p.screenY / 100 * pl.h };
  }

  function measure() {
    var w = el.wrap.clientWidth || 360;
    S.W = w; S.H = Math.max(520, Math.min(Math.round(w * (w > 700 ? 0.74 : 0.9)), 720));
    S.sf = Math.max(0.62, Math.min(1, w / 720)); // 좁은 화면에서는 버블을 줄여 겹침 완화
    el.svg.setAttribute('viewBox', '0 0 ' + S.W + ' ' + S.H);
    el.svg.style.height = S.H + 'px';
  }

  function clampView() {
    S.tx = Math.min(0, Math.max(S.W * (1 - S.scale), S.tx));
    S.ty = Math.min(0, Math.max(S.H * (1 - S.scale), S.ty));
  }
  function applyView() {
    clampView();
    el.vp.setAttribute('transform', 'translate(' + S.tx + ',' + S.ty + ') scale(' + S.scale + ')');
    var inv = 'scale(' + (1 / S.scale) + ')';
    var n = el.vp.querySelectorAll('.mi');
    for (var i = 0; i < n.length; i++) n[i].setAttribute('transform', inv);
    el.zoomval.textContent = Math.round(S.scale * 100) + '%';
    scheduleLabels();
  }

  // 데이터가 중앙에 몰려 있으면(통합/일본) 점들이 화면을 채우도록 처음 보기를 자동으로 맞춘다.
  function fitView() {
    var pts = activePoints();
    S.scale = 1; S.tx = 0; S.ty = 0;
    if (pts.length && pts[0].px) {
      var x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      pts.forEach(function (p) { x1 = Math.min(x1, p.px.x); x2 = Math.max(x2, p.px.x); y1 = Math.min(y1, p.px.y); y2 = Math.max(y2, p.px.y); });
      var bw = Math.max(x2 - x1 + 70, 120), bh = Math.max(y2 - y1 + 70, 120);
      var sc = Math.min(2.6, Math.min(S.W / bw, S.H / bh));
      if (sc >= 1.2) {
        S.scale = sc;
        S.tx = S.W / 2 - (x1 + x2) / 2 * sc; S.ty = S.H / 2 - (y1 + y2) / 2 * sc;
      }
    }
    applyView();
  }

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function f(c) { return Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)); }
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function gradId(col) { return 'rg' + col.slice(1); }

  function buildDefs(svg, pts) {
    var defs = svgEl('defs', {}, svg), seen = {};
    pts.forEach(function (p) {
      var col = colorOf(p);
      if (seen[col]) return; seen[col] = 1;
      var g = svgEl('radialGradient', { id: gradId(col), cx: '.36', cy: '.3', r: '.85' }, defs);
      svgEl('stop', { offset: '0', 'stop-color': shade(col, 0.55) }, g);
      svgEl('stop', { offset: '.55', 'stop-color': col }, g);
      svgEl('stop', { offset: '1', 'stop-color': shade(col, -0.32) }, g);
    });
    // 사분면 틴트: 바깥 모서리에서 안쪽으로 옅게 번지는 그라데이션
    [['zgCL', ZONE_META['CORE LIVE'].color, 0, 0], ['zgSS', ZONE_META['STAGE STAR'].color, 1, 0],
     ['zgCD', ZONE_META['CORE DIGITAL'].color, 0, 1], ['zgPH', ZONE_META['PUBLIC HIT'].color, 1, 1]].forEach(function (z) {
      var g = svgEl('radialGradient', { id: z[0], cx: z[2], cy: z[3], r: '1.05' }, defs);
      svgEl('stop', { offset: '0', 'stop-color': z[1], 'stop-opacity': '.2' }, g);
      svgEl('stop', { offset: '1', 'stop-color': z[1], 'stop-opacity': '0' }, g);
    });
  }

  function renderIdolMap() {
    measure();
    var svg = el.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('class', S.enter && !REDUCED ? 'enter' : '');
    var pl = plot();
    var pts = activePoints().slice().sort(function (a, b) { return b.radius - a.radius; }); // 작은 점이 위
    buildDefs(svg, pts);

    // 고정 레이어(줌해도 크기 유지): 사분면 이름
    var fx = svgEl('g', { id: 'fx', 'pointer-events': 'none' }, svg);
    var big = S.W >= 520;
    [['CORE LIVE', 0, 0], ['STAGE STAR', 1, 0], ['CORE DIGITAL', 0, 1], ['PUBLIC HIT', 1, 1]].forEach(function (z) {
      var right = z[1] === 1, bottom = z[2] === 1, x = PAD.l + (right ? pl.w - 12 : 12), y0 = PAD.t + (bottom ? pl.h - (big ? 30 : 14) : 20);
      var t = svgEl('text', { class: 'zc-t', x: x, y: y0, 'text-anchor': right ? 'end' : 'start', fill: ZONE_META[z[0]].color }, fx);
      t.textContent = z[0];
      if (big) {
        var st = svgEl('text', { class: 'zc-s', x: x, y: y0 + (bottom ? 14 : 14), 'text-anchor': right ? 'end' : 'start' }, fx);
        st.textContent = ZONE_META[z[0]].text;
      }
    });

    var vp = svgEl('g', { id: 'vp' }, svg);
    el.vp = vp;
    var cx = PAD.l + pl.w / 2, cy = PAD.t + pl.h / 2, hw = pl.w / 2, hh = pl.h / 2;
    // 사분면 틴트 + 플롯 테두리
    svgEl('rect', { class: 'plot-bg', x: PAD.l, y: PAD.t, width: pl.w, height: pl.h, rx: 14 }, vp);
    [['zgCL', PAD.l, PAD.t], ['zgSS', cx, PAD.t], ['zgCD', PAD.l, cy], ['zgPH', cx, cy]].forEach(function (q) {
      svgEl('rect', { x: q[1], y: q[2], width: hw, height: hh, fill: 'url(#' + q[0] + ')' }, vp);
    });
    // 동심 타원(레이더 느낌) + 중심축
    [[0.25, 'd'], [0.47, '']].forEach(function (r) {
      svgEl('ellipse', { class: 'ring-l ' + r[1], cx: cx, cy: cy, rx: pl.w * r[0], ry: pl.h * r[0] }, vp);
    });
    svgEl('line', { class: 'axis', x1: cx, y1: PAD.t + 4, x2: cx, y2: PAD.t + pl.h - 4 }, vp);
    svgEl('line', { class: 'axis', x1: PAD.l + 4, y1: cy, x2: PAD.l + pl.w - 4, y2: cy }, vp);
    // BALANCED 영역(중앙 ±R.CENTER_TOLERANCE)
    svgEl('rect', { class: 'bal', x: cx - pl.w * R.CENTER_TOLERANCE / 100, y: cy - pl.h * R.CENTER_TOLERANCE / 100, width: pl.w * R.CENTER_TOLERANCE / 50, height: pl.h * R.CENTER_TOLERANCE / 50, rx: 12 }, vp);
    var bw = svgEl('g', { transform: 'translate(' + cx + ',' + (cy - pl.h * R.CENTER_TOLERANCE / 100 + 13) + ')' }, vp);
    var bmi = svgEl('g', { class: 'mi' }, bw);
    var bt = svgEl('text', { class: 'bal-t' }, bmi); bt.textContent = 'BALANCED';

    el.compareLine = svgEl('line', { class: 'cmp-line', 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' }, vp);
    el.layer = svgEl('g', { id: 'pts' }, vp);
    el.lbls = svgEl('g', { id: 'lbls', 'pointer-events': 'none' }, vp);

    var coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches;
    var multi = S.mode === 'ALL';
    byKey = {};
    pts.forEach(function (p) {
      byKey[p.key] = p;
      var px = toPx(p); p.px = px;
      var g = svgEl('g', { class: 'mp', tabindex: 0, role: 'button', 'data-k': p.key, transform: 'translate(' + px.x.toFixed(1) + ',' + px.y.toFixed(1) + ')' }, el.layer);
      g.setAttribute('aria-label', p.group + ', ' + p.tier + '티어, ' + p.zone);
      g.style.setProperty('--d', Math.round(Math.hypot(p.screenX - 50, p.screenY - 50) * 9));
      var mi = svgEl('g', { class: 'mi' }, g);
      var pop = svgEl('g', { class: 'pop' }, mi);
      p.node = g;
      var pr = p.radius * S.sf; p.pr = pr;
      var col = colorOf(p);
      g.style.color = col;
      svgEl('circle', { class: 'hit', r: coarse ? 22 : Math.max(pr + 3, 13) }, pop);
      if (p.glow > 0) svgEl('circle', { class: 'halo', r: pr + 3 + p.glow * 2.4 }, pop);
      svgEl('circle', { class: 'rip', r: pr + 2 }, pop);
      svgEl('circle', { class: 'ring-g', r: pr + 9 }, pop);
      svgEl('circle', { class: 'ring', r: pr + 4.5 }, pop);
      var shape;
      if (multi && p.country === 'JP') {
        var d = pr * 1.18;
        shape = svgEl('polygon', { class: 'dot', points: '0,' + (-d) + ' ' + d + ',0 0,' + d + ' ' + (-d) + ',0' }, pop);
      } else shape = svgEl('circle', { class: 'dot', r: pr }, pop);
      shape.setAttribute('fill', 'url(#' + gradId(col) + ')');
      // 라벨은 모든 버블 위에 그려지도록 별도 레이어에 둔다
      var lb = svgEl('g', { class: 'lb', transform: 'translate(' + px.x.toFixed(1) + ',' + px.y.toFixed(1) + ')' }, el.lbls);
      var lbl = svgEl('text', { class: 'lbl', x: pr + 6, y: 4 }, svgEl('g', { class: 'mi' }, lb));
      lbl.textContent = p.group; p.lblNode = lbl; p.lbNode = lb;
      g.setAttribute('data-glow', p.glow);
    });
    S.enter = false;
    applyView();
    refreshStates();
    renderZones();
    drawDots();
  }

  function labelSet(vis) {
    var set = {};
    var byCountry = { KR: [], JP: [] };
    vis.forEach(function (p) { byCountry[p.country].push(p); });
    var per = curSet() ? 0 : (S.mode === 'ALL' ? 6 : 10); // 매칭 중에는 추천 그룹 라벨에 집중
    ['KR', 'JP'].forEach(function (c) {
      byCountry[c].sort(function (a, b) { return b.totalScore - a.totalScore; }).slice(0, per).forEach(function (p) { set[p.key] = 1; });
    });
    if (vis.length <= 12) vis.forEach(function (p) { set[p.key] = 1; });
    if (S.sel) set[S.sel] = 1;
    if (S.hover) set[S.hover] = 1;
    S.cmp.forEach(function (k) { set[k] = 1; });
    if (curSet()) { set[curSet().src] = 1; curSet().items.forEach(function (m) { set[m.key] = 1; }); }
    return set;
  }

  /* ---------- 라벨 배치: 겹치면 반대편으로 옮기고, 그래도 안 되면 숨긴다 ---------- */
  var labelRaf = 0;
  function scheduleLabels() {
    if (labelRaf) return;
    labelRaf = requestAnimationFrame(function () { labelRaf = 0; layoutLabels(); });
  }
  function textW(str) {
    var w = 0;
    for (var i = 0; i < str.length; i++) w += str.charCodeAt(i) > 0x2e7f ? 11.5 : 6.4;
    return w + 4;
  }
  function hitRect(a, b) { return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1; }
  function layoutLabels() {
    var vis = S.vis || [], lab = S.lab || {};
    var forced = {};
    if (S.sel) forced[S.sel] = 1;
    if (S.hover) forced[S.hover] = 1;
    S.cmp.forEach(function (k) { forced[k] = 1; });
    if (curSet()) { forced[curSet().src] = 1; curSet().items.forEach(function (m) { forced[m.key] = 1; }); }
    var extra = S.scale >= 1.8 ? 1 : (S.scale >= 1.3 ? 0.5 : 0);
    var cand = vis.filter(function (p) { return lab[p.key] || forced[p.key] || extra === 1 || (extra > 0 && p.totalPercentile >= 55); });
    cand.sort(function (a, b) { return (forced[b.key] ? 1e6 : 0) + b.totalScore - ((forced[a.key] ? 1e6 : 0) + a.totalScore); });
    var scr = function (p) { return { x: S.tx + S.scale * p.px.x, y: S.ty + S.scale * p.px.y }; };
    var obst = vis.map(function (p) { var s = scr(p); return { k: p.key, x: s.x, y: s.y, r: p.pr + 2 }; });
    var placed = [], done = {};
    cand.forEach(function (p) {
      var s = scr(p), w = textW(p.group), h = 13, pr = p.pr, chosen = null;
      if (s.x < -20 || s.y < -20 || s.x > S.W + 20 || s.y > S.H + 20) return;
      var opts = [
        { ax: 'start', x: pr + 6, y: 4, box: { x1: s.x + pr + 4, x2: s.x + pr + 8 + w, y1: s.y - 9, y2: s.y + 5 } },
        { ax: 'end', x: -(pr + 6), y: 4, box: { x1: s.x - pr - 8 - w, x2: s.x - pr - 4, y1: s.y - 9, y2: s.y + 5 } },
        { ax: 'middle', x: 0, y: -(pr + 7), box: { x1: s.x - w / 2, x2: s.x + w / 2, y1: s.y - pr - 7 - h + 2, y2: s.y - pr - 5 } },
        { ax: 'middle', x: 0, y: pr + 16, box: { x1: s.x - w / 2, x2: s.x + w / 2, y1: s.y + pr + 4, y2: s.y + pr + 16 + 3 } }
      ];
      // 1차: 다른 라벨·버블과 모두 안 겹치는 자리 / 2차(상위 그룹만): 라벨끼리만 안 겹치면 버블 위에도 허용
      for (var pass = 0; pass < 2 && !chosen; pass++) {
        if (pass === 1 && !(lab[p.key] || forced[p.key])) break;
        for (var i = 0; i < opts.length && !chosen; i++) {
          var o = opts[i], b = o.box;
          if (b.x1 < 2 || b.x2 > S.W - 2 || b.y1 < 2 || b.y2 > S.H - 2) continue;
          var bad = placed.some(function (q) { return hitRect(b, q); });
          if (!bad && pass === 0) bad = obst.some(function (c) { return c.k !== p.key && c.x + c.r > b.x1 && c.x - c.r < b.x2 && c.y + c.r > b.y1 && c.y - c.r < b.y2; });
          if (!bad) chosen = o;
        }
      }
      if (!chosen && forced[p.key]) chosen = opts[0];
      if (chosen) { placed.push(chosen.box); done[p.key] = chosen; }
    });
    activePoints().forEach(function (p) {
      var n = p.lbNode, l = p.lblNode; if (!n || !l) return;
      var o = done[p.key];
      if (o) { l.setAttribute('x', o.x); l.setAttribute('y', o.y); l.setAttribute('text-anchor', o.ax); }
      n.classList.toggle('show', !!o);
    });
  }

  function refreshStates() {
    var favs = favSet(), pts = activePoints(), vis = pts.filter(function (p) { return isVisible(p, favs); });
    var lab = labelSet(vis);
    S.vis = vis; S.lab = lab;
    var mm = {};
    if (curSet()) curSet().items.forEach(function (m) { mm[m.key] = m.type; });
    pts.forEach(function (p) {
      var g = p.node; if (!g) return;
      var v = isVisible(p, favs);
      g.classList.toggle('off', !v);
      g.setAttribute('tabindex', v ? 0 : -1);
      g.classList.toggle('sel', S.sel === p.key || S.cmp.indexOf(p.key) !== -1);
      var hl = '';
      if (curSet()) hl = curSet().src === p.key ? 'src' : (mm[p.key] || '');
      if (hl) g.setAttribute('data-hl', hl); else g.removeAttribute('data-hl');
      g.classList.toggle('dimmed', !!curSet() && !hl && S.sel !== p.key);
    });
    $('count').textContent = vis.length + '팀 표시 중';
    drawCompareLine();
    layoutLabels();
  }

  function drawCompareLine() {
    var ln = el.compareLine; if (!ln) return;
    if (S.cmp.length === 2 && byKey[S.cmp[0]] && byKey[S.cmp[1]]) {
      var a = toPx(byKey[S.cmp[0]]), b = toPx(byKey[S.cmp[1]]);
      ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y); ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y);
      ln.setAttribute('visibility', 'visible');
    } else ln.setAttribute('visibility', 'hidden');
  }

  /* ---------- 상세 시트 ---------- */
  function bar(label, v) {
    return '<div class="mrow2"><span>' + label + '</span><div class="bar"><i data-w="' + Math.round(v) + '"></i></div><b>' + Math.round(v) + '</b></div>';
  }
  function flag(c) { return '<span class="flagb flag-' + c.toLowerCase() + '">' + c + '</span>'; }
  function digLabel(p) { return p.country === 'KR' ? '디지털·글로벌' : '디지털·SNS'; }
  function zc(p) { return ZONE_META[p.zone].color; }
  function tierChip(p) { return '<span class="chip tier" style="background:' + (TIER_COLORS[p.tier] || '#777') + '">' + esc(p.tier) + '</span>'; }

  function miniMap(p) {
    var c = zc(p), x = Math.max(9, Math.min(87, p.screenX / 100 * 96)), y = Math.max(9, Math.min(87, p.screenY / 100 * 96));
    var t = function (col, px, py) { return '<rect x="' + px + '" y="' + py + '" width="48" height="48" fill="' + col + '" opacity=".16"/>'; };
    return '<svg viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" rx="12" fill="#1a1a1a"/>'
      + '<g clip-path="inset(0 round 12px)">' + t(ZONE_META['CORE LIVE'].color, 0, 0) + t(ZONE_META['STAGE STAR'].color, 48, 0) + t(ZONE_META['CORE DIGITAL'].color, 0, 48) + t(ZONE_META['PUBLIC HIT'].color, 48, 48) + '</g>'
      + '<path d="M48 4v88M4 48h88" stroke="rgba(255,255,255,.22)" stroke-width="1"/>'
      + '<rect x="' + (48 - 11.5) + '" y="' + (48 - 11.5) + '" width="23" height="23" rx="5" fill="none" stroke="rgba(255,255,255,.28)" stroke-dasharray="2 3"/>'
      + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="11" fill="' + c + '" opacity=".28"/>'
      + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5" fill="' + c + '" stroke="#fff" stroke-width="1.5"/></svg>';
  }

  function openMapDetail(p) {
    var sh = el.sheet;
    if (S.compare && S.cmp.length === 2) { renderComparePanel(); return; }
    var expl = generatePositionExplanation(p).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('');
    var topTotal = Math.max(1, Math.round(100 - p.totalPercentile)), topMom = Math.max(1, Math.round(100 - p.mom));
    var html = '<div class="sh-hero"><div class="av">' + esc(p.group.charAt(0)) + imgHtml(p) + '</div>'
      + '<div class="sh-id"><h2>' + esc(p.group) + ' ' + flag(p.country) + '</h2>'
      + '<p class="sh-sub">' + tierChip(p) + '<span>' + (p.status ? esc(p.status) : '') + '</span></p></div>'
      + '<button class="x" id="shClose" aria-label="닫기">✕</button></div>'
      + '<div class="sh-zone"><i></i><b>' + esc(p.zone) + '</b><span>' + ZONE_META[p.zone].text + '</span></div>'
      + '<div class="kpis"><div class="kpi"><small>총점</small><b data-count="' + p.totalScore + '">' + p.totalScore + '</b></div>'
      + '<div class="kpi"><small>체급 상위</small><b><span data-count="' + topTotal + '">' + topTotal + '</span><u>%</u></b></div>'
      + '<div class="kpi"><small>기세 상위</small><b><span data-count="' + topMom + '">' + topMom + '</span><u>%</u></b></div></div>'
      + '<p class="sh-k">MARKET POSITION <small>(자국 시장 내 백분위)</small></p>'
      + '<div class="pos">' + miniMap(p) + '<div>' + bar('대중 확장력', p.pub) + bar('코어 팬덤력', p.fan) + bar('라이브', p.live) + bar(digLabel(p), p.dig) + '</div></div>'
      + '<p class="sh-k">왜 이 위치인가?</p><div class="expl">' + expl + '</div>'
      + (DEBUG ? '<pre class="dbg">rawX ' + p.xRaw.toFixed(1) + '  rawY ' + p.yRaw.toFixed(1) + '\nzX ' + p.zX.toFixed(2) + '  zY ' + p.zY.toFixed(2) + '\nscreen ' + p.screenX.toFixed(1) + ', ' + p.screenY.toFixed(1) + ' (base ' + p.baseX.toFixed(1) + ', ' + p.baseY.toFixed(1) + ')\npublic ' + p.pub.toFixed(1) + '  fandom ' + p.fan.toFixed(1) + '  live ' + p.live.toFixed(1) + '  digital ' + p.dig.toFixed(1) + '  momentum ' + p.mom.toFixed(1) + '</pre>' : '')
      + matchList() + sceneList()
      + '<div class="sh-act"><a class="btn out" href="' + detailUrl(p) + '">상세보기</a>'
      + (p.spotify ? '<a class="btn grn" target="_blank" rel="noopener noreferrer" href="' + esc(p.spotify) + '" aria-label="' + esc(p.group) + ' Spotify에서 듣기">Spotify ▶</a>' : '')
      + '<button class="btn out" id="btnScene">' + (S.scene && S.scene.src === p.key ? '🧬 SAME SCENE 해제' : '🧬 같은 나라 비슷한 그룹') + '</button>'
      + '<button class="btn out" id="btnMatch">' + (S.match && S.match.src === p.key ? '🇰🇷↔🇯🇵 매칭 해제' : '🇰🇷↔🇯🇵 IDOL MATCH') + '</button></div>';
    sh.innerHTML = html;
    sh.style.setProperty('--zc', zc(p));
    showSheet();
    $('shClose').addEventListener('click', clearSelection);
    $('btnMatch').addEventListener('click', function () { if (S.match && S.match.src === p.key) clearMatch(); else runMatch(p); });
    $('btnScene').addEventListener('click', function () { if (S.scene && S.scene.src === p.key) clearScene(); else runScene(p); });
    animateSheet(sh);
  }

  // 사진이 있는 그룹만 <img> 를 만든다(data/namu_images.json) — 없는 파일 요청으로 404 가 나지 않게.
  var IMGS = {};
  function loadImgs() {
    return fetch('data/namu_images.json').then(function (r) { return r.json(); }).catch(function () { return {}; }).then(function (j) { IMGS = j || {}; });
  }
  function imgHtml(p) {
    var r = IMGS[p.country] && IMGS[p.country][p.group];
    return r && r.img ? '<img alt="" src="' + esc(r.img) + '" onerror="this.remove()" style="position:absolute;inset:0">' : '';
  }
  function showSheet() { el.sheet.hidden = false; document.body.classList.add('sheet-open'); }
  // 막대 채우기 + 숫자 카운트업 (Count Up)
  function animateSheet(root) {
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(root.querySelectorAll('.bar i'), function (i) { i.style.width = i.getAttribute('data-w') + '%'; });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-count]'), function (n) { countUp(n, Number(n.getAttribute('data-count'))); });
  }
  function countUp(node, to) {
    if (REDUCED) { node.textContent = to; return; }
    var t0 = performance.now(), dur = 650;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(to * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function matchList() {
    if (!S.match) return '';
    var rows = S.match.items.map(function (m) {
      var p = byKey[m.key] || findPoint(m.key);
      return '<button class="mi-row" data-go="' + esc(m.key) + '"><span class="mk ' + m.type + '"></span><span class="nm">' + esc(p ? p.group : m.key) + '</span><b>' + m.score + '%</b></button>';
    }).join('');
    return '<p class="sh-k">IDOL MATCH <small>핑크 링 = 추천, 점선 다이아 = 숨은 취향</small></p><div class="mlist2">' + rows + '</div>';
  }
  function sceneList() {
    if (!S.scene) return '';
    var rows = S.scene.items.map(function (m) {
      var p = findPoint(m.key);
      return '<button class="mi-row" data-go="' + esc(m.key) + '"><span class="mk ' + m.type + '"></span><span class="nm">' + esc(p ? p.group : m.key) + '</span><b>' + m.score + '%</b></button>';
    }).join('');
    return '<p class="sh-k">🧬 SAME SCENE <small>금색 링 = 가장 비슷, 점선 = 취향 확장</small></p><div class="mlist2">' + rows + '</div>';
  }
  function findPoint(key) {
    var c = key.split('|')[0];
    return DATA[c] && DATA[c].points.filter(function (p) { return p.key === key; })[0];
  }

  function renderComparePanel() {
    var a = findPoint(S.cmp[0]), b = findPoint(S.cmp[1]);
    var xd = Math.round(Math.abs(a.xRaw - b.xRaw)), yd = Math.round(Math.abs(a.yRaw - b.yRaw));
    var xa = (a.pub - a.fan), xb = (b.pub - b.fan), ya = (a.live - a.dig), yb = (b.live - b.dig);
    var xt = xd < 8 ? '팬덤/대중 포지션이 거의 같아요' : (xa > xb ? a.group : b.group) + '이(가) 더 대중 쪽, ' + (xa > xb ? b.group : a.group) + '이(가) 더 팬덤 쪽이에요';
    var yt = yd < 8 ? '라이브/디지털 포지션이 거의 같아요' : (ya > yb ? a.group : b.group) + '이(가) 더 라이브 쪽, ' + (ya > yb ? b.group : a.group) + '이(가) 더 디지털 쪽이에요';
    var same = a.country === b.country;
    el.sheet.innerHTML = '<div class="sh-hero"><div class="sh-id"><h2>포지션 비교</h2></div><button class="x" id="shClose" aria-label="닫기">✕</button></div>'
      + '<p class="sh-sub">' + esc(a.group) + ' ' + flag(a.country) + ' ↔ ' + esc(b.group) + ' ' + flag(b.country) + '</p>'
      + '<div class="expl"><p><b>팬덤 ↔ 대중</b> 차이 ' + xd + ' · ' + esc(xt) + '</p><p><b>디지털 ↔ 라이브</b> 차이 ' + yd + ' · ' + esc(yt) + '</p></div>'
      + '<p class="mnote2">위치 차이는 성향의 차이일 뿐 우열이 아니에요.' + (same ? '' : ' 서로 다른 시장의 그룹은 각 시장 안의 상대 위치로만 비교해요.') + '</p>'
      + '<div class="sh-act">' + (same ? '<a class="btn grn" href="' + pageOf(a.country) + '?compare=' + encodeURIComponent(a.group + ',' + b.group) + '">상세 비교하기</a>'
        : '<a class="btn out" href="' + detailUrl(a) + '">' + esc(a.group) + ' 상세</a><a class="btn out" href="' + detailUrl(b) + '">' + esc(b.group) + ' 상세</a>')
      + '<button class="btn out" id="cmpReset">선택 초기화</button></div>';
    el.sheet.style.setProperty('--zc', '#1ed760'); showSheet();
    $('shClose').addEventListener('click', clearSelection);
    $('cmpReset').addEventListener('click', function () { S.cmp = []; refreshStates(); closeSheet(); });
  }

  function closeSheet() { el.sheet.hidden = true; document.body.classList.remove('sheet-open'); }

  /* ---------- 선택 / 매칭 ---------- */
  function setUrl() {
    var u = new URLSearchParams();
    u.set('country', S.mode);
    if (S.sel) { var p = findPoint(S.sel); if (p) u.set('group', p.group); }
    if (S.match) u.set('match', '1');
    if (S.scene) u.set('scene', '1');
    if (S.color === 'style') u.set('color', 'style');
    if (S.preset !== 'ALL') u.set('preset', S.preset);
    if (DEBUG) u.set('debugMap', '1');
    try { history.replaceState(null, '', location.pathname + '?' + u.toString()); } catch (e) { /* noop */ }
  }

  function selectGroup(key, fromMatch) {
    var p = findPoint(key); if (!p) return;
    if (S.compare) {
      var i = S.cmp.indexOf(key);
      if (i >= 0) S.cmp.splice(i, 1); else { if (S.cmp.length >= 2) S.cmp.shift(); S.cmp.push(key); }
      refreshStates();
      if (S.cmp.length === 2) renderComparePanel(); else { S.sel = key; openMapDetail(p); }
      return;
    }
    // 선택한 그룹이 현재 지도에 없으면 지도 모드를 맞춘다.
    if (!byKey[key]) setMode('ALL', true);
    S.sel = key; refreshStates(); openMapDetail(p); focusMapGroup(p); sparkAt(p); setUrl();
  }
  function clearSelection() { S.sel = null; S.cmp = []; closeSheet(); refreshStates(); setUrl(); }

  function focusMapGroup(p) {
    if (S.scale <= 1) return;
    var px = toPx(p), ty = S.H / 2;
    if (window.innerWidth < 1000) { // 하단 시트가 지도를 가리므로 보이는 영역의 가운데로 맞춘다
      var r = el.svg.getBoundingClientRect(), vis = window.innerHeight * 0.54 - r.top;
      if (vis > 120 && vis < S.H) ty = vis / 2;
    }
    S.tx = S.W / 2 - px.x * S.scale; S.ty = ty - px.y * S.scale; applyView();
  }

  function runMatch(p) {
    var r = IM.getMatches(p.country, p.group, { includeEnded: false, limit: 3, hiddenLimit: 3 });
    if (!r) return;
    var items = [];
    var tc = r.target;
    r.top.forEach(function (m) { items.push({ key: tc + '|' + m.group.name, score: m.score, type: 'match' }); });
    r.hidden.forEach(function (m) { items.push({ key: tc + '|' + m.group.name, score: m.score, type: 'gem' }); });
    S.match = { src: p.key, items: items }; S.scene = null;
    S.preset = 'ALL'; syncToolbar();
    setMode('ALL', true);
    S.sel = p.key; refreshStates(); openMapDetail(p); setUrl();
  }
  function runScene(p) {
    var r = R.getSameSceneMatches(p.country, p.group, { limit: 3, expandLimit: 3 });
    if (!r) return;
    var items = [];
    r.top.forEach(function (m) { items.push({ key: p.country + '|' + m.group.name, score: m.score, type: 'scene' }); });
    r.expand.forEach(function (m) { items.push({ key: p.country + '|' + m.group.name, score: m.score, type: 'expand' }); });
    S.scene = { src: p.key, items: items }; S.match = null;
    S.preset = 'ALL'; syncToolbar();
    if (S.mode !== 'ALL' && S.mode !== p.country) setMode(p.country, true); else if (!byKey[p.key]) setMode('ALL', true);
    S.sel = p.key; refreshStates(); openMapDetail(p); setUrl();
  }
  function clearScene() { S.scene = null; syncToolbar(); refreshStates(); var p = S.sel && findPoint(S.sel); if (p) openMapDetail(p); setUrl(); }
  function clearMatch() { S.match = null; syncToolbar(); refreshStates(); var p = S.sel && findPoint(S.sel); if (p) openMapDetail(p); setUrl(); }

  /* ---------- 툴바 ---------- */
  function setMode(m, keepSel) {
    S.mode = m; S.zone = null; S.enter = true; hideTipNow();
    if (!keepSel) { S.sel = null; S.cmp = []; S.match = null; S.scene = null; closeSheet(); }
    renderIdolMap(); fitView(); syncToolbar(); renderSideEmpty();
    $('notice').hidden = m !== 'ALL';
    setUrl();
  }
  function applyMapPreset(p) { S.preset = p; syncToolbar(); refreshStates(); setUrl(); }
  function syncToolbar() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b) { b.setAttribute('aria-pressed', b.dataset.mode === S.mode); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) { b.setAttribute('aria-pressed', b.dataset.preset === S.preset); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-color]'), function (b) { b.setAttribute('aria-pressed', b.dataset.color === S.color); });
    $('cmpToggle').setAttribute('aria-pressed', S.compare);
    renderLegend();
  }
  function renderLegend() {
    var items;
    if (S.color === 'style') items = STYLE_CATS.map(function (c) { return '<span class="lg"><i style="background:' + c.color + '"></i>' + c.label + '</span>'; });
    else items = TIER_ORDER.map(function (t) { return '<span class="lg"><i style="background:' + TIER_COLORS[t] + '"></i>' + t + '</span>'; });
    var html = '<div class="lgb"><span class="lgt">' + (S.color === 'style' ? '스타일' : '티어') + '</span>' + items.join('') + '</div>'
      + '<div class="lgb"><span class="lgt">크기</span><span class="lgsz"><i style="width:9px;height:9px"></i><i style="width:13px;height:13px"></i><i style="width:18px;height:18px"></i></span><span>전체 체급</span></div>'
      + '<div class="lgb"><span class="lgt">빛</span><span class="lgglow"><i class="g0"></i><i class="g1"></i><i class="g3"></i></span><span>현재기세</span></div>'
      + (S.mode === 'ALL' ? '<div class="lgb"><span class="lgt">모양</span><span>● 한국 · ◆ 일본</span></div>' : '')
      + (S.scene ? '<div class="lgb"><span class="lgt">SAME SCENE</span><span><b class="ringkey src"></b>선택 그룹 <b class="ringkey scene"></b>가장 비슷 <b class="ringkey expand"></b>취향 확장</span></div>' : '')
      + (S.match ? '<div class="lgb"><span class="lgt">매칭</span><span><b class="ringkey src"></b>선택 그룹 <b class="ringkey match"></b>추천 <b class="ringkey gem"></b>숨은 취향</span></div>' : '');
    $('legend').innerHTML = html;
  }

  /* ---------- 영역 칩 (Spotlight Card) ---------- */
  function renderZones() {
    var pts = activePoints(), cnt = {};
    ZONE_ORDER.forEach(function (z) { cnt[z] = 0; });
    pts.forEach(function (p) { cnt[p.zone]++; });
    var sig = S.mode + ':' + ZONE_ORDER.map(function (z) { return cnt[z]; }).join(',');
    if (el.zones.getAttribute('data-sig') !== sig) {
      el.zones.setAttribute('data-sig', sig);
      el.zones.innerHTML = ZONE_ORDER.map(function (z) {
        return '<button class="zchip" data-zone="' + z + '" style="--zc:' + ZONE_META[z].color + '" aria-pressed="false">'
          + '<span class="zt"><i></i>' + z + '</span><span class="zn"><span data-count="' + cnt[z] + '">' + cnt[z] + '</span><small>팀</small></span>'
          + '<span class="zd">' + ZONE_META[z].text + '</span></button>';
      }).join('');
      Array.prototype.forEach.call(el.zones.querySelectorAll('[data-count]'), function (n) { countUp(n, Number(n.getAttribute('data-count'))); });
    }
    syncZones();
  }
  function syncZones() {
    Array.prototype.forEach.call(el.zones.querySelectorAll('.zchip'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-zone') === S.zone); });
  }

  /* ---------- 빈 상태 사이드 패널 ---------- */
  function renderSideEmpty() {
    var lists = (S.mode === 'ALL' ? ['KR', 'JP'] : [S.mode]).map(function (c) {
      var top = DATA[c].points.slice().sort(function (a, b) { return b.totalScore - a.totalScore; }).slice(0, S.mode === 'ALL' ? 3 : 5);
      return top.map(function (p, i) {
        return '<button class="rk" data-go="' + esc(p.key) + '"><span class="n">' + (i + 1) + '</span><span class="dt" style="background:' + (TIER_COLORS[p.tier] || '#777') + '"></span><span class="nm">' + esc(p.group) + '</span><small>' + p.tier + ' · ' + p.totalScore + '</small></button>';
      }).join('');
    }).join('');
    el.sideEmpty.innerHTML = '<p class="se-t">HOW TO READ</p><ul class="se-how">'
      + '<li><span class="se-ic">↔</span><span><b>가로</b> 왼쪽일수록 코어 팬덤형, 오른쪽일수록 대중 확장형이에요.</span></li>'
      + '<li><span class="se-ic">↕</span><span><b>세로</b> 위쪽일수록 라이브·공연형, 아래쪽일수록 디지털·음원형이에요.</span></li>'
      + '<li><span class="se-ic">◉</span><span><b>크기·빛</b> 버블이 클수록 체급, 빛이 강할수록 현재기세가 높아요.</span></li>'
      + '<li><span class="se-ic">☝</span><span><b>버블을 눌러</b> 위치의 이유와 비슷한 그룹을 확인하고, 휠·핀치로 확대해 보세요.</span></li></ul>'
      + '<p class="se-t">체급 TOP' + (S.mode === 'ALL' ? ' (국가별)' : '') + '</p><div class="se-list">' + lists + '</div>';
  }

  /* ---------- DotGrid 배경 (React Bits DotGrid 스타일) ---------- */
  var DG = { ctx: null, dpr: 1, w: 0, h: 0, mx: -999, my: -999, cx: -999, cy: -999, raf: 0 };
  function drawDots() {
    var c = $('dots'), box = $('mapbox');
    if (!c || !box) return;
    DG.dpr = Math.min(window.devicePixelRatio || 1, 2);
    DG.w = box.clientWidth; DG.h = box.clientHeight;
    c.width = Math.round(DG.w * DG.dpr); c.height = Math.round(DG.h * DG.dpr);
    DG.ctx = c.getContext('2d');
    paintDots();
  }
  function paintDots() {
    var ctx = DG.ctx; if (!ctx) return;
    ctx.setTransform(DG.dpr, 0, 0, DG.dpr, 0, 0);
    ctx.clearRect(0, 0, DG.w, DG.h);
    var gap = DG.w < 520 ? 22 : 26, R = 120;
    for (var x = gap / 2; x < DG.w; x += gap) {
      for (var y = gap / 2; y < DG.h; y += gap) {
        var t = 0;
        if (DG.cx > -900) { var d = Math.hypot(x - DG.cx, y - DG.cy); t = d < R ? Math.pow(1 - d / R, 1.6) : 0; }
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + t * 2.8, 0, 6.2832);
        ctx.fillStyle = t > 0.01 ? 'rgba(30,215,96,' + (0.1 + 0.75 * t).toFixed(3) + ')' : 'rgba(255,255,255,0.075)';
        ctx.fill();
      }
    }
  }
  function dotLoop() {
    DG.cx += (DG.mx - DG.cx) * 0.22; DG.cy += (DG.my - DG.cy) * 0.22;
    paintDots();
    if (Math.abs(DG.mx - DG.cx) + Math.abs(DG.my - DG.cy) > 0.6) DG.raf = requestAnimationFrame(dotLoop);
    else { DG.raf = 0; if (DG.mx < -900) { DG.cx = -999; paintDots(); } }
  }
  function bindMapFx() {
    var box = $('mapbox');
    if (!FINE || REDUCED) return;
    box.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var r = box.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      box.style.setProperty('--mx', x + 'px'); box.style.setProperty('--my', y + 'px'); box.classList.add('hov');
      if (DG.cx < -900) { DG.cx = x; DG.cy = y; }
      DG.mx = x; DG.my = y;
      if (!DG.raf) DG.raf = requestAnimationFrame(dotLoop);
    });
    box.addEventListener('pointerleave', function () {
      box.classList.remove('hov'); DG.mx = -999; DG.my = -999;
      if (!DG.raf) DG.raf = requestAnimationFrame(dotLoop);
    });
  }
  // 영역 칩 스포트라이트 + 필터 토글
  function bindSpotlight() {
    el.zones.addEventListener('pointermove', function (e) {
      var b = e.target.closest && e.target.closest('.zchip'); if (!b) return;
      var r = b.getBoundingClientRect();
      b.style.setProperty('--mx', (e.clientX - r.left) + 'px'); b.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    el.zones.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.zchip'); if (!b) return;
      var z = b.getAttribute('data-zone');
      S.zone = S.zone === z ? null : z;
      syncZones(); refreshStates();
    });
  }

  /* ---------- 툴팁 / 스파크 ---------- */
  function hideTipNow() { if (el.tip) el.tip.hidden = true; }
  function showTip(p) {
    var tip = el.tip;
    if (!p || !p.node || !FINE || p.node.classList.contains('off')) { tip.hidden = true; return; }
    var box = $('mapbox').getBoundingClientRect(), r = p.node.getBoundingClientRect();
    var cxp = r.left + r.width / 2 - box.left, top = r.top - box.top - 8, below = top < 90;
    tip.innerHTML = '<div class="tn">' + esc(p.group) + flag(p.country) + '</div><div class="tm">' + tierChip(p) + ' ' + p.totalScore + '점 · 체급 상위 ' + Math.max(1, Math.round(100 - p.totalPercentile)) + '%</div>'
      + '<div class="tz" style="--zc:' + zc(p) + '"><i></i>' + esc(p.zone) + '</div>';
    tip.hidden = false;
    var half = tip.offsetWidth / 2;
    cxp = Math.max(half + 6, Math.min(box.width - half - 6, cxp));
    tip.style.left = cxp + 'px';
    if (below) { tip.style.top = (r.bottom - box.top + 10) + 'px'; tip.style.transform = 'translate(-50%,0)'; }
    else { tip.style.top = top + 'px'; tip.style.transform = 'translate(-50%,-100%)'; }
  }
  function sparkAt(p) {
    if (REDUCED || !p || !p.node) return;
    var r = p.node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, col = colorOf(p);
    for (var i = 0; i < 9; i++) {
      var s = document.createElement('span'), a = (i / 9) * 6.283 + Math.random() * 0.5, d = 26 + Math.random() * 22;
      s.className = 'spark'; s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.background = col;
      s.style.setProperty('--dx', Math.cos(a) * d + 'px'); s.style.setProperty('--dy', Math.sin(a) * d + 'px');
      document.body.appendChild(s);
      setTimeout(removeNode.bind(null, s), 600);
    }
  }
  function removeNode(n) { if (n.parentNode) n.parentNode.removeChild(n); }

  /* ---------- 줌 / 팬 ---------- */
  function zoomAt(f, cx, cy) {
    var ns = Math.max(1, Math.min(5, S.scale * f)); f = ns / S.scale;
    S.tx = cx - (cx - S.tx) * f; S.ty = cy - (cy - S.ty) * f; S.scale = ns; applyView();
  }
  function bindPointer() {
    var svg = el.svg, ptrs = {}, last = null, moved = 0, pinch = 0;
    function pos(e) { var r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * S.W / r.width, y: (e.clientY - r.top) * S.H / r.height }; }
    svg.addEventListener('pointerdown', function (e) {
      ptrs[e.pointerId] = pos(e); moved = 0;
      var ids = Object.keys(ptrs);
      if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      last = pos(e);
    });
    svg.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      var p = pos(e), ids = Object.keys(ptrs);
      if (ids.length === 2) {
        ptrs[e.pointerId] = p;
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d; moved = 99; return;
      }
      if (S.scale > 1 || true) {
        var dx = p.x - last.x, dy = p.y - last.y; moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 6 && S.scale > 1) { S.tx += dx; S.ty += dy; applyView(); }
      }
      last = p; ptrs[e.pointerId] = p;
    });
    function up(e) { delete ptrs[e.pointerId]; pinch = 0; }
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('pointerleave', up);
    svg.addEventListener('wheel', function (e) { e.preventDefault(); var p = pos(e); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y); }, { passive: false });
    svg.addEventListener('click', function (e) {
      if (moved > 6) { moved = 0; return; }
      var g = e.target.closest && e.target.closest('.mp');
      if (g && !g.classList.contains('off')) selectGroup(g.getAttribute('data-k'));
      else if (!g && !S.compare) clearSelection();
    });
    svg.addEventListener('keydown', function (e) {
      var g = e.target.closest && e.target.closest('.mp');
      if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectGroup(g.getAttribute('data-k')); }
    });
    svg.addEventListener('pointerover', function (e) {
      var g = e.target.closest && e.target.closest('.mp'); var k = g ? g.getAttribute('data-k') : null;
      if (k !== S.hover) { S.hover = k; refreshStates(); showTip(k ? byKey[k] : null); }
    });
    svg.addEventListener('focusin', function (e) { var g = e.target.closest && e.target.closest('.mp'); if (g) { S.hover = g.getAttribute('data-k'); refreshStates(); } });
    svg.addEventListener('focusout', function () { S.hover = null; refreshStates(); });
    svg.addEventListener('pointerleave', function () { if (S.hover) { S.hover = null; refreshStates(); } hideTipNow(); });
  }

  /* ---------- 초기화 ---------- */
  function init() {
    el.wrap = $('mapwrap'); el.svg = $('map'); el.sheet = $('sheet'); el.zoomval = $('zoomval'); el.zones = $('zones'); el.sideEmpty = $('sideEmpty'); el.tip = $('tip');
    Promise.all([IM.ready, loadImgs()]).then(function () {
      DATA.KR = buildPoints('KR'); DATA.JP = buildPoints('JP');
      $('excl').textContent = (DATA.KR.excluded + DATA.JP.excluded) ? 'MAP DATA 부족으로 제외: ' + (DATA.KR.excluded + DATA.JP.excluded) + '팀' : '';
      var mode = (Q.get('country') || 'KR').toUpperCase();
      S.mode = ['KR', 'JP', 'ALL'].indexOf(mode) >= 0 ? mode : 'KR';
      if (Q.get('color') === 'style') S.color = 'style';
      if (['HOT', 'GEM', 'MINE'].indexOf(Q.get('preset')) >= 0) S.preset = Q.get('preset');
      bindUi(); bindPointer(); bindMapFx(); bindSpotlight();
      renderIdolMap(); fitView(); syncToolbar(); renderSideEmpty();
      $('notice').hidden = S.mode !== 'ALL';
      var g = Q.get('group');
      if (g) {
        var cand = ['KR', 'JP'].map(function (c) { return IM.getGroup(c, g) ? c + '|' + g : null; }).filter(Boolean);
        var key = cand.filter(function (k) { return k.indexOf(S.mode) === 0; })[0] || cand[0];
        if (key) {
          if (Q.get('match') === '1') { var pp = findPoint(key); if (pp) runMatch(pp); }
          else if (Q.get('scene') === '1') { var ps = findPoint(key); if (ps) runScene(ps); }
          else selectGroup(key);
        }
      }
      window.addEventListener('resize', debounce(function () { S.enter = false; renderIdolMap(); fitView(); }, 150));
      window.__IDOL_MAP__ = { S: S, DATA: DATA, buildPoints: buildPoints, robustZ: R.robustZ, classifyMapZone: R.classifyMapZone };
    }).catch(function () { $('excl').textContent = '데이터를 불러오지 못했어요.'; });
  }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function bindUi() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) { b.addEventListener('click', function () { applyMapPreset(b.dataset.preset); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-color]'), function (b) { b.addEventListener('click', function () { S.color = b.dataset.color; renderIdolMap(); syncToolbar(); setUrl(); }); });
    $('cmpToggle').addEventListener('click', function () { S.compare = !S.compare; S.cmp = []; if (!S.compare) closeSheet(); syncToolbar(); refreshStates(); });
    $('zin').addEventListener('click', function () { zoomAt(1.4, S.W / 2, S.H / 2); });
    $('zout').addEventListener('click', function () { zoomAt(1 / 1.4, S.W / 2, S.H / 2); });
    $('zreset').addEventListener('click', fitView);
    $('q').addEventListener('input', function (e) {
      S.query = e.target.value.trim().toLowerCase(); refreshStates();
      var f = activePoints().filter(function (p) { return passesQuery(p); });
      if (S.query && f.length === 1) selectGroup(f[0].key);
    });
    $('side').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-go]');
      if (b) selectGroup(b.getAttribute('data-go'), true);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') clearSelection(); });
  }

  init();
})();
