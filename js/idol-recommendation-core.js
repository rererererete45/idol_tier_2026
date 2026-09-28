/* IDOL RECOMMENDATION CORE — IDOL MAP 논리 좌표 + SAME SCENE + DISCOVER 공통 엔진
 * (SAME_SCENE_DISCOVER_SPEC.md)
 * - 정규화·스타일 태그·수치 유사도·최애 저장은 window.IdolMatch 를 그대로 재사용한다.
 * - IDOL MAP 의 logical coordinate(지터/충돌 보정 전)를 여기서 한 번만 계산하고,
 *   idol-map.js 와 SAME SCENE 이 같은 좌표를 쓴다.
 * - window.IdolRec 로만 노출한다. */
(function (global) {
  'use strict';
  var IM = global.IdolMatch;

  var RECENT_KEY = 'idolTierRecentDiscoveries', RECENT_MAX = 20;
  var HISTORY_KEY = 'idolTierDiscoveryHistory', HISTORY_MAX = 50;
  var CENTER_TOLERANCE = 12;

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
  function weighted(pairs, P) { return pairs.reduce(function (a, p) { return a + P(p[0]) * p[1]; }, 0); }

  var logicalCache = {};
  // 지터·충돌 보정이 없는 논리 좌표. baseX/baseY: 지도 화면 %(y 아래로 증가), mapX/mapY: 0~100(오른쪽=대중, 위=라이브)
  function logicalPoints(country) {
    if (logicalCache[country]) return logicalCache[country];
    var rows = IM.getRaw(country), cfg = MAP_KEYS[country], need = [];
    ['pub', 'fan', 'live', 'dig'].forEach(function (k) { cfg[k].forEach(function (p) { if (need.indexOf(p[0]) === -1) need.push(p[0]); }); });
    need.push(cfg.mom, '총점');
    var valid = rows.filter(function (r) { return need.every(function (k) { return Number.isFinite(Number(r[k])) && r[k] !== null && r[k] !== ''; }); });
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
      p.zX = robustZ(p.xRaw, xs); p.zY = robustZ(p.yRaw, ys);
      var s = toScreenPosition(p.zX, p.zY);
      p.baseX = s.x; p.baseY = s.y; p.mapX = s.x; p.mapY = 100 - s.y;
      p.zone = classifyMapZone(s.x, s.y);
    });
    logicalCache[country] = { points: pts, excluded: rows.length - valid.length };
    return logicalCache[country];
  }

  /* ---------- 엔티티(그룹/최애 프로필 공통 입력 벡터) ---------- */
  var entCache = {};
  function extraOf(country, name) {
    var raw = IM.getRaw(country) || [], i;
    for (i = 0; i < raw.length; i++) if (raw[i]['그룹'] === name) return raw[i];
    return null;
  }
  // SameSceneVector: styleTags, mapX, mapY, fandom, live, digital, popularity, momentum (0~100)
  function entityOf(country, name) {
    var key = country + '|' + name;
    if (entCache[key]) return entCache[key];
    var g = IM.getGroup(country, name);
    if (!g) return null;
    var pos = null, L = logicalPoints(country).points;
    for (var i = 0; i < L.length; i++) if (L[i].group === name) { pos = L[i]; break; }
    var raw = extraOf(country, name) || {};
    var e = {
      key: key, id: g.id, name: name, country: country, tier: g.tier, total: g.total, status: g.status, group: g,
      styleTags: g.styleTags, styleRaw: g.styleRaw, spotify: g.spotify, slug: raw.slug || g.slug,
      fandom: g.vec.fandom, live: g.vec.live, digital: g.vec.digital, popularity: g.vec.popularity, momentum: g.vec.momentum,
      vec: g.vec, mapX: pos ? pos.mapX : NaN, mapY: pos ? pos.mapY : NaN, zone: pos ? pos.zone : '',
      totalPercentile: pos ? pos.totalPercentile : NaN,
      gen: country === 'KR' ? (raw['세대'] || '') : '', lineage: country === 'JP' ? (raw['계열'] || '') : ''
    };
    entCache[key] = e;
    return e;
  }
  function entitiesOf(country) { return (IM.getGroups(country) || []).map(function (g) { return entityOf(country, g.name); }).filter(Boolean); }

  /* ---------- SAME SCENE ---------- */
  var SCENE_W = { style: 0.35, map: 0.20, fandom: 0.12, live: 0.10, digital: 0.10, popularity: 0.08, momentum: 0.05 };
  var MAX_MAP_DISTANCE = Math.sqrt(100 * 100 + 100 * 100);

  function numericSimilarity(a, b) { return IM.util.calculateNumericSimilarity(a, b); }
  function mapSimilarity(a, b) {
    if (![a.mapX, a.mapY, b.mapX, b.mapY].every(Number.isFinite)) return 50;
    var dx = a.mapX - b.mapX, dy = a.mapY - b.mapY;
    return Math.max(0, 100 - (Math.sqrt(dx * dx + dy * dy) / MAX_MAP_DISTANCE) * 100);
  }
  function calculateSameSceneBreakdown(a, b) {
    return {
      style: IM.util.calculateStyleSimilarity(a.styleTags, b.styleTags, a.tagWeights),
      map: mapSimilarity(a, b),
      fandom: numericSimilarity(a.fandom, b.fandom),
      live: numericSimilarity(a.live, b.live),
      digital: numericSimilarity(a.digital, b.digital),
      popularity: numericSimilarity(a.popularity, b.popularity),
      momentum: numericSimilarity(a.momentum, b.momentum)
    };
  }
  // 같은 세대(한국 +2) / 같은 계열(일본 +3)은 동점 보정 수준만 허용 (총점의 5% 이하)
  function tieBreakBonus(a, b) {
    if (a.country && a.country === 'KR' && b.country === 'KR' && a.gen && a.gen === b.gen) return 2;
    if (a.country === 'JP' && b.country === 'JP' && a.lineage && a.lineage === b.lineage && !/기타|독립|^—$/.test(a.lineage)) return 3;
    return 0;
  }
  function calculateSameSceneScore(a, b, breakdown) {
    var d = breakdown || calculateSameSceneBreakdown(a, b), s = 0;
    Object.keys(SCENE_W).forEach(function (k) { s += d[k] * SCENE_W[k]; });
    return Math.min(100, Math.round(s + tieBreakBonus(a, b)));
  }

  // 추천 이유: 스타일 > 시장 위치 > 라이브 > 팬덤 > 디지털 > 대중성 > 기세, 최대 2문장
  var REASON_ORDER = [['style', 70], ['map', 88], ['live', 85], ['fandom', 85], ['digital', 85], ['popularity', 85], ['momentum', 85]];
  var REASON_LEAD = {
    style: '음악·콘셉트가 비슷한 팀입니다.', map: '시장 포지션이 가까운 팀입니다.',
    live: '라이브 성향이 가까운 팀입니다.', fandom: '팬덤 성향이 비슷한 팀입니다.', digital: '디지털·음원 성향이 비슷한 팀입니다.',
    popularity: '대중성 수준이 비슷한 팀입니다.', momentum: '현재 기세가 비슷한 흐름의 팀입니다.'
  };
  var REASON_MORE = {
    live: '라이브 성향도 가까운 편입니다.', fandom: '팬덤 성향도 비슷한 편입니다.', digital: '디지털·음원 성향도 비슷한 편입니다.',
    popularity: '대중성 수준도 비슷합니다.', momentum: '현재 기세도 비슷한 흐름입니다.', style: '음악·콘셉트도 닮았습니다.', map: '시장 포지션도 가깝습니다.'
  };
  // 최대 2문장: 첫 문장은 가장 우선순위 높은 요소(스타일+시장 위치가 함께면 한 문장으로), 둘째 문장은 다음 요소
  function generateSameSceneReason(b) {
    var hit = REASON_ORDER.filter(function (r) { return b[r[0]] >= r[1]; }).map(function (r) { return r[0]; });
    if (!hit.length) return ['전반적인 성향이 고르게 닮은 팀입니다.'];
    var out = [];
    if (hit.indexOf('style') !== -1 && hit.indexOf('map') !== -1) {
      out.push('음악·콘셉트와 시장 포지션이 비슷한 팀입니다.');
      hit = hit.filter(function (k) { return k !== 'style' && k !== 'map'; });
      if (hit.length) out.push(REASON_MORE[hit[0]]);
    } else {
      out.push(REASON_LEAD[hit[0]]);
      if (hit.length > 1) out.push(REASON_MORE[hit[1]]);
    }
    return out.slice(0, 2);
  }
  function sceneTags(src, tgt) {
    var shared = tgt.styleTags.filter(function (t) { return src.styleTags.indexOf(t) !== -1; });
    var rest = tgt.styleTags.filter(function (t) { return shared.indexOf(t) === -1; });
    return shared.concat(rest).filter(function (t) { return t !== '세련됨'; }).slice(0, 3);
  }
  function decorateScene(src, tgt, b) {
    return { group: tgt, score: calculateSameSceneScore(src, tgt, b), breakdown: b, reasons: generateSameSceneReason(b), tags: sceneTags(src, tgt) };
  }
  function rankScene(src, pool) {
    return pool.map(function (t) { return decorateScene(src, t, calculateSameSceneBreakdown(src, t)); })
      .sort(function (x, y) { return y.score - x.score || y.breakdown.style - x.breakdown.style || y.breakdown.map - x.breakdown.map; });
  }

  // 취향 확장: score>=65 && style>=55 && map>=45, TOP 과 중복 제외, 완전히 같은 위치보다 약간 다른 팀 우선
  function getTasteExpansionMatches(ranked, excludeNames, limit) {
    return ranked.filter(function (m) {
      return excludeNames.indexOf(m.group.name) === -1 && m.score >= 65 && m.breakdown.style >= 55 && m.breakdown.map >= 45;
    }).map(function (m) { m.expandScore = m.score - Math.max(0, m.breakdown.map - 92); return m; })
      .sort(function (x, y) { return y.expandScore - x.expandScore; }).slice(0, limit || 3);
  }

  function isActive(e) { return IM.util.isActive(e); }

  function getSameSceneMatches(country, name, opts) {
    opts = opts || {};
    var src = entityOf(country, name);
    if (!src) return null;
    var pool = entitiesOf(country).filter(function (e) { return e.name !== name && (opts.includeEnded || isActive(e)); });
    var ranked = rankScene(src, pool);
    var top = ranked.slice(0, opts.limit || 3);
    var expand = getTasteExpansionMatches(ranked, top.map(function (m) { return m.group.name; }), opts.expandLimit || 3);
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

  /* ---------- DISCOVER ---------- */
  function weightedRandom(items, weightFn, rng) {
    rng = rng || Math.random;
    var ws = items.map(function (it) { return Math.max(0, weightFn(it)) || 0; }), sum = ws.reduce(function (a, b) { return a + b; }, 0);
    if (!items.length) return null;
    if (!sum) return items[Math.floor(rng() * items.length)];
    var r = rng() * sum;
    for (var i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  function favoriteEntities() {
    return IM.getFavorites().map(function (f) { return entityOf(f.country, f.group); }).filter(Boolean);
  }
  function maxAxis(e) { return Math.max(e.popularity, e.fandom, e.live, e.digital); }

  // 최애 평균 프로필: popularity/fandom/live/digital/momentum/mapX/mapY 평균 + 스타일 빈도 가중치
  function buildFavoriteTasteProfile(favEntities) {
    if (!favEntities.length) return null;
    var base = IM.util.buildFavoriteTasteProfile(favEntities.map(function (e) { return e.group; }));
    var avg = function (k) { var v = favEntities.map(function (e) { return e[k]; }).filter(Number.isFinite); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : NaN; };
    return {
      country: '', styleTags: base.styleTags, tagWeights: base.tagWeights,
      popularity: base.vec.popularity, fandom: base.vec.fandom, live: base.vec.live, digital: base.vec.digital, momentum: base.vec.momentum,
      mapX: avg('mapX'), mapY: avg('mapY'), gen: '', lineage: ''
    };
  }

  // 국가 범위(ALL/KR/JP) + 활동중 + 최애 제외 + 최근 발견 제외
  function getDiscoverPool(scope, opts) {
    opts = opts || {};
    var favIds = {}, recent = opts.ignoreRecent ? [] : loadRecentDiscoveries();
    IM.getFavorites().forEach(function (f) { var e = entityOf(f.country, f.group); if (e) favIds[e.key] = 1; });
    var list = [];
    (scope === 'KR' || scope === 'ALL' || !scope ? ['KR'] : []).concat(scope === 'JP' || scope === 'ALL' || !scope ? ['JP'] : []).forEach(function (c) { list = list.concat(entitiesOf(c)); });
    return list.filter(function (e) { return isActive(e) && !favIds[e.key] && recent.indexOf(e.id) === -1; });
  }

  function scoreVsProfile(profile, pool) {
    return pool.map(function (e) {
      var b = calculateSameSceneBreakdown(profile, e);
      return { ent: e, score: calculateSameSceneScore(profile, e, b), breakdown: b };
    });
  }

  var PICK = {
    random: function (ctx) {
      var g = weightedRandom(ctx.pool, function () { return 1; }, ctx.rng);
      return g && { ent: g };
    },
    taste: function (ctx) {
      if (!ctx.profile || ctx.favs.length < 2) return null;
      var top = scoreVsProfile(ctx.profile, ctx.pool).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
      return weightedRandom(top, function (m) { return Math.pow(m.score / 100, 3); }, ctx.rng); // TOP1 고정 금지
    },
    hiddenGem: function (ctx) {
      // 스펙 기준(총점 하위 65% 미만 & 한 축 80 이상). 후보가 4팀 미만이면 조금 완화(75/75)해 반복을 막는다.
      var c = ctx.pool.filter(function (e) { return e.totalPercentile < 65 && maxAxis(e) >= 80; });
      if (c.length < 4) c = ctx.pool.filter(function (e) { return e.totalPercentile < 75 && maxAxis(e) >= 75; });
      var g = weightedRandom(c, function (e) { return (maxAxis(e) / 100) * (1.2 - e.totalPercentile / 100); }, ctx.rng);
      return g && { ent: g };
    },
    expand: function (ctx) {
      if (!ctx.profile || ctx.favs.length < 2) return null;
      var c = scoreVsProfile(ctx.profile, ctx.pool).filter(function (m) {
        return m.score >= 60 && m.score <= 82 && m.breakdown.style >= 50 && m.breakdown.map >= 40 && m.breakdown.map <= 85;
      });
      return weightedRandom(c, function () { return 1; }, ctx.rng);
    },
    hot: function (ctx) {
      var c = ctx.pool.filter(function (e) { return e.momentum >= 80; });
      var g = weightedRandom(c, function (e) { return Math.pow(e.momentum / 100, 2); }, ctx.rng);
      return g && { ent: g };
    }
  };
  function getRandomDiscovery(ctx) { return PICK.random(ctx); }
  function getTasteDiscovery(ctx) { return PICK.taste(ctx); }
  function getHiddenGemDiscovery(ctx) { return PICK.hiddenGem(ctx); }
  function getExpansionDiscovery(ctx) { return PICK.expand(ctx); }
  function getHotDiscovery(ctx) { return PICK.hot(ctx); }

  // 자동 모드: 최애 2팀 이상 45/25/20/10, 0~1팀 45/35/20
  function chooseDiscoveryMode(favCount, rng) {
    var r = (rng || Math.random)() * 100;
    if (favCount >= 2) return r < 45 ? 'taste' : r < 70 ? 'hiddenGem' : r < 90 ? 'expand' : 'random';
    return r < 45 ? 'random' : r < 80 ? 'hiddenGem' : 'hot';
  }

  var MODE_BADGE = {
    random: '🎲 완전 랜덤 발견', taste: '❤️ 내 취향 추천', hiddenGem: '💎 숨은 보석 추천',
    expand: '🌱 취향 확장 추천', hot: '🔥 HOT 추천', daily: '📅 오늘의 아이돌'
  };
  var AXES = [['popularity', '대중성'], ['fandom', '팬덤 성향'], ['live', '라이브 성향'], ['digital', '디지털·음원 성향']];
  var SCOPE_LABEL = { KR: '한국', JP: '일본' };

  function generateDiscoveryReason(mode, e, extra) {
    var best = AXES.slice().sort(function (a, b) { return e[b[0]] - e[a[0]]; })[0];
    var axis = { label: best[1], text: SCOPE_LABEL[e.country] + ' 전체 상위 ' + Math.max(1, Math.round(100 - e[best[0]])) + '%' };
    if (mode === 'hot') axis = { label: '현재기세', text: SCOPE_LABEL[e.country] + ' 전체 상위 ' + Math.max(1, Math.round(100 - e.momentum)) + '%' };
    var tags = e.styleTags.filter(function (t) { return t !== '세련됨'; }).slice(0, 2).join('·');
    var s;
    if (mode === 'hiddenGem') s = (tags ? tags + ' 계열을 좋아한다면 ' : '') + '한번 들어볼 만한 그룹입니다.';
    else if (mode === 'taste') s = '최애 취향 기준으로, ' + (extra && extra.breakdown ? generateSameSceneReason(extra.breakdown)[0] : '전반적인 성향이 가까운 팀입니다.');
    else if (mode === 'expand') s = '내 취향과 겹치는 부분이 있지만, 조금 다른 방향으로 넓혀 볼 만한 팀입니다.';
    else if (mode === 'hot') s = '요즘 상승세가 강한 팀이에요. ' + (tags ? tags + ' 성향이라면 지금 들어보기 좋아요.' : '');
    else if (mode === 'daily') s = '오늘 하루 고정되는 추천이에요. ' + (tags ? tags + ' 성향의 그룹입니다.' : '');
    else s = (tags ? tags + ' 성향의 ' : '') + '아직 안 들어본 그룹일지도 몰라요.';
    return { badge: MODE_BADGE[mode] || MODE_BADGE.random, axis: axis, sentence: s };
  }

  function describeStyle(e) {
    var t = e.styleTags.filter(function (x) { return x !== '세련됨'; }).slice(0, 2);
    var top = AXES.slice().sort(function (a, b) { return e[b[0]] - e[a[0]]; })[0];
    if (top && e[top[0]] >= 70) t.push({ popularity: '대중형', fandom: '강한 팬덤', live: '라이브형', digital: '디지털 강세' }[top[0]]);
    return t;
  }

  /* 발견 실행: mode = auto|random|taste|hiddenGem|expand|hot|daily, scope = ALL|KR|JP
   * 후보가 없으면 hiddenGem → hot → random(최근 제외) → random(최근 무시) 순으로 물러난다. */
  function pickDiscovery(mode, scope, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random, favs = favoriteEntities(), profile = buildFavoriteTasteProfile(favs);
    var requested = mode || 'auto';
    if (mode === 'daily') return dailyDiscovery(scope);
    var actual = requested === 'auto' ? chooseDiscoveryMode(favs.length, rng) : requested;
    var chain = [actual, 'hiddenGem', 'hot', 'random'].filter(function (m, i, a) { return a.indexOf(m) === i; });
    var pool = getDiscoverPool(scope), ctx = { pool: pool, profile: profile, favs: favs, rng: rng };
    for (var i = 0; i < chain.length; i++) {
      var r = PICK[chain[i]](ctx);
      if (r) return finish(r, chain[i], requested, actual);
    }
    var all = { pool: getDiscoverPool(scope, { ignoreRecent: true }), profile: profile, favs: favs, rng: rng };
    var last = PICK.random(all);
    return last ? finish(last, 'random', requested, actual) : null;
  }
  function finish(r, used, requested, actual) {
    var e = r.ent || r.group;
    return { ent: e, mode: used, requested: requested, fellBack: used !== actual, breakdown: r.breakdown || null, score: r.score, reason: generateDiscoveryReason(used, e, r) };
  }
  function dailyDiscovery(scope) {
    var d = new Date(), seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    var pool = getDiscoverPool(scope, { ignoreRecent: true }).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    if (!pool.length) return null;
    var h = seed; for (var i = 0; i < (scope || 'ALL').length; i++) h = (h * 31 + (scope || 'ALL').charCodeAt(i)) >>> 0;
    var e = pool[(h * 2654435761 >>> 0) % pool.length];
    return { ent: e, mode: 'daily', requested: 'daily', fellBack: false, breakdown: null, reason: generateDiscoveryReason('daily', e) };
  }
  function discoveryFor(id, mode) { // 공유 링크(?discover=ID)용
    var found = null;
    ['KR', 'JP'].forEach(function (c) { entitiesOf(c).forEach(function (e) { if (e.id === id) found = e; }); });
    return found && { ent: found, mode: mode || 'random', requested: mode || 'random', fellBack: false, breakdown: null, reason: generateDiscoveryReason(mode || 'random', found) };
  }

  global.IdolRec = {
    MODE_BADGE: MODE_BADGE,
    // 지도 논리 좌표 (idol-map.js 공유)
    logicalPoints: logicalPoints, median: median, mad: mad, robustZ: robustZ, toScreenPosition: toScreenPosition,
    classifyMapZone: classifyMapZone, CENTER_TOLERANCE: CENTER_TOLERANCE, MAP_KEYS: MAP_KEYS,
    // SAME SCENE
    entityOf: entityOf, entitiesOf: entitiesOf, mapSimilarity: mapSimilarity, numericSimilarity: numericSimilarity,
    calculateSameSceneBreakdown: calculateSameSceneBreakdown, calculateSameSceneScore: calculateSameSceneScore,
    getSameSceneMatches: getSameSceneMatches, getTasteExpansionMatches: getTasteExpansionMatches, generateSameSceneReason: generateSameSceneReason,
    // DISCOVER
    buildFavoriteTasteProfile: buildFavoriteTasteProfile, favoriteEntities: favoriteEntities, getDiscoverPool: getDiscoverPool,
    getRandomDiscovery: getRandomDiscovery, getTasteDiscovery: getTasteDiscovery, getHiddenGemDiscovery: getHiddenGemDiscovery,
    getExpansionDiscovery: getExpansionDiscovery, getHotDiscovery: getHotDiscovery, chooseDiscoveryMode: chooseDiscoveryMode,
    weightedRandom: weightedRandom, pickDiscovery: pickDiscovery, discoveryFor: discoveryFor, generateDiscoveryReason: generateDiscoveryReason,
    describeStyle: describeStyle,
    loadRecentDiscoveries: loadRecentDiscoveries, saveRecentDiscovery: saveRecentDiscovery,
    loadDiscoveryHistory: loadDiscoveryHistory, saveDiscoveryHistory: saveDiscoveryHistory, clearDiscoveryHistory: clearDiscoveryHistory,
    _internals: { PICK: PICK, scoreVsProfile: scoreVsProfile, rankScene: rankScene, SCENE_W: SCENE_W }
  };
})(window);
