/* IDOL MATCH V2 — 한국 ↔ 일본 여자아이돌 취향 매칭 (IDOL_MATCH_SPEC.md + IDOL_ALGORITHM_V2_SPEC.md)
 * 국가별 percentile 로 정규화한 공통 취향 벡터 + 스타일 태그 유사도로 계산한다.
 * V2 원칙: 결측값을 50 으로 채우지 않는다(해당 component 제외 후 weight 재정규화) · matchScore 와 confidence 분리 ·
 *          결정적 tie-break · 최애는 안정적인 id 로 저장 · 다봉 취향(최애 여러 명)을 평균으로 뭉개지 않는다.
 * 한국/일본 총점·원점수는 직접 비교하지 않는다. window.IdolMatch 네임스페이스로만 노출. */
(function (global) {
  'use strict';

  var DATA_VERSION = '20260970';
  var NORMALIZATION_VERSION = 'v2';
  var FAVORITE_KEY = 'idolTierFavorites';

  var COUNTRIES = {
    KR: { file: 'data/kr_db.json', page: 'kr', label: '한국', flag: '🇰🇷' },
    JP: { file: 'data/jp_db.json', page: 'jp', label: '일본', flag: '🇯🇵' }
  };

  var KR_KEYS = ['국내음원', '음반·팬덤', '공연', '글로벌', '국내인지도', '현재기세'];
  var JP_KEYS = ['공연·현장', '팬덤·구매력', '대중인지도', '스트리밍·SNS', '현재기세', '업계영향력'];

  /* ---------- 숫자 / 결측 ---------- */
  function toFiniteNumber(v) {
    if (typeof v === 'string') { if (!v.trim()) return null; v = Number(v); }
    else if (typeof v !== 'number') return null;
    return isFinite(v) ? v : null;
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

  // 결측 component 는 점수를 만들지 않는다(available:false). 50 같은 중간값으로 대체하지 않는다.
  function comp(name, score, weight, confidence) {
    var ok = isNum(score);
    return { name: name, score: ok ? score : null, weight: weight, available: ok, confidence: ok ? (confidence == null ? 1 : confidence) : 0 };
  }
  // 관측된 component 만으로 가중 평균을 내고, 남은 weight 를 재정규화한다. coverage = 사용 weight / 전체 weight
  function weightedObservedAverage(components) {
    var observed = components.filter(function (x) { return x.available && isNum(x.score); });
    var total = components.reduce(function (s, x) { return s + x.weight; }, 0);
    if (!observed.length || !total) return { score: null, coverage: 0, usedWeight: 0 };
    var used = observed.reduce(function (s, x) { return s + x.weight; }, 0);
    if (!used) return { score: null, coverage: 0, usedWeight: 0 };
    return { score: observed.reduce(function (s, x) { return s + x.score * x.weight; }, 0) / used, coverage: used / total, usedWeight: used };
  }

  // tie-aware midrank percentile (0~100). 값이 없으면 null (50 으로 대체하지 않음)
  function percentileRank(value, values) {
    var v = toFiniteNumber(value);
    if (v === null) return null;
    var valid = values.map(toFiniteNumber).filter(isNum).sort(function (a, b) { return a - b; });
    if (!valid.length) return null;
    if (valid.length === 1) return 100;
    var less = valid.filter(function (x) { return x < v; }).length;
    var equal = valid.filter(function (x) { return x === v; }).length;
    return ((less + (Math.max(equal, 1) - 1) / 2) / (valid.length - 1)) * 100;
  }
  function buildPercentileMaps(rows, keys) {
    var m = {};
    keys.forEach(function (k) { m[k] = rows.map(function (r) { return toFiniteNumber(r[k]); }); });
    return m;
  }
  // [[값, weight], ...] — 하나라도 결측이면 그 축은 null (부분값으로 조용히 대체하지 않는다)
  function combine(pairs) {
    var s = 0;
    for (var i = 0; i < pairs.length; i++) { if (!isNum(pairs[i][0])) return null; s += pairs[i][0] * pairs[i][1]; }
    return s;
  }

  /* ---------- 스타일 태그 ---------- */
  // 토큰(스타일 문자열을 "/"로 나눈 조각)에 키워드가 포함되면 해당 공통 태그를 모두 부여한다. (DB 에 styleTags 가 없을 때의 fallback)
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

  // 동의어 → 표준 태그 (소문자 키)
  var STYLE_ALIASES = {
    '얼터': '얼터너티브', 'alt': '얼터너티브', 'alternative': '얼터너티브',
    'edm': '일렉트로', 'electro': '일렉트로', 'electronic': '일렉트로', '일렉': '일렉트로', '전자음악': '일렉트로',
    '락': '록', 'rock': '록', 'band': '밴드',
    'rnb': 'R&B', 'r&b': 'R&B', '알앤비': 'R&B', 'r n b': 'R&B',
    'hiphop': '힙합', 'hip-hop': '힙합', 'hip hop': '힙합', 'pop': '팝', 'kawaii': '카와이', 'dark': '다크', 'retro': '레트로',
    'performance': '퍼포먼스', 'girlcrush': '걸크러시', 'girl crush': '걸크러시', 'vocal': '보컬', 'global': '글로벌'
  };
  function canonicalTag(t) {
    var s = String(t == null ? '' : t).trim();
    if (!s) return '';
    var k = s.toLowerCase();
    return STYLE_ALIASES.hasOwnProperty(k) ? STYLE_ALIASES[k] : s;
  }
  function canonicalTags(list) {
    var out = [];
    (list || []).forEach(function (t) { var c = canonicalTag(t); if (c && out.indexOf(c) === -1) out.push(c); });
    return out;
  }

  // 같은 카테고리 = 0.72 (exact 1.0, 명시적 관련쌍 0.35~0.9, 그 외 0)
  var STYLE_CATEGORY = {
    ROYAL_CUTE: ['왕도', '카와이', '청순', '청춘'],
    PERFORMANCE: ['퍼포먼스', '걸크러시', '쿨'],
    ROCK_ALT: ['록', '밴드', '얼터너티브', '다크'],
    URBAN: ['힙합', 'R&B', '보컬'],
    ELECTRO: ['일렉트로', '실험적'],
    POP: ['팝', '글로벌', '세련됨']
  };
  var CATEGORY_LABEL = { ROYAL_CUTE: '왕도·카와이', PERFORMANCE: '퍼포먼스', ROCK_ALT: '록·얼터', URBAN: '힙합·R&B', ELECTRO: '일렉트로', POP: '팝' };
  var CATEGORY_OF = {};
  Object.keys(STYLE_CATEGORY).forEach(function (c) { STYLE_CATEGORY[c].forEach(function (t) { CATEGORY_OF[t] = c; }); });
  var SAME_CATEGORY_SIM = 0.72;

  var RELATED_STYLE_WEIGHTS = {
    '청순|왕도': 0.70, '청춘|왕도': 0.70, '카와이|왕도': 0.80, '걸크러시|쿨': 0.80,
    '록|얼터너티브': 0.80, '밴드|록': 0.90, '힙합|퍼포먼스': 0.60, '몽환|청순': 0.60,
    'R&B|보컬': 0.70, '일렉트로|실험적': 0.70, '다크|쿨': 0.70,
    '팝|왕도': 0.50, '팝|카와이': 0.55, '퍼포먼스|쿨': 0.50,
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
  // V2 기본 가중치: 스타일을 가장 중요하게 유지 (합 1.0). 결측 dimension 은 제외 후 재정규화된다.
  var DEFAULT_WEIGHTS = { style: 0.45, live: 0.13, fandom: 0.12, popularity: 0.10, digital: 0.10, momentum: 0.05, activity: 0.05 };
  var weights = Object.assign({}, DEFAULT_WEIGHTS);

  // 추천 최소 품질: 무조건 TOP N 을 채우지 않는다
  var QUALITY = { minScore: 58, minStyle: 40, minCoverage: 0.55, limitedCoverage: 0.70, relaxScore: 50, relaxStyle: 30 };
  // 숨은 취향 발견 기준
  var GEM = { minStyle: 60, minScore: 62, maxPopularity: 65, bonusFrom: 70, bonusRate: 0.35 };
  var RERANK = { pool: 12, sameLineage: 2.5, nearDuplicateStyle: 2 };

  // 소개글 키워드 보조 태그 (스타일 필드에서 태그가 3개 미만일 때만)
  var DESC_KEYWORDS = [
    ['청순', '청순'], ['청춘', '청춘'], ['카와이', '카와이'], ['귀여', '카와이'], ['퍼포먼스', '퍼포먼스'], ['댄스', '퍼포먼스'],
    ['걸크러시', '걸크러시'], ['쿨', '쿨'], ['밴드', '밴드'], ['록', '록'], ['힙합', '힙합'], ['R&B', 'R&B'],
    ['일렉트로', '일렉트로'], ['EDM', '일렉트로'], ['몽환', '몽환'], ['다크', '다크'], ['레트로', '레트로'],
    ['실험', '실험적'], ['서브컬처', '서브컬처'], ['보컬', '보컬'], ['시티팝', '레트로']
  ];
  function enrichTags(tags, desc) {
    if (tags.length >= 3 || !desc) return tags;
    var hits = [];
    DESC_KEYWORDS.forEach(function (k) {
      var n = desc.split(k[0]).length - 1;
      if (n > 0 && tags.indexOf(k[1]) === -1) {
        var e = hits.filter(function (h) { return h.t === k[1]; })[0];
        if (e) e.n += n; else hits.push({ t: k[1], n: n });
      }
    });
    hits.sort(function (a, b) { return b.n - a.n || (a.t < b.t ? -1 : 1); });
    return tags.concat(hits.slice(0, 3 - tags.length > 2 ? 2 : 3 - tags.length).map(function (h) { return h.t; }));
  }
  function extractStyleTags(styleText, desc) {
    var tags = [];
    String(styleText || '').split('/').forEach(function (tok) {
      tok = tok.trim();
      STYLE_KEYWORD_MAP.forEach(function (rule) {
        if (tok.indexOf(rule[0]) !== -1) rule[1].forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
      });
    });
    return enrichTags(tags, desc);
  }
  // DB 의 styleTags(명시 저장)를 우선하고, 없으면 자유문자열 파싱으로 fallback
  function resolveStyleTags(row) {
    var explicit = row.styleTags || row['스타일태그'];
    if (Array.isArray(explicit) && explicit.length) return { tags: canonicalTags(explicit), source: 'db' };
    return { tags: canonicalTags(extractStyleTags(row['스타일'], row['소개글'])), source: 'parsed' };
  }

  function getRelatedStyleWeight(a, b) {
    if (a === b) return 1;
    var w = RELATED_STYLE_WEIGHTS[a + '|' + b];
    if (w === undefined) w = RELATED_STYLE_WEIGHTS[b + '|' + a];
    return w === undefined ? 0 : w;
  }
  // 3단계: exact(1.0) → same category(0.72) → explicit related(0.35~0.9) → unrelated(0)
  function tagSimilarity(a, b) {
    if (a === b) return 1;
    var rel = getRelatedStyleWeight(a, b);
    var ca = CATEGORY_OF[a], cb = CATEGORY_OF[b];
    if (ca && ca === cb) return Math.max(SAME_CATEGORY_SIM, rel);
    return rel;
  }

  // 전체 DB 에서 흔한 태그(팝·퍼포먼스 등)는 specificity 를 낮춘다: idf = ln((N+1)/(count+1)) + 1
  var tagStats = { n: 0, count: {} };
  function idf(tag) {
    if (!tagStats.n) return 1;
    return Math.log((tagStats.n + 1) / ((tagStats.count[tag] || 0) + 1)) + 1;
  }

  // 방향별 best-match(가중). from 의 각 태그가 to 에서 가장 비슷한 태그와 얼마나 닮았는가
  function directionalStyleScore(fromTags, toTags, weightOf) {
    var num = 0, den = 0;
    fromTags.forEach(function (s) {
      var best = 0;
      toTags.forEach(function (t) { best = Math.max(best, tagSimilarity(s, t)); });
      var w = weightOf(s);
      num += best * w; den += w;
    });
    return den ? num / den : null;
  }
  // 태그가 없으면 null (50 이 아니다). 양방향 평균이라 태그가 많은 그룹이 무조건 유리하지 않다.
  // aWeights: 최애 프로필용 {tag: weight(0~1)} — 없으면 균등
  function calculateStyleSimilarity(aTags, bTags, aWeights) {
    if (!aTags || !bTags || !aTags.length || !bTags.length) return null;
    var ab = directionalStyleScore(aTags, bTags, function (t) { return (aWeights ? (aWeights[t] || 0) : 1) * idf(t); });
    var ba = directionalStyleScore(bTags, aTags, idf);
    if (ab === null || ba === null) return null;
    return ((ab + ba) / 2) * 100;
  }
  function calculateNumericSimilarity(a, b) {
    if (!isNum(a) || !isNum(b)) return null;
    return Math.max(0, 100 - Math.abs(a - b));
  }

  function baseActivity(a, b) {
    if (a === b) return 100;
    var v = ACTIVITY_MAP[a + '|' + b];
    if (v === undefined) v = ACTIVITY_MAP[b + '|' + a];
    return v === undefined ? 60 : v;
  }
  // 활동형태 정보가 없으면(unknown) null — 한국 기본값을 '메이저'로 강제하지 않는다.
  function calculateActivityTypeSimilarity(a, b) {
    if (!a || !b || a === 'unknown' || b === 'unknown') return null;
    var best = 0;
    String(a).split('/').forEach(function (x) { String(b).split('/').forEach(function (y) { best = Math.max(best, baseActivity(x, y)); }); });
    return best;
  }

  /* ---------- 데이터 신뢰도 ---------- */
  // 검증상태 → 가중치: 공식확인 1.0 / 1차 검증완료 0.95 / 부분검증·인원변동 0.8 / 추가검증필요 0.6 / 확인필요 0.4
  function verificationWeight(status) {
    var s = String(status || '');
    if (/확인필요|미확인/.test(s) && !/추가검증필요/.test(s)) return 0.4;
    if (/추가검증필요/.test(s)) return 0.6;
    if (/부분검증|인원변동/.test(s)) return 0.8;
    if (/1차 ?검증완료/.test(s)) return 0.95;
    if (/공식/.test(s)) return 1.0;
    return 0.8;
  }
  function confidenceLabel(c) { return c >= 0.85 ? '높음' : c >= 0.65 ? '보통' : '낮음'; }

  /* ---------- 정규화 ---------- */
  function finishGroup(g) {
    var dims = ['popularity', 'fandom', 'live', 'digital', 'momentum'];
    var observed = dims.filter(function (k) { return isNum(g.vec[k]); }).length;
    g.completeness = (observed + (g.styleTags.length ? 1 : 0)) / (dims.length + 1);
    g.verificationWeight = verificationWeight(g.verification);
    g.dataConfidence = g.completeness * g.verificationWeight;
    return g;
  }

  function normalizeKoreanGroup(r, maps) {
    var P = function (k) { return percentileRank(r[k], maps[k]); };
    var music = P('국내음원'), st = resolveStyleTags(r);
    return finishGroup({
      country: 'KR', id: r.id, name: r['그룹'], slug: r.slug, tier: r['티어'], total: toFiniteNumber(r['총점']), totalPct: P('총점'), status: r['활동상태'] || '',
      styleRaw: r['스타일'], styleTags: st.tags, tagSource: st.source,
      // 한국 DB 에는 활동형태 필드가 없다 → 정보가 없으면 unknown (하드코딩 override 없음)
      activityType: r['활동형태'] || 'unknown', gen: r['세대'] || '', lineage: '',
      verification: r['검증상태'] || '', spotify: firstSpotify(r),
      vec: {
        popularity: combine([[P('국내인지도'), 0.60], [music, 0.40]]),
        fandom: P('음반·팬덤'),
        live: P('공연'),
        digital: combine([[P('글로벌'), 0.65], [music, 0.35]]),
        momentum: P('현재기세')
      }
    });
  }

  function normalizeJapaneseGroup(r, maps) {
    var P = function (k) { return percentileRank(r[k], maps[k]); };
    var sns = P('스트리밍·SNS'), st = resolveStyleTags(r);
    return finishGroup({
      country: 'JP', id: r.id, name: r['그룹'], slug: String(r.id || '').toLowerCase(), tier: r['티어'], total: toFiniteNumber(r['총점']), totalPct: P('총점'), status: r['활동상태'] || '',
      styleRaw: r['스타일'], styleTags: st.tags, tagSource: st.source,
      activityType: r['활동형태'] || 'unknown', gen: '', lineage: r['계열'] || '',
      verification: r['검증상태'] || '', spotify: firstSpotify(r),
      vec: {
        popularity: combine([[P('대중인지도'), 0.70], [sns, 0.30]]),
        fandom: P('팬덤·구매력'),
        live: P('공연·현장'),
        digital: sns,
        momentum: P('현재기세')
      }
    });
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

  /* ---------- 매칭 (V2) ---------- */
  function matchComponents(src, tgt) {
    var w = weights, sv = src.vec, tv = tgt.vec;
    return [
      comp('style', calculateStyleSimilarity(src.styleTags, tgt.styleTags, src.tagWeights), w.style),
      comp('live', calculateNumericSimilarity(sv.live, tv.live), w.live),
      comp('fandom', calculateNumericSimilarity(sv.fandom, tv.fandom), w.fandom),
      comp('popularity', calculateNumericSimilarity(sv.popularity, tv.popularity), w.popularity),
      comp('digital', calculateNumericSimilarity(sv.digital, tv.digital), w.digital),
      comp('momentum', calculateNumericSimilarity(sv.momentum, tv.momentum), w.momentum),
      comp('activity', calculateActivityTypeSimilarity(src.activityType, tgt.activityType), w.activity)
    ];
  }
  function breakdownOf(components) {
    var b = {}; components.forEach(function (c) { b[c.name] = c.available ? c.score : null; }); return b;
  }
  function dcOf(g) { return isNum(g.dataConfidence) ? g.dataConfidence : 1; }

  // 결과 하나: matchScore(취향 유사도)와 confidence(결과 신뢰도)를 분리한다. 정렬에는 약한 보정만 쓴다.
  function scoreMatch(src, tgt) {
    var comps = matchComponents(src, tgt), agg = weightedObservedAverage(comps);
    var confidence = agg.score === null ? 0 : Math.min(1, agg.coverage) * Math.sqrt(dcOf(src) * dcOf(tgt));
    var raw = agg.score === null ? null : agg.score;
    return {
      group: tgt, raw: raw, score: raw === null ? null : Math.round(raw), coverage: agg.coverage, confidence: confidence,
      rankingScore: raw === null ? -1 : raw * (0.85 + 0.15 * confidence),
      breakdown: breakdownOf(comps), components: comps, diversityPenalty: 0
    };
  }
  function calculateMatchBreakdown(src, tgt) { return breakdownOf(matchComponents(src, tgt)); }
  function calculateMatchScore(b) { // 하위 호환: 관측된 dimension 만으로 재정규화
    var comps = Object.keys(weights).map(function (k) { return comp(k, b[k], weights[k]); });
    var agg = weightedObservedAverage(comps);
    return agg.score === null ? null : Math.round(agg.score);
  }

  // 결정적 정렬: 보정점수 ↓, 신뢰도 ↓, 스타일 ↓, id ↑ — 입력 배열 순서에 의존하지 않는다.
  function compareResults(x, y) {
    var xs = x.breakdown && isNum(x.breakdown.style) ? x.breakdown.style : -1, ys = y.breakdown && isNum(y.breakdown.style) ? y.breakdown.style : -1;
    return (y.rankingScore - x.rankingScore) || (y.confidence - x.confidence) || (ys - xs) || String(x.group.id).localeCompare(String(y.group.id));
  }
  function passesQuality(m) {
    return m.score !== null && m.score >= QUALITY.minScore && isNum(m.breakdown.style) && m.breakdown.style >= QUALITY.minStyle && m.coverage >= QUALITY.minCoverage;
  }
  function passesRelaxed(m) {
    return m.score !== null && m.score >= QUALITY.relaxScore && isNum(m.breakdown.style) && m.breakdown.style >= QUALITY.relaxStyle && m.coverage >= QUALITY.minCoverage;
  }

  var REASON_TEXT = [
    ['style', '음악·콘셉트 취향이 매우 비슷함'],
    ['live', '라이브 성향이 비슷함'],
    ['fandom', '팬덤 규모와 소비 성향이 비슷함'],
    ['popularity', '대중성 포지션이 비슷함'],
    ['digital', '디지털 반응 성향이 비슷함'],
    ['momentum', '현재 상승세가 비슷함']
  ];
  function generateMatchReason(b) {
    var val = function (k) { return isNum(b[k]) ? b[k] : -1; };
    var cand = REASON_TEXT.filter(function (r) { return val(r[0]) >= 85; }).sort(function (x, y) { return val(y[0]) - val(x[0]); });
    if (!cand.length) cand = REASON_TEXT.filter(function (r) { return val(r[0]) >= 70; }).sort(function (x, y) { return val(y[0]) - val(x[0]); });
    if (!cand.length) return ['전반적인 성향이 고르게 닮은 팀'];
    return cand.slice(0, 2).map(function (r) { return r[1]; });
  }

  function describeGroup(g) {
    var out = g.styleTags.filter(function (t) { return t !== '세련됨'; }).slice(0, 2);
    var v = g.vec;
    if (isNum(v.fandom) && v.fandom >= 75) out.push('강한 팬덤');
    else if (isNum(v.live) && v.live >= 75) out.push('라이브형');
    else if (isNum(v.digital) && v.digital >= 75) out.push('디지털 강세');
    else if (isNum(v.momentum) && v.momentum >= 75) out.push('상승세');
    return out;
  }

  function decorate(m) {
    m.reasons = generateMatchReason(m.breakdown);
    m.tags = describeGroup(m.group);
    m.limited = m.coverage < QUALITY.limitedCoverage || m.confidence < 0.6;
    m.confidenceLabel = confidenceLabel(m.confidence);
    m.debug = {
      usedWeights: m.components.filter(function (c) { return c.available; }).map(function (c) { return [c.name, +(c.weight).toFixed(3)]; }),
      missing: m.components.filter(function (c) { return !c.available; }).map(function (c) { return c.name; }),
      coverage: +m.coverage.toFixed(3), confidence: +m.confidence.toFixed(3), rankingScore: +m.rankingScore.toFixed(2),
      diversityPenalty: m.diversityPenalty, tieBreak: '보정점수→신뢰도→스타일→id'
    };
    return m;
  }

  // 다양성 재정렬(MMR 성격): 상위 후보 pool 안에서 같은 계열/동일 스타일 복제본에 작은 감점만 준다.
  // 감점이 작아서 실제 유사도 차이가 크면 순서를 뒤집지 않는다.
  function diversify(sorted, limit) {
    var pool = sorted.slice(0, RERANK.pool), picked = [];
    while (picked.length < limit && pool.length) {
      var bestI = -1, bestAdj = -Infinity;
      for (var i = 0; i < pool.length; i++) {
        var c = pool[i], pen = 0;
        picked.forEach(function (p) {
          if (c.group.lineage && p.group.lineage === c.group.lineage && !/기타|독립|^—$/.test(c.group.lineage)) pen += RERANK.sameLineage;
          var a = p.group.styleTags, b = c.group.styleTags;
          if (a.length && a.length === b.length && a.every(function (t) { return b.indexOf(t) !== -1; })) pen += RERANK.nearDuplicateStyle;
        });
        var adj = c.rankingScore - pen;
        if (adj > bestAdj + 1e-9) { bestAdj = adj; bestI = i; }
      }
      var chosen = pool.splice(bestI, 1)[0];
      chosen.diversityPenalty = +(chosen.rankingScore - bestAdj).toFixed(2);
      picked.push(chosen);
    }
    return picked;
  }

  function rankTargets(src, targets, includeEnded) {
    return targets.filter(function (g) { return includeEnded || isActive(g); })
      .map(function (g) { return scoreMatch(src, g); })
      .filter(function (m) { return m.score !== null; })
      .sort(compareResults);
  }

  function getHiddenGems(src, targets, excludeNames, limit, includeEnded) {
    var ex = excludeNames || [];
    var c = rankTargets(src, targets, includeEnded).filter(function (m) {
      return ex.indexOf(m.group.name) === -1 && isNum(m.breakdown.style) && m.breakdown.style >= GEM.minStyle && m.score >= GEM.minScore &&
        isNum(m.group.vec.popularity) && m.group.vec.popularity <= GEM.maxPopularity && m.coverage >= QUALITY.minCoverage;
    }).map(function (m) {
      m.gemScore = m.score + Math.max(0, GEM.bonusFrom - m.group.vec.popularity) * GEM.bonusRate;
      return m;
    });
    c.sort(function (x, y) { return (y.gemScore - x.gemScore) || compareResults(x, y); });
    return c.slice(0, limit || 3).sort(compareResults).map(decorate);
  }

  /* ---------- 최애 (안정적인 id 로 저장) ---------- */
  var state = { groups: { KR: [], JP: [] }, byKey: {}, byId: {}, raw: { KR: [], JP: [] }, ready: false };

  function rawFavorites() {
    try {
      var v = JSON.parse(global.localStorage.getItem(FAVORITE_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function writeFavorites(list) {
    try { global.localStorage.setItem(FAVORITE_KEY, JSON.stringify(list)); } catch (e) { /* 저장 불가 환경 */ }
    try { global.dispatchEvent(new Event('idolfav')); } catch (e2) { /* noop */ }
  }
  function findBySlug(country, slug) {
    var l = state.groups[country] || [];
    for (var i = 0; i < l.length; i++) if (l[i].slug === slug) return l[i];
    return null;
  }
  function getGroupById(id) { return state.byId[id] || null; }
  // id 또는 이름(예전 저장 형식/딥링크)으로 그룹을 찾는다
  function resolveGroup(country, idOrName) {
    if (idOrName == null) return null;
    return state.byId[idOrName] || (country && state.byKey[country + '|' + idOrName]) || null;
  }
  function resolveFavItem(f) {
    if (!f) return null;
    return (f.id && state.byId[f.id]) || (f.group && state.byKey[f.country + '|' + f.group]) || (f.slug && findBySlug(f.country, f.slug)) || null;
  }
  // {country, id, slug, group(표시용)} — 데이터가 로드되기 전에는 저장된 값 그대로
  function getFavorites() {
    return rawFavorites().map(function (f) {
      var g = state.ready ? resolveFavItem(f) : null;
      if (!g) return { country: f.country, id: f.id || '', slug: f.slug || '', group: f.group || '' };
      return { country: g.country, id: g.id, slug: g.slug, group: g.name };
    }).filter(function (f) { return f.id || f.group; });
  }
  // 1회 migration: {country, group} → {country, id, slug}. 사라진 그룹은 보관하지 않는다.
  function migrateFavorites() {
    var raw = rawFavorites(), changed = false, out = [], seen = {};
    raw.forEach(function (f) {
      var g = resolveFavItem(f);
      if (!g || seen[g.id]) { changed = true; return; }
      seen[g.id] = 1;
      if (f.id !== g.id || f.slug !== g.slug || f.group !== undefined) changed = true;
      out.push({ country: g.country, id: g.id, slug: g.slug });
    });
    if (changed) { try { global.localStorage.setItem(FAVORITE_KEY, JSON.stringify(out)); } catch (e) { /* noop */ } }
  }
  function matchesFav(f, g) { return (f.id && f.id === g.id) || (!f.id && f.group === g.name && f.country === g.country); }
  function isFavorite(country, idOrName) {
    var g = state.ready ? resolveGroup(country, idOrName) : null;
    return rawFavorites().some(function (f) { return g ? matchesFav(f, g) : (f.id === idOrName || f.group === idOrName); });
  }
  function saveFavorite(country, idOrName) { // 토글, 새 상태(true=저장됨) 반환
    var g = state.ready ? resolveGroup(country, idOrName) : null;
    var list = rawFavorites(), i = -1;
    list.forEach(function (f, k) {
      if (i >= 0) return;
      if (g ? matchesFav(f, g) : (f.country === country && (f.id === idOrName || f.group === idOrName))) i = k;
    });
    if (i >= 0) { list.splice(i, 1); writeFavorites(list); return false; }
    list.push(g ? { country: g.country, id: g.id, slug: g.slug } : { country: country, group: idOrName });
    writeFavorites(list);
    return true;
  }
  function clearFavorites(country) {
    writeFavorites(rawFavorites().filter(function (f) { return country && f.country !== country; }));
  }

  function averageNumericProfile(vs) {
    var keys = ['popularity', 'fandom', 'live', 'digital', 'momentum'], o = {};
    keys.forEach(function (k) { var v = vs.map(function (x) { return x[k]; }).filter(isNum); o[k] = v.length ? mean(v) : null; });
    return o;
  }
  // 하위 호환/시각화용 평균 프로필. 추천 점수 계산에는 쓰지 않는다(다봉 취향이 평균으로 뭉개지므로).
  function buildFavoriteTasteProfile(groups) {
    var counts = {}, acts = {};
    groups.forEach(function (g) {
      g.styleTags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      if (g.activityType && g.activityType !== 'unknown') acts[g.activityType] = (acts[g.activityType] || 0) + 1;
    });
    var tw = {}, tags = Object.keys(counts);
    tags.forEach(function (t) { tw[t] = counts[t] / groups.length; });
    tags.sort(function (a, b) { return (counts[b] * idf(b) - counts[a] * idf(a)) || (a < b ? -1 : 1); });
    var act = Object.keys(acts).sort(function (a, b) { return acts[b] - acts[a] || (a < b ? -1 : 1); })[0] || 'unknown';
    return { vec: averageNumericProfile(groups.map(function (g) { return g.vec; })), styleTags: tags, tagWeights: tw, activityType: act };
  }

  // 후보 하나를 여러 최애에 대해 채점: profileScore = 가장 잘 맞는 최애 0.55 + 상위 2개 평균 0.45
  function profileMatch(favGroups, cand) {
    var per = favGroups.map(function (f) { var m = scoreMatch(f, cand); m.fav = f; return m; }).filter(function (m) { return m.score !== null; });
    if (!per.length) return null;
    per.sort(function (a, b) { return (b.raw - a.raw) || String(a.fav.id).localeCompare(String(b.fav.id)); });
    var best = per[0], top2Mean = mean(per.slice(0, 2).map(function (m) { return m.raw; }));
    var raw = best.raw * 0.55 + top2Mean * 0.45;
    var conf = mean(per.map(function (m) { return m.confidence; })), cov = mean(per.map(function (m) { return m.coverage; }));
    return {
      group: cand, raw: raw, score: Math.round(raw), coverage: cov, confidence: conf, rankingScore: raw * (0.85 + 0.15 * conf),
      breakdown: best.breakdown, components: best.components, diversityPenalty: 0, bestFavorite: best.fav, top2Mean: top2Mean, perFavorite: per
    };
  }

  // 2-cluster 분리(최애 5팀 이상): 4축 프로필 + 스타일 카테고리 벡터, 결정적 k-means
  function featureVec(g) {
    var v = g.vec, dims = ['popularity', 'fandom', 'live', 'digital'].map(function (k) { return isNum(v[k]) ? v[k] / 100 : null; });
    var known = dims.filter(function (x) { return x !== null; }), fill = known.length ? mean(known) : 0.5;
    var out = dims.map(function (x) { return x === null ? fill : x; });
    Object.keys(STYLE_CATEGORY).forEach(function (c) {
      var n = g.styleTags.filter(function (t) { return CATEGORY_OF[t] === c; }).length;
      out.push(g.styleTags.length ? n / g.styleTags.length : 0);
    });
    return out;
  }
  function dist(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }
  function clusterFavorites(groups) {
    if (!groups || groups.length < 5) return null;
    var gs = groups.slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); }), fv = gs.map(featureVec);
    var bi = 0, bj = 1, bd = -1;
    for (var i = 0; i < gs.length; i++) for (var j = i + 1; j < gs.length; j++) { var d = dist(fv[i], fv[j]); if (d > bd + 1e-12) { bd = d; bi = i; bj = j; } }
    var cents = [fv[bi].slice(), fv[bj].slice()], assign = [];
    for (var it = 0; it < 10; it++) {
      assign = fv.map(function (x) { return dist(x, cents[0]) <= dist(x, cents[1]) ? 0 : 1; });
      [0, 1].forEach(function (c) {
        var mem = fv.filter(function (_, k) { return assign[k] === c; });
        if (mem.length) cents[c] = cents[c].map(function (_, dim) { return mean(mem.map(function (m2) { return m2[dim]; })); });
      });
    }
    var A = gs.filter(function (_, k) { return assign[k] === 0; }), B = gs.filter(function (_, k) { return assign[k] === 1; });
    if (A.length < 2 || B.length < 2) return null;
    var within = mean(fv.map(function (x, k) { return dist(x, cents[assign[k]]); })), between = dist(cents[0], cents[1]);
    if (between < 0.45 || between < within * 1.5) return null; // 뚜렷한 두 취향군이 아니면 하나로 본다
    function label(list, name) {
      var cnt = {}; list.forEach(function (g) { g.styleTags.forEach(function (t) { var c = CATEGORY_OF[t]; if (c) cnt[c] = (cnt[c] || 0) + 1; }); });
      var top = Object.keys(cnt).sort(function (x, y) { return cnt[y] - cnt[x] || (x < y ? -1 : 1); }).slice(0, 2).map(function (c) { return CATEGORY_LABEL[c]; });
      return '취향 ' + name + (top.length ? ' · ' + top.join('/') : '');
    }
    return [{ key: 'A', label: label(A, 'A'), members: A }, { key: 'B', label: label(B, 'B'), members: B }];
  }

  /* ---------- 데이터 로드 ---------- */
  function fetchJson(url) {
    return fetch(url + '?v=' + DATA_VERSION).then(function (r) {
      if (!r.ok) throw new Error('fetch failed: ' + url);
      return r.json();
    });
  }
  // fetch가 막힌 환경(file:// 등)에서는 data/*.js(window.IDOL_DB_*)를 script 태그로 읽는다.
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var t = document.createElement('script');
      t.src = src + '?v=' + DATA_VERSION;
      t.onload = resolve; t.onerror = function () { reject(new Error('script failed: ' + src)); };
      document.head.appendChild(t);
    });
  }
  function loadCountry(c) {
    var info = COUNTRIES[c];
    return fetchJson(info.file).catch(function () {
      return loadScript(info.file.replace(/\.json$/, '.js')).then(function () { return global['IDOL_DB_' + c]; });
    });
  }

  var ready = Promise.all([loadCountry('KR'), loadCountry('JP')]).then(function (res) {
    var kr = Array.isArray(res[0]) ? res[0] : res[0].korea;
    var jp = Array.isArray(res[1]) ? res[1] : (res[1].japan || res[1]);
    state.raw.KR = kr; state.raw.JP = jp;
    var krMaps = buildPercentileMaps(kr, KR_KEYS.concat(['총점']));
    var jpMaps = buildPercentileMaps(jp, JP_KEYS.concat(['총점']));
    state.groups.KR = kr.map(function (r) { return normalizeKoreanGroup(r, krMaps); });
    state.groups.JP = jp.map(function (r) { return normalizeJapaneseGroup(r, jpMaps); });
    ['KR', 'JP'].forEach(function (c) {
      state.groups[c].forEach(function (g) {
        state.byKey[c + '|' + g.name] = g; state.byId[g.id] = g;
        g.styleTags.forEach(function (t) { tagStats.count[t] = (tagStats.count[t] || 0) + 1; });
        tagStats.n++;
      });
    });
    state.ready = true;
    migrateFavorites(); // 저장된 최애는 id 형식으로 1회 migration
    return state;
  });

  function otherCountry(c) { return c === 'KR' ? 'JP' : 'KR'; }

  // 교차 국가 추천. top: 품질 기준(점수·스타일·coverage)을 통과한 TOP N, 부족하면 취향 확장 후보로 채우고 notice 를 남긴다.
  function getMatches(country, name, opts) {
    opts = opts || {};
    var src = resolveGroup(country, name);
    if (!src) return null;
    var targets = state.groups[otherCountry(country)], limit = opts.limit || 3;
    var ranked = rankTargets(src, targets, opts.includeEnded);
    var top = diversify(ranked.filter(passesQuality), limit).map(decorate), notice = '';
    if (top.length < limit) {
      var have = top.map(function (m) { return m.group.id; });
      var fill = diversify(ranked.filter(function (m) { return passesRelaxed(m) && have.indexOf(m.group.id) === -1; }), limit - top.length)
        .map(function (m) { m = decorate(m); m.relaxed = true; return m; });
      if (fill.length) notice = '완전히 비슷한 팀이 적어 취향 확장 후보를 보여줍니다.';
      top = top.concat(fill);
    }
    var hidden = getHiddenGems(src, targets, top.map(function (m) { return m.group.name; }), opts.hiddenLimit || 3, opts.includeEnded);
    return { source: src, target: otherCountry(country), top: top, hidden: hidden, notice: notice };
  }

  // 최애 기반: 단일 평균 프로필이 아니라 (가장 잘 맞는 최애 0.55 + 상위 2개 평균 0.45). 5팀 이상이면 취향군 A/B 로 나눈다.
  function getFavoriteMatches(favs, targetCountry, limit, includeEnded) {
    var uniq = {}, groups = favs.map(resolveFavItem).filter(function (g) { if (!g || uniq[g.id]) return false; uniq[g.id] = 1; return true; });
    if (groups.length < 1) return null;
    var lim = limit || 5, targets = state.groups[targetCountry].filter(function (g) { return !uniq[g.id] && (includeEnded || isActive(g)); });
    var run = function (fg) {
      var ranked = targets.map(function (t) { return profileMatch(fg, t); }).filter(Boolean).sort(compareResults);
      var top = diversify(ranked.filter(passesQuality), lim).map(decorate);
      if (top.length < lim) {
        var have = top.map(function (m) { return m.group.id; });
        top = top.concat(diversify(ranked.filter(function (m) { return passesRelaxed(m) && have.indexOf(m.group.id) === -1; }), lim - top.length)
          .map(function (m) { m = decorate(m); m.relaxed = true; return m; }));
      }
      return top;
    };
    var clusters = clusterFavorites(groups);
    var out = { profile: buildFavoriteTasteProfile(groups), groups: groups, matches: run(groups), clusters: null };
    if (clusters) out.clusters = clusters.map(function (c) { return { key: c.key, label: c.label, groups: c.members, matches: run(c.members) }; });
    return out;
  }

  function setWeights(w) { // 합이 1이 되도록 정규화
    var merged = Object.assign({}, weights, w || {}), sum = 0;
    Object.keys(merged).forEach(function (k) { merged[k] = Math.max(0, Number(merged[k]) || 0); sum += merged[k]; });
    if (!sum) return getWeights();
    Object.keys(merged).forEach(function (k) { weights[k] = merged[k] / sum; });
    return getWeights();
  }
  function getWeights() { return Object.assign({}, weights); }
  function resetWeights() { weights = Object.assign({}, DEFAULT_WEIGHTS); return getWeights(); }

  // 유지보수용: DB 에 styleTags 를 직접 저장할 때 쓸 JSON (현재 파싱 결과)
  function exportStyleTags() {
    var out = {};
    ['KR', 'JP'].forEach(function (c) { state.groups[c].forEach(function (g) { out[g.id] = g.styleTags.slice(); }); });
    return out;
  }

  global.IdolMatch = {
    version: DATA_VERSION, normalizationVersion: NORMALIZATION_VERSION, countries: COUNTRIES, ready: ready,
    getMatches: getMatches, getFavoriteMatches: getFavoriteMatches,
    getRaw: function (c) { return state.raw[c]; }, getGroups: function (c) { return state.groups[c]; },
    getGroup: function (c, n) { return resolveGroup(c, n); }, getGroupById: getGroupById, percentileRank: percentileRank,
    setWeights: setWeights, getWeights: getWeights, resetWeights: resetWeights, defaultWeights: DEFAULT_WEIGHTS,
    getFavorites: getFavorites, saveFavorite: saveFavorite, isFavorite: isFavorite, clearFavorites: clearFavorites, migrateFavorites: migrateFavorites,
    exportStyleTags: exportStyleTags, quality: QUALITY,
    // SAME SCENE / DISCOVER 가 재사용하는 공통 유틸
    util: {
      toFiniteNumber: toFiniteNumber, comp: comp, weightedObservedAverage: weightedObservedAverage,
      calculateNumericSimilarity: calculateNumericSimilarity, calculateStyleSimilarity: calculateStyleSimilarity,
      tagSimilarity: tagSimilarity, idf: idf, canonicalTag: canonicalTag, canonicalTags: canonicalTags, STYLE_CATEGORY: STYLE_CATEGORY, CATEGORY_OF: CATEGORY_OF,
      isActive: isActive, buildFavoriteTasteProfile: buildFavoriteTasteProfile, describeGroup: describeGroup, verificationWeight: verificationWeight,
      confidenceLabel: confidenceLabel, compareResults: compareResults, diversify: diversify, clusterFavorites: clusterFavorites, profileMatch: profileMatch, scoreMatch: scoreMatch
    },
    // 테스트/검증용
    _internals: {
      percentileRank: percentileRank, extractStyleTags: extractStyleTags, calculateStyleSimilarity: calculateStyleSimilarity,
      calculateMatchBreakdown: calculateMatchBreakdown, calculateMatchScore: calculateMatchScore, isActive: isActive,
      state: state, buildFavoriteTasteProfile: buildFavoriteTasteProfile, tagStats: tagStats, weightedObservedAverage: weightedObservedAverage
    }
  };
})(window);
