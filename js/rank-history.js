/* RANK HISTORY — 월별 순위 변동·시계열 (IDOL_RANK_HISTORY_SPEC.md)
 * - data/history/index.json 과 data/history/{kr,jp}/YYYY-MM.json snapshot 을 읽는다.
 * - rank 는 snapshot 에 저장된 값을 그대로 쓴다(배열 순서로 재계산하지 않음, 동점 유지).
 * - 그룹 연결은 id 기준. 한국/일본 history 는 섞지 않는다. 누락된 달은 보간하지 않는다.
 * - 로딩 실패는 조용히 null 로 처리해 기존 화면(랭킹·상세·비교)에 영향을 주지 않는다.
 * window.RankHistory 로만 노출한다. */
(function (global) {
  'use strict';
  var VERSION = '20260962';
  var script = document.currentScript, base = script && script.src ? script.src.replace(/js\/rank-history\.js.*$/, '') : '';
  var DIR = base + 'data/history/';

  /* ---------- 순수 계산 ---------- */
  function monthIndex(p) { var m = /^(\d{4})-(\d{2})$/.exec(p || ''); return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : NaN; }
  function fmtPeriod(p) { return String(p).replace('-', '.'); }

  // current/previous: {rank, score,...} 또는 null. previousExists=false 면 비교할 이전 snapshot 자체가 없다는 뜻(최초 월).
  //  rankDelta = previousRank - currentRank  (양수=상승, 음수=하락)
  function getRankDelta(current, previous, previousExists) {
    if (!current || !Number.isFinite(current.rank)) return { kind: 'none', n: 0 };
    if (previousExists === false) return { kind: 'none', n: 0 };
    if (!previous || !Number.isFinite(previous.rank)) return { kind: 'new', n: 0 };
    var d = previous.rank - current.rank;
    return d > 0 ? { kind: 'up', n: d } : d < 0 ? { kind: 'down', n: -d } : { kind: 'same', n: 0 };
  }
  // scoreDelta = currentScore - previousScore. 비교 대상이 없으면 null
  function getScoreDelta(current, previous) {
    if (!current || !previous || !Number.isFinite(current.score) || !Number.isFinite(previous.score)) return null;
    return Math.round((current.score - previous.score) * 100) / 100;
  }
  // 알고리즘 내부의 월간 상승세는 raw ▲N 이 아니라 '순위 위치 백분위' 이동으로 본다 (팀 수가 달라져도 의미가 같다).
  function getRankPositionPercentile(rank, n) {
    if (!Number.isFinite(rank) || !Number.isFinite(n) || n < 1) return null;
    return n <= 1 ? 100 : 100 * (1 - (rank - 1) / (n - 1));
  }
  var TIER_ORDER = ['S+', 'S', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D'];
  function tierIdx(t) { var i = TIER_ORDER.indexOf(t); return i < 0 ? null : i; }
  function fmtScoreDelta(d) { return d === null ? '' : d > 0 ? '(+' + d + ')' : d < 0 ? '(' + d + ')' : '(±0)'; }

  // history: [{period, rank, score, ...}] (오래된 → 최신). 동점이면 더 이른 달을 대표로 한다.
  function getBestRank(history) {
    var best = null; history.forEach(function (h) { if (Number.isFinite(h.rank) && (!best || h.rank < best.rank)) best = h; }); return best;
  }
  function getWorstRank(history) {
    var w = null; history.forEach(function (h) { if (Number.isFinite(h.rank) && (!w || h.rank > w.rank)) w = h; }); return w;
  }

  function validSnapshot(s, country) {
    return !!(s && s.meta && s.meta.period && Array.isArray(s.groups) && (!country || s.meta.country === country));
  }
  function entryOf(snapshot, id) {
    if (!snapshot) return null;
    for (var i = 0; i < snapshot.groups.length; i++) if (snapshot.groups[i].id === id) return snapshot.groups[i];
    return null;
  }
  // snapshots: 임의 순서의 snapshot 배열 → 해당 id 의 시계열(실제 존재하는 달만, 오래된 순)
  function extractGroupHistory(snapshots, id) {
    return snapshots.filter(function (s) { return validSnapshot(s); })
      .sort(function (a, b) { return monthIndex(a.meta.period) - monthIndex(b.meta.period); })
      .map(function (s) { var e = entryOf(s, id); return e ? { period: s.meta.period, group: e.group, rank: e.rank, tier: e.tier, score: e.score, metrics: e.metrics } : null; })
      .filter(Boolean);
  }
  // 최근 N개월(달력 기준, 가장 최근 기록 월 포함). months=0/Infinity 는 전체. 데이터가 부족하면 자연히 전체가 된다.
  function sliceRange(history, months) {
    if (!months || !isFinite(months) || history.length < 2) return history;
    var last = monthIndex(history[history.length - 1].period);
    return history.filter(function (h) { return monthIndex(h.period) > last - months; });
  }

  /* ---------- 로딩 (lazy + 메모리 캐시, 실패는 null) ---------- */
  var cache = {}, indexP = null;
  function getJson(url) {
    if (!cache[url]) {
      cache[url] = fetch(url + '?v=' + VERSION).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(function () { return null; });
    }
    return cache[url];
  }
  function loadHistoryIndex() {
    if (!indexP) indexP = getJson(DIR + 'index.json').then(function (j) { return j && typeof j === 'object' ? j : null; });
    return indexP;
  }
  // data/history/breaks.json — 실패하면 빈 목록(기록 계산은 경계 없이 진행)
  var breaksP = null;
  function loadBreaks() {
    if (!breaksP) breaksP = getJson(DIR + 'breaks.json').then(function (j) { return j && typeof j === 'object' ? { KR: Array.isArray(j.KR) ? j.KR : [], JP: Array.isArray(j.JP) ? j.JP : [] } : { KR: [], JP: [] }; });
    return breaksP;
  }
  function periodsOf(idx, country) {
    var l = idx && Array.isArray(idx[country]) ? idx[country].filter(function (p) { return !isNaN(monthIndex(p)); }) : [];
    return l.slice().sort(function (a, b) { return monthIndex(a) - monthIndex(b); });
  }
  function loadCountrySnapshot(country, period) {
    return getJson(DIR + country.toLowerCase() + '/' + period + '.json').then(function (s) { return validSnapshot(s, country) ? s : null; });
  }
  // 최근 n개 snapshot (기본 2: 현재월 + 이전월). 하나라도 실패하면 그 항목만 빠진다.
  function loadRecent(country, n) {
    return loadHistoryIndex().then(function (idx) {
      var ps = periodsOf(idx, country).slice(-(n || 2));
      return Promise.all(ps.map(function (p) { return loadCountrySnapshot(country, p); })).then(function (l) { return l.filter(Boolean); });
    });
  }
  function loadAll(country) { return loadRecent(country, 9999); }
  function getGroupHistory(country, groupId) {
    return loadAll(country).then(function (snaps) { return extractGroupHistory(snaps, groupId); });
  }

  // 카드용: id → {kind,n,rank,prevRank}. 현재월+이전월만 읽는다. 실패하면 null.
  function deltasFromSnapshots(snaps) {
    if (!snaps.length) return null;
    var cur = snaps[snaps.length - 1], prev = snaps.length > 1 ? snaps[snaps.length - 2] : null, earlier = snaps.slice(0, -1), out = {};
    cur.groups.forEach(function (g) {
      var p = prev ? entryOf(prev, g.id) : null, d = getRankDelta(g, p, !!prev);
      d.rank = g.rank; d.prevRank = p ? p.rank : null; d.period = cur.meta.period; d.prevPeriod = prev ? prev.meta.period : null;
      // 셋을 따로 보관: raw rank delta(UI) / 순위 위치 백분위 이동(알고리즘) / 점수 변화 — 순위 하락을 실력 하락으로 단정하지 않는다
      d.scoreDelta = getScoreDelta(g, p);
      d.curPercentile = getRankPositionPercentile(g.rank, cur.groups.length);
      d.prevPercentile = p ? getRankPositionPercentile(p.rank, prev.groups.length) : null;
      d.movement = p && d.curPercentile !== null && d.prevPercentile !== null ? d.curPercentile - d.prevPercentile : null;
      var before = earlier.map(function (s) { return entryOf(s, g.id); }).filter(Boolean);
      d.newPeak = before.length ? g.rank < Math.min.apply(null, before.map(function (e) { return e.rank; })) : null;
      d.tierUp = p && tierIdx(g.tier) !== null && tierIdx(p.tier) !== null ? tierIdx(g.tier) < tierIdx(p.tier) : null;
      out[g.id] = d;
    });
    return out;
  }
  function loadDeltas(country) { return loadRecent(country, 2).then(deltasFromSnapshots); }

  /* ---------- 렌더 ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ▲3 / ▼2 / – / NEW : 색만으로 구분하지 않고 기호·텍스트를 함께 쓴다.
  function renderRankDeltaBadge(d) {
    if (!d) return '';
    var t, label, cls = d.kind;
    if (d.kind === 'up') { t = '▲' + d.n; label = '전월 대비 ' + d.n + '계단 상승'; }
    else if (d.kind === 'down') { t = '▼' + d.n; label = '전월 대비 ' + d.n + '계단 하락'; }
    else if (d.kind === 'new') { t = 'NEW'; label = '이번 달 새로 진입'; }
    else if (d.kind === 'same') { t = '–'; label = '전월과 순위 동일'; }
    else { t = '–'; label = '비교할 이전 기록 없음(첫 기록)'; }
    if (Number.isFinite(d.scoreDelta) && d.kind !== 'none') label += ', 점수 ' + (d.scoreDelta > 0 ? '+' + d.scoreDelta : d.scoreDelta < 0 ? String(d.scoreDelta) : '±0');
    return '<span class="rkd ' + cls + '" role="img" aria-label="' + label + '" title="' + label + '">' + t + '</span>';
  }

  var PAL = ['#1ed760', '#f3727f', '#539df5', '#ffa42b', '#a78bfa', '#22d3ee'];

  // series: [{name,color,points:[{p:'2026-09', v:3}]}] · invert=true 면 값이 작을수록(=1위) 위쪽
  function lineChart(o) {
    var W = 340, H = o.h || 190, L = 34, Rm = 16, T = 18, B = 28, series = o.series.filter(function (s) { return s.points.length; });
    var periods = [];
    series.forEach(function (s) { s.points.forEach(function (pt) { if (periods.indexOf(pt.p) === -1) periods.push(pt.p); }); });
    periods.sort(function (a, b) { return monthIndex(a) - monthIndex(b); });
    if (!periods.length) return '';
    var x0 = monthIndex(periods[0]), x1 = monthIndex(periods[periods.length - 1]), pw = W - L - Rm, ph = H - T - B;
    var xOf = function (p) { return x1 === x0 ? L + pw / 2 : L + (monthIndex(p) - x0) / (x1 - x0) * pw; };
    var vals = []; series.forEach(function (s) { s.points.forEach(function (pt) { vals.push(pt.v); }); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (o.rank) { lo = Math.max(1, lo - 1); hi = hi + 1; } else { var pad = Math.max(1, (hi - lo) * 0.15); lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad); }
    if (hi - lo < 3) { hi = lo + 3; }
    var steps = [1, 2, 5, 10, 20, 25, 50, 100], step = steps.filter(function (s) { return (hi - lo) / s <= 4; })[0] || 100;
    var t0 = Math.ceil(lo / step) * step, ticks = []; for (var v = t0; v <= hi; v += step) ticks.push(v);
    var yOf = function (val) { return o.invert ? T + (val - lo) / (hi - lo) * ph : T + (hi - val) / (hi - lo) * ph; };
    var svg = '<svg class="rh-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label) + '" preserveAspectRatio="xMidYMid meet">';
    ticks.forEach(function (tv) {
      var y = yOf(tv).toFixed(1);
      svg += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - Rm) + '" y2="' + y + '" class="rh-grid"/><text x="' + (L - 6) + '" y="' + (Number(y) + 3.5) + '" text-anchor="end" class="rh-yl">' + (o.rank ? '#' : '') + tv + '</text>';
    });
    // x 라벨: 최대 6개
    var every = Math.ceil(periods.length / 6);
    periods.forEach(function (p, i) {
      if (i % every === 0 || i === periods.length - 1) {
        var px = xOf(p), anc = px > W - 34 ? 'end' : px < L + 18 ? 'start' : 'middle';
        svg += '<text x="' + (anc === 'end' ? W - 4 : px).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anc + '" class="rh-xl">' + fmtPeriod(p) + '</text>';
      }
    });
    var single = series.length === 1;
    series.forEach(function (s, si) {
      var col = s.color || PAL[si % PAL.length], pts = s.points.slice().sort(function (a, b) { return monthIndex(a.p) - monthIndex(b.p); });
      for (var i = 1; i < pts.length; i++) { // 인접한 달은 실선, 누락된 달이 끼면 점선(보간값을 만들지 않고 이어서만 표시)
        var gap = monthIndex(pts[i].p) - monthIndex(pts[i - 1].p) > 1;
        svg += '<line x1="' + xOf(pts[i - 1].p).toFixed(1) + '" y1="' + yOf(pts[i - 1].v).toFixed(1) + '" x2="' + xOf(pts[i].p).toFixed(1) + '" y2="' + yOf(pts[i].v).toFixed(1) + '" stroke="' + col + '" stroke-width="2.5" stroke-linecap="round"' + (gap ? ' stroke-dasharray="2 5" opacity=".7"' : '') + '/>';
      }
      pts.forEach(function (pt) {
        var cx = xOf(pt.p).toFixed(1), cy = yOf(pt.v).toFixed(1);
        svg += '<circle cx="' + cx + '" cy="' + cy + '" r="4.5" fill="' + col + '" stroke="#181818" stroke-width="1.5"><title>' + esc(s.name) + ' · ' + fmtPeriod(pt.p) + ' · ' + (o.rank ? '#' : '') + pt.v + '</title></circle>';
        if (single && pts.length <= 8) svg += '<text x="' + cx + '" y="' + (Number(cy) - 9) + '" text-anchor="middle" class="rh-vl">' + (o.rank ? '#' : '') + pt.v + '</text>';
      });
    });
    return svg + '</svg>';
  }

  function histTable(hist) {
    return '<details class="rh-tbl"><summary>표로 보기</summary><table><thead><tr><th>기간</th><th>순위</th><th>티어</th><th>점수</th></tr></thead><tbody>'
      + hist.slice().reverse().map(function (h) { return '<tr><td>' + fmtPeriod(h.period) + '</td><td>#' + h.rank + '</td><td>' + esc(h.tier) + '</td><td>' + h.score + '</td></tr>'; }).join('') + '</tbody></table></details>';
  }

  // 현재/전월/최고/최저/점수 요약
  function renderHistoryStats(hist, prevSnapshot, id) {
    var cur = hist[hist.length - 1], prevEntry = prevSnapshot ? entryOf(prevSnapshot, id) : null;
    var delta = getRankDelta(cur, prevEntry, !!prevSnapshot), sd = getScoreDelta(cur, prevEntry);
    var best = getBestRank(hist), worst = getWorstRank(hist);
    var prevTxt = !prevSnapshot ? '–' : prevEntry ? '#' + prevEntry.rank : '없음';
    var prevSub = prevSnapshot ? fmtPeriod(prevSnapshot.meta.period) : '이전 기록 없음';
    return '<div class="rh-stats">'
      + '<div><small>현재 순위</small><b>#' + cur.rank + ' ' + renderRankDeltaBadge(delta) + '</b><em>' + fmtPeriod(cur.period) + '</em></div>'
      + '<div><small>전월 순위</small><b>' + prevTxt + '</b><em>' + prevSub + '</em></div>'
      + '<div><small>최고 순위</small><b>#' + best.rank + '</b><em>' + fmtPeriod(best.period) + '</em></div>'
      + '<div><small>최저 순위</small><b>#' + worst.rank + '</b><em>' + fmtPeriod(worst.period) + '</em></div>'
      + '<div class="wide"><small>현재 점수</small><b>' + cur.score + ' <span class="' + (sd > 0 ? 'up' : sd < 0 ? 'down' : '') + '">' + fmtScoreDelta(sd) + '</span></b><em>' + esc(cur.tier) + ' 티어</em></div>'
      + '</div>';
  }

  // HistoryAnalytics 가 있으면(history-analytics.js) 최근 3개월·최고 점수·연속 상승과 '평가항목상 주요 변화'를 붙인다.
  // 없으면 아무것도 그리지 않는다(기존 화면 그대로).
  function renderExtra(hist, snaps, ci, prevSnap, country, id, brk) {
    var HA = global.HistoryAnalytics; if (!HA || hist.length < 2) return '';
    var cur = hist[hist.length - 1], back3 = null;
    hist.forEach(function (h) { if (monthIndex(cur.period) - monthIndex(h.period) === 3) back3 = h; });
    var d3 = back3 ? cur.rank - back3.rank : null; // 음수 = 3개월 전보다 순위가 오름
    var t3 = back3 ? (d3 < 0 ? '<span class="rkd up">▲' + (-d3) + '</span>' : d3 > 0 ? '<span class="rkd down">▼' + d3 + '</span>' : '<span class="rkd same">–</span>') : '–';
    var maxS = Math.max.apply(null, hist.map(function (h) { return h.score; })), maxP = hist.filter(function (h) { return h.score === maxS; })[0].period;
    var st = HA.computeStreaks(hist, function (h, p) { return !!(p && h.rank < p.rank); }).current;
    var h = '<div class="rh-stats rh-stats3">'
      + '<div><small>최근 3개월</small><b>' + t3 + '</b><em>' + (back3 ? '#' + back3.rank + ' → #' + cur.rank : '3개월 전 기록 없음') + '</em></div>'
      + '<div><small>최고 점수</small><b>' + maxS + '</b><em>' + fmtPeriod(maxP) + (maxP === cur.period ? ' · 이번 달' : '') + '</em></div>'
      + '<div><small>연속 상승</small><b>' + (st ? st.length + '개월' : '–') + '</b><em>' + (st ? fmtPeriod(st.start) + ' ~ ' + fmtPeriod(st.end) : '연속 상승 없음') + '</em></div></div>';
    if (prevSnap) {
      var pe = entryOf(prevSnap, id), ce = entryOf(snaps[ci], id);
      if (pe && ce) {
        var md = HA.metricDelta(country, pe, ce), cmp = HA.compareEntries(pe, ce, prevSnap.groups.length, snaps[ci].groups.length, true);
        var chips = !md.comparable ? '<p class="rh-note" style="margin:0">비교할 세부 항목이 없어요.</p>'
          : !md.changes.length ? '<p class="rh-note" style="margin:0">세부 항목 점수는 지난달과 같아요.</p>'
          : '<ul class="rh-wy">' + md.changes.map(function (c) { return '<li class="' + (c.delta > 0 ? 'up' : 'dn') + '">' + (c.delta > 0 ? '▲' : '▼') + ' ' + esc(c.label) + ' ' + HA.fmtSigned(c.delta) + '</li>'; }).join('') + '</ul>';
        h += '<div class="rh-why"><h4>왜 움직였나 <small>달라진 항목 · ' + fmtPeriod(prevSnap.meta.period) + ' → ' + fmtPeriod(curPeriodOf(snaps[ci])) + '</small></h4>'
          + '<p class="rh-sum">총점 <b>' + pe.score + ' → ' + ce.score + '</b> (' + HA.fmtSigned(cmp.scoreDelta) + ') · 순위 <b>#' + pe.rank + ' → #' + ce.rank + '</b>'
          + (cmp.movementPct !== null ? ' · 상대 위치 <b>' + HA.fmtSigned(cmp.movementPct, 1) + '%p</b>' : '') + '</p>' + chips
          + (HA.isBreakInterval(brk, prevSnap.meta.period, curPeriodOf(snaps[ci])) ? '<p class="rh-note" style="color:#ffd7a0">이 구간(' + fmtPeriod(prevSnap.meta.period) + ' → ' + fmtPeriod(curPeriodOf(snaps[ci])) + ')은 점수가 한꺼번에 크게 뒤바뀐 구간이라 한 달 변화로 보기 어려워요.</p>' : '')
          + '<p class="rh-note">어떤 항목이 달라졌는지만 보여줘요. 이유까지는 알 수 없어요.</p></div>';
      }
    }
    return h;
  }
  function curPeriodOf(snap) { return snap.meta.period; }

  var RANGES = [[3, '3개월'], [6, '6개월'], [12, '12개월'], [0, '전체']];
  function renderGroupTimeline(hist, months) {
    var h = sliceRange(hist, months);
    var rankSeries = [{ name: '순위', color: '#1ed760', points: h.map(function (e) { return { p: e.period, v: e.rank }; }) }];
    var scoreSeries = [{ name: '점수', color: '#539df5', points: h.map(function (e) { return { p: e.period, v: e.score }; }) }];
    return '<p class="rh-k">순위 <small>1위가 위쪽</small></p>' + lineChart({ series: rankSeries, invert: true, rank: true, label: '월별 순위 추이 차트' })
      + '<p class="rh-k">점수 <small>이 그룹 자신의 월별 점수</small></p>' + lineChart({ series: scoreSeries, invert: false, rank: false, h: 150, label: '월별 점수 추이 차트' });
  }

  var css = '.rkd{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:20px;padding:0 6px;border-radius:9999px;font-size:10.5px;font-weight:800;letter-spacing:.02em;line-height:1;vertical-align:1px;white-space:nowrap;background:rgba(255,255,255,.08);color:var(--tx2,#b3b3b3)}'
    + '.rkd.none,.rkd.same{background:transparent;min-width:0;padding:0 2px;color:var(--tx3,#7c7c7c);font-size:12px}'
    + '.rkd.up{background:rgba(30,215,96,.16);color:#1ed760}.rkd.down{background:rgba(243,114,127,.16);color:#f3727f}.rkd.new{background:rgba(255,209,102,.16);color:#ffd166;letter-spacing:.06em}'
    + '.histbox{margin-top:22px;padding-top:20px;border-top:1px solid #2a2a2a}'
    + '.histbox .mtitle .sub2{font-size:11px;font-weight:600;color:var(--tx3,#7c7c7c);margin-left:8px}'
    + '.rh-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}'
    + '.rh-stats>div{background:var(--surf2,#1f1f1f);border-radius:12px;padding:10px 12px}'
    + '.rh-stats .wide{grid-column:1/-1}'
    + '.rh-stats small{display:block;font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--tx3,#7c7c7c);text-transform:uppercase}'
    + '.rh-stats b{display:block;margin-top:2px;font-size:20px;font-weight:900;font-variant-numeric:tabular-nums}'
    + '.rh-stats b .up{color:#1ed760;font-size:14px}.rh-stats b .down{color:#f3727f;font-size:14px}'
    + '.rh-stats em{display:block;margin-top:2px;font-style:normal;font-size:11px;font-weight:600;color:var(--tx3,#7c7c7c)}'
    + '.rh-stats3{grid-template-columns:repeat(3,1fr);margin-top:8px}.rh-stats3 b{font-size:17px}.rh-stats3 em{font-size:10.5px}'
    + '.rh-why{margin-top:12px;padding:14px;border-radius:14px;background:var(--surf2,#1f1f1f)}.rh-why h4{margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.1em;color:var(--tx3,#7c7c7c);text-transform:uppercase}.rh-why h4 small{letter-spacing:0;text-transform:none;font-weight:600;margin-left:6px}'
    + '.rh-sum{margin:0 0 8px;font-size:13px;line-height:1.7;color:var(--tx2,#b3b3b3)}.rh-sum b{color:#fff;font-variant-numeric:tabular-nums}'
    + '.rh-wy{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}.rh-wy li{padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}'
    + '.rh-wy li.up{color:#1ed760;background:rgba(30,215,96,.12)}.rh-wy li.dn{color:#f3727f;background:rgba(243,114,127,.12)}'
    + '.rh-cta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.rh-cta a{flex:1 1 150px;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border-radius:9999px;font-size:12.5px;font-weight:800;color:#fff;text-decoration:none;box-shadow:inset 0 0 0 1px #4d4d4d}.rh-cta a:hover{box-shadow:inset 0 0 0 1px #fff}'
    + '.rh-range{display:flex;gap:6px;margin:14px 0 0;flex-wrap:wrap}'
    + '.rh-range button{min-height:44px;padding:0 14px;border:0;border-radius:9999px;background:var(--surf2,#1f1f1f);color:var(--tx2,#b3b3b3);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer}'
    + '.rh-range button:hover{color:#fff}.rh-range button[aria-pressed="true"]{background:#1ed760;color:#000}'
    + '.rh-range button:focus-visible,.rh-tbl summary:focus-visible{outline:2px solid #1ed760;outline-offset:2px}'
    + '.rh-k{margin:14px 0 4px;font-size:12px;font-weight:800;color:var(--tx,#fff)}.rh-k small{font-weight:600;color:var(--tx3,#7c7c7c);margin-left:6px}'
    + '.rh-chart{display:block;width:100%;height:auto;max-width:100%}'
    + '.rh-grid{stroke:rgba(255,255,255,.08);stroke-width:1}.rh-yl,.rh-xl{fill:#7c7c7c;font-size:10px;font-weight:700}.rh-vl{fill:#fff;font-size:10px;font-weight:800}'
    + '.rh-first{padding:16px;border-radius:14px;background:var(--surf2,#1f1f1f);font-size:13px;line-height:1.7;color:var(--tx2,#b3b3b3)}.rh-first b{color:#fff}'
    + '.rh-tbl{margin:10px 0 0;font-size:12px;color:var(--tx2,#b3b3b3)}.rh-tbl summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:700}'
    + '.rh-tbl table{width:100%;border-collapse:collapse}.rh-tbl th,.rh-tbl td{padding:6px 8px;text-align:left;border-bottom:1px solid #2a2a2a;font-variant-numeric:tabular-nums}.rh-tbl th{color:#7c7c7c;font-size:10.5px}'
    + '.rh-legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin:8px 0 0;font-size:12px;font-weight:700}.rh-legend span{display:inline-flex;align-items:center;gap:6px}.rh-legend i{width:10px;height:10px;border-radius:50%}'
    + '.rh-note{margin:12px 0 0;font-size:10.5px;line-height:1.6;color:var(--tx3,#7c7c7c)}'
    + '.rh-radartl{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:260px;margin:-6px auto 18px}'
    + '.rh-radartl-lab{display:inline-flex;align-items:center;min-height:26px;padding:0 12px;border-radius:9999px;background:var(--surf2,#1f1f1f);color:var(--tx2,#b3b3b3);font-size:11.5px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}'
    + '.rh-radartl-row{display:flex;align-items:center;gap:8px;width:100%}'
    + '.rh-radartl-step{flex:none;width:30px;height:30px;border:0;border-radius:50%;background:var(--surf2,#1f1f1f);color:#fff;font-size:15px;cursor:pointer;display:grid;place-items:center;transition:background .15s}'
    + '.rh-radartl-step:hover:not(:disabled){background:var(--card2,#272727)}'
    + '.rh-radartl-step:disabled{opacity:.3;cursor:default}'
    + '.rh-radartl input[type=range]{flex:1;min-width:0;height:30px;accent-color:#1ed760;cursor:pointer}'
    + '.rh-radartl-play{flex:none;width:32px;height:32px;border:0;border-radius:50%;background:#1ed760;color:#000;font-family:inherit;font-size:13px;cursor:pointer;display:grid;place-items:center;transition:background .15s,box-shadow .15s}'
    + '.rh-radartl-play:hover{background:#3be477}'
    + '.rh-radartl-play[aria-pressed="true"]{background:var(--surf2,#1f1f1f);color:#1ed760;box-shadow:inset 0 0 0 1px #1ed760}';
  function injectCss() {
    if (document.getElementById('rhCss')) return;
    var st = document.createElement('style'); st.id = 'rhCss'; st.textContent = css; document.head.appendChild(st);
  }
  injectCss();

  // 상세 팝업 위쪽의 방사형 차트(#dpRadarWrap/#dpRadarShape, tools/page.script.js 의 bigRadarSVG)를
  // 월별로 스크럽·재생할 수 있게 만든다. 모양만 바뀌고(부드럽게 보간) 색은 현재 티어색 그대로 둔다.
  function mountRadarTimeline(hist, country) {
    var wrap = document.getElementById('dpRadarWrap'), shape = document.getElementById('dpRadarShape');
    var HA = global.HistoryAnalytics;
    if (!wrap || !shape || !HA || hist.length < 2 || document.getElementById('dpRadarTl')) return;
    var defs = HA.metricDefs(country), N = defs.length, cx = 110, cy = 104, R = 78;
    function ang(i) { return i * (2 * Math.PI / N) - Math.PI / 2; }
    function ptsFor(idx) {
      var m = hist[idx].metrics || {};
      return defs.map(function (d, i) {
        var v = m[d.key], nv = Math.max(0, Math.min(1, (v == null ? 0 : v) / d.max)), a = ang(i), r = R * Math.max(0.04, nv);
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      });
    }
    function curPts() {
      return (shape.getAttribute('points') || '').split(' ').filter(Boolean).map(function (s) { var xy = s.split(',').map(Number); return [xy[0], xy[1]]; });
    }
    var idx = hist.length - 1, animTok = 0, playTimer = 0;
    function paintTo(target, ms) {
      var from = curPts(), tok = ++animTok, t0 = null;
      if (!ms || from.length !== target.length) { shape.setAttribute('points', target.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ')); return; }
      function frame(t) {
        if (tok !== animTok) return;
        if (t0 === null) t0 = t;
        var p = Math.min(1, (t - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        shape.setAttribute('points', from.map(function (fp, i) { var tp = target[i]; return (fp[0] + (tp[0] - fp[0]) * e).toFixed(1) + ',' + (fp[1] + (tp[1] - fp[1]) * e).toFixed(1); }).join(' '));
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
    function sync(ms) {
      paintTo(ptsFor(idx), ms);
      var h = hist[idx];
      lab.textContent = fmtPeriod(h.period) + ' · #' + h.rank + ' · ' + h.score + '점' + (idx === hist.length - 1 ? ' · 현재' : '');
      slider.value = idx;
      prevBtn.disabled = idx <= 0; nextBtn.disabled = idx >= hist.length - 1;
    }
    function stop() { if (playTimer) { clearTimeout(playTimer); playTimer = 0; } playBtn.textContent = '▶'; playBtn.setAttribute('aria-pressed', 'false'); playBtn.setAttribute('aria-label', '재생'); }
    function stepPlay() {
      idx = idx >= hist.length - 1 ? 0 : idx + 1;
      sync(220);
      if (idx < hist.length - 1) playTimer = setTimeout(stepPlay, 260); else stop();
    }
    var box = document.createElement('div');
    box.id = 'dpRadarTl';
    box.className = 'rh-radartl';
    box.innerHTML = '<span class="rh-radartl-lab"></span>'
      + '<div class="rh-radartl-row"><button type="button" class="rh-radartl-step" aria-label="이전 달">‹</button>'
      + '<input type="range" min="0" max="' + (hist.length - 1) + '" step="1" aria-label="' + esc(fmtPeriod(hist[0].period)) + '부터 ' + esc(fmtPeriod(hist[hist.length - 1].period)) + '까지, 월 선택">'
      + '<button type="button" class="rh-radartl-play" aria-pressed="false" aria-label="재생">▶</button>'
      + '<button type="button" class="rh-radartl-step" aria-label="다음 달">›</button></div>';
    wrap.insertAdjacentElement('afterend', box);
    var lab = box.querySelector('.rh-radartl-lab'), slider = box.querySelector('input[type=range]'),
      prevBtn = box.querySelector('.rh-radartl-row button:first-child'), nextBtn = box.querySelector('.rh-radartl-row button:last-child'), playBtn = box.querySelector('.rh-radartl-play');
    slider.addEventListener('input', function () { stop(); idx = Number(slider.value); sync(200); });
    prevBtn.addEventListener('click', function () { stop(); idx = Math.max(0, idx - 1); sync(350); });
    nextBtn.addEventListener('click', function () { stop(); idx = Math.min(hist.length - 1, idx + 1); sync(350); });
    playBtn.addEventListener('click', function () {
      if (playTimer) { stop(); return; }
      playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-pressed', 'true'); playBtn.setAttribute('aria-label', '일시정지');
      idx = idx >= hist.length - 1 ? 0 : idx + 1; sync(220);
      playTimer = setTimeout(stepPlay, 260);
    });
    sync(0);
  }

  // 상세 팝업 하단 "📈 순위 추이" 섹션. 팝업을 열 때 해당 국가의 snapshot 전체를 lazy load 한다.
  function renderDetail(box, opts) {
    if (!box) return;
    box.classList.add('histbox');
    box.innerHTML = '<h3 class="mtitle">📈 순위 추이</h3><p class="mnote" style="margin:0">불러오는 중…</p>';
    Promise.all([loadAll(opts.country), loadBreaks()]).then(function (res) {
      var snaps = res[0], brk = res[1][opts.country] || [];
      if (!box.isConnected || box.dataset.id !== opts.id) return;
      var hist = extractGroupHistory(snaps, opts.id);
      if (!snaps.length || !hist.length) { box.innerHTML = ''; box.hidden = true; return; } // 로딩 실패/기록 없음: 섹션만 숨김
      box.hidden = false;
      mountRadarTimeline(hist, opts.country);
      // '현재'는 이 그룹의 가장 최근 기록 월. 전월은 그 월 바로 앞의 실제 snapshot(없으면 최초 월).
      var latest = snaps[snaps.length - 1], curP = hist[hist.length - 1].period, ci = -1;
      snaps.forEach(function (s, i) { if (s.meta.period === curP) ci = i; });
      var prevSnap = ci > 0 ? snaps[ci - 1] : null;
      var title = '<h3 class="mtitle">📈 순위 추이<span class="sub2">' + fmtPeriod(hist[0].period) + (hist.length > 1 ? ' ~ ' + fmtPeriod(hist[hist.length - 1].period) : '') + '</span></h3>';
      var stats = renderHistoryStats(hist, prevSnap, opts.id) + renderExtra(hist, snaps, ci, prevSnap, opts.country, opts.id, brk);
      if (snaps.length < 2 || hist.length < 2) {
        var only = snaps.length < 2
          ? '<div class="rh-first"><b>📈 ' + fmtPeriod(latest.meta.period) + ' 첫 기록</b><br>다음 월 평가부터 순위 변동이 표시됩니다.</div>'
          : '<div class="rh-first"><b>📈 ' + fmtPeriod(hist[0].period) + ' 진입</b><br>기록이 1개월뿐이라 추이 그래프는 다음 달부터 그려져요.</div>';
        box.innerHTML = title + stats + '<div style="margin-top:10px">' + only + '</div>' + histTable(hist)
          + '<p class="rh-note">순위는 각 월 평가의 원본 순위(동점 포함)예요. 한국·일본은 평가 기준이 달라 서로 비교하지 않아요.</p>';
        return;
      }
      var state = { months: 0 };
      var paint = function () {
        box.querySelector('.rh-chartwrap').innerHTML = renderGroupTimeline(hist, state.months);
        Array.prototype.forEach.call(box.querySelectorAll('[data-rmonths]'), function (b) { b.setAttribute('aria-pressed', Number(b.getAttribute('data-rmonths')) === state.months); });
      };
      box.innerHTML = title + stats
        + '<div class="rh-range" role="group" aria-label="기간 선택">' + RANGES.map(function (r) { return '<button type="button" data-rmonths="' + r[0] + '" aria-pressed="false">' + r[1] + '</button>'; }).join('') + '</div>'
        + '<div class="rh-chartwrap"></div>' + histTable(hist)
        + '<p class="rh-note">순위는 각 월 평가의 원본 순위(동점 포함)예요. 기록이 없는 달은 이어 그리지 않고 점선으로만 표시해요. 한국·일본은 평가 기준이 달라 서로 비교하지 않아요.</p>';
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-rmonths]'); if (!b) return;
        state.months = Number(b.getAttribute('data-rmonths')); paint();
      });
      paint();
    });
  }

  // 같은 국가 그룹 비교 시 순위 추이 겹쳐 보기 (2개 이상 snapshot 이 있을 때만)
  function renderCompareTrend(box, country, items) {
    if (!box) return;
    box.innerHTML = '';
    loadAll(country).then(function (snaps) {
      if (!box.isConnected || snaps.length < 2) return;
      var series = items.map(function (it, i) {
        return { name: it.name, color: it.color || PAL[i % PAL.length], points: extractGroupHistory(snaps, it.id).map(function (e) { return { p: e.period, v: e.rank }; }) };
      }).filter(function (s) { return s.points.length; });
      if (!series.length) return;
      box.innerHTML = '<div class="histbox" style="margin-top:16px;padding-top:16px"><h3 class="mtitle" style="font-size:14px">📈 순위 추이 비교</h3>'
        + lineChart({ series: series, invert: true, rank: true, label: '선택한 그룹들의 월별 순위 추이 비교 차트' })
        + '<div class="rh-legend">' + series.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>'
        + '<p class="rh-note">같은 국가 그룹끼리만 비교해요. 1위가 위쪽입니다.</p></div>';
    });
  }

  global.RankHistory = {
    version: VERSION,
    // 순수 계산
    getRankDelta: getRankDelta, getScoreDelta: getScoreDelta, getRankPositionPercentile: getRankPositionPercentile, getBestRank: getBestRank, getWorstRank: getWorstRank,
    extractGroupHistory: extractGroupHistory, sliceRange: sliceRange, deltasFromSnapshots: deltasFromSnapshots, monthIndex: monthIndex,
    // 로딩
    loadHistoryIndex: loadHistoryIndex, loadBreaks: loadBreaks, loadCountrySnapshot: loadCountrySnapshot, loadRecent: loadRecent, loadAll: loadAll, getGroupHistory: getGroupHistory, loadDeltas: loadDeltas,
    // 렌더
    fmtPeriod: fmtPeriod, renderRankDeltaBadge: renderRankDeltaBadge, renderGroupTimeline: renderGroupTimeline, renderHistoryStats: renderHistoryStats,
    renderDetail: renderDetail, renderCompareTrend: renderCompareTrend, lineChart: lineChart
  };
})(window);
