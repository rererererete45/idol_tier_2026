/* HISTORY ANALYTICS — 월별 snapshot 에서 변동·기록·주목 패턴을 계산하는 순수 함수 모음 (IDOL_HISTORY_SUITE_V3_SPEC.md)
 * - UI/DOM/fetch 를 다루지 않는다. 입력은 RankHistory 가 읽어 온 snapshot 객체({meta, groups[]})뿐이다.
 * - 순위(rank)는 snapshot 에 저장된 값을 그대로 쓴다. 배열 순서나 점수로 재계산하지 않는다(동점 유지).
 * - 없는 달·없는 그룹은 보간하지 않는다. 이전 기록이 없는 그룹은 NEW 이며 상승 기록에서 제외한다.
 * - 한국/일본은 평가 배점이 달라 절대점수·티어를 섞지 않는다. 모든 계산은 국가별로 따로 호출한다.
 * - 순위 이동의 공정한 비교는 RankHistory.getRankPositionPercentile 기반 '시장 내 위치 지수 이동(%p)'을 쓴다.
 * - 모든 정렬은 입력 순서와 무관한 결정적 tie-break(마지막은 id)를 가진다.
 * window.HistoryAnalytics 로만 노출한다. (rank-history.js 뒤에 로드) */
(function (global) {
  'use strict';
  var RH = global.RankHistory;
  if (!RH) throw new Error('HistoryAnalytics: rank-history.js 를 먼저 불러와야 합니다');

  var TIERS = ['S+', 'S', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D'];
  // 평가항목(키·라벨·만점). 한국/일본은 서로 다른 체계라 국가별로 따로 둔다.
  var METRICS = {
    KR: [
      { key: 'domestic_digital', label: '국내음원', max: 20 }, { key: 'album_fandom', label: '음반·팬덤', max: 20 }, { key: 'performance', label: '공연', max: 20 },
      { key: 'global', label: '글로벌', max: 15 }, { key: 'recognition', label: '국내인지도', max: 15 }, { key: 'momentum', label: '현재기세', max: 10 }
    ],
    JP: [
      { key: 'live', label: '공연·현장', max: 25 }, { key: 'fandom', label: '팬덤·구매력', max: 20 }, { key: 'recognition', label: '대중인지도', max: 20 },
      { key: 'streaming_sns', label: '스트리밍·SNS', max: 15 }, { key: 'momentum', label: '현재기세', max: 10 }, { key: 'industry', label: '업계영향력', max: 10 }
    ]
  };
  var COUNTRY_NAME = { KR: '한국', JP: '일본' };

  /* ---------- 기본 유틸 ---------- */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function mi(p) { return RH.monthIndex(p); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function idCmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function tierIdx(t) { var i = TIERS.indexOf(t); return i < 0 ? null : i; }
  function fmtPeriod(p) { return RH.fmtPeriod(p); }
  function fmtSigned(n, digits) {
    if (!isNum(n)) return '–';
    var s = digits ? n.toFixed(digits) : String(n);
    return n > 0 ? '+' + s : n < 0 ? s.replace('-', '−') : '±0';
  }

  /* ---------- 기간 ---------- */
  function isConsecutiveMonth(a, b) { return mi(b) - mi(a) === 1; }
  function monthsBetween(a, b) { return mi(b) - mi(a); }
  function sortPeriods(periods) { return periods.slice().sort(function (a, b) { return mi(a) - mi(b); }); }
  function previousPeriod(periods, p) { var l = sortPeriods(periods), i = l.indexOf(p); return i > 0 ? l[i - 1] : null; }
  function nextPeriod(periods, p) { var l = sortPeriods(periods), i = l.indexOf(p); return i >= 0 && i < l.length - 1 ? l[i + 1] : null; }
  function periodRange(periods, from, to) { return sortPeriods(periods).filter(function (p) { return mi(p) >= mi(from) && mi(p) <= mi(to); }); }
  function sortSnapshots(snaps) { return snaps.filter(Boolean).slice().sort(function (a, b) { return mi(a.meta.period) - mi(b.meta.period); }); }

  /* ---------- 구간 경계(breaks) ----------
   * data/history/breaks.json: 두 달 사이에 다수 그룹의 점수·순위가 한꺼번에 크게 바뀌어(평가 기준·자료 갱신 등) 월간 변화로 읽기 어려운 구간.
   * 값은 고치지 않는다. 단월 기록(RECORD BOOK)에서만 제외하고, 그 구간을 지나는 비교에는 이유를 표시한다.
   * breaks: [{from:'2025-12', to:'2026-01', reason, evidence, excludeFromMonthlyRecords}]  (국가별로 따로 넘긴다) */
  function isBreakInterval(breaks, a, b) {
    return (breaks || []).some(function (x) { return x.from === a && x.to === b; });
  }
  // 비교 구간 [from, to] 안에 통째로 들어오는(또는 그 끝점과 같은) 경계들
  function breaksIn(breaks, from, to) {
    return (breaks || []).filter(function (x) { return mi(x.from) >= mi(from) && mi(x.to) <= mi(to); });
  }
  function excluded(breaks, a, b) {
    return (breaks || []).some(function (x) { return x.from === a && x.to === b && x.excludeFromMonthlyRecords !== false; });
  }

  /* ---------- snapshot 조회 ---------- */
  var idxCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function indexOf(snapshot) {
    var m = idxCache && idxCache.get(snapshot);
    if (!m) {
      m = Object.create(null);
      snapshot.groups.forEach(function (g) { m[g.id] = g; });
      if (idxCache) idxCache.set(snapshot, m);
    }
    return m;
  }
  function entryById(snapshot, id) { return snapshot ? indexOf(snapshot)[id] || null : null; }
  function population(snapshot) { return snapshot ? snapshot.groups.length : 0; }

  /* ---------- 평가항목 변화 ---------- */
  function metricDefs(country) { return METRICS[country] || []; }
  // 두 달 모두에 값이 있는 항목만 delta 를 만든다(없으면 null = N/A). 정렬: 상승 큰 순 → 하락 절대값 큰 순.
  function metricDelta(country, prevEntry, curEntry) {
    var defs = metricDefs(country);
    if (!defs.length || !prevEntry || !curEntry || !prevEntry.metrics || !curEntry.metrics) return { comparable: false, items: [], changes: [], sum: null, scoreDelta: null, mismatch: false };
    var items = defs.map(function (d, i) {
      var a = prevEntry.metrics[d.key], b = curEntry.metrics[d.key], ok = isNum(a) && isNum(b);
      return { key: d.key, label: d.label, max: d.max, order: i, prev: isNum(a) ? a : null, cur: isNum(b) ? b : null, delta: ok ? r2(b - a) : null };
    });
    var known = items.filter(function (it) { return it.delta !== null; });
    var changes = known.filter(function (it) { return it.delta !== 0; }).sort(function (x, y) {
      var xp = x.delta > 0 ? 0 : 1, yp = y.delta > 0 ? 0 : 1;
      return xp - yp || Math.abs(y.delta) - Math.abs(x.delta) || x.order - y.order;
    });
    var sum = known.length ? r2(known.reduce(function (a, it) { return a + it.delta; }, 0)) : null;
    var sd = RH.getScoreDelta(curEntry, prevEntry);
    // 여섯 항목이 모두 비교 가능할 때만 '합 = 총점 변화' 를 검사한다(불일치는 조용히 숨기지 않고 표시)
    var mismatch = known.length === defs.length && sd !== null && Math.abs(sum - sd) > 0.01;
    return { comparable: known.length > 0, items: items, changes: changes, sum: sum, scoreDelta: sd, mismatch: mismatch };
  }

  /* ---------- 한 그룹의 두 달 비교 ---------- */
  // previousExists=false: 비교할 이전 snapshot 자체가 없음(첫 기록) → kind 'none'.  prev=null 이고 previousExists!==false: NEW.
  function compareEntries(prev, cur, prevPop, curPop, previousExists) {
    var kind = RH.getRankDelta(cur, prev, previousExists !== false);
    var raw = prev && cur ? prev.rank - cur.rank : null;
    var pp = prev ? RH.getRankPositionPercentile(prev.rank, prevPop) : null, cp = cur ? RH.getRankPositionPercentile(cur.rank, curPop) : null;
    var mv = pp !== null && cp !== null ? cp - pp : null;
    var ti = cur ? tierIdx(cur.tier) : null, tp = prev ? tierIdx(prev.tier) : null;
    var tier = { from: prev ? prev.tier : null, to: cur ? cur.tier : null, dir: ti !== null && tp !== null ? (ti < tp ? 'up' : ti > tp ? 'down' : 'same') : null, steps: ti !== null && tp !== null ? Math.abs(tp - ti) : 0 };
    return {
      kind: kind.kind, n: kind.n, rawDelta: raw,
      prevPercentile: pp, curPercentile: cp, movement: mv,
      // 화면 표시용(소수 1자리). 정렬·기록 계산에는 movement 원값을 쓴다.
      movementPct: mv === null ? null : r1(mv),
      scoreDelta: RH.getScoreDelta(cur, prev), tier: tier
    };
  }

  /* ---------- 두 snapshot 비교 (MOVERS 의 기반) ----------
   * opts.history: 시간순 전체 snapshot(선택). 있으면 NEW PEAK 를 계산한다(from 이하 최고 순위보다 (from,to] 안에서 더 좋아졌는가).
   * prevSnap 이 null 이면 첫 기록: 모든 행이 kind 'none'. */
  function compareSnapshots(country, prevSnap, curSnap, opts) {
    opts = opts || {};
    var prevPop = population(prevSnap), curPop = population(curSnap), first = !prevSnap;
    var hist = opts.history ? sortSnapshots(opts.history) : null;
    var fromM = prevSnap ? mi(prevSnap.meta.period) : null, toM = mi(curSnap.meta.period);
    var rows = curSnap.groups.map(function (g) {
      var p = prevSnap ? entryById(prevSnap, g.id) : null;
      var c = compareEntries(p, g, prevPop, curPop, !first);
      var row = {
        id: g.id, group: g.group, cur: g, prev: p, isNew: !first && !p,
        kind: c.kind, n: c.n, rawDelta: c.rawDelta, movement: c.movement, movementPct: c.movementPct, scoreDelta: c.scoreDelta, tier: c.tier,
        prevPercentile: c.prevPercentile, curPercentile: c.curPercentile, metric: metricDelta(country, p, g), newPeak: null, bestBefore: null
      };
      if (hist && p) {
        var best = null, inRange = null;
        hist.forEach(function (s) {
          var e = entryById(s, g.id); if (!e) return;
          var m = mi(s.meta.period);
          if (m <= fromM) best = best === null ? e.rank : Math.min(best, e.rank);
          else if (m <= toM) inRange = inRange === null ? e.rank : Math.min(inRange, e.rank);
        });
        row.bestBefore = best; row.newPeak = best !== null && inRange !== null ? inRange < best : null;
        row.peakRank = inRange;
      }
      return row;
    });
    var toSet = Object.create(null); curSnap.groups.forEach(function (g) { toSet[g.id] = 1; });
    var exits = prevSnap ? prevSnap.groups.filter(function (g) { return !toSet[g.id]; }) : [];
    return {
      country: country, from: prevSnap ? prevSnap.meta.period : null, to: curSnap.meta.period,
      gapMonths: prevSnap ? monthsBetween(prevSnap.meta.period, curSnap.meta.period) : null,
      prevPop: prevPop, curPop: curPop, first: first, rows: rows,
      breaks: prevSnap ? breaksIn(opts.breaks, prevSnap.meta.period, curSnap.meta.period) : [],
      newEntries: rows.filter(function (r) { return r.isNew; }), exits: exits
    };
  }

  /* ---------- MOVERS 카테고리 ----------
   * 순위 상승/하락의 '방향'은 실제 순위(raw)로 정하고(예: #10→#11 을 '상승'에 넣지 않는다),
   * 같은 방향 안에서의 크기는 시장 내 위치 지수 이동(%p) → 점수 변화 → id 순으로 정렬한다. */
  function metricDeltaOf(row, key) {
    var it = row.metric && row.metric.items ? row.metric.items.filter(function (x) { return x.key === key; })[0] : null;
    return it ? it.delta : null;
  }
  function byDesc(f1, f2) {
    return function (a, b) {
      var d1 = f1(b) - f1(a); if (d1) return d1;
      if (f2) { var d2 = f2(b) - f2(a); if (d2) return d2; }
      return idCmp(a.id, b.id);
    };
  }
  function computeMovers(cmp) {
    var rows = cmp.first ? [] : cmp.rows.filter(function (r) { return !r.isNew; });
    var z = function (v) { return v === null || v === undefined ? 0 : v; };
    var out = {
      rankUp: rows.filter(function (r) { return r.rawDelta > 0; }).sort(byDesc(function (r) { return z(r.movement); }, function (r) { return z(r.scoreDelta); })),
      rankDown: rows.filter(function (r) { return r.rawDelta < 0; }).sort(byDesc(function (r) { return -z(r.movement); }, function (r) { return -z(r.scoreDelta); })),
      scoreUp: rows.filter(function (r) { return r.scoreDelta > 0; }).sort(byDesc(function (r) { return r.scoreDelta; }, function (r) { return z(r.movement); })),
      scoreDown: rows.filter(function (r) { return r.scoreDelta < 0; }).sort(byDesc(function (r) { return -r.scoreDelta; }, function (r) { return -z(r.movement); })),
      momentumUp: rows.filter(function (r) { return metricDeltaOf(r, 'momentum') > 0; }).sort(byDesc(function (r) { return metricDeltaOf(r, 'momentum'); }, function (r) { return z(r.scoreDelta); })),
      tierUp: rows.filter(function (r) { return r.tier.dir === 'up'; }).sort(byDesc(function (r) { return r.tier.steps; }, function (r) { return z(r.scoreDelta); })),
      newPeak: rows.filter(function (r) { return r.newPeak === true; }).sort(byDesc(function (r) { return r.bestBefore - r.cur.rank; }, function (r) { return z(r.movement); })),
      newEntry: cmp.first ? [] : cmp.newEntries.slice().sort(function (a, b) { return a.cur.rank - b.cur.rank || idCmp(a.id, b.id); })
    };
    out.counts = {};
    Object.keys(out).forEach(function (k) { if (k !== 'counts') out.counts[k] = out[k].length; });
    out.newPeakReady = rows.some(function (r) { return r.newPeak !== null; }); // history 없이 계산했다면 false
    return out;
  }

  /* ---------- 그룹 이력 ---------- */
  function groupHistoryUntil(snapshots, id, cutoffPeriod) {
    var c = cutoffPeriod ? mi(cutoffPeriod) : Infinity;
    return RH.extractGroupHistory(snapshots.filter(function (s) { return mi(s.meta.period) <= c; }), id);
  }

  // pred(entry, prevEntry|null, i): prevEntry 는 '바로 앞 달'이 실제로 이어질 때만 넘어온다(끊기면 null → streak 도 끊김).
  function computeStreaks(history, pred) {
    var runs = [], cur = null;
    history.forEach(function (h, i) {
      var prev = i > 0 ? history[i - 1] : null, consec = !!(prev && isConsecutiveMonth(prev.period, h.period));
      if (pred(h, consec ? prev : null, i)) {
        if (cur && consec) { cur.end = h.period; cur.length++; cur.periods.push(h.period); }
        else { cur = { start: h.period, end: h.period, length: 1, periods: [h.period] }; runs.push(cur); }
      } else cur = null;
    });
    var longest = runs.reduce(function (b, r) { return !b || r.length > b.length ? r : b; }, null); // 동률이면 더 이른 구간
    var last = history.length ? history[history.length - 1].period : null;
    return { runs: runs, longest: longest, current: runs.length && runs[runs.length - 1].end === last ? runs[runs.length - 1] : null };
  }

  /* ---------- 그룹 기록 ---------- */
  function periodsWhere(history, f) { return history.filter(f).map(function (h) { return h.period; }); }
  function countRun(history, f) { var s = computeStreaks(history, function (h) { return f(h); }); return { months: periodsWhere(history, f).length, periods: periodsWhere(history, f), streak: s.longest, current: s.current }; }

  // history: 한 그룹의 시간순 기록(이미 기간/컷오프 적용). pops: {period: 그 달 평가 팀 수}. totalSnapshots: 범위 안 snapshot 수.
  function computeGroupRecord(country, history, pops, totalSnapshots, breaks) {
    if (!history.length) return null;
    var last = history[history.length - 1];
    var rec = { id: null, group: last.group, country: country, months: history.length, first: history[0].period, latest: last.period, coverage: totalSnapshots ? history.length / totalSnapshots : null };
    rec.rank1 = countRun(history, function (h) { return h.rank === 1; });
    rec.top5 = countRun(history, function (h) { return h.rank <= 5; });
    rec.top10 = countRun(history, function (h) { return h.rank <= 10; });
    var bestRank = Math.min.apply(null, history.map(function (h) { return h.rank; }));
    var bestPeriods = periodsWhere(history, function (h) { return h.rank === bestRank; });
    rec.bestRank = { rank: bestRank, first: bestPeriods[0], periods: bestPeriods };
    var maxScore = Math.max.apply(null, history.map(function (h) { return h.score; }));
    var maxPeriods = periodsWhere(history, function (h) { return h.score === maxScore; });
    rec.maxScore = { score: maxScore, first: maxPeriods[0], periods: maxPeriods };

    var gain = null, loss = null, up = null, down = null, tierUps = [], newPeaks = [], bestSoFar = null;
    history.forEach(function (h, i) {
      if (bestSoFar !== null && h.rank < bestSoFar) newPeaks.push(h.period);
      bestSoFar = bestSoFar === null ? h.rank : Math.min(bestSoFar, h.rank);
      var p = i > 0 ? history[i - 1] : null;
      if (!p || !isConsecutiveMonth(p.period, h.period)) return; // 이어지지 않는 달 사이는 '월간' 변화가 아니므로 기록에서 제외
      if (excluded(breaks, p.period, h.period)) return; // 구간 경계(평가 기준·자료 갱신 등)는 월간 변화 기록에서 제외
      var sd = RH.getScoreDelta(h, p);
      if (sd !== null && sd > 0 && (!gain || sd > gain.value)) gain = { value: sd, period: h.period, from: p.period, prevScore: p.score, score: h.score };
      if (sd !== null && sd < 0 && (!loss || sd < loss.value)) loss = { value: sd, period: h.period, from: p.period, prevScore: p.score, score: h.score };
      var c = compareEntries({ rank: p.rank, tier: p.tier }, { rank: h.rank, tier: h.tier }, pops[p.period], pops[h.period], true);
      if (c.rawDelta > 0 && c.movement > 0 && (!up || c.movement > up.movement || (c.movement === up.movement && c.rawDelta > up.rawDelta))) up = { movement: c.movement, movementPct: r1(c.movement), rawDelta: c.rawDelta, period: h.period, from: p.period, prevRank: p.rank, rank: h.rank };
      if (c.rawDelta < 0 && c.movement < 0 && (!down || c.movement < down.movement || (c.movement === down.movement && c.rawDelta < down.rawDelta))) down = { movement: c.movement, movementPct: r1(c.movement), rawDelta: c.rawDelta, period: h.period, from: p.period, prevRank: p.rank, rank: h.rank };
      if (c.tier.dir === 'up') tierUps.push(h.period);
    });
    rec.scoreGain = gain; rec.scoreLoss = loss; rec.rankUp = up; rec.rankDown = down;
    rec.newPeaks = { count: newPeaks.length, periods: newPeaks };
    rec.tierUps = { count: tierUps.length, periods: tierUps };
    var rise = computeStreaks(history, function (h, p) { return !!(p && !excluded(breaks, p.period, h.period) && h.rank < p.rank); });
    rec.riseStreak = rise.longest;
    var splus = periodsWhere(history, function (h) { return h.tier === 'S+' || h.tier === 'S'; });
    var aplus = periodsWhere(history, function (h) { var t = tierIdx(h.tier); return t !== null && t <= 2; });
    rec.tierMonths = { sTier: splus, aPlus: aplus };
    return rec;
  }

  /* ---------- RECORD BOOK ----------
   * 보드는 국가별로만 만든다. value 가 없거나 0 인 그룹은 넣지 않는다. 동점은 같은 순위로 표시하고 순위 10 까지 모두 노출한다. */
  function pl(n, unit) { return n + unit; }
  var BOARDS = [
    { key: 'rank1Months', cat: 'rank', title: '최다 1위', unit: '개월', rule: '1위였던 달 수 (공동 1위 포함)', v: function (g) { return g.rank1.months; }, per: function (g) { return g.rank1.periods; }, text: function (g) { return pl(g.rank1.months, '개월'); } },
    { key: 'rank1Streak', cat: 'rank', title: '최장 연속 1위', unit: '개월', rule: '이어진 달 동안 계속 1위였던 가장 긴 구간. 한 달이라도 빠지면 끊겨요', v: function (g) { return g.rank1.streak ? g.rank1.streak.length : 0; }, per: function (g) { return g.rank1.streak ? g.rank1.streak.periods : []; }, text: function (g) { return pl(g.rank1.streak.length, '개월'); } },
    { key: 'top5Months', cat: 'rank', title: '상위 5위 진입 개월', unit: '개월', rule: '5위 안이었던 달 수 (공동 5위 포함)', v: function (g) { return g.top5.months; }, per: function (g) { return g.top5.periods; }, text: function (g) { return pl(g.top5.months, '개월'); } },
    { key: 'top5Streak', cat: 'rank', title: '최장 연속 상위 5위', unit: '개월', rule: '이어진 달 동안 계속 5위 안이었던 가장 긴 구간', v: function (g) { return g.top5.streak ? g.top5.streak.length : 0; }, per: function (g) { return g.top5.streak ? g.top5.streak.periods : []; }, text: function (g) { return pl(g.top5.streak.length, '개월'); } },
    { key: 'top10Months', cat: 'rank', title: '상위 10위 진입 개월', unit: '개월', rule: '10위 안이었던 달 수 (공동 10위 포함)', v: function (g) { return g.top10.months; }, per: function (g) { return g.top10.periods; }, text: function (g) { return pl(g.top10.months, '개월'); } },
    { key: 'top10Streak', cat: 'rank', title: '최장 연속 상위 10위', unit: '개월', rule: '이어진 달 동안 계속 10위 안이었던 가장 긴 구간', v: function (g) { return g.top10.streak ? g.top10.streak.length : 0; }, per: function (g) { return g.top10.streak ? g.top10.streak.periods : []; }, text: function (g) { return pl(g.top10.streak.length, '개월'); } },
    { key: 'bestRank', cat: 'rank', title: '개인 최고 순위', unit: '위', rule: '가장 높았던 순위. 같으면 그 순위를 더 오래 지킨 그룹이 앞이에요', asc: true, v: function (g) { return g.bestRank.rank; }, per: function (g) { return g.bestRank.periods; }, text: function (g) { return '#' + g.bestRank.rank; }, tie: function (g) { return -g.bestRank.periods.length; } },
    { key: 'maxScore', cat: 'score', title: '역대 최고 종합점수', unit: '점', rule: '가장 높았던 총점 (처음 찍은 달 기준)', v: function (g) { return g.maxScore.score; }, per: function (g) { return g.maxScore.periods; }, text: function (g) { return g.maxScore.score + '점'; }, tie: function (g) { return mi(g.maxScore.first); } },
    { key: 'scoreGain', cat: 'score', title: '단월 최대 점수 상승', unit: '점', rule: '한 달 사이에 총점이 가장 많이 오른 폭', v: function (g) { return g.scoreGain ? g.scoreGain.value : 0; }, per: function (g) { return g.scoreGain ? [g.scoreGain.period] : []; }, text: function (g) { return fmtSigned(g.scoreGain.value) + '점 (' + g.scoreGain.prevScore + '→' + g.scoreGain.score + ')'; } },
    { key: 'scoreLoss', cat: 'score', title: '단월 최대 점수 하락', unit: '점', rule: '한 달 사이에 총점이 가장 많이 내려간 폭. 실력 평가가 아니라 점수 변화일 뿐이에요', v: function (g) { return g.scoreLoss ? -g.scoreLoss.value : 0; }, per: function (g) { return g.scoreLoss ? [g.scoreLoss.period] : []; }, text: function (g) { return fmtSigned(g.scoreLoss.value) + '점 (' + g.scoreLoss.prevScore + '→' + g.scoreLoss.score + ')'; } },
    { key: 'rankUp', cat: 'movement', title: '단월 최대 순위 상승', unit: '%p', rule: '한 달 사이에 순위가 오른 경우, 팀 수 차이를 보정한 상대 위치(%p)가 가장 많이 오른 순서. 새로 들어온 그룹은 뺐어요', v: function (g) { return g.rankUp ? g.rankUp.movement : 0; }, per: function (g) { return g.rankUp ? [g.rankUp.period] : []; }, text: function (g) { return '#' + g.rankUp.prevRank + ' → #' + g.rankUp.rank + ' ▲' + g.rankUp.rawDelta + ' · ' + fmtSigned(g.rankUp.movementPct, 1) + '%p'; } },
    { key: 'rankDown', cat: 'movement', title: '단월 최대 순위 하락', unit: '%p', rule: '한 달 사이에 순위가 내려간 경우의 상대 위치(%p). 순위가 내려갔다고 인기가 떨어진 건 아니에요', v: function (g) { return g.rankDown ? -g.rankDown.movement : 0; }, per: function (g) { return g.rankDown ? [g.rankDown.period] : []; }, text: function (g) { return '#' + g.rankDown.prevRank + ' → #' + g.rankDown.rank + ' ▼' + (-g.rankDown.rawDelta) + ' · ' + fmtSigned(g.rankDown.movementPct, 1) + '%p'; } },
    { key: 'newPeaks', cat: 'movement', title: '자기 최고 경신 횟수', unit: '회', rule: '그때까지의 자기 최고 순위를 넘어선 횟수 (첫 기록 제외)', v: function (g) { return g.newPeaks.count; }, per: function (g) { return g.newPeaks.periods; }, text: function (g) { return pl(g.newPeaks.count, '회'); } },
    { key: 'tierUps', cat: 'movement', title: '티어 승격 횟수', unit: '회', rule: '지난달보다 티어가 오른 횟수', v: function (g) { return g.tierUps.count; }, per: function (g) { return g.tierUps.periods; }, text: function (g) { return pl(g.tierUps.count, '회'); } },
    { key: 'riseStreak', cat: 'movement', title: '최장 연속 상승', unit: '개월', rule: '매달 순위가 계속 오른 가장 긴 구간', v: function (g) { return g.riseStreak ? g.riseStreak.length : 0; }, per: function (g) { return g.riseStreak ? g.riseStreak.periods : []; }, text: function (g) { return pl(g.riseStreak.length, '개월'); } },
    { key: 'months', cat: 'longevity', title: '평가 기록 개월 수', unit: '개월', rule: '기록에 나온 달 수. 실제 활동 기간과 다를 수 있어요', v: function (g) { return g.months; }, per: function (g) { return []; }, text: function (g) { return pl(g.months, '개월') + ' · 커버리지 ' + Math.round((g.coverage || 0) * 100) + '%'; }, tie: function (g) { return mi(g.first); } },
    { key: 'sTierMonths', cat: 'longevity', title: 'S+ / S 체류 개월', unit: '개월', rule: 'S+ 또는 S 티어였던 달 수', v: function (g) { return g.tierMonths.sTier.length; }, per: function (g) { return g.tierMonths.sTier; }, text: function (g) { return pl(g.tierMonths.sTier.length, '개월'); } },
    { key: 'aPlusMonths', cat: 'longevity', title: 'A+ 이상 체류 개월', unit: '개월', rule: 'A+ 이상(S+·S·A+) 티어였던 달 수', v: function (g) { return g.tierMonths.aPlus.length; }, per: function (g) { return g.tierMonths.aPlus; }, text: function (g) { return pl(g.tierMonths.aPlus.length, '개월'); } }
  ];
  var CATEGORIES = [{ key: 'rank', label: '순위' }, { key: 'score', label: '점수' }, { key: 'movement', label: '변동' }, { key: 'longevity', label: '꾸준함' }];

  function filterRange(snaps, range) {
    if (!range || range === 'all') return snaps;
    return snaps.filter(function (s) { return String(s.meta.period).slice(0, 4) === String(range); });
  }

  // 같은 국가의 snapshot 배열 전체 → {groups, boards, periods, versions}
  function computeRecords(country, snapshots, opts) {
    opts = opts || {};
    var snaps = filterRange(sortSnapshots(snapshots), opts.range);
    var pops = {}, byId = Object.create(null), names = {};
    snaps.forEach(function (s) {
      pops[s.meta.period] = s.groups.length;
      s.groups.forEach(function (g) {
        (byId[g.id] = byId[g.id] || []).push({ period: s.meta.period, group: g.group, rank: g.rank, tier: g.tier, score: g.score, metrics: g.metrics });
      });
    });
    var groups = Object.keys(byId).map(function (id) {
      var r = computeGroupRecord(country, byId[id], pops, snaps.length, opts.breaks); r.id = id; return r;
    }).sort(function (a, b) { return idCmp(a.id, b.id); });
    var boards = BOARDS.map(function (b) {
      var rows = groups.map(function (g) { return { g: g, v: b.v(g) }; }).filter(function (x) { return x.v > 0; });
      rows.sort(function (x, y) {
        var d = b.asc ? x.v - y.v : y.v - x.v; if (d) return d;
        if (b.tie) { var t = b.tie(x.g) - b.tie(y.g); if (t) return t; }
        return idCmp(x.g.id, y.g.id);
      });
      var out = [], pos = 0, prev = null, prevTie = null;
      rows.forEach(function (x, i) {
        var tv = b.tie ? b.tie(x.g) : null;
        if (x.v !== prev || tv !== prevTie) { pos = i + 1; prev = x.v; prevTie = tv; }
        out.push({ pos: pos, id: x.g.id, group: x.g.group, value: x.v, text: b.text(x.g), periods: b.per(x.g) });
      });
      return { key: b.key, cat: b.cat, title: b.title, unit: b.unit, rule: b.rule, rows: out.filter(function (r) { return r.pos <= 10; }), total: out.length };
    });
    var pset = {}; snaps.forEach(function (s) { pset[s.meta.period] = 1; });
    var used = (opts.breaks || []).filter(function (x) { return pset[x.from] && pset[x.to]; }); // 이 범위 안에서 실제로 적용된 경계
    return { country: country, range: opts.range || 'all', periods: snaps.map(function (s) { return s.meta.period; }), groups: groups, boards: boards, versions: versionBoundaries(snaps), breaks: used };
  }

  /* ---------- 버전 경계 ----------
   * 직접 비교가 깨지는 기준은 normalization_version(percentile 의미). algorithm_version/map_version 은
   * '둘 다 기록되어 있고 서로 다를 때만' 경계로 본다(과거 snapshot 에 없는 값은 억지로 채우지 않는다). */
  function versionBoundaries(snaps) {
    var out = [], prev = null;
    sortSnapshots(snaps).forEach(function (s) {
      var m = s.meta || {};
      if (prev) {
        var diff = [];
        ['normalization_version', 'algorithm_version', 'map_version'].forEach(function (k) {
          if (prev.meta[k] !== undefined && m[k] !== undefined && prev.meta[k] !== m[k]) diff.push({ field: k, from: prev.meta[k], to: m[k] });
        });
        if (diff.length) out.push({ from: prev.meta.period, to: m.period, diff: diff });
      }
      prev = s;
    });
    return out;
  }

  /* ---------- EDITOR'S WATCH ----------
   * 취향으로 고르지 않고 객관 규칙에 맞는 그룹만 근거 수치와 함께 낸다. 이어진 4개월(period 포함)이 있어야 한다. */
  var WATCH_RULES = [
    { key: 'climber', title: '3개월 연속 상승', rule: '최근 3개월 연속으로 순위가 올랐어요' },
    { key: 'scoreStreak', title: '점수 연속 상승', rule: '최근 3개월 연속으로 총점이 올랐어요' },
    { key: 'peakRun', title: '연속 자기 최고 경신', rule: '최근 3개월 안에 자기 최고 순위를 2번 이상 경신했어요' },
    { key: 'tierHold', title: '티어 유지', rule: '최근 6개월 안에 티어가 오른 뒤 2개월 넘게 그 티어를 지켰어요' }
  ];
  function computeEditorsWatch(country, snapshots, period, breaks) {
    var snaps = sortSnapshots(snapshots).filter(function (s) { return mi(s.meta.period) <= mi(period); });
    var last = snaps[snaps.length - 1];
    var empty = { ready: false, cards: [], rules: WATCH_RULES, reason: '' };
    if (!last || last.meta.period !== period) { empty.reason = '고른 달 기록이 없어요'; return empty; }
    var win = snaps.slice(-4);
    if (win.length < 4 || !win.every(function (s, i) { return i === 0 || isConsecutiveMonth(win[i - 1].meta.period, s.meta.period); })) {
      empty.reason = '이어진 4개월 기록이 있어야 계산할 수 있어요'; return empty;
    }
    if (win.some(function (s, i) { return i > 0 && excluded(breaks, win[i - 1].meta.period, s.meta.period); })) {
      empty.reason = '최근 4개월 안에 점수가 크게 뒤바뀐 구간이 있어서 계산하지 않아요'; return empty;
    }
    var pops = {}; snaps.forEach(function (s) { pops[s.meta.period] = s.groups.length; });
    var cards = [];
    last.groups.forEach(function (g) {
      var hist = groupHistoryUntil(snaps, g.id, period), byP = {}; hist.forEach(function (h) { byP[h.period] = h; });
      var seq = win.map(function (s) { return byP[s.meta.period] || null; });
      // 이어진 3개 구간
      if (seq.every(Boolean)) {
        var iv = [1, 2, 3].map(function (i) {
          var c = compareEntries(seq[i - 1], seq[i], pops[win[i - 1].meta.period], pops[win[i].meta.period], true);
          return { from: win[i - 1].meta.period, to: win[i].meta.period, prevRank: seq[i - 1].rank, rank: seq[i].rank, rawDelta: c.rawDelta, movement: c.movement, movementPct: r1(c.movement), scoreDelta: c.scoreDelta };
        });
        if (iv.every(function (x) { return x.rawDelta > 0 && x.movement > 0; })) {
          cards.push({ rule: 'climber', id: g.id, group: g.group, rank: g.rank, tier: g.tier, key: iv.reduce(function (a, x) { return a + x.movement; }, 0),
            fact: '#' + seq[0].rank + ' → #' + seq[3].rank + ' (3개월 연속 상승)', detail: iv.map(function (x) { return fmtPeriod(x.to).slice(2) + ' ▲' + x.rawDelta + ' · ' + fmtSigned(x.movementPct, 1) + '%p'; }), intervals: iv });
        }
        if (iv.every(function (x) { return x.scoreDelta > 0; })) {
          var tot = r2(iv.reduce(function (a, x) { return a + x.scoreDelta; }, 0));
          cards.push({ rule: 'scoreStreak', id: g.id, group: g.group, rank: g.rank, tier: g.tier, key: tot,
            fact: seq[0].score + ' → ' + seq[3].score + '점 (' + fmtSigned(tot) + ')', detail: iv.map(function (x) { return fmtPeriod(x.to).slice(2) + ' ' + fmtSigned(x.scoreDelta); }), intervals: iv });
        }
      }
      // NEW PEAK: 이전 모든 기록보다 좋아진 달의 수 (최근 3개월 안)
      var peaks = [], best = null;
      hist.forEach(function (h) {
        if (best !== null && h.rank < best && mi(h.period) > mi(period) - 3) peaks.push(h);
        best = best === null ? h.rank : Math.min(best, h.rank);
      });
      if (peaks.length >= 2) cards.push({ rule: 'peakRun', id: g.id, group: g.group, rank: g.rank, tier: g.tier, key: peaks.length * 1000 - peaks[peaks.length - 1].rank, fact: '최근 3개월 중 ' + peaks.length + '번 최고 순위 경신', detail: peaks.map(function (h) { return fmtPeriod(h.period).slice(2) + ' #' + h.rank; }) });
      // TIER HOLD
      var k = -1;
      for (var i = 1; i < hist.length; i++) {
        if (isConsecutiveMonth(hist[i - 1].period, hist[i].period) && tierIdx(hist[i].tier) !== null && tierIdx(hist[i - 1].tier) !== null && tierIdx(hist[i].tier) < tierIdx(hist[i - 1].tier)) k = i;
      }
      if (k >= 0 && mi(hist[k].period) >= mi(period) - 6) {
        var held = 0, ok = true;
        for (var j = k + 1; j < hist.length && ok; j++) {
          if (isConsecutiveMonth(hist[j - 1].period, hist[j].period) && tierIdx(hist[j].tier) <= tierIdx(hist[k].tier)) held++; else ok = false;
        }
        if (held >= 2 && hist[hist.length - 1].period === period) cards.push({ rule: 'tierHold', id: g.id, group: g.group, rank: g.rank, tier: g.tier, key: held * 100 - tierIdx(hist[k].tier), fact: hist[k - 1].tier + ' → ' + hist[k].tier + ' (' + fmtPeriod(hist[k].period) + ') 이후 ' + held + '개월 유지', detail: [] });
      }
    });
    cards.sort(function (a, b) { return b.key - a.key || idCmp(a.id, b.id); });
    return { ready: true, cards: cards, rules: WATCH_RULES, reason: '' };
  }

  /* ---------- 과거 지도용 row 어댑터 ----------
   * snapshot.metrics → IdolRec.logicalPointsFromRows 가 읽는 DB row 형태. 현재 좌표를 재사용하지 않고 그 달 분포로 다시 계산하게 한다. */
  function snapshotToMapRows(country, snapshot) {
    if (!snapshot) return [];
    return snapshot.groups.map(function (g) {
      var m = g.metrics || {}, base = { id: g.id, '그룹': g.group, '티어': g.tier, '총점': g.score };
      if (country === 'KR') {
        base['국내음원'] = m.domestic_digital; base['음반·팬덤'] = m.album_fandom; base['공연'] = m.performance;
        base['글로벌'] = m.global; base['국내인지도'] = m.recognition; base['현재기세'] = m.momentum;
      } else {
        base['공연·현장'] = m.live; base['팬덤·구매력'] = m.fandom; base['대중인지도'] = m.recognition;
        base['스트리밍·SNS'] = m.streaming_sns; base['현재기세'] = m.momentum; base['업계영향력'] = m.industry;
      }
      return base;
    });
  }

  /* ---------- 데이터 품질 검사 ---------- */
  var PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function validateSnapshot(country, period, snap) {
    var errors = [], warnings = [], E = function (m) { errors.push(m); }, W = function (m) { warnings.push(m); };
    if (!snap || !snap.meta || !Array.isArray(snap.groups)) return { errors: ['meta/groups 가 없습니다'], warnings: [] };
    var m = snap.meta;
    if (m.country !== country) E('meta.country(' + m.country + ') != ' + country);
    if (!PERIOD_RE.test(m.period || '')) E('meta.period 형식 오류: ' + m.period);
    if (period && m.period !== period) E('meta.period(' + m.period + ') != 파일 기간(' + period + ')');
    if (!DATE_RE.test(m.published_at || '')) E('meta.published_at 형식 오류: ' + m.published_at);
    if (!isNum(m.population_count)) W('meta.population_count 없음'); else if (m.population_count !== snap.groups.length) W('population_count(' + m.population_count + ') != groups.length(' + snap.groups.length + ')');
    var defs = metricDefs(country), seen = Object.create(null), prefix = country + '-';
    snap.groups.forEach(function (g) {
      var t = (g && g.id) || '(id 없음)';
      if (!g || !g.id) { E('id 없는 그룹'); return; }
      if (seen[g.id]) E('중복 id: ' + g.id); seen[g.id] = 1;
      if (String(g.id).indexOf(prefix) !== 0) E(t + ': 국가 접두사가 ' + prefix + ' 가 아님');
      if (!isNum(g.rank) || g.rank < 1 || Math.floor(g.rank) !== g.rank) E(t + ': rank 오류 ' + g.rank);
      if (!isNum(g.score)) E(t + ': score 오류 ' + g.score);
      if (tierIdx(g.tier) === null) E(t + ': 알 수 없는 티어 ' + g.tier);
      var mm = g.metrics || {}, bad = defs.filter(function (d) { return !isNum(mm[d.key]); });
      if (bad.length) E(t + ': metric 누락 ' + bad.map(function (d) { return d.key; }).join(','));
      else {
        var over = defs.filter(function (d) { return mm[d.key] < 0 || mm[d.key] > d.max; });
        if (over.length) E(t + ': metric 범위 초과 ' + over.map(function (d) { return d.key + '=' + mm[d.key]; }).join(','));
        if (isNum(g.score) && Math.abs(defs.reduce(function (a, d) { return a + mm[d.key]; }, 0) - g.score) > 0.01) E(t + ': metric 합 != score');
      }
    });
    // 점수 순서와 rank 의 모순(더 높은 점수가 더 나쁜 순위)은 원본을 그대로 두되 알려 준다
    var byScore = snap.groups.slice().sort(function (a, b) { return b.score - a.score; });
    for (var i = 1; i < byScore.length; i++) if (byScore[i].score < byScore[i - 1].score && byScore[i].rank < byScore[i - 1].rank) { W('점수와 순위 순서 모순: ' + byScore[i - 1].id + ' / ' + byScore[i].id); break; }
    return { errors: errors, warnings: warnings };
  }
  function validateIndex(periods) {
    var errors = [], seen = Object.create(null);
    (periods || []).forEach(function (p, i) {
      if (!PERIOD_RE.test(p)) errors.push('잘못된 period: ' + p);
      if (seen[p]) errors.push('중복 period: ' + p); seen[p] = 1;
      if (i > 0 && mi(p) <= mi(periods[i - 1])) errors.push('period 오름차순 위반: ' + periods[i - 1] + ' → ' + p);
    });
    return errors;
  }

  global.HistoryAnalytics = {
    TIERS: TIERS, METRICS: METRICS, COUNTRY_NAME: COUNTRY_NAME, BOARDS: BOARDS, CATEGORIES: CATEGORIES, WATCH_RULES: WATCH_RULES,
    isConsecutiveMonth: isConsecutiveMonth, monthsBetween: monthsBetween, previousPeriod: previousPeriod, nextPeriod: nextPeriod, periodRange: periodRange, sortPeriods: sortPeriods, sortSnapshots: sortSnapshots,
    entryById: entryById, population: population, metricDefs: metricDefs, metricDelta: metricDelta,
    compareEntries: compareEntries, compareSnapshots: compareSnapshots, computeMovers: computeMovers,
    groupHistoryUntil: groupHistoryUntil, computeStreaks: computeStreaks, computeGroupRecord: computeGroupRecord, computeRecords: computeRecords, versionBoundaries: versionBoundaries,
    computeEditorsWatch: computeEditorsWatch, snapshotToMapRows: snapshotToMapRows, isBreakInterval: isBreakInterval, breaksIn: breaksIn,
    validateSnapshot: validateSnapshot, validateIndex: validateIndex,
    fmtSigned: fmtSigned, fmtPeriod: fmtPeriod, tierIdx: tierIdx, r1: r1
  };
})(window);
