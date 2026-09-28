# IDOL MAP
## 한국·일본 여자아이돌 시장 포지셔닝 지도 설계서

**버전:** 1.0  
**기준일:** 2026-09-28  
**대상:** 한국 86팀 / 일본 126팀  
**목적:** 순위가 아니라 각 그룹의 시장 성향과 포지션을 시각화

---

# 1. 제품 정의

IDOL MAP은 아이돌을 2차원 좌표에 배치하는 포지셔닝 지도다.

단순 랭킹 산점도가 아니다.

사용자가 다음 질문에 답을 얻는 것이 목표다.

- 이 그룹은 대중형인가, 팬덤형인가?
- 음원·디지털형인가, 공연·라이브형인가?
- 체급은 어느 정도인가?
- 최근 기세는 강한가?
- 비슷한 그룹은 지도에서 어디에 모여 있는가?

---

# 2. 지도 축

## X축

```text
FANDOM CORE ←────────────────→ PUBLIC REACH
```

왼쪽 = 코어 팬덤 중심  
오른쪽 = 대중 확장 중심

## Y축

```text
LIVE / STAGE
      ↑
      │
      │
      ↓
DIGITAL / MUSIC
```

위 = 공연 / 현장 / 라이브  
아래 = 음원 / 스트리밍 / 디지털

---

# 3. 시각 변수

| 시각 요소 | 의미 |
|---|---|
| X 위치 | 팬덤 ↔ 대중 |
| Y 위치 | 디지털 ↔ 라이브 |
| Bubble size | 전체 체급 |
| Glow | 현재기세 |
| Color | 티어 또는 스타일 |
| Shape | 통합지도에서 국가 구분 |
| Ring | 선택 / IDOL MATCH |
| Label | 그룹명 |

---

# 4. 절대 금지

총점을 좌표 계산에 사용하지 않는다.

```text
97점이므로 오른쪽 위
```

같은 계산은 금지.

총점은 bubble size 등에만 사용.

---

# 5. 국가별 percentile

한국과 일본 평가축이 다르므로 raw score 직접 비교 금지.

각 국가 내부에서 개별 평가항목을 0~100 percentile로 변환한다.

```js
function percentileRank(value, values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return 50;
  if (valid.length === 1) return 100;
  const less = valid.filter(v => v < value).length;
  const equal = valid.filter(v => v === value).length;
  const rank = less + (equal - 1) / 2;
  return (rank / (valid.length - 1)) * 100;
}
```

---

# 6. 한국 좌표 공식

## X축

```text
PUBLIC = 국내음원 P × 0.55 + 국내인지도 P × 0.45
FANDOM = 음반·팬덤 P
X_RAW = PUBLIC - FANDOM
```

해석:

```text
+ → 대중형
- → 팬덤형
0 → 균형
```

## Y축

```text
LIVE = 공연 P
DIGITAL = 국내음원 P × 0.55 + 글로벌 P × 0.45
Y_RAW = LIVE - DIGITAL
```

해석:

```text
+ → 라이브형
- → 디지털형
```

`P`는 percentile.

---

# 7. 일본 좌표 공식

## X축

```text
PUBLIC = 대중인지도 P × 0.60 + 스트리밍·SNS P × 0.40
FANDOM = 팬덤·구매력 P
X_RAW = PUBLIC - FANDOM
```

## Y축

```text
LIVE = 공연·현장 P
DIGITAL = 스트리밍·SNS P
Y_RAW = LIVE - DIGITAL
```

`업계영향력`, `현재기세`는 좌표에서 제외.

---

# 8. Robust Position Scaling

X_RAW와 Y_RAW는 중앙에 몰릴 수 있으므로 robust z-score를 사용한다.

```js
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(values) {
  const med = median(values);
  return median(values.map(v => Math.abs(v - med)));
}

function robustZ(value, values) {
  const med = median(values);
  const m = mad(values);
  if (!m) return 0;
  return (value - med) / (1.4826 * m);
}
```

화면 좌표:

```js
function toScreenPosition(zX, zY) {
  const x = 50 + 44 * Math.tanh(zX / 1.4);
  const y = 50 - 44 * Math.tanh(zY / 1.4);
  return {
    x: Math.max(6, Math.min(94, x)),
    y: Math.max(6, Math.min(94, y))
  };
}
```

---

# 9. Zone Classification

```js
const CENTER_TOLERANCE = 12;
```

중앙은 `BALANCED`.

| 영역 | 의미 |
|---|---|
| CORE LIVE | 팬덤형 + 라이브형 |
| STAGE STAR | 대중형 + 라이브형 |
| PUBLIC HIT | 대중형 + 디지털형 |
| CORE DIGITAL | 팬덤형 + 디지털형 |
| BALANCED | 중앙 균형형 |

화면 Y 좌표는 위쪽이 작은 값이므로 구현 시 방향 혼동 주의.

---

# 10. Bubble Size

총점 percentile 사용.

```js
function bubbleRadius(totalPercentile) {
  return 7 + totalPercentile * 0.09;
}
```

권장 clamp:

```text
7px ~ 16px
```

---

# 11. Momentum Glow

현재기세 percentile 사용.

```js
function momentumGlow(p) {
  if (p < 40) return 0;
  if (p < 70) return 1;
  if (p < 90) return 2;
  return 3;
}
```

CSS 예:

```css
.map-point[data-glow="1"] {
  filter: drop-shadow(0 0 4px currentColor);
}

.map-point[data-glow="2"] {
  filter: drop-shadow(0 0 7px currentColor);
}

.map-point[data-glow="3"] {
  filter:
    drop-shadow(0 0 10px currentColor)
    drop-shadow(0 0 18px currentColor);
}
```

---

# 12. Color Mode

## TIER
기존 티어 색상 재사용.

## STYLE
스타일 대분류:

```js
const STYLE_CATEGORIES = {
  POP_ROYAL: ["팝", "왕도", "청춘"],
  KAWAII_CLEAN: ["카와이", "청순"],
  PERFORMANCE: ["퍼포먼스", "걸크러시", "쿨"],
  HIPHOP_RNB: ["힙합", "R&B", "보컬"],
  ROCK_BAND: ["록", "밴드"],
  DARK_ALT: ["다크", "얼터너티브", "서브컬처"],
  ELECTRO_EXPERIMENTAL: ["일렉트로", "실험적"]
};
```

---

# 13. Deterministic Jitter

랜덤 jitter 금지.

```js
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
```

hash 기반으로 X/Y 각각 최대 ±1.5 범위에서 미세 이동.

---

# 14. Collision Resolution

원칙:

```text
겹침은 줄이되 데이터 위치는 크게 왜곡하지 않는다.
```

최대 변위:

```text
3~4 percentage points
```

초과 금지.

---

# 15. Label Strategy

항상 표시:

```text
total percentile 상위 10팀
```

추가 표시:

- 선택 그룹
- hover/focus 그룹
- MATCH highlighted 그룹
- 필터 후 남은 그룹 수가 적을 때

---

# 16. Point Data Model

```js
{
  id: "KR-004",
  group: "IVE",
  country: "KR",
  tier: "S",
  totalScore: 87,
  public: 91,
  fandom: 86,
  live: 82,
  digital: 89,
  momentum: 88,
  xRaw: 5,
  yRaw: -7,
  zX: 0.41,
  zY: -0.56,
  screenX: 62,
  screenY: 65,
  zone: "PUBLIC HIT",
  totalPercentile: 96,
  radius: 15.6,
  glow: 2,
  styleCategory: "POP_ROYAL"
}
```

---

# 17. Position Explanation

그룹별 설명 하드코딩 금지.

```js
const xDiff = point.public - point.fandom;
const yDiff = point.live - point.digital;
```

권장 threshold:

```text
±10
```

예:

```text
대중 확장력이 코어 팬덤력보다 상대적으로 높아 PUBLIC 방향에 위치합니다.
공연력보다 디지털·글로벌 지표가 상대적으로 강해 DIGITAL 방향에 위치합니다.
```

균형:

```text
대중성과 팬덤이 비슷한 수준이라 X축 중앙에 가깝습니다.
```

---

# 18. Detail Panel

필수 표시:

```text
그룹명
국가
티어
총점

Public
Fandom
Live
Digital

Zone

왜 이 위치인가?

현재기세 percentile

대표곡
Spotify

상세보기
비슷한 그룹
```

---

# 19. Presets

## ALL
전체.

## HOT

```js
momentum >= 80
```

## HIDDEN GEM

```js
totalPercentile < 60 &&
Math.max(public, fandom, live, digital) >= 80
```

## MY IDOLS
localStorage favorites.

## COUNTRY

```text
KR
JP
BOTH
```

---

# 20. Compare Mode

두 그룹 선택:

```js
selectedGroups = [groupA, groupB];
```

지도에서 선 연결 가능.

차이 계산:

```js
xDifference = Math.abs(groupA.xRaw - groupB.xRaw);
yDifference = Math.abs(groupA.yRaw - groupB.yRaw);
```

표시:

- 팬덤/대중 포지션 차이
- 라이브/디지털 포지션 차이
- 상세 비교 링크

승자 판정 없음.

---

# 21. IDOL MATCH Integration

기존 추천 결과를 지도에 강조.

```text
source group → green strong outline
match result → sakura pink outline
hidden gem → diamond 또는 dotted marker
```

추천 카드 hover/tap 시 해당 지도점 pulse 가능.

---

# 22. 통합 지도

한국 + 일본을 한 화면에 표시 가능.

단, 자국 시장 안에서의 상대적 포지션 비교임.

필수 문구:

```text
※ 통합 지도는 각 그룹이 자국 시장에서 어떤 위치에 있는지를 비교합니다.
한국과 일본의 절대적 시장 규모나 총점을 직접 비교하지 않습니다.
```

국가 shape:

```text
KR = circle
JP = diamond
```

---

# 23. 기술 선택

추천: SVG.

이유:

- 212팀 충분히 처리 가능
- tooltip
- label
- line
- ring
- keyboard focus
- responsive viewBox

D3는 필요할 때만.

---

# 24. 모바일

- width 100%
- 지도 min-height 약 520px 이상
- hit target 44px
- hover 의존 금지
- tap → bottom sheet 권장
- pinch/pan 또는 줌 컨트롤

---

# 25. Axis Grid

중심선:

```text
X = 50
Y = 50
```

추가 grid는 필요하면 25/50/75 정도만.

시각적 혼잡 금지.

---

# 26. 검색·필터 연동

기존 검색 결과에서:

```text
[지도에서 보기]
```

지원 가능.

기존 필터 predicate를 가능하면 그대로 재사용.

새 필터 엔진을 따로 만들지 말 것.

---

# 27. 딥링크

권장:

```text
idol-map.html?country=KR&group=IVE
```

또는:

```text
kr-idol-tier-2026-09.html?view=map&group=IVE
```

현재 아키텍처에 맞는 쪽 선택.

---

# 28. 월별 확장 V2

향후:

```js
history = [
  { month: "2026-07", ... },
  { month: "2026-08", ... },
  { month: "2026-09", ... }
];
```

Time Slider:

```text
2026.07 ━━━━━●━━━ 2026.09
```

월 변경 시:

```text
x / y / radius / glow
```

재계산.

---

# 29. Motion

```css
transition:
  transform 500ms ease,
  r 300ms ease,
  opacity 250ms ease;
```

`prefers-reduced-motion` 지원.

---

# 30. Data Validation

한국 필수 숫자:

```text
국내음원
음반·팬덤
공연
글로벌
국내인지도
현재기세
총점
```

일본 필수 숫자:

```text
공연·현장
팬덤·구매력
대중인지도
스트리밍·SNS
현재기세
총점
```

값이 없으면 0으로 처리하지 말 것.

필수 축 데이터 부족 시:

```text
MAP DATA 부족
```

표시하거나 지도에서 제외.

---

# 31. Sanity Checks

정확한 좌표를 강제하는 게 아니라 방향 확인.

## 한국

- Dreamcatcher → 상대적으로 CORE / LIVE 방향
- QWER → LIVE 성향이 어느 정도 나타나는지
- IVE → PUBLIC 성향이 있으나 팬덤도 강해 극단값은 아닌지

## 일본

- FRUITS ZIPPER → PUBLIC / DIGITAL 성향
- iLiFE! → CORE / LIVE 성향
- PassCode → CORE / LIVE 성향
- 乃木坂46 → bubble은 크지만 좌표가 총점에 끌려가지 않는지

---

# 32. Debug Mode

```text
?debugMap=1
```

일 때만 표시:

- raw X
- raw Y
- z X
- z Y
- screen X
- screen Y
- public
- fandom
- live
- digital

운영 UI에서는 숨김.

---

# 33. 함수 목록

```js
percentileRank()
buildPercentileMaps()
calculateKoreanMapMetrics()
calculateJapaneseMapMetrics()
calculateRawPosition()
median()
mad()
robustZ()
toScreenPosition()
classifyMapZone()
bubbleRadius()
momentumGlow()
extractStyleCategory()
hashString()
applyDeterministicJitter()
resolveCollisions()
generatePositionExplanation()
buildMapPoint()
renderIdolMap()
renderMapAxes()
renderMapPoint()
renderPointLabel()
openMapDetail()
closeMapDetail()
applyMapPreset()
selectGroup()
clearSelection()
compareMapGroups()
highlightMatches()
focusMapGroup()
```

---

# 34. 권장 모듈 구조

```text
idol-map.js
```

내부 섹션:

```text
data
normalization
position
render
interaction
integration
```

---

# 35. V1 UX Flow

```text
IDOL MAP 클릭
↓
지도 열림
↓
IVE 클릭
↓
시장 포지션 + 왜 이 위치인가 확인
↓
비슷한 일본 그룹 클릭
↓
IDOL MATCH 결과를 지도에 pink ring 표시
↓
추천 그룹 클릭
↓
상세 / Spotify
```

이 흐름이 핵심 사용자 경험이다.

---

# 36. 완료 기준

## V1

- [ ] KR map
- [ ] JP map
- [ ] 국가별 percentile
- [ ] X_RAW / Y_RAW
- [ ] robust z scaling
- [ ] bubble size
- [ ] momentum glow
- [ ] zone classification
- [ ] deterministic jitter
- [ ] label strategy
- [ ] point interaction
- [ ] explanation
- [ ] preset filters
- [ ] Spotify
- [ ] existing detail link
- [ ] IDOL MATCH highlight
- [ ] responsive
- [ ] keyboard support
- [ ] console error 없음

## V2

- [ ] 통합 KR + JP
- [ ] compare line
- [ ] favorites map
- [ ] search focus
- [ ] shareable map state
- [ ] URL deep link

## V3

- [ ] 월별 history
- [ ] time slider
- [ ] animated movement
- [ ] movement trail
- [ ] 상승/하락 변화 설명

---

# 37. 최종 제품 철학

IDOL MAP은:

```text
누가 더 높은가?
```

를 보여주는 기능이 아니다.

그 질문은 기존 티어 랭킹이 담당한다.

IDOL MAP은:

```text
이 그룹은 어떤 방식으로 강한가?
```

를 보여줘야 한다.

그리고 IDOL MATCH와 연결하면:

```text
왜 이 두 그룹을 비슷하다고 추천했는가?
```

를 시각적으로 설명하는 기능이 된다.

이 두 역할을 유지하는 것이 가장 중요하다.
