# IDOL TIER HISTORY SUITE V3
## Product & Technical Specification

> **Product thesis**  
> 이 프로젝트의 다음 단계는 현재 순위를 더 화려하게 보여주는 것이 아니다.  
> 2025년부터 축적된 월별 snapshot을 이용해 **“누가 몇 위인가”에서 “어떻게 움직여 왔는가”로 질문을 확장하는 것**이다.

---

## 1. Executive Summary

현재 서비스에는 한국·일본 여자아이돌 랭킹, 상세 팝업, 월별 순위 추이, 비교, DISCOVER, SAME SCENE, IDOL MATCH, IDOL MAP이 존재한다.

월별 history는 `data/history/index.json`을 기준으로 관리되며, 각 snapshot에는 다음 핵심 정보가 저장된다.

- `meta.country`
- `meta.period`
- `meta.published_at`
- `meta.population_count`
- `meta.normalization_version`
- `groups[].id`
- `groups[].group`
- `groups[].rank`
- `groups[].tier`
- `groups[].score`
- `groups[].metrics`

새 기능은 이 history를 기반으로 다음 4개 경험을 제공한다.

| Priority | Feature | Purpose |
|---|---|---|
| P0 | TIME MACHINE | 특정 월의 시장을 그대로 재생 |
| P0 | RECORD BOOK | 누적 history에서 역대 기록 자동 산출 |
| P0 | MOVERS | 월간/기간별 변화와 평가항목 delta 분석 |
| P1 | MAP REPLAY | 월별 시장 포지션 이동을 지도에서 재생 |

---

## 2. Editorial Identity

### 2.1 서비스가 말해야 하는 것

- 어떤 그룹이 특정 월에 어느 위치였는가
- 이전 월과 비교해 상대적 위치가 어떻게 바뀌었는가
- 어떤 평가항목 점수가 변했는가
- 장기간 어떤 패턴을 보였는가
- 시장 지도에서 어느 방향으로 이동했는가

### 2.2 서비스가 말하지 말아야 하는 것

- “A가 B보다 음악적으로 우월하다”
- “인기가 망했다”
- “컴백 때문에 올랐다”처럼 데이터에 없는 인과
- 한국과 일본 절대점수의 직접 우열
- 순위 하락 = 실력 하락이라는 해석
- 팬덤 자극을 위한 선정적 승패 표현

### 2.3 카피 원칙

좋은 표현:
- `전월 대비 시장 내 상대 위치 +8.4%p`
- `평가항목상 국내음원과 글로벌 점수가 상승`
- `최근 3개월 연속 순위 위치 상승`
- `2025.08 이후 최고 순위 갱신`

피할 표현:
- `폭망`
- `압살`
- `완전히 추락`
- `무조건 대세`
- `역대 최강`

---

# 3. Information Architecture

## 3.1 Main Navigation

새 메뉴:

`HISTORY`

권장 URL:

`/history.html`

## 3.2 HISTORY 내부

```text
HISTORY
├─ TIME MACHINE
├─ MOVERS
├─ RECORD BOOK
└─ MAP REPLAY → idol-map.html history mode
```

권장 query:

```text
history.html?country=KR&period=2025-06&view=timeline
history.html?country=JP&period=2026-03&view=movers
history.html?country=KR&view=records
idol-map.html?country=KR&period=2025-06&history=1
```

URL은 UI state와 동기화한다.

---

# 4. Data Contract

## 4.1 Source of truth

```text
data/history/index.json
data/history/kr/YYYY-MM.json
data/history/jp/YYYY-MM.json
```

snapshot의 `rank`가 공식 rank다.

**금지:**

```js
snapshot.groups
  .sort((a,b) => b.score - a.score)
  .map((g,i) => ({ ...g, rank:i+1 }))
```

동점이 깨지므로 절대 사용하지 않는다.

## 4.2 Country separation

KR과 JP는 다른 평가배점 체계다.

따라서:

- KR absolute score ↔ JP absolute score 비교 금지
- KR tier ↔ JP tier로 통합 역대기록 생성 금지
- records는 국가별 생성
- cross-country visualization이 필요하면 자국 percentile만 사용

## 4.3 Missing data

- 없는 월: 보간하지 않음
- 해당 월에 없는 group: 없음으로 처리
- 이전월에 없고 현재월에 존재: `NEW`
- metric가 한쪽에 없으면 해당 metric delta는 `N/A`

---

# 5. Shared Analytics Layer

신규 권장:

```text
js/history-analytics.js
```

UI와 순수 계산을 분리한다.

## 5.1 Public API

```js
window.HistoryAnalytics = {
  isConsecutiveMonth,
  previousPeriod,
  periodRange,

  entryById,
  compareEntries,
  compareSnapshots,
  metricDelta,

  groupHistoryUntil,
  computeStreaks,
  computeGroupRecords,
  computeRecords,
  computeMovers,

  snapshotToMapRows
};
```

기존 `RankHistory`의 다음 API는 재사용한다.

```js
RankHistory.loadHistoryIndex()
RankHistory.loadCountrySnapshot()
RankHistory.loadAll()
RankHistory.extractGroupHistory()
RankHistory.getRankPositionPercentile()
RankHistory.getRankDelta()
RankHistory.getScoreDelta()
RankHistory.monthIndex()
```

중복 구현을 피한다.

---

# 6. TIME MACHINE

## 6.1 User story

> “2025년 6월 당시 한국 걸그룹 판도가 어땠는지 보고 싶다.”

사용자는 선택한 달을 **현재 페이지와 동일한 밀도의 월간 아카이브**로 볼 수 있어야 한다.

## 6.2 Hero

```text
HISTORY / TIME MACHINE

2025.06
KOREA — MONTHLY SNAPSHOT

64 GROUPS EVALUATED
```

controls:

```text
[←] [2025.06 ▼] [→]
[KR] [JP]
```

desktop에는 추가로 month rail:

```text
25.01  25.02  25.03 ... 26.09
                      ●
```

## 6.3 Snapshot summary

카드:

- 평가 팀 수
- 1위
- 평균 score
- S+/S 팀 수
- NEW entry 수

평균 score는 UI 참고값일 뿐 국가 간 비교에 사용하지 않는다.

## 6.4 TOP section

`TOP 5 RANKS`

동점 보존:

```js
groups.filter(g => g.rank <= 5)
```

따라서 5위 동점이 3팀이면 7팀이 표시될 수 있다.

## 6.5 Full ranking

컬럼:

```text
Rank
Movement
Group
Tier
Score
Top metric / optional
```

movement:
- ▲N
- ▼N
- –
- NEW

hover / tap:
- score delta
- percentile movement

## 6.6 Historical detail

선택 period보다 뒤의 데이터는 통계에서 제외한다.

예:

```text
IVE
2025.06 ARCHIVE

#3 ▲2
91점 · S

전월 #5
당시 최고 #1 · 2025.03
기록 기간 2025.01–2025.06
```

탭:

```text
[SUMMARY] [METRICS] [CAREER LINE]
```

CAREER LINE의 end period는 선택한 month다.

CTA:
- `현재 기록 보기`
- `2025.06 지도에서 보기`

---

# 7. RECORD BOOK

## 7.1 Philosophy

기록은 편집자가 수동 선정하지 않는다.

**명시된 수학적 기준을 history 전체에 적용해 자동 계산**한다.

## 7.2 Rank records

### Most #1 months

```text
count(history where rank === 1)
```

공동 1위도 1위 기록 1개월로 인정한다.

### Longest #1 streak

연속 calendar month + rank === 1.

### TOP 5 / TOP 10 months

```text
rank <= 5
rank <= 10
```

### Longest TOP 5 / TOP 10 streak

그룹이 한 달 누락되면 streak break.

## 7.3 Score records

- max score
- period of first max score
- biggest MoM score gain
- biggest MoM score loss

동일 max score가 여러 달이면:
- 대표 카드에는 최초 달
- detail에는 모든 달 표시

## 7.4 Movement records

`rawDelta = prev.rank - cur.rank`

그러나 record ranking은 다음을 사용:

```js
prevPct = RankHistory.getRankPositionPercentile(
  prev.rank,
  prevPopulation
)

curPct = RankHistory.getRankPositionPercentile(
  cur.rank,
  curPopulation
)

movement = curPct - prevPct
```

표시:

```text
#31 → #16  ▲15
+18.6%p
```

NEW는 제외.

## 7.5 Career longevity

- months tracked
- first period
- latest period
- S+/S months
- A+ 이상 months
- record coverage

coverage:

```text
그룹이 등장한 snapshot 수 / 해당 국가 전체 snapshot 수
```

“활동 기간”이라고 부르지 않는다.
history에 잡힌 기간과 실제 활동기간은 다를 수 있다.

## 7.6 Filters

```text
Country: KR / JP
Range: ALL / 2025 / 2026 YTD
Category: Rank / Score / Movement / Longevity
```

---

# 8. MOVERS

## 8.1 Default comparison

선택 period vs 바로 이전 snapshot.

```text
2026.08 → 2026.09
```

## 8.2 Custom comparison

```text
FROM [2025.01]
TO   [2026.09]
```

장기간 비교일 때:
- raw rank delta
- percentile movement
- score delta
를 표시한다.

“월간 최대 상승” 기록과 custom range 상승을 혼동하지 않는다.

## 8.3 Categories

```text
RANK UP
RANK DOWN
SCORE UP
SCORE DOWN
MOMENTUM UP
TIER UP
NEW PEAK
NEW ENTRY
```

## 8.4 Deterministic ordering

Rank movers:

```text
1. abs/dir percentile movement
2. score delta
3. id ascending
```

Score movers:

```text
1. score delta
2. percentile movement
3. id
```

## 8.5 Why It Moved

### KR labels

| key | label |
|---|---|
| domestic_digital | 국내음원 |
| album_fandom | 음반·팬덤 |
| performance | 공연 |
| global | 글로벌 |
| recognition | 국내인지도 |
| momentum | 현재기세 |

### JP labels

| key | label |
|---|---|
| live | 공연·현장 |
| fandom | 팬덤·구매력 |
| recognition | 대중인지도 |
| streaming_sns | 스트리밍·SNS |
| momentum | 현재기세 |
| industry | 업계영향력 |

정렬:
- positive delta 큰 순
- negative delta 절대값 큰 순

예:

```text
평가항목상 주요 변화
↑ 국내음원 +2
↑ 글로벌 +2
↑ 현재기세 +1
↓ 공연 -1
```

단어 `원인` 대신 `평가항목상 주요 변화`를 기본으로 한다.

## 8.6 Editor's Watch

편집자 취향으로 고르지 않는다.

객관 규칙 예:

### THREE-MONTH CLIMBER
최근 3개 비교구간 모두:

```text
percentile movement > 0
```

### SCORE STREAK
최근 3개 비교구간 모두:

```text
scoreDelta > 0
```

### PEAK RUN
최근 3개월 중 `newPeak >= 2`

### TIER HOLD
tierUp 이후 2개 이상 snapshot에서 하락 없이 유지.

카드에 rule을 그대로 보여준다.

---

# 9. MAP REPLAY

## 9.1 Core rule

과거 map은 각 snapshot의 당시 분포로 계산한다.

**현재 logical coordinate를 재사용하지 않는다.**

현재 좌표 정의:

```text
xRaw = public - fandom
yRaw = live - digital
```

이후:
- robust scale
- tanh projection
- logical coordinate
- zone classification

순서는 그대로 유지한다.

## 9.2 Historical row adapter

### KR

```js
{
  id: g.id,
  그룹: g.group,
  티어: g.tier,
  총점: g.score,
  국내음원: g.metrics.domestic_digital,
  "음반·팬덤": g.metrics.album_fandom,
  공연: g.metrics.performance,
  글로벌: g.metrics.global,
  국내인지도: g.metrics.recognition,
  현재기세: g.metrics.momentum
}
```

### JP

```js
{
  id: g.id,
  그룹: g.group,
  티어: g.tier,
  총점: g.score,
  "공연·현장": g.metrics.live,
  "팬덤·구매력": g.metrics.fandom,
  대중인지도: g.metrics.recognition,
  "스트리밍·SNS": g.metrics.streaming_sns,
  현재기세: g.metrics.momentum,
  업계영향력: g.metrics.industry
}
```

## 9.3 Required refactor

`idol-recommendation-core.js`

추가:

```js
function logicalPointsFromRows(country, rows, cacheKey) {
  // existing logicalPoints core
}
```

기존:

```js
function logicalPoints(country) {
  return logicalPointsFromRows(
    country,
    IM.getRaw(country),
    "current:" + country
  );
}
```

historical:

```js
const rows = HistoryAnalytics.snapshotToMapRows(country, snapshot);
const map = IdolRec.logicalPointsFromRows(
  country,
  rows,
  "history:" + country + ":" + period
);
```

이 방식으로 현재 map 알고리즘과 historical map 알고리즘이 갈라지는 것을 막는다.

## 9.4 Replay controls

```text
[←] 2025.06 [→]
[▶ PLAY]
[0.75x] [1x] [1.5x] [2x]

TRAIL
[OFF] [3M] [6M] [12M] [ALL]
```

## 9.5 Animation

같은 id:
- current point → next point transition

new id:
- fade in

disappeared id:
- fade out

`prefers-reduced-motion: reduce`:
- animation 없이 즉시 위치 변경

## 9.6 Trail

선택 group만 trail 표시.

trail point:
- period
- logicalX/Y
- zone
- rank
- score

hover:

```text
2025.08
#7 · 78점
PUBLIC HIT
```

## 9.7 Important disclosure

항상 보이거나 info tooltip에:

> 지도는 각 월의 자국 시장 내부 분포를 기준으로 한 상대 위치입니다. 같은 원점수라도 전체 분포가 달라지면 지도 좌표가 달라질 수 있습니다.

---

# 10. Page Layout Proposal

## Desktop

```text
┌─────────────────────────────────────────────────────┐
│ HISTORY                                             │
│ 2025.01 ───────────────●────────────── 2026.09      │
│ KR  JP                                              │
├─────────────────────────────────────────────────────┤
│ TIME MACHINE | MOVERS | RECORD BOOK | MAP REPLAY    │
├─────────────────────────────────────────────────────┤
│ KPI        KPI        KPI        KPI                │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Main content                                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Mobile

```text
HISTORY
[KR] [JP]

[←] [2025.06 ▼] [→]

[Time]
[Movers]
[Records]
[Map]

content cards...
```

---

# 11. Loading Strategy

## Time Machine

load:
1. selected snapshot
2. previous snapshot
3. selected group history only when detail is opened

## Movers

load exactly:
- from snapshot
- to snapshot

## Records

on first RECORDS tab entry:
- `RankHistory.loadAll(country)`
- cache result

## Map Replay

on entry:
- selected period
- neighboring month preload

on PLAY:
- selected country all snapshots preload sequentially
- cached snapshots reuse

---

# 12. Error & Empty States

### Snapshot fail

```text
이 달의 기록을 불러오지 못했습니다.
다른 월을 선택해 주세요.
```

현재 랭킹 페이지까지 망가뜨리지 않는다.

### No previous period

```text
첫 기록
비교할 이전 snapshot이 없습니다.
```

### No metric delta

```text
비교 가능한 세부 평가항목이 없습니다.
```

### Historical map insufficient data

해당 group만 exclude.
전체 map 렌더는 계속 진행.

---

# 13. Data Quality Rules

snapshot validation:

```text
country valid
period valid
published_at valid
population_count
groups array
unique id
finite rank
finite score
valid tier
required metric coverage
```

경고:
`population_count !== groups.length`

단, 운영 페이지를 바로 crash시키지 않는다.

개발 debug에서 보고하고,
실사용에서는 안정적으로 fallback한다.

---

# 14. Versioning

향후 snapshot meta 권장:

```json
{
  "normalization_version": "v2",
  "algorithm_version": "v2.1",
  "map_version": "v1"
}
```

기존 데이터에 없는 값은 억지로 채우지 않는다.

UI 비교 전에 version compatibility를 확인할 수 있는 구조를 만든다.

---

# 15. Acceptance Tests

## TIME MACHINE

- [ ] 2025-01 선택 가능
- [ ] 최신 월 선택 가능
- [ ] 전/다음 월 정상
- [ ] URL direct access 정상
- [ ] 동점 보존
- [ ] NEW 정확
- [ ] historical detail에 미래 기록 미포함
- [ ] current detail 이동 정상

## RECORDS

- [ ] 누적 1위
- [ ] 연속 1위
- [ ] TOP5/TOP10
- [ ] score peak
- [ ] biggest movement uses percentile
- [ ] NEW 제외
- [ ] missing month streak break
- [ ] 국가별 분리

## MOVERS

- [ ] raw delta
- [ ] percentile movement
- [ ] score delta
- [ ] tier change
- [ ] metric delta
- [ ] NEW PEAK
- [ ] deterministic sorting
- [ ] incompatible metrics 안전 처리

## MAP REPLAY

- [ ] 과거 snapshot 기반 좌표
- [ ] 현재좌표 재사용 안 함
- [ ] 현재 map refactor 전후 좌표 동일
- [ ] play/pause
- [ ] speed
- [ ] trail
- [ ] new/disappear
- [ ] reduced motion
- [ ] mobile controls

## Regression

- [ ] KR ranking
- [ ] JP ranking
- [ ] detail popup
- [ ] compare
- [ ] DISCOVER
- [ ] SAME SCENE
- [ ] IDOL MATCH
- [ ] current IDOL MAP

---

# 16. Recommended Build Order

## Phase 1 — Foundation

1. `history-analytics.js`
2. validation helpers
3. URL state helper
4. RankHistory reuse verification

## Phase 2 — TIME MACHINE

1. `history.html`
2. month controls
3. snapshot summary
4. full ranking
5. historical detail

## Phase 3 — MOVERS

1. compare engine
2. categories
3. metric delta
4. Editor's Watch

## Phase 4 — RECORDS

1. group-level aggregation
2. streaks
3. leaderboards
4. detail drawer

## Phase 5 — MAP REPLAY

1. `logicalPointsFromRows`
2. snapshot adapter
3. period state
4. animation
5. trail
6. autoplay

## Phase 6 — QA

1. 2025-01
2. middle month
3. latest month
4. KR
5. JP
6. desktop/mobile
7. regression

---

# 17. Definition of Done

이 기능 세트는 다음 질문에 모두 답할 수 있어야 한다.

- “2025년 4월엔 누가 1위였지?”
- “그때 이 그룹 점수는 몇 점이었지?”
- “지난달보다 실제로 얼마나 올라왔지?”
- “평가항목 중 어디가 가장 많이 변했지?”
- “2025년 이후 1위를 가장 자주 기록한 그룹은?”
- “평가 대상 수가 달라도 가장 큰 상승을 공정하게 비교할 수 있나?”
- “이 그룹은 팬덤형에서 대중형 쪽으로 언제 이동했지?”
- “그 이동은 현재 기준이 아니라 당시 시장 분포 기준인가?”

마지막 질문까지 **YES**라면 완성이다.

---

# 18. Final Product Standard

HISTORY는 과거 데이터를 진열하는 보관함이 아니다.

좋은 음악 데이터 아카이브는 사용자가 숫자를 읽은 뒤
“누가 높았나”보다
**“이 장면이 어떻게 바뀌어 왔나”를 이해하게 만든다.**

이 기능 세트의 성공 기준은 기능 개수가 아니라 다음 세 가지다.

1. **Temporal integrity** — 당시 데이터를 당시 기준으로 보여준다.
2. **Analytical honesty** — 관찰과 해석을 구분한다.
3. **Editorial clarity** — 복잡한 변화가 몇 초 안에 읽힌다.

그 세 가지를 끝까지 지킨다.
