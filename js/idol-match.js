/* IDOL MATCH — 한국 ↔ 일본 여자아이돌 취향 매칭 (IDOL_MATCH_SPEC.md)
 * 국가별 percentile로 정규화한 공통 취향 벡터 + 스타일 태그 유사도로 계산한다.
 * 한국/일본 총점·원점수는 직접 비교하지 않는다. window.IdolMatch 네임스페이스로만 노출. */
(function (global) {
  'use strict';

  var DATA_VERSION = '20260928';
  var FAVORITE_KEY = 'idolTierFavorites';

  var COUNTRIES = {
    KR: { file: 'data/kr_db.json', page: 'kr-idol-tier-2026-09.html', label: '한국', flag: '🇰🇷' },
    JP: { file: 'data/jp_db.json', page: 'jp-idol-tier-2026-09.html', label: '일본', flag: '🇯🇵' }
  };

  var KR_KEYS = ['국내음원', '음반·팬덤', '공연', '글로벌', '국내인지도', '현재기세'];
  var JP_KEYS = ['공연·현장', '팬덤·구매력', '대중인지도', '스트리밍·SNS', '현재기세', '업계영향력'];

  /* ---------- 스타일 태그 ---------- */
  // 토큰(스타일 문자열을 "/"로 나눈 조각)에 키워드가 포함되면 해당 공통 태그를 모두 부여한다.
  var STYLE_KEYWORD_MAP = [
    ['걸크러시', ['걸크러시']], ['틴크러시', ['걸크러시']],
    ['힙합', ['힙합']], ['R&B', ['R&B']], ['네오소울', ['R&B']],
    ['팝록', ['록', '팝']], ['록', ['록']], ['라우드', ['록']],
    ['밴드', ['밴드']],
    ['얼터', ['얼터너티브']], ['エモ', ['얼터너티브']], ['에모', ['얼터너티브']],
    ['EDM', ['일렉트로', '퍼포먼스']], ['일렉트로', ['일렉트로']], ['전자', ['일렉트로']],
    ['소울트로닉', ['일렉트로', 'R&B']], ['퓨처팝', ['일렉트로', '팝']],
    ['시티팝', ['레트로', '팝']], ['J-POP', ['레트로']],
    ['퍼포먼스', ['퍼포먼스']], ['댄스', ['퍼포먼스']],
    ['보컬', ['보컬']], ['믹스팝', ['팝', '보컬']],
    ['청순', ['청순']], ['청량', ['청춘']], ['하이틴', ['청춘', '팝']], ['틴팝', ['청춘', '팝']], ['청춘', ['청춘']],
    ['카와이', ['카와이']], ['컬러팝', ['카와이', '팝']],
    ['드리미', ['몽환']], ['몽환', ['몽환']],
    ['왕도', ['왕도']], ['극장형', ['왕도']], ['축제형', ['왕도']], ['연극형', ['왕도']],
    ['레트로호러', ['다크', '레트로']], ['다크', ['다크']],
    ['레트로', ['레트로']], ['Y2K', ['레트로']],
    ['서브컬처', ['서브컬처']], ['애니송', ['서브컬처']], ['성우', ['서브컬처']], ['디지털아이돌', ['서브컬처']], ['인キャ', ['서브컬처']],
    ['쿨', ['쿨']],
    ['글로벌', ['글로벌']],
    ['이지리스닝', ['팝', '세련됨']],
    ['아트팝', ['몽환', '실험적', '팝']], ['실험', ['실험적']], ['크로스오버', ['실험적']],
    ['팝', ['팝']]
  ];

  var RELATED_STYLE_WEIGHTS = {
    '청순|왕도': 0.70, '청춘|왕도': 0.70, '카와이|왕도': 0.80, '걸크러시|쿨': 0.80,
    '록|얼터너티브': 0.80, '밴드|록': 0.90, '힙합|퍼포먼스': 0.60, '몽환|청순': 0.60,
    'R&B|보컬': 0.70, '일렉트로|실험적': 0.70, '다크|쿨': 0.70,
    '팝|왕도': 0.50, '팝|카와이': 0.55, '퍼포먼스|쿨': 0.50,
    // 스펙 표를 보완하는 약한 관계(팝 계열 청춘/청순, 걸크러시-퍼포먼스 등)
    '청순|청춘': 0.60, '청춘|팝': 0.50, '청순|팝': 0.40, '카와이|청춘': 0.55, '카와이|청순': 0.55,
    '걸크러시|퍼포먼스': 0.55, '다크|록': 0.55, '다크|얼터너티브': 0.50, '록|퍼포먼스': 0.40,
    '일렉트로|퍼포먼스': 0.45, '일렉트로|다크': 0.45, '쿨|얼터너티브': 0.40, '걸크러시|힙합': 0.55,
    '몽환|일렉트로': 0.45, '몽환|팝': 0.35, '서브컬처|카와이': 0.50, '서브컬처|왕도': 0.40,
    '글로벌|팝': 0.40, '레트로|팝': 0.40, 'R&B|팝': 0.40, '세련됨|팝': 0.50, '세련됨|R&B': 0.45,
    '성숙|R&B': 0.60, '성숙|보컬': 0.50
  };

  var ACTIVITY_MAP = {
    '메이저|라이브': 75, '메이저|라이브 아이돌': 75, '메이저|로컬': 55, '메이저|성우·2.5D': 65,
    '라이브|로컬': 75, '라이브 아이돌|로컬': 75, '라이브|라이브 아이돌': 95
  };
  var KR_ACTIVITY_OVERRIDES = { 'QWER': '밴드/메이저', 'Dreamcatcher': '메이저/라이브', 'KATSEYE': '글로벌/메이저' };

  /* ---------- 유틸 ---------- */
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

  function percentileRank(value, values) {
    var valid = values.filter(Number.isFinite).sort(function (a, b) { return a - b; });
    if (!valid.length) return 50;
    if (valid.length === 1) return 100;
    var less = valid.filter(function (v) { return v < value; }).length;
    var equal = valid.filter(function (v) { return v === value; }).length;
    return ((less + (equal - 1) / 2) / (valid.length - 1)) * 100;
  }

  function buildPercentileMaps(rows, keys) {
    var m = {};
    keys.forEach(function (k) { m[k] = rows.map(function (r) { return Number(r[k]); }); });
    return m;
  }

  function extractStyleTags(styleText) {
    var tags = [];
    String(styleText || '').split('/').forEach(function (tok) {
      tok = tok.trim();
      STYLE_KEYWORD_MAP.forEach(function (rule) {
        if (tok.indexOf(rule[0]) !== -1) {
          rule[1].forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
        }
      });
    });
    return tags;
  }

  function getRelatedStyleWeight(a, b) {
    if (a === b) return 1;
    var w = RELATED_STYLE_WEIGHTS[a + '|' + b];
    if (w === undefined) w = RELATED_STYLE_WEIGHTS[b + '|' + a];
    return w === undefined ? 0 : w;
  }

  // tagWeights: {tag: weight(0~1)} — 최애 평균 프로필용. 없으면 균등.
  function directionalStyleScore(fromTags, toTags, fromWeights) {
    if (!fromTags.length || !toTags.length) return 0.5;
    var num = 0, den = 0;
    fromTags.forEach(function (s) {
      var best = 0;
      toTags.forEach(function (t) { best = Math.max(best, getRelatedStyleWeight(s, t)); });
      var w = fromWeights ? (fromWeights[s] || 0) : 1;
      num += best * w; den += w;
    });
    return den ? num / den : 0.5;
  }

  function calculateStyleSimilarity(aTags, bTags, aWeights) {
    if (!aTags.length || !bTags.length) return 50;
    var ab = directionalStyleScore(aTags, bTags, aWeights);
    var ba = directionalStyleScore(bTags, aTags, null);
    return ((ab + ba) / 2) * 100;
  }

  function calculateNumericSimilarity(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 50;
    return Math.max(0, 100 - Math.abs(a - b));
  }

  function baseActivity(a, b) {
    if (a === b) return 100;
    var v = ACTIVITY_MAP[a + '|' + b];
    if (v === undefined) v = ACTIVITY_MAP[b + '|' + a];
    return v === undefined ? 60 : v;
  }
  function calculateActivityTypeSimilarity(a, b) {
    var best = 0;
    String(a || '메이저').split('/').forEach(function (x) {
      String(b || '메이저').split('/').forEach(function (y) { best = Math.max(best, baseActivity(x, y)); });
    });
    return best;
  }

  /* ---------- 정규화 ---------- */
  function normalizeKoreanGroup(r, maps) {
    var P = function (k) { return percentileRank(Number(r[k]), maps[k]); };
    var music = P('국내음원');
    return {
      country: 'KR', name: r['그룹'], slug: r.slug, tier: r['티어'], status: r['활동상태'] || '',
      styleRaw: r['스타일'], styleTags: extractStyleTags(r['스타일']),
      activityType: KR_ACTIVITY_OVERRIDES[r['그룹']] || '메이저',
      spotify: firstSpotify(r),
      vec: {
        popularity: music * 0.60 + P('국내인지도') * 0.40,
        fandom: P('음반·팬덤'),
        live: P('공연'),
        digital: music * 0.40 + P('글로벌') * 0.60,
        momentum: P('현재기세')
      }
    };
  }

  function normalizeJapaneseGroup(r, maps) {
    var P = function (k) { return percentileRank(Number(r[k]), maps[k]); };
    var sns = P('스트리밍·SNS');
    return {
      country: 'JP', name: r['그룹'], slug: String(r.id || '').toLowerCase(), tier: r['티어'], status: r['활동상태'] || '',
      styleRaw: r['스타일'], styleTags: extractStyleTags(r['스타일']),
      activityType: r['활동형태'] || '메이저',
      spotify: firstSpotify(r),
      vec: {
        popularity: P('대중인지도') * 0.65 + sns * 0.35,
        fandom: P('팬덤·구매력'),
        live: P('공연·현장'),
        digital: sns,
        momentum: P('현재기세')
      }
    };
  }

  function firstSpotify(r) {
    var t = r['대표곡목록'] && r['대표곡목록'][0];
    return t && t.spotify_url ? t.spotify_url : '';
  }

  function isActive(g) {
    var s = g.status || '';
    if (s.indexOf('활동종료') !== -1) return false;
    if (s.indexOf('해산') !== -1 && s.indexOf('해산예정') === -1) return false;
    return true;
  }

  /* ---------- 매칭 ---------- */
  function calculateMatchBreakdown(src, tgt) {
    return {
      style: calculateStyleSimilarity(src.styleTags, tgt.styleTags, src.tagWeights),
      live: calculateNumericSimilarity(src.vec.live, tgt.vec.live),
      fandom: calculateNumericSimilarity(src.vec.fandom, tgt.vec.fandom),
      popularity: calculateNumericSimilarity(src.vec.popularity, tgt.vec.popularity),
      digital: calculateNumericSimilarity(src.vec.digital, tgt.vec.digital),
      momentum: calculateNumericSimilarity(src.vec.momentum, tgt.vec.momentum),
      activity: calculateActivityTypeSimilarity(src.activityType, tgt.activityType)
    };
  }

  function calculateMatchScore(b) {
    return Math.round(
      b.style * 0.40 + b.live * 0.15 + b.fandom * 0.12 + b.popularity * 0.12 +
      b.digital * 0.10 + b.momentum * 0.06 + b.activity * 0.05
    );
  }

  var REASON_TEXT = [
    ['style', '음악·콘셉트 취향이 매우 비슷함'],
    ['live', '라이브 성향이 비슷함'],
    ['fandom', '팬덤 체급과 소비 성향이 비슷함'],
    ['popularity', '대중성 포지션이 비슷함'],
    ['digital', '디지털 반응 성향이 비슷함'],
    ['momentum', '현재 상승세가 비슷함']
  ];

  function generateMatchReason(b) {
    var cand = REASON_TEXT.filter(function (r) { return b[r[0]] >= 85; })
      .sort(function (x, y) { return b[y[0]] - b[x[0]]; });
    if (!cand.length) {
      cand = REASON_TEXT.filter(function (r) { return b[r[0]] >= 70; })
        .sort(function (x, y) { return b[y[0]] - b[x[0]]; });
    }
    if (!cand.length) return ['전반적인 성향이 고르게 닮은 팀'];
    return cand.slice(0, 2).map(function (r) { return r[1]; });
  }

  function describeGroup(g) {
    var out = g.styleTags.filter(function (t) { return t !== '세련됨'; }).slice(0, 2);
    if (g.vec.fandom >= 75) out.push('강한 팬덤');
    else if (g.vec.live >= 75) out.push('라이브형');
    else if (g.vec.digital >= 75) out.push('디지털 강세');
    else if (g.vec.momentum >= 75) out.push('상승세');
    return out;
  }

  function rankTargets(src, targets, includeEnded) {
    return targets
      .filter(function (g) { return includeEnded || isActive(g); })
      .map(function (g) {
        var b = calculateMatchBreakdown(src, g);
        return { group: g, score: calculateMatchScore(b), breakdown: b };
      })
      .sort(function (x, y) { return y.score - x.score || y.breakdown.style - x.breakdown.style; });
  }

  function decorate(m) {
    m.reasons = generateMatchReason(m.breakdown);
    m.tags = describeGroup(m.group);
    return m;
  }

  function getCrossCountryMatches(src, targets, limit, includeEnded) {
    return rankTargets(src, targets, includeEnded).slice(0, limit || 3).map(decorate);
  }

  function getHiddenGems(src, targets, excludeNames, limit, includeEnded) {
    var ex = excludeNames || [];
    var c = rankTargets(src, targets, includeEnded).filter(function (m) {
      return ex.indexOf(m.group.name) === -1 && m.breakdown.style >= 70 && m.score >= 65;
    }).map(function (m) {
      m.gemScore = m.score + Math.max(0, 75 - m.group.vec.popularity) * 0.20;
      return m;
    });
    c.sort(function (x, y) {
      var px = x.group.vec.popularity <= 75 ? 0 : 1, py = y.group.vec.popularity <= 75 ? 0 : 1;
      return px - py || y.gemScore - x.gemScore;
    });
    return c.slice(0, limit || 3).sort(function (x, y) { return y.score - x.score; }).map(decorate);
  }

  /* ---------- 최애 ---------- */
  function getFavorites() {
    try {
      var v = JSON.parse(global.localStorage.getItem(FAVORITE_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function writeFavorites(list) {
    try { global.localStorage.setItem(FAVORITE_KEY, JSON.stringify(list)); } catch (e) { /* 저장 불가 환경 */ }
  }
  function isFavorite(country, name) {
    return getFavorites().some(function (f) { return f.country === country && f.group === name; });
  }
  function saveFavorite(country, name) { // 토글, 새 상태(true=저장됨) 반환
    var list = getFavorites();
    var i = -1;
    list.forEach(function (f, k) { if (f.country === country && f.group === name) i = k; });
    if (i >= 0) { list.splice(i, 1); writeFavorites(list); return false; }
    list.push({ country: country, group: name });
    writeFavorites(list);
    return true;
  }
  function clearFavorites(country) {
    writeFavorites(getFavorites().filter(function (f) { return country && f.country !== country; }));
  }

  function averageNumericProfile(vs) {
    var keys = ['popularity', 'fandom', 'live', 'digital', 'momentum'], o = {};
    keys.forEach(function (k) { o[k] = mean(vs.map(function (v) { return v[k]; })); });
    return o;
  }

  function buildFavoriteTasteProfile(groups) {
    var counts = {}, acts = {};
    groups.forEach(function (g) {
      g.styleTags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      acts[g.activityType] = (acts[g.activityType] || 0) + 1;
    });
    var weights = {}, tags = Object.keys(counts);
    tags.forEach(function (t) { weights[t] = counts[t] / groups.length; });
    tags.sort(function (a, b) { return counts[b] - counts[a]; });
    var act = Object.keys(acts).sort(function (a, b) { return acts[b] - acts[a]; })[0] || '메이저';
    return {
      vec: averageNumericProfile(groups.map(function (g) { return g.vec; })),
      styleTags: tags, tagWeights: weights, activityType: act
    };
  }

  /* ---------- 데이터 로드 ---------- */
  var state = { groups: { KR: [], JP: [] }, byKey: {} };

  function fetchJson(url) {
    return fetch(url + '?v=' + DATA_VERSION).then(function (r) {
      if (!r.ok) throw new Error('fetch failed: ' + url);
      return r.json();
    });
  }

  var ready = Promise.all([fetchJson(COUNTRIES.KR.file), fetchJson(COUNTRIES.JP.file)]).then(function (res) {
    var kr = Array.isArray(res[0]) ? res[0] : res[0].korea;
    var jp = Array.isArray(res[1]) ? res[1] : (res[1].japan || res[1]);
    var krMaps = buildPercentileMaps(kr, KR_KEYS);
    var jpMaps = buildPercentileMaps(jp, JP_KEYS);
    state.groups.KR = kr.map(function (r) { return normalizeKoreanGroup(r, krMaps); });
    state.groups.JP = jp.map(function (r) { return normalizeJapaneseGroup(r, jpMaps); });
    ['KR', 'JP'].forEach(function (c) {
      state.groups[c].forEach(function (g) { state.byKey[c + '|' + g.name] = g; });
    });
    return state;
  });

  function otherCountry(c) { return c === 'KR' ? 'JP' : 'KR'; }

  function getMatches(country, name, opts) {
    opts = opts || {};
    var src = state.byKey[country + '|' + name];
    if (!src) return null;
    var targets = state.groups[otherCountry(country)];
    var top = getCrossCountryMatches(src, targets, opts.limit || 3, opts.includeEnded);
    var hidden = getHiddenGems(src, targets, top.map(function (m) { return m.group.name; }), opts.hiddenLimit || 3, opts.includeEnded);
    return { source: src, target: otherCountry(country), top: top, hidden: hidden };
  }

  function getFavoriteMatches(favs, targetCountry, limit, includeEnded) {
    var groups = favs.map(function (f) { return state.byKey[f.country + '|' + f.group]; }).filter(Boolean);
    if (groups.length < 1) return null;
    var profile = buildFavoriteTasteProfile(groups);
    var targets = state.groups[targetCountry].filter(function (g) {
      return !favs.some(function (f) { return f.country === targetCountry && f.group === g.name; });
    });
    return { profile: profile, groups: groups, matches: getCrossCountryMatches(profile, targets, limit || 5, includeEnded) };
  }

  global.IdolMatch = {
    version: DATA_VERSION, countries: COUNTRIES, ready: ready,
    getMatches: getMatches, getFavoriteMatches: getFavoriteMatches,
    getFavorites: getFavorites, saveFavorite: saveFavorite, isFavorite: isFavorite, clearFavorites: clearFavorites,
    // 테스트/검증용
    _internals: {
      percentileRank: percentileRank, extractStyleTags: extractStyleTags, calculateStyleSimilarity: calculateStyleSimilarity,
      calculateMatchBreakdown: calculateMatchBreakdown, calculateMatchScore: calculateMatchScore, isActive: isActive,
      state: state, buildFavoriteTasteProfile: buildFavoriteTasteProfile
    }
  };
})(window);
