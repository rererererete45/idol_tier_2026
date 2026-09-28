/* IDOL RECOMMENDATION CORE V2 — IDOL MAP 논리 좌표 + SAME SCENE + DISCOVER 공통 엔진
 * (SAME_SCENE_DISCOVER_SPEC.md + IDOL_ALGORITHM_V2_SPEC.md)
 * - 정규화·스타일 유사도·결측 처리·최애 저장은 window.IdolMatch 를 그대로 재사용한다(중복 구현 없음).
 * - 결측값은 50 으로 채우지 않는다: 관측된 component 만 쓰고 weight 를 재정규화하며 coverage/confidence 를 따로 계산한다.
 * - IDOL MAP 의 logical coordinate(지터/충돌 보정 전, screen 좌표와 분리)는 여기서 한 번만 계산한다.
 *   지도 좌표는 SAME SCENE 점수에 다시 넣지 않는다(4축 profile 을 한 번만 센다).
 * - 모든 정렬은 입력 배열 순서에 의존하지 않는 결정적 tie-break 를 가진다.
 * - window.IdolRec 로만 노출한다. */
(function (global) {
  'use strict';
  var IM = global.IdolMatch;
  var U = IM.util;

  var RECENT_KEY = 'idolTierRecentDiscoveries', RECENT_MAX = 20;
  var HISTORY_KEY = 'idolTierDiscoveryHistory', HISTORY_MAX = 50;
  var CENTER_TOLERANCE = 12;

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function idCmp(a, b) { return String(a).localeCompare(String(b)); }

  /* ---------- 난수 (운영: crypto, 테스트: ?seed=1234 로 재현) ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function cryptoRandom() {
    try { var a = new Uint32Array(1); global.crypto.getRandomValues(a); return a[0] / 4294967296; } catch (e) { return Math.random(); }
  }
  var rng = cryptoRandom, seeded = false;
  function setSeed(n) { if (n === null || n === undefined || n === '') { rng = cryptoRandom; seeded = false; } else { rng = mulberry32(Number(n)); seeded = true; } }
  try { var sp = new URLSearchParams(global.location.search).get('seed'); if (sp !== null && sp !== '') setSeed(sp); } catch (e0) { /* noop */ }
  function getRng() { return rng; }

  /* ---------- IDOL MAP 논리 좌표 (idol-map.js 가 재사용) ---------- */
  var MAP_KEYS = {
    KR: { pub: [['국내음원', 0.55], ['국내인지도', 0.45]], fan: [['음반·팬덤', 1]], live: [['공연', 1]], dig: [['국내음원', 0.55], ['글로벌', 0.45]], mom: '현재기세' },
    JP: { pub: [['대중인지도', 0.60], ['스트리밍·SNS', 0.40]], fan: [['팬덤·구매력', 1]], live: [['공연·현장', 1]], dig: [['스트리밍·SNS', 1]], mom: '현재기세' }
  };

  function median(v) {
    var a = v.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mad(v) { var med = median(v); return median(v.map(function (x) { return Math.abs(x - med); })); }
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function iqr(v) { var s = v.slice().sort(function (a, b) { return a - b; }); return quantile(s, 0.75) - quantile(s, 0.25); }
  function std(v) { var m = mean(v); return Math.sqrt(mean(v.map(function (x) { return (x - m) * (x - m); }))); }
  // 동점이 많아 MAD 가 0 이어도 지도 전체가 중앙으로 붕괴하지 않도록: MAD → IQR/1.349 → 표준편차 → 0
  function robustScaleInfo(value, values) {
    var med = median(values), m = mad(values);
    if (m > 1e-9) return { z: (value - med) / (1.4826 * m), method: 'MAD' };
    var iq = iqr(values);
    if (iq > 1e-9) return { z: (value - med) / (iq / 1.349), method: 'IQR' };
    var sd = std(values);
    if (sd > 1e-9) return { z: (value - mean(values)) / sd, method: 'SD' };
    return { z: 0, method: 'none' };
  }
  function robustScale(value, values) { return robustScaleInfo(value, values).z; }
  var robustZ = robustScale; // 하위 호환 이름

  function toScreenPosition(zX, zY) {
    var x = 50 + 44 * Math.tanh(zX / 1.4), y = 50 - 44 * Math.tanh(zY / 1.4);
    return { x: Math.max(6, Math.min(94, x)), y: Math.max(6, Math.min(94, y)) };
  }
  // zone 은 항상 jitter/collision 보정 전 logical 위치로 분류한다
  function classifyMapZone(x, y) {
    var dx = x - 50, dy = 50 - y; // dy>0 = 위(라이브)
    if (Math.abs(dx) <= CENTER_TOLERANCE && Math.abs(dy) <= CENTER_TOLERANCE) return 'BALANCED';
    if (dy >= 0) return dx >= 0 ? 'STAGE STAR' : 'CORE LIVE';
    return dx >= 0 ? 'PUBLIC HIT' : 'CORE DIGITAL';
  }
  function weighted(pairs, P) { return pairs.reduce(function (a, p) { return a + P(p[0]) * p[1]; }, 0); }

  var logicalCache = {};
  // logicalX/logicalY: 0~100 (오른쪽=대중, 위=라이브). baseX/baseY 는 같은 위치의 지도 화면 %(y 아래로 증가).
  // screenX/screenY(지터·충돌 보정 후)는 idol-map.js 에서만 만들고 추천·시계열 계산에는 쓰지 않는다.
  function logicalPoints(country) {
    if (logicalCache[country]) return logicalCache[country];
    var rows = IM.getRaw(country), cfg = MAP_KEYS[country], need = [];
    ['pub', 'fan', 'live', 'dig'].forEach(function (k) { cfg[k].forEach(function (p) { if (need.indexOf(p[0]) === -1) need.push(p[0]); }); });
    need.push(cfg.mom, '총점');
    var valid = rows.filter(function (r) { return need.every(function (k) { return U.toFiniteNumber(r[k]) !== null; }); });
    var maps = {};
    need.forEach(function (k) { maps[k] = valid.map(function (r) { return Number(r[k]); }); });
    var pts = valid.map(function (r) {
      var P = function (k) { return IM.percentileRank(Number(r[k]), maps[k]); };
      var pub = weighted(cfg.pub, P), fan = weighted(cfg.fan, P), live = weighted(cfg.live, P), dig = weighted(cfg.dig, P);
      return {
        id: r.id, key: country + '|' + r['그룹'], group: r['그룹'], country: country, tier: r['티어'], totalScore: Number(r['총점']),
        pub: pub, fan: fan, live: live, dig: dig, mom: P(cfg.mom), totalPercentile: P('총점'), xRaw: pub - fan, yRaw: live - dig
      };
    });
    var xs = pts.map(function (p) { return p.xRaw; }), ys = pts.map(function (p) { return p.yRaw; });
    pts.forEach(function (p) {
      var sx = robustScaleInfo(p.xRaw, xs), sy = robustScaleInfo(p.yRaw, ys);
      p.zX = sx.z; p.zY = sy.z; p.scaleMethodX = sx.method; p.scaleMethodY = sy.method;
      var s = toScreenPosition(p.zX, p.zY);
      p.baseX = s.x; p.baseY = s.y; p.logicalX = s.x; p.logicalY = 100 - s.y; p.mapX = p.logicalX; p.mapY = p.logicalY;
      p.zone = classifyMapZone(s.x, s.y);
    });
    logicalCache[country] = { points: pts, excluded: rows.length - valid.length, population: valid.length };
    return logicalCache[country];
  }

  /* ---------- 엔티티(그룹/최애 프로필 공통 입력 벡터) ---------- */
  var entCache = {};
  function entityOf(country, idOrName) {
    var g = IM.getGroup(country, idOrName);
    if (!g) return null;
    if (entCache[g.id]) return entCache[g.id];
    var pos = null, L = logicalPoints(g.country).points;
    for (var i = 0; i < L.length; i++) if (L[i].id === g.id) { pos = L[i]; break; }
    var e = {
      key: g.country + '|' + g.name, id: g.id, name: g.name, country: g.country, tier: g.tier, total: g.total, status: g.status, group: g,
      styleTags: g.styleTags, styleRaw: g.styleRaw, spotify: g.spotify, slug: g.slug,
      fandom: g.vec.fandom, live: g.vec.live, digital: g.vec.digital, popularity: g.vec.popularity, momentum: g.vec.momentum, vec: g.vec,
      logicalX: pos ? pos.logicalX : null, logicalY: pos ? pos.logicalY : null, mapX: pos ? pos.logicalX : null, mapY: pos ? pos.logicalY : null,
      zone: pos ? pos.zone : '', totalPercentile: g.totalPct,
      gen: g.gen, lineage: g.lineage, activityType: g.activityType, verification: g.verification,
      completeness: g.completeness, verificationWeight: g.verificationWeight, dataConfidence: g.dataConfidence
    };
    entCache[g.id] = e;
    return e;
  }
  function entitiesOf(country) { return (IM.getGroups(country) || []).map(function (g) { return entityOf(country, g.id); }).filter(Boolean); }
  function entityById(id) { var g = IM.getGroupById(id); return g ? entityOf(g.country, g.id) : null; }
  function isActive(e) { return U.isActive(e); }
  // 발견 후보: 활동종료/해산 외에 '무기한 휴지·시즌 종료·장기 공백·상태 미확인'으로 시작하는 상태도 제외한다.
  var NOT_DISCOVERABLE = /^(무기한 활동휴지|시즌1 종료|3인 재편 후 장기 공백|활동 확인 필요)/;
  function isDiscoverable(e) { return isActive(e) && !NOT_DISCOVERABLE.test(e.status || ''); }

  /* ---------- SAME SCENE V2 ---------- */
  // 스타일 45 / 4축 profile 35 / 현재기세 5 / 체급(총점 백분위) 5. 세대·계열은 점수가 아니라 동점 보정(+2/+3, 기준 통과 후에만).
  // 지도 좌표는 점수에 넣지 않는다 — 같은 4축 정보를 두 번 세는 중복가중을 없앤다.
  var SCENE_W = { style: 0.45, profile: 0.35, momentum: 0.05, scale: 0.05 };
  var PROFILE_DIMS = ['popularity', 'fandom', 'live', 'digital'];
  var BONUS_GATE = { base: 62, style: 45 };
  var SCENE_MIN = { coverage: 0.55, score: 50 };

  // 4축(대중성·팬덤·라이브·디지털)을 하나의 다차원 거리로: 100 - sqrt(mean(diff²)). 2축 미만이면 결측.
  function profileSimilarity(a, b) {
    var d = [];
    PROFILE_DIMS.forEach(function (k) { if (isNum(a[k]) && isNum(b[k])) d.push(a[k] - b[k]); });
    if (d.length < 2) return null;
    return Math.max(0, 100 - Math.sqrt(mean(d.map(function (x) { return x * x; }))));
  }
  function mapSimilarity(a, b) { // 설명/시각화 전용(점수에 사용하지 않음)
    var ax = a.logicalX, ay = a.logicalY, bx = b.logicalX, by = b.logicalY;
    if (![ax, ay, bx, by].every(isNum)) return null;
    return Math.max(0, 100 - Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)) / Math.sqrt(20000) * 100);
  }
  function numericSimilarity(a, b) { return U.calculateNumericSimilarity(a, b); }

  function tieBreakBonus(a, b) {
    if (a.country === 'KR' && b.country === 'KR' && a.gen && a.gen === b.gen) return 2;
    if (a.country === 'JP' && b.country === 'JP' && a.lineage && a.lineage === b.lineage && !/기타|독립|^—$/.test(a.lineage)) return 3;
    return 0;
  }
  function sceneComponents(a, b) {
    return [
      U.comp('style', U.calculateStyleSimilarity(a.styleTags, b.styleTags, a.tagWeights), SCENE_W.style),
      U.comp('profile', profileSimilarity(a, b), SCENE_W.profile),
      U.comp('momentum', numericSimilarity(a.momentum, b.momentum), SCENE_W.momentum),
      U.comp('scale', numericSimilarity(a.totalPercentile, b.totalPercentile), SCENE_W.scale)
    ];
  }
  function dcOf(e) { return isNum(e.dataConfidence) ? e.dataConfidence : 1; }
  // 결과: score(유사도) ↔ confidence(신뢰도) 분리, rankingScore 는 신뢰도로 약하게만 보정
  function sceneResult(a, b) {
    var comps = sceneComponents(a, b), agg = U.weightedObservedAverage(comps), bd = {};
    comps.forEach(function (c) { bd[c.name] = c.available ? c.score : null; });
    var base = agg.score, bonus = 0;
    if (base !== null && base >= BONUS_GATE.base && isNum(bd.style) && bd.style >= BONUS_GATE.style) bonus = tieBreakBonus(a, b);
    var raw = base === null ? null : Math.min(100, base + bonus);
    var conf = base === null ? 0 : Math.min(1, agg.coverage) * Math.sqrt(dcOf(a) * dcOf(b));
    return {
      group: b, raw: raw, base: base, bonus: bonus, score: raw === null ? null : Math.min(100, Math.round(raw)), coverage: agg.coverage, confidence: conf,
      rankingScore: raw === null ? -1 : raw * (0.85 + 0.15 * conf), breakdown: bd, components: comps, diversityPenalty: 0
    };
  }
  function calculateSameSceneBreakdown(a, b) { return sceneResult(a, b).breakdown; }
  function calculateSameSceneScore(a, b) { return sceneResult(a, b).score; }

  var REASON_ORDER = [['style', 70], ['profile', 85], ['scale', 88], ['momentum', 85]];
  var AXIS_NAME = { popularity: '대중성', fandom: '팬덤', live: '라이브', digital: '디지털' };
  var REASON_LEAD = {
    style: '음악·콘셉트가 비슷한 팀입니다.', profile: '시장 성향(팬덤·라이브·디지털·대중성)이 비슷한 팀입니다.',
    scale: '체급이 비슷한 팀입니다.', momentum: '현재 기세가 비슷한 흐름의 팀입니다.'
  };
  var REASON_MORE = {
    style: '음악·콘셉트도 닮았습니다.', profile: '시장 성향도 가깝습니다.', scale: '체급도 비슷합니다.', momentum: '현재 기세도 비슷한 흐름입니다.'
  };
  // 최대 2문장. 우선순위: 스타일 > 시장 성향 > 체급 > 기세. 시장 성향이 맞으면 특히 가까운 축을 짚어 준다.
  function generateSameSceneReason(b, a, t) {
    var hit = REASON_ORDER.filter(function (r) { return isNum(b[r[0]]) && b[r[0]] >= r[1]; }).map(function (r) { return r[0]; });
    if (!hit.length) return ['전반적인 성향이 고르게 닮은 팀입니다.'];
    var out = [];
    if (hit.indexOf('style') !== -1 && hit.indexOf('profile') !== -1) {
      out.push('음악·콘셉트와 시장 성향이 비슷한 팀입니다.');
      hit = hit.filter(function (k) { return k !== 'style' && k !== 'profile'; });
      if (hit.length) out.push(REASON_MORE[hit[0]]);
    } else {
      out.push(REASON_LEAD[hit[0]]);
      if (hit.length > 1) out.push(REASON_MORE[hit[1]]);
    }
    if (out.length < 2 && a && t && isNum(b.profile) && b.profile >= 85) {
      var close = PROFILE_DIMS.filter(function (k) { return isNum(a[k]) && isNum(t[k]) && Math.abs(a[k] - t[k]) <= 8; })
        .sort(function (x, y) { return Math.abs(a[x] - t[x]) - Math.abs(a[y] - t[y]) || (x < y ? -1 : 1); }).slice(0, 2);
      if (close.length) out.push(close.map(function (k) { return AXIS_NAME[k]; }).join('·') + ' 성향이 특히 가까운 편입니다.');
    }
    return out.slice(0, 2);
  }
  function sceneTags(src, tgt) {
    var shared = tgt.styleTags.filter(function (t) { return src.styleTags.indexOf(t) !== -1; });
    var rest = tgt.styleTags.filter(function (t) { return shared.indexOf(t) === -1; });
    return shared.concat(rest).filter(function (t) { return t !== '세련됨'; }).slice(0, 3);
  }
  function decorateScene(src, m) {
    var tgt = m.group;
    m.reasons = generateSameSceneReason(m.breakdown, src, tgt);
    m.tags = sceneTags(src, tgt);
    m.limited = m.coverage < 0.70 || m.confidence < 0.6;
    m.confidenceLabel = U.confidenceLabel(m.confidence);
    m.debug = {
      usedWeights: m.components.filter(function (c) { return c.available; }).map(function (c) { return [c.name, +c.weight.toFixed(3)]; }),
      missing: m.components.filter(function (c) { return !c.available; }).map(function (c) { return c.name; }),
      coverage: +m.coverage.toFixed(3), confidence: +m.confidence.toFixed(3), base: m.base === null ? null : +m.base.toFixed(2), bonus: m.bonus,
      rankingScore: +m.rankingScore.toFixed(2), diversityPenalty: m.diversityPenalty, tieBreak: '보정점수→신뢰도→스타일→id'
    };
    return m;
  }
  function rankScene(src, pool) {
    return pool.map(function (t) { return sceneResult(src, t); }).filter(function (m) { return m.score !== null; }).sort(U.compareResults);
  }
  function passesScene(m) { return m.coverage >= SCENE_MIN.coverage && m.score >= SCENE_MIN.score; }

  // 취향 확장: score>=65 && style>=55 && profile>=45, TOP 과 중복 제외. 완전히 같은 팀보다 약간 다른 팀 우선.
  function getTasteExpansionMatches(ranked, excludeNames, limit) {
    return ranked.filter(function (m) {
      return excludeNames.indexOf(m.group.name) === -1 && m.score >= 65 && isNum(m.breakdown.style) && m.breakdown.style >= 55 && isNum(m.breakdown.profile) && m.breakdown.profile >= 45;
    }).map(function (m) { m.expandScore = m.score - Math.max(0, m.breakdown.profile - 92); return m; })
      .sort(function (x, y) { return (y.expandScore - x.expandScore) || U.compareResults(x, y); }).slice(0, limit || 3);
  }

  function getSameSceneMatches(country, name, opts) {
    opts = opts || {};
    var src = entityOf(country, name);
    if (!src) return null;
    var pool = entitiesOf(country).filter(function (e) { return e.id !== src.id && (opts.includeEnded || isActive(e)); });
    var ranked = rankScene(src, pool);
    var top = U.diversify(ranked.filter(passesScene), opts.limit || 3).map(function (m) { return decorateScene(src, m); });
    var expand = getTasteExpansionMatches(ranked, top.map(function (m) { return m.group.name; }), opts.expandLimit || 3).map(function (m) { return decorateScene(src, m); });
    return { source: src, country: country, top: top, expand: expand };
  }

  /* ---------- 저장소 (최근 발견 / 발견 기록) ---------- */
  function readList(key) {
    try { var v = JSON.parse(global.localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function writeList(key, v) { try { global.localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } }
  function loadRecentDiscoveries() { return readList(RECENT_KEY); }
  function saveRecentDiscovery(id) {
    var l = loadRecentDiscoveries().filter(function (x) { return x !== id; });
    l.unshift(id); writeList(RECENT_KEY, l.slice(0, RECENT_MAX));
  }
  function loadDiscoveryHistory() { return readList(HISTORY_KEY); }
  function saveDiscoveryHistory(entry) {
    var l = loadDiscoveryHistory(); l.unshift(entry); writeList(HISTORY_KEY, l.slice(0, HISTORY_MAX));
  }
  function clearDiscoveryHistory() { writeList(RECENT_KEY, []); writeList(HISTORY_KEY, []); }

  // 장기 노출 편향 보정: 발견 기록(최근 50개)에서 그룹별 노출 횟수 → 1/sqrt(1+count)
  function exposureCounts() {
    var c = {}; loadDiscoveryHistory().forEach(function (h) { if (h && h.id) c[h.id] = (c[h.id] || 0) + 1; }); return c;
  }
  function noveltyWeight(id, counts) { return 1 / Math.sqrt(1 + ((counts || exposureCounts())[id] || 0)); }

  /* ---------- DISCOVER V2 ---------- */
  function weightedRandom(items, weightFn, r) {
    var rr = r || rng;
    if (!items.length) return null;
    var ws = items.map(function (it) { var w = weightFn(it); return isNum(w) && w > 0 ? w : 0; }), sum = ws.reduce(function (a, b) { return a + b; }, 0);
    if (!sum) return items[Math.floor(rr() * items.length)];
    var x = rr() * sum;
    for (var i = 0; i < items.length; i++) { x -= ws[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  }

  function favoriteEntities() {
    return IM.getFavorites().map(function (f) { return entityOf(f.country, f.id || f.group); }).filter(Boolean);
  }
  function axisValues(e) { return PROFILE_DIMS.map(function (k) { return e[k]; }).filter(isNum); }
  function maxAxis(e) { var v = axisValues(e); return v.length ? Math.max.apply(null, v) : 0; }
  function topAxisMean(e) { var v = axisValues(e).sort(function (a, b) { return b - a; }).slice(0, 2); return v.length ? mean(v) : 0; }
  function strongAxisCount(e, th) { return axisValues(e).filter(function (x) { return x >= th; }).length; }

  // 최애 평균 프로필(하위 호환 표시용). 추천 채점은 최애별 유사도(best/top2)로 한다.
  function buildFavoriteTasteProfile(favEntities) {
    if (!favEntities.length) return null;
    var base = U.buildFavoriteTasteProfile(favEntities.map(function (e) { return e.group; }));
    var avg = function (k) { var v = favEntities.map(function (e) { return e[k]; }).filter(isNum); return v.length ? mean(v) : null; };
    return {
      country: '', styleTags: base.styleTags, tagWeights: base.tagWeights,
      popularity: base.vec.popularity, fandom: base.vec.fandom, live: base.vec.live, digital: base.vec.digital, momentum: base.vec.momentum,
      logicalX: avg('logicalX'), logicalY: avg('logicalY'), mapX: avg('logicalX'), mapY: avg('logicalY'), gen: '', lineage: '', totalPercentile: avg('totalPercentile'),
      dataConfidence: avg('dataConfidence')
    };
  }

  // profileScore = 가장 잘 맞는 최애 0.55 + 상위 2개 평균 0.45 (단일 centroid 로 뭉개지 않는다)
  function profileScoreVs(favs, cand) {
    var per = favs.map(function (f) { var m = sceneResult(f, cand); m.fav = f; return m; }).filter(function (m) { return m.score !== null; });
    if (!per.length) return null;
    per.sort(function (a, b) { return (b.raw - a.raw) || idCmp(a.fav.id, b.fav.id); });
    var top2 = mean(per.slice(0, 2).map(function (m) { return m.raw; })), raw = per[0].raw * 0.55 + top2 * 0.45;
    var conf = mean(per.map(function (m) { return m.confidence; }));
    return { ent: cand, raw: raw, score: Math.round(raw), coverage: mean(per.map(function (m) { return m.coverage; })), confidence: conf, breakdown: per[0].breakdown, best: per[0] };
  }
  function scoreVsProfile(favsOrProfile, pool) { // 하위 호환 이름
    var favs = Array.isArray(favsOrProfile) ? favsOrProfile : [];
    return pool.map(function (e) { return profileScoreVs(favs, e); }).filter(Boolean).map(function (m) { return { ent: m.ent, score: m.score, breakdown: m.breakdown, raw: m.raw }; });
  }

  // 국가 범위(ALL/KR/JP) + 발견 가능 + 최애 제외 + 최근 발견 제외
  function getDiscoverPool(scope, opts) {
    opts = opts || {};
    var favIds = {}, recent = opts.ignoreRecent ? [] : loadRecentDiscoveries();
    IM.getFavorites().forEach(function (f) { var e = entityOf(f.country, f.id || f.group); if (e) favIds[e.id] = 1; });
    var list = [];
    if (scope === 'KR' || scope === 'ALL' || !scope) list = list.concat(entitiesOf('KR'));
    if (scope === 'JP' || scope === 'ALL' || !scope) list = list.concat(entitiesOf('JP'));
    return list.filter(function (e) { return isDiscoverable(e) && !favIds[e.id] && recent.indexOf(e.id) === -1; })
      .sort(function (a, b) { return idCmp(a.id, b.id); }); // 입력 순서와 무관한 결정적 순서
  }

  // HOT 신호(월별 history): {id: {movement, scoreDelta, newPeak, tierUp}} — RankHistory.deltasFromSnapshots 결과를 그대로 받는다.
  var hotSignals = null;
  function setHotSignals(map) { hotSignals = map && Object.keys(map).length ? map : null; }
  function hasHotHistory() {
    if (!hotSignals) return false;
    return Object.keys(hotSignals).some(function (k) { return isNum(hotSignals[k].movement); });
  }
  // 현재기세 50 / 순위 위치 백분위 상승 25 / 점수 상승 15 / NEW PEAK·티어 상승 10. history 가 없는 component 는 제외 후 재정규화.
  function hotComponents(e) {
    var s = hotSignals && hotSignals[e.id];
    return [
      U.comp('momentum', e.momentum, 0.50),
      U.comp('rankMovement', s && isNum(s.movement) ? clamp(Math.max(0, s.movement) * 5, 0, 100) : null, 0.25),
      U.comp('scoreChange', s && isNum(s.scoreDelta) ? clamp(Math.max(0, s.scoreDelta) * 20, 0, 100) : null, 0.15),
      U.comp('peakOrTier', s && (s.newPeak !== null && s.newPeak !== undefined) ? ((s.newPeak || s.tierUp) ? 100 : 0) : null, 0.10)
    ];
  }
  function hotScore(e) {
    var comps = hotComponents(e), agg = U.weightedObservedAverage(comps);
    return { score: agg.score === null ? 0 : agg.score, coverage: agg.coverage, components: comps };
  }

  var HIDDEN_GEM = { coverage: 0.70, verification: 0.65, totalPct: 70, strong: 75, one: 90 };
  function gemBase(e) { return e.completeness >= HIDDEN_GEM.coverage && e.verificationWeight >= HIDDEN_GEM.verification && isNum(e.totalPercentile); }

  var PICK = {
    random: function (ctx) {
      var e = weightedRandom(ctx.pool, function (x) { return ctx.novelty(x.id); }, ctx.rng);
      return e && { ent: e, debug: { novelty: +ctx.novelty(e.id).toFixed(3) } };
    },
    taste: function (ctx) {
      if (ctx.favs.length < 2) return null;
      var groups = ctx.favs, cluster = null;
      var cl = ctx.favs.length >= 5 ? U.clusterFavorites(ctx.favs.map(function (f) { return f.group; })) : null;
      if (cl) {
        var c = weightedRandom(cl, function (x) { return x.members.length; }, ctx.rng);
        cluster = { key: c.key, label: c.label };
        groups = c.members.map(function (g) { return entityOf(g.country, g.id); }).filter(Boolean);
      }
      var scored = ctx.pool.map(function (e) { return profileScoreVs(groups, e); }).filter(Boolean)
        .filter(function (m) { return m.coverage >= 0.55; })
        .sort(function (a, b) { return (b.raw - a.raw) || (b.confidence - a.confidence) || idCmp(a.ent.id, b.ent.id); }).slice(0, ctx.topK);
      var pick = weightedRandom(scored, function (m) { return Math.pow(m.score / 100, 3) * ctx.novelty(m.ent.id); }, ctx.rng); // TOP1 고정 금지
      return pick && { ent: pick.ent, score: pick.score, breakdown: pick.breakdown, cluster: cluster, confidence: pick.confidence, coverage: pick.coverage,
        debug: { candidates: scored.length, novelty: +ctx.novelty(pick.ent.id).toFixed(3), cluster: cluster && cluster.label } };
    },
    hiddenGem: function (ctx) {
      var strict = ctx.pool.filter(function (e) {
        return gemBase(e) && e.totalPercentile <= HIDDEN_GEM.totalPct && (strongAxisCount(e, HIDDEN_GEM.strong) >= 2 || maxAxis(e) >= HIDDEN_GEM.one);
      }), relaxed = false, c = strict;
      if (c.length < 4) { // 후보가 너무 적으면 조건을 완화하고 사용자에게 알린다
        c = ctx.pool.filter(function (e) { return gemBase(e) && e.totalPercentile <= 80 && strongAxisCount(e, HIDDEN_GEM.strong) >= 1; }); relaxed = true;
      }
      if (!c.length) return null;
      var favs = ctx.favs;
      var scored = c.map(function (e) {
        var quality = topAxisMean(e), obscurity = 100 - e.totalPercentile, nov = 100 * ctx.novelty(e.id), taste = null;
        if (favs.length) { var pm = profileScoreVs(favs, e); taste = pm ? pm.raw : null; }
        var s = taste !== null ? taste * 0.45 + quality * 0.30 + obscurity * 0.15 + nov * 0.10 : quality * 0.55 + obscurity * 0.30 + nov * 0.15;
        return { ent: e, score: s, parts: { taste: taste, quality: quality, obscurity: obscurity, novelty: nov } };
      }).sort(function (a, b) { return (b.score - a.score) || idCmp(a.ent.id, b.ent.id); }).slice(0, ctx.topK);
      var pick = weightedRandom(scored, function (m) { return Math.pow(m.score / 100, 3); }, ctx.rng);
      return { ent: pick.ent, relaxed: relaxed, score: Math.round(pick.score), debug: { candidates: c.length, parts: pick.parts, strict: !relaxed } };
    },
    expand: function (ctx) {
      if (ctx.favs.length < 2) return null;
      var known = {}; ctx.favs.forEach(function (f) { f.styleTags.forEach(function (t) { known[t] = 1; }); });
      var c = ctx.pool.map(function (e) {
        var pm = profileScoreVs(ctx.favs, e); if (!pm) return null;
        var shared = e.styleTags.filter(function (t) { return known[t]; }), fresh = e.styleTags.filter(function (t) { return !known[t]; });
        // '비슷하지만 새로운': 공유 스타일 1개 이상 + 새 스타일 1개 이상, 너무 동떨어지거나(55 미만) 사실상 같은 팀(85 초과)은 제외
        if (pm.score < 55 || pm.score > 85 || shared.length < 1 || fresh.length < 1 || pm.coverage < 0.55) return null;
        return { ent: e, pm: pm, shared: shared.length, fresh: fresh.length };
      }).filter(Boolean);
      var pick = weightedRandom(c, function (m) { return (1 + 0.25 * m.fresh + 0.25 * Math.min(2, m.shared)) * ctx.novelty(m.ent.id); }, ctx.rng);
      return pick && { ent: pick.ent, score: pick.pm.score, breakdown: pick.pm.breakdown, confidence: pick.pm.confidence, coverage: pick.pm.coverage,
        debug: { candidates: c.length, shared: pick.shared, fresh: pick.fresh } };
    },
    hot: function (ctx) {
      var hist = hasHotHistory(), items;
      if (hist) {
        items = ctx.pool.map(function (e) { var h = hotScore(e); return { ent: e, score: h.score, comps: h.components, cov: h.coverage }; })
          .filter(function (m) { var s = hotSignals[m.ent.id]; return (isNum(m.ent.momentum) && m.ent.momentum >= 50) || (s && isNum(s.movement) && s.movement >= 15); })
          .sort(function (a, b) { return (b.score - a.score) || idCmp(a.ent.id, b.ent.id); }).slice(0, ctx.topK);
      } else { // 첫 달: history 가 없으니 현재기세만
        items = ctx.pool.filter(function (e) { return isNum(e.momentum) && e.momentum >= 80; })
          .map(function (e) { return { ent: e, score: e.momentum, comps: null, cov: 0.5 }; });
      }
      var pick = weightedRandom(items, function (m) { return Math.pow(m.score / 100, 2) * ctx.novelty(m.ent.id); }, ctx.rng);
      return pick && { ent: pick.ent, hotScore: Math.round(pick.score), debug: { history: hist, candidates: items.length, hotScore: +pick.score.toFixed(1), components: pick.comps && pick.comps.map(function (c) { return [c.name, c.available ? +c.score.toFixed(1) : null, c.weight]; }) } };
    }
  };
  function getRandomDiscovery(ctx) { return PICK.random(ctx); }
  function getTasteDiscovery(ctx) { return PICK.taste(ctx); }
  function getHiddenGemDiscovery(ctx) { return PICK.hiddenGem(ctx); }
  function getExpansionDiscovery(ctx) { return PICK.expand(ctx); }
  function getHotDiscovery(ctx) { return PICK.hot(ctx); }

  // 자동 모드: 최애 2팀 이상 45/25/20/10, 0~1팀 45/35/20
  function chooseDiscoveryMode(favCount, r) {
    var x = (r || rng)() * 100;
    if (favCount >= 2) return x < 45 ? 'taste' : x < 70 ? 'hiddenGem' : x < 90 ? 'expand' : 'random';
    return x < 45 ? 'random' : x < 80 ? 'hiddenGem' : 'hot';
  }

  var MODE_BADGE = {
    random: '🎲 완전 랜덤 발견', taste: '❤️ 내 취향 추천', hiddenGem: '💎 숨은 보석 추천',
    expand: '🌱 취향 확장 추천', hot: '🔥 HOT 추천', daily: '📅 오늘의 아이돌'
  };
  var AXES = [['popularity', '대중성'], ['fandom', '팬덤 성향'], ['live', '라이브 성향'], ['digital', '디지털·음원 성향']];
  var SCOPE_LABEL = { KR: '한국', JP: '일본' };

  function generateDiscoveryReason(mode, e, extra) {
    var avail = AXES.filter(function (a) { return isNum(e[a[0]]); });
    var best = avail.slice().sort(function (a, b) { return e[b[0]] - e[a[0]] || (a[0] < b[0] ? -1 : 1); })[0];
    var axis = best ? { label: best[1], text: SCOPE_LABEL[e.country] + ' 전체 상위 ' + Math.max(1, Math.round(100 - e[best[0]])) + '%' } : { label: '데이터', text: '지표가 부족해요' };
    if (mode === 'hot' && isNum(e.momentum)) axis = { label: '현재기세', text: SCOPE_LABEL[e.country] + ' 전체 상위 ' + Math.max(1, Math.round(100 - e.momentum)) + '%' };
    var tags = e.styleTags.filter(function (t) { return t !== '세련됨'; }).slice(0, 2).join('·');
    var s;
    if (mode === 'hiddenGem') s = (tags ? tags + ' 계열을 좋아한다면 ' : '') + '한번 들어볼 만한 그룹입니다.';
    else if (mode === 'taste') s = (extra && extra.cluster ? extra.cluster.label + ' 기준으로, ' : '최애 취향 기준으로, ') + (extra && extra.breakdown ? generateSameSceneReason(extra.breakdown)[0] : '전반적인 성향이 가까운 팀입니다.');
    else if (mode === 'expand') s = '내 취향과 겹치는 부분이 있지만, 조금 다른 방향으로 넓혀 볼 만한 팀입니다.';
    else if (mode === 'hot') s = '요즘 상승세가 강한 팀이에요. ' + (tags ? tags + ' 성향이라면 지금 들어보기 좋아요.' : '');
    else if (mode === 'daily') s = '오늘 하루 고정되는 추천이에요. ' + (tags ? tags + ' 성향의 그룹입니다.' : '');
    else s = (tags ? tags + ' 성향의 ' : '') + '아직 안 들어본 그룹일지도 몰라요.';
    var badge = MODE_BADGE[mode] || MODE_BADGE.random;
    if (mode === 'taste' && extra && extra.cluster) badge += ' · ' + extra.cluster.label.split(' · ')[0];
    return { badge: badge, axis: axis, sentence: s };
  }

  function describeStyle(e) {
    var t = e.styleTags.filter(function (x) { return x !== '세련됨'; }).slice(0, 2);
    var avail = AXES.filter(function (a) { return isNum(e[a[0]]); }), top = avail.slice().sort(function (a, b) { return e[b[0]] - e[a[0]] || (a[0] < b[0] ? -1 : 1); })[0];
    if (top && e[top[0]] >= 70) t.push({ popularity: '대중형', fandom: '강한 팬덤', live: '라이브형', digital: '디지털 강세' }[top[0]]);
    return t;
  }

  /* 발견 실행: mode = auto|random|taste|hiddenGem|expand|hot|daily, scope = ALL|KR|JP
   * - ALL 은 팀 수(KR 86 / JP 126)와 무관하게 국가를 먼저 50:50 으로 고른 뒤 그 안에서 그룹을 고른다.
   * - 후보가 없으면 hiddenGem → hot → random(최근 제외) → random(최근 무시) 순으로 물러난다. */
  function makeCtx(scope, opts, poolOpts) {
    var r = opts.rng || rng, favs = favoriteEntities(), counts = exposureCounts();
    return { pool: getDiscoverPool(scope, poolOpts), favs: favs, rng: r, topK: 12, counts: counts, novelty: function (id) { return noveltyWeight(id, counts); } };
  }
  function runBalanced(mode, ctx, scope) {
    var pool = ctx.pool, countries = ['KR', 'JP'].filter(function (c) { return (scope === 'ALL' || !scope || scope === c) && pool.some(function (e) { return e.country === c; }); });
    if (!countries.length) return null;
    var first = countries.length === 2 ? (ctx.rng() < 0.5 ? 'KR' : 'JP') : countries[0], order = countries.length === 2 ? [first, first === 'KR' ? 'JP' : 'KR'] : [first];
    for (var i = 0; i < order.length; i++) {
      var sub = Object.assign({}, ctx, { pool: pool.filter(function (e) { return e.country === order[i]; }) });
      var r = PICK[mode](sub);
      if (r) { r.countryPick = order[i]; r.balanced = countries.length === 2; return r; }
    }
    return null;
  }
  function pickDiscovery(mode, scope, opts) {
    opts = opts || {};
    var favs0 = favoriteEntities();
    var requested = mode || 'auto', ctx = makeCtx(scope, opts, {});
    if (mode === 'daily') return dailyDiscovery(scope);
    var actual = requested === 'auto' ? chooseDiscoveryMode(favs0.length, ctx.rng) : requested;
    var chain = [actual, 'hiddenGem', 'hot', 'random'].filter(function (m, i, a) { return a.indexOf(m) === i; });
    for (var i = 0; i < chain.length; i++) {
      var r = runBalanced(chain[i], ctx, scope);
      if (r) return finish(r, chain[i], requested, actual, ctx);
    }
    var all = makeCtx(scope, opts, { ignoreRecent: true }), last = runBalanced('random', all, scope);
    return last ? finish(last, 'random', requested, actual, all) : null;
  }
  function finish(r, used, requested, actual, ctx) {
    var e = r.ent;
    return {
      ent: e, mode: used, requested: requested, fellBack: used !== actual, relaxed: !!r.relaxed, breakdown: r.breakdown || null, score: r.score, cluster: r.cluster || null,
      confidence: e.dataConfidence, limited: !(e.dataConfidence >= 0.65), reason: generateDiscoveryReason(used, e, r),
      debug: Object.assign({ mode: used, requested: requested, countryPick: r.countryPick, balanced: !!r.balanced, exposure: ctx.counts[e.id] || 0, novelty: +ctx.novelty(e.id).toFixed(3), seeded: seeded }, r.debug || {})
    };
  }
  function dailyDiscovery(scope) {
    var d = new Date(), seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    var pool = getDiscoverPool(scope, { ignoreRecent: true }); // getDiscoverPool 이 id 순으로 정렬해 준다
    if (!pool.length) return null;
    var h = seed; for (var i = 0; i < (scope || 'ALL').length; i++) h = (h * 31 + (scope || 'ALL').charCodeAt(i)) >>> 0;
    var e = pool[(h * 2654435761 >>> 0) % pool.length];
    return { ent: e, mode: 'daily', requested: 'daily', fellBack: false, relaxed: false, breakdown: null, cluster: null, confidence: e.dataConfidence, limited: !(e.dataConfidence >= 0.65), reason: generateDiscoveryReason('daily', e), debug: { mode: 'daily', seed: seed } };
  }
  function discoveryFor(id, mode) { // 공유 링크(?discover=ID)용
    var found = entityById(id);
    return found && { ent: found, mode: mode || 'random', requested: mode || 'random', fellBack: false, relaxed: false, breakdown: null, cluster: null, confidence: found.dataConfidence, limited: !(found.dataConfidence >= 0.65), reason: generateDiscoveryReason(mode || 'random', found), debug: { mode: mode || 'random', shared: true } };
  }

  /* ---------- 발견 컬렉션 · 월간 리포트 · 최애 빠른 추가 ---------- */
  // 발견한 그룹(중복 제거, 최신순): {ent, mode, last, count}
  function getDiscoveryCollection() {
    var seen = {}, out = [];
    loadDiscoveryHistory().forEach(function (h) {
      var e = entityById(h.id); if (!e) return;
      if (seen[h.id]) { seen[h.id].count++; return; }
      seen[h.id] = { ent: e, mode: h.mode, last: h.timestamp, count: 1 };
      out.push(seen[h.id]);
    });
    return out;
  }
  // year/month(0~11) 의 발견 기록 요약. 기록은 최근 50개까지만 남으므로 그 범위 안에서 집계한다.
  function getMonthlyReport(year, month) {
    var rows = loadDiscoveryHistory().filter(function (h) {
      var d = new Date(h.timestamp); return d.getFullYear() === year && d.getMonth() === month;
    });
    var uniq = {}, modes = {}, countries = { KR: 0, JP: 0 }, tags = {}, gems = [], hots = [];
    rows.forEach(function (h) {
      modes[h.mode] = (modes[h.mode] || 0) + 1;
      var e = entityById(h.id); if (!e || uniq[h.id]) return;
      uniq[h.id] = e; countries[e.country]++;
      e.styleTags.forEach(function (t) { if (t !== '세련됨') tags[t] = (tags[t] || 0) + 1; });
      if (h.mode === 'hiddenGem') gems.push(e);
      if (h.mode === 'hot') hots.push(e);
    });
    var topTags = Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a] || (a < b ? -1 : 1); }).slice(0, 5).map(function (t) { return { tag: t, n: tags[t] }; });
    var ids = Object.keys(uniq);
    var avg = function (k) { var v = ids.map(function (id) { return uniq[id][k]; }).filter(isNum); return v.length ? mean(v) : 0; };
    return {
      year: year, month: month, total: rows.length, unique: ids.length, modes: modes, countries: countries, topTags: topTags,
      gems: gems.slice(0, 5), hots: hots.slice(0, 5), avg: { live: avg('live'), fandom: avg('fandom'), digital: avg('digital'), popularity: avg('popularity') },
      favorites: IM.getFavorites().length
    };
  }
  // 최애가 부족할 때 고르기 쉬운 후보(국가별 체급 상위, 최애 제외)
  function getFavoriteSuggestions(scope, perCountry) {
    var favs = {}; IM.getFavorites().forEach(function (f) { favs[f.id] = 1; });
    var out = [];
    (scope === 'KR' ? ['KR'] : scope === 'JP' ? ['JP'] : ['KR', 'JP']).forEach(function (c) {
      entitiesOf(c).filter(function (e) { return isDiscoverable(e) && !favs[e.id]; })
        .sort(function (a, b) { return (b.total - a.total) || idCmp(a.id, b.id); }).slice(0, perCountry || 4).forEach(function (e) { out.push(e); });
    });
    return out;
  }

  global.IdolRec = {
    MODE_BADGE: MODE_BADGE,
    // 지도 논리 좌표 (idol-map.js 공유)
    logicalPoints: logicalPoints, median: median, mad: mad, iqr: iqr, std: std, robustZ: robustZ, robustScale: robustScale, robustScaleInfo: robustScaleInfo, toScreenPosition: toScreenPosition,
    classifyMapZone: classifyMapZone, CENTER_TOLERANCE: CENTER_TOLERANCE, MAP_KEYS: MAP_KEYS,
    // SAME SCENE
    entityOf: entityOf, entitiesOf: entitiesOf, mapSimilarity: mapSimilarity, numericSimilarity: numericSimilarity, profileSimilarity: profileSimilarity,
    sceneResult: sceneResult, calculateSameSceneBreakdown: calculateSameSceneBreakdown, calculateSameSceneScore: calculateSameSceneScore,
    getSameSceneMatches: getSameSceneMatches, getTasteExpansionMatches: getTasteExpansionMatches, generateSameSceneReason: generateSameSceneReason, SCENE_W: SCENE_W,
    // DISCOVER
    buildFavoriteTasteProfile: buildFavoriteTasteProfile, favoriteEntities: favoriteEntities, getDiscoverPool: getDiscoverPool,
    getRandomDiscovery: getRandomDiscovery, getTasteDiscovery: getTasteDiscovery, getHiddenGemDiscovery: getHiddenGemDiscovery,
    getExpansionDiscovery: getExpansionDiscovery, getHotDiscovery: getHotDiscovery, chooseDiscoveryMode: chooseDiscoveryMode,
    weightedRandom: weightedRandom, pickDiscovery: pickDiscovery, discoveryFor: discoveryFor, generateDiscoveryReason: generateDiscoveryReason,
    describeStyle: describeStyle, isDiscoverable: isDiscoverable, entityById: entityById, getDiscoveryCollection: getDiscoveryCollection, getMonthlyReport: getMonthlyReport, getFavoriteSuggestions: getFavoriteSuggestions,
    setSeed: setSeed, getRng: getRng, setHotSignals: setHotSignals, hotScore: hotScore, exposureCounts: exposureCounts, noveltyWeight: noveltyWeight, profileScoreVs: profileScoreVs,
    loadRecentDiscoveries: loadRecentDiscoveries, saveRecentDiscovery: saveRecentDiscovery,
    loadDiscoveryHistory: loadDiscoveryHistory, saveDiscoveryHistory: saveDiscoveryHistory, clearDiscoveryHistory: clearDiscoveryHistory,
    _internals: { PICK: PICK, scoreVsProfile: scoreVsProfile, rankScene: rankScene, SCENE_W: SCENE_W, sceneComponents: sceneComponents, HIDDEN_GEM: HIDDEN_GEM, makeCtx: makeCtx }
  };
})(window);
