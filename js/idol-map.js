/* IDOL MAP — 시장 포지셔닝 지도 (IDOL_MAP_SPEC.md)
 * X: 코어 팬덤 ↔ 대중 확장, Y: 디지털 ↔ 라이브. 좌표에는 총점·현재기세를 쓰지 않는다.
 * 국가별 percentile → X_RAW/Y_RAW → robust z + tanh 로 화면 좌표를 만든다.
 * 정규화/스타일 태그/최애 저장/추천은 js/idol-match.js(window.IdolMatch)를 재사용한다. */
(function () {
  'use strict';
  var IM = window.IdolMatch;
  var Q = new URLSearchParams(location.search);
  var DEBUG = Q.get('debugMap') === '1';
  var CENTER_TOLERANCE = 12;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var KEYS = {
    KR: { pub: [['국내음원', 0.55], ['국내인지도', 0.45]], fan: [['음반·팬덤', 1]], live: [['공연', 1]], dig: [['국내음원', 0.55], ['글로벌', 0.45]], mom: '현재기세' },
    JP: { pub: [['대중인지도', 0.60], ['스트리밍·SNS', 0.40]], fan: [['팬덤·구매력', 1]], live: [['공연·현장', 1]], dig: [['스트리밍·SNS', 1]], mom: '현재기세' }
  };
  var TIER_COLORS = { 'S+': '#1ed760', 'S': '#a3e635', 'A+': '#facc15', 'A': '#fb923c', 'B+': '#f87171', 'B': '#e879f9', 'C+': '#a78bfa', 'C': '#60a5fa', 'D+': '#94a3b8', 'D': '#64748b' };
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
  function median(v) {
    var a = v.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mad(v) { var med = median(v); return median(v.map(function (x) { return Math.abs(x - med); })); }
  function robustZ(value, values) {
    var m = mad(values);
    return m ? (value - median(values)) / (1.4826 * m) : 0;
  }
  function toScreenPosition(zX, zY) {
    var x = 50 + 44 * Math.tanh(zX / 1.4), y = 50 - 44 * Math.tanh(zY / 1.4);
    return { x: Math.max(6, Math.min(94, x)), y: Math.max(6, Math.min(94, y)) };
  }
  function classifyMapZone(x, y) {
    var dx = x - 50, dy = 50 - y; // dy>0 = 위(라이브)
    if (Math.abs(dx) <= CENTER_TOLERANCE && Math.abs(dy) <= CENTER_TOLERANCE) return 'BALANCED';
    if (dy >= 0) return dx >= 0 ? 'STAGE STAR' : 'CORE LIVE';
    return dx >= 0 ? 'PUBLIC HIT' : 'CORE DIGITAL';
  }
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

  function weighted(pairs, P) { return pairs.reduce(function (a, p) { return a + P(p[0]) * p[1]; }, 0); }

  function buildPoints(country) {
    var rows = IM.getRaw(country), cfg = KEYS[country], need = [];
    ['pub', 'fan', 'live', 'dig'].forEach(function (k) { cfg[k].forEach(function (p) { if (need.indexOf(p[0]) === -1) need.push(p[0]); }); });
    need.push(cfg.mom, '총점');
    var valid = rows.filter(function (r) { return need.every(function (k) { return Number.isFinite(Number(r[k])) && r[k] !== null && r[k] !== ''; }); });
    var maps = {};
    need.forEach(function (k) { maps[k] = valid.map(function (r) { return Number(r[k]); }); });
    var pts = valid.map(function (r) {
      var P = function (k) { return IM.percentileRank(Number(r[k]), maps[k]); };
      var g = IM.getGroup(country, r['그룹']);
      var pub = weighted(cfg.pub, P), fan = weighted(cfg.fan, P), live = weighted(cfg.live, P), dig = weighted(cfg.dig, P);
      var mom = P(cfg.mom), totPct = P('총점');
      return {
        id: r.id, key: country + '|' + r['그룹'], group: r['그룹'], country: country, tier: r['티어'], totalScore: Number(r['총점']),
        pub: pub, fan: fan, live: live, dig: dig, mom: mom, xRaw: pub - fan, yRaw: live - dig,
        totalPercentile: totPct, radius: bubbleRadius(totPct), glow: momentumGlow(mom),
        styleCategory: styleCategory(g && g.styleTags), status: r['활동상태'] || '', spotify: g ? g.spotify : '', slug: g ? g.slug : ''
      };
    });
    var xs = pts.map(function (p) { return p.xRaw; }), ys = pts.map(function (p) { return p.yRaw; });
    pts.forEach(function (p) {
      p.zX = robustZ(p.xRaw, xs); p.zY = robustZ(p.yRaw, ys);
      var s = toScreenPosition(p.zX, p.zY);
      p.baseX = s.x; p.baseY = s.y;
      var h = hashString(p.key), jx = ((h & 0xffff) / 0xffff * 2 - 1) * 1.2, jy = (((h >>> 16) & 0xffff) / 0xffff * 2 - 1) * 1.2;
      p.screenX = Math.max(6, Math.min(94, s.x + jx)); p.screenY = Math.max(6, Math.min(94, s.y + jy));
      p.zone = classifyMapZone(s.x, s.y);
    });
    resolveCollisions(pts);
    return { points: pts, excluded: rows.length - valid.length };
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
    mode: 'KR', preset: 'ALL', color: 'tier', sel: null, hover: null, compare: false, cmp: [], match: null,
    scale: 1, tx: 0, ty: 0, W: 0, H: 0, sf: 1, query: ''
  };
  var el = {};
  var PAD = { l: 34, r: 34, t: 34, b: 38 };

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
  function isVisible(p, favs) { return passesPreset(p, favs) && passesQuery(p); }
  function colorOf(p) { return S.color === 'style' ? catOf(p.styleCategory).color : (TIER_COLORS[p.tier] || '#7c7c7c'); }

  /* ---------- 렌더 ---------- */
  function plot() { return { w: S.W - PAD.l - PAD.r, h: S.H - PAD.t - PAD.b }; }
  function toPx(p) {
    var pl = plot();
    return { x: PAD.l + p.screenX / 100 * pl.w, y: PAD.t + p.screenY / 100 * pl.h };
  }

  function measure() {
    var w = el.wrap.clientWidth || 360;
    S.W = w; S.H = Math.max(520, Math.min(Math.round(w * 0.9), 760));
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
  }

  function renderIdolMap() {
    measure();
    var svg = el.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var pl = plot();
    var vp = svgEl('g', { id: 'vp' }, svg);
    el.vp = vp;
    // 축 / 그리드 (은은하게: 중심선 + 25/75 점선)
    var cx = PAD.l + pl.w / 2, cy = PAD.t + pl.h / 2;
    [25, 75].forEach(function (v) {
      svgEl('line', { class: 'grid', x1: PAD.l + pl.w * v / 100, y1: PAD.t, x2: PAD.l + pl.w * v / 100, y2: PAD.t + pl.h, 'stroke-dasharray': '2 6' }, vp);
      svgEl('line', { class: 'grid', y1: PAD.t + pl.h * v / 100, x1: PAD.l, y2: PAD.t + pl.h * v / 100, x2: PAD.l + pl.w, 'stroke-dasharray': '2 6' }, vp);
    });
    svgEl('line', { class: 'axis', x1: cx, y1: PAD.t, x2: cx, y2: PAD.t + pl.h }, vp);
    svgEl('line', { class: 'axis', x1: PAD.l, y1: cy, x2: PAD.l + pl.w, y2: cy }, vp);
    [['CORE LIVE', 0.02, 0.02, 'start'], ['STAGE STAR', 0.98, 0.02, 'end'], ['CORE DIGITAL', 0.02, 0.98, 'start'], ['PUBLIC HIT', 0.98, 0.98, 'end']].forEach(function (z) {
      var t = svgEl('text', { class: 'zone-t', x: PAD.l + pl.w * z[1], y: PAD.t + pl.h * z[2] + (z[2] > 0.5 ? -6 : 14), 'text-anchor': z[3] }, vp);
      t.textContent = z[0];
    });
    el.compareLine = svgEl('line', { class: 'cmp-line', 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' }, vp);
    el.layer = svgEl('g', { id: 'pts' }, vp);

    var favs = favSet();
    var pts = activePoints().slice().sort(function (a, b) { return b.radius - a.radius; }); // 작은 점이 위
    var coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches;
    var multi = S.mode === 'ALL';
    byKey = {};
    pts.forEach(function (p) {
      byKey[p.key] = p;
      var px = toPx(p);
      var g = svgEl('g', { class: 'mp', tabindex: 0, role: 'button', 'data-k': p.key, transform: 'translate(' + px.x.toFixed(1) + ',' + px.y.toFixed(1) + ')' }, el.layer);
      g.setAttribute('aria-label', p.group + ', ' + p.tier + '티어, ' + p.zone);
      var mi = svgEl('g', { class: 'mi' }, g);
      p.node = g;
      var pr = p.radius * S.sf;
      svgEl('circle', { class: 'hit', r: coarse ? 22 : Math.max(pr + 3, 13) }, mi);
      svgEl('circle', { class: 'ring-g', r: pr + 8 }, mi);
      svgEl('circle', { class: 'ring', r: pr + 4.5 }, mi);
      var col = colorOf(p);
      var shape;
      if (multi && p.country === 'JP') {
        var d = pr * 1.15;
        shape = svgEl('polygon', { class: 'dot', points: '0,' + (-d) + ' ' + d + ',0 0,' + d + ' ' + (-d) + ',0' }, mi);
      } else shape = svgEl('circle', { class: 'dot', r: pr }, mi);
      shape.style.fill = col; g.style.color = col;
      var lbl = svgEl('text', { class: 'lbl', x: pr + 6, y: 4 }, mi);
      lbl.textContent = p.group;
      var ti = svgEl('title', {}, g);
      ti.textContent = p.group + ' · ' + p.tier + ' · ' + p.zone;
      g.setAttribute('data-glow', p.glow);
    });
    applyView();
    refreshStates();
  }

  function labelSet(vis) {
    var set = {};
    var byCountry = { KR: [], JP: [] };
    vis.forEach(function (p) { byCountry[p.country].push(p); });
    var per = S.mode === 'ALL' ? 6 : 10;
    ['KR', 'JP'].forEach(function (c) {
      byCountry[c].sort(function (a, b) { return b.totalScore - a.totalScore; }).slice(0, per).forEach(function (p) { set[p.key] = 1; });
    });
    if (vis.length <= 12) vis.forEach(function (p) { set[p.key] = 1; });
    if (S.sel) set[S.sel] = 1;
    if (S.hover) set[S.hover] = 1;
    S.cmp.forEach(function (k) { set[k] = 1; });
    if (S.match) { set[S.match.src] = 1; S.match.items.forEach(function (m) { set[m.key] = 1; }); }
    return set;
  }

  function refreshStates() {
    var favs = favSet(), pts = activePoints(), vis = pts.filter(function (p) { return isVisible(p, favs); });
    var lab = labelSet(vis);
    var mm = {};
    if (S.match) S.match.items.forEach(function (m) { mm[m.key] = m.type; });
    pts.forEach(function (p) {
      var g = p.node; if (!g) return;
      var v = isVisible(p, favs);
      g.classList.toggle('off', !v);
      g.setAttribute('tabindex', v ? 0 : -1);
      g.classList.toggle('showlbl', !!lab[p.key] && v);
      g.classList.toggle('sel', S.sel === p.key || S.cmp.indexOf(p.key) !== -1);
      var hl = '';
      if (S.match) hl = S.match.src === p.key ? 'src' : (mm[p.key] || '');
      if (hl) g.setAttribute('data-hl', hl); else g.removeAttribute('data-hl');
      g.classList.toggle('dimmed', !!S.match && !hl && S.sel !== p.key);
    });
    $('count').textContent = vis.length + '팀 표시 중';
    drawCompareLine();
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
  function bar(label, v, cls) {
    return '<div class="mrow2"><span>' + label + '</span><div class="bar"><i class="' + (cls || '') + '" style="width:' + Math.round(v) + '%"></i></div><b>' + Math.round(v) + '</b></div>';
  }
  function flag(c) { return '<span class="flagb flag-' + c.toLowerCase() + '">' + c + '</span>'; }
  function pubLabel(p) { return p.country === 'KR' ? '대중 확장력' : '대중 확장력'; }
  function digLabel(p) { return p.country === 'KR' ? '디지털·글로벌' : '디지털·SNS'; }

  function openMapDetail(p) {
    var sh = el.sheet;
    if (S.compare && S.cmp.length === 2) { renderComparePanel(); return; }
    var expl = generatePositionExplanation(p).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('');
    var top = Math.max(1, Math.round(100 - p.mom));
    var html = '<div class="sh-head"><h2>' + esc(p.group) + ' ' + flag(p.country) + '</h2><button class="x" id="shClose" aria-label="닫기">✕</button></div>'
      + '<p class="sh-sub"><span class="chip">' + esc(p.tier) + '</span> ' + p.totalScore + '점 · 체급 상위 ' + Math.max(1, Math.round(100 - p.totalPercentile)) + '%</p>'
      + '<p class="sh-k">MARKET POSITION <small>(자국 시장 내 백분위)</small></p>'
      + bar(pubLabel(p), p.pub) + bar('코어 팬덤력', p.fan) + bar('라이브', p.live) + bar(digLabel(p), p.dig)
      + '<p class="sh-k">TYPE</p><p class="type">' + esc(p.zone) + ' <small>' + ZONE_TEXT[p.zone] + '</small></p>'
      + '<p class="sh-k">왜 이 위치인가?</p><div class="expl">' + expl + '</div>'
      + '<p class="mom">🔥 현재기세 상위 ' + top + '%</p>'
      + (DEBUG ? '<pre class="dbg">rawX ' + p.xRaw.toFixed(1) + '  rawY ' + p.yRaw.toFixed(1) + '\nzX ' + p.zX.toFixed(2) + '  zY ' + p.zY.toFixed(2) + '\nscreen ' + p.screenX.toFixed(1) + ', ' + p.screenY.toFixed(1) + ' (base ' + p.baseX.toFixed(1) + ', ' + p.baseY.toFixed(1) + ')\npublic ' + p.pub.toFixed(1) + '  fandom ' + p.fan.toFixed(1) + '  live ' + p.live.toFixed(1) + '  digital ' + p.dig.toFixed(1) + '  momentum ' + p.mom.toFixed(1) + '</pre>' : '')
      + matchList()
      + '<div class="sh-act"><a class="btn out" href="' + detailUrl(p) + '">상세보기</a>'
      + (p.spotify ? '<a class="btn grn" target="_blank" rel="noopener noreferrer" href="' + esc(p.spotify) + '" aria-label="' + esc(p.group) + ' Spotify에서 듣기">Spotify ▶</a>' : '')
      + '<button class="btn out" id="btnMatch">' + (S.match && S.match.src === p.key ? '매칭 해제' : '비슷한 그룹') + '</button></div>';
    sh.innerHTML = html;
    sh.hidden = false; document.body.classList.add('sheet-open');
    $('shClose').addEventListener('click', clearSelection);
    $('btnMatch').addEventListener('click', function () { if (S.match && S.match.src === p.key) clearMatch(); else runMatch(p); });
    Array.prototype.forEach.call(sh.querySelectorAll('[data-go]'), function (b) {
      b.addEventListener('click', function () { selectGroup(b.getAttribute('data-go'), true); });
    });
  }

  function matchList() {
    if (!S.match) return '';
    var rows = S.match.items.map(function (m) {
      var p = byKey[m.key] || findPoint(m.key);
      return '<button class="mi-row" data-go="' + esc(m.key) + '"><span class="mk ' + m.type + '"></span><span class="nm">' + esc(p ? p.group : m.key) + '</span><b>' + m.score + '%</b></button>';
    }).join('');
    return '<p class="sh-k">IDOL MATCH <small>핑크 링 = 추천, 점선 다이아 = 숨은 취향</small></p><div class="mlist2">' + rows + '</div>';
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
    el.sheet.innerHTML = '<div class="sh-head"><h2>포지션 비교</h2><button class="x" id="shClose" aria-label="닫기">✕</button></div>'
      + '<p class="sh-sub">' + esc(a.group) + ' ' + flag(a.country) + ' ↔ ' + esc(b.group) + ' ' + flag(b.country) + '</p>'
      + '<div class="expl"><p><b>팬덤 ↔ 대중</b> 차이 ' + xd + ' · ' + esc(xt) + '</p><p><b>디지털 ↔ 라이브</b> 차이 ' + yd + ' · ' + esc(yt) + '</p></div>'
      + '<p class="mnote2">위치 차이는 성향의 차이일 뿐 우열이 아니에요.' + (same ? '' : ' 서로 다른 시장의 그룹은 각 시장 안의 상대 위치로만 비교해요.') + '</p>'
      + '<div class="sh-act">' + (same ? '<a class="btn grn" href="' + pageOf(a.country) + '?compare=' + encodeURIComponent(a.group + ',' + b.group) + '">상세 비교하기</a>'
        : '<a class="btn out" href="' + detailUrl(a) + '">' + esc(a.group) + ' 상세</a><a class="btn out" href="' + detailUrl(b) + '">' + esc(b.group) + ' 상세</a>')
      + '<button class="btn out" id="cmpReset">선택 초기화</button></div>';
    el.sheet.hidden = false; document.body.classList.add('sheet-open');
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
    S.sel = key; refreshStates(); openMapDetail(p); focusMapGroup(p); setUrl();
  }
  function clearSelection() { S.sel = null; S.cmp = []; closeSheet(); refreshStates(); setUrl(); }

  function focusMapGroup(p) {
    if (S.scale <= 1) return;
    var px = toPx(p);
    S.tx = S.W / 2 - px.x * S.scale; S.ty = S.H / 2 - px.y * S.scale; applyView();
  }

  function runMatch(p) {
    var r = IM.getMatches(p.country, p.group, { includeEnded: false, limit: 3, hiddenLimit: 3 });
    if (!r) return;
    var items = [];
    var tc = r.target;
    r.top.forEach(function (m) { items.push({ key: tc + '|' + m.group.name, score: m.score, type: 'match' }); });
    r.hidden.forEach(function (m) { items.push({ key: tc + '|' + m.group.name, score: m.score, type: 'gem' }); });
    S.match = { src: p.key, items: items };
    S.preset = 'ALL'; syncToolbar();
    setMode('ALL', true);
    S.sel = p.key; refreshStates(); openMapDetail(p); setUrl();
  }
  function clearMatch() { S.match = null; refreshStates(); var p = S.sel && findPoint(S.sel); if (p) openMapDetail(p); setUrl(); }

  /* ---------- 툴바 ---------- */
  function setMode(m, keepSel) {
    S.mode = m;
    if (!keepSel) { S.sel = null; S.cmp = []; S.match = null; closeSheet(); }
    S.scale = 1; S.tx = 0; S.ty = 0;
    renderIdolMap(); syncToolbar();
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
    var extra = '<span class="lg2">크기 = 전체 체급(자국 백분위) · 빛 = 현재기세</span>'
      + (S.mode === 'ALL' ? '<span class="lg2">● 한국 · ◆ 일본</span>' : '')
      + (S.match ? '<span class="lg2"><b class="ringkey src"></b> 선택 그룹 <b class="ringkey match"></b> 추천 <b class="ringkey gem"></b> 숨은 취향</span>' : '');
    $('legend').innerHTML = items.join('') + '<div class="lgrow">' + extra + '</div>';
  }

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
      if (k !== S.hover) { S.hover = k; refreshStates(); }
    });
    svg.addEventListener('focusin', function (e) { var g = e.target.closest && e.target.closest('.mp'); if (g) { S.hover = g.getAttribute('data-k'); refreshStates(); } });
    svg.addEventListener('focusout', function () { S.hover = null; refreshStates(); });
    svg.addEventListener('pointerleave', function () { if (S.hover) { S.hover = null; refreshStates(); } });
  }

  /* ---------- 초기화 ---------- */
  function init() {
    el.wrap = $('mapwrap'); el.svg = $('map'); el.sheet = $('sheet'); el.zoomval = $('zoomval');
    IM.ready.then(function () {
      DATA.KR = buildPoints('KR'); DATA.JP = buildPoints('JP');
      $('excl').textContent = (DATA.KR.excluded + DATA.JP.excluded) ? 'MAP DATA 부족으로 제외: ' + (DATA.KR.excluded + DATA.JP.excluded) + '팀' : '';
      var mode = (Q.get('country') || 'KR').toUpperCase();
      S.mode = ['KR', 'JP', 'ALL'].indexOf(mode) >= 0 ? mode : 'KR';
      if (Q.get('color') === 'style') S.color = 'style';
      if (['HOT', 'GEM', 'MINE'].indexOf(Q.get('preset')) >= 0) S.preset = Q.get('preset');
      bindUi(); bindPointer();
      renderIdolMap(); syncToolbar();
      $('notice').hidden = S.mode !== 'ALL';
      var g = Q.get('group');
      if (g) {
        var cand = ['KR', 'JP'].map(function (c) { return IM.getGroup(c, g) ? c + '|' + g : null; }).filter(Boolean);
        var key = cand.filter(function (k) { return k.indexOf(S.mode) === 0; })[0] || cand[0];
        if (key) {
          if (Q.get('match') === '1') { var pp = findPoint(key); if (pp) runMatch(pp); }
          else selectGroup(key);
        }
      }
      window.addEventListener('resize', debounce(function () { renderIdolMap(); }, 150));
      window.__IDOL_MAP__ = { S: S, DATA: DATA, buildPoints: buildPoints, robustZ: robustZ, classifyMapZone: classifyMapZone };
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
    $('zreset').addEventListener('click', function () { S.scale = 1; S.tx = 0; S.ty = 0; applyView(); });
    $('q').addEventListener('input', function (e) {
      S.query = e.target.value.trim().toLowerCase(); refreshStates();
      var f = activePoints().filter(function (p) { return passesQuery(p); });
      if (S.query && f.length === 1) selectGroup(f[0].key);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') clearSelection(); });
  }

  init();
})();
