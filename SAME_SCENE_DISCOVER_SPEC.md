# SAME SCENE + DISCOVER
## 같은 나라 비슷한 그룹 + 아이돌 발견하기 설계서

**버전:** 1.0  
**기준일:** 2026-09-28  
**대상:** 한국 86팀 / 일본 126팀

---

## 1. 제품 목표

### SAME SCENE
> 이 그룹과 같은 나라에서 비슷한 그룹은 누구인가?

### DISCOVER
> 내가 아직 잘 모르는 그룹 중 무엇을 한번 들어볼 만한가?

이 두 기능은 기존 `IDOL MATCH`, `IDOL MAP`, `MY IDOLS`와 연결되어야 한다.

---

## 2. 공통 추천 엔진

공통 사용 항목:
- percentile
- style similarity
- numeric similarity
- IDOL MAP logical position
- favorites taste profile

추천 기능마다 별도 계산 체계를 새로 만들지 않는다.

---

## 3. SAME SCENE 입력

```ts
type SameSceneVector = {
  styleTags: string[];
  mapX: number;
  mapY: number;
  fandom: number;
  live: number;
  digital: number;
  popularity: number;
  momentum: number;
};
```

모든 값은 0~100.

---

## 4. Map Similarity

```js
function mapSimilarity(a, b) {
  const dx = a.mapX - b.mapX;
  const dy = a.mapY - b.mapY;

  const distance = Math.sqrt(dx * dx + dy * dy);
  const maxDistance = Math.sqrt(100 * 100 + 100 * 100);

  return Math.max(
    0,
    100 - (distance / maxDistance) * 100
  );
}
```

중요:
- IDOL MAP logical coordinate 사용
- rendering jitter / collision 후 좌표 사용 금지

---

## 5. Numeric Similarity

```js
function numericSimilarity(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 50;
  return Math.max(0, 100 - Math.abs(a - b));
}
```

---

## 6. SAME SCENE 가중치

| 요소 | 비중 |
|---|---:|
| 스타일 | 35% |
| 시장 포지션 | 20% |
| 팬덤 | 12% |
| 라이브 | 10% |
| 디지털 | 10% |
| 대중성 | 8% |
| 현재기세 | 5% |

```js
sameSceneScore =
  styleSimilarity * 0.35 +
  mapSimilarity * 0.20 +
  fandomSimilarity * 0.12 +
  liveSimilarity * 0.10 +
  digitalSimilarity * 0.10 +
  popularitySimilarity * 0.08 +
  momentumSimilarity * 0.05;
```

---

## 7. 보정

### 한국
같은 세대:
```text
+2 정도
```
다른 세대 감점 없음.

### 일본
같은 계열:
```text
+3 정도
```
전체 영향 5% 이하.

---

## 8. SAME SCENE TOP3

조건:
- source 자신 제외
- 활동종료/해산 제외
- 점수 내림차순
- 기본 3팀

---

## 9. 🌱 취향 확장

조건:
```text
sameSceneScore >= 65
styleSimilarity >= 55
mapSimilarity >= 45
```

TOP3 중복 제외.

완전히 같은 포지션보다 약간 다른 팀을 우선.

---

## 10. 추천 이유

우선순위:
1. style
2. map
3. live
4. fandom
5. digital
6. popularity
7. momentum

최대 2개 요소.

예:
```text
음악·콘셉트와 시장 포지션이 비슷한 팀입니다.
라이브 성향도 가까운 편입니다.
```

---

## 11. SAME SCENE UI

```text
🧬 비슷한 한국 그룹

NMIXX
88% MATCH

퍼포먼스 · 실험적 · 보컬

음악·콘셉트와 시장 포지션이
비슷한 팀입니다.

[상세보기]
[Spotify ▶]
[지도에서 보기]
```

---

## 12. DISCOVER 모드

```text
🎲 RANDOM
❤️ TASTE
💎 HIDDEN GEM
🌱 EXPAND
🔥 HOT
```

---

## 13. 국가 범위

```text
ALL
KR
JP
```

---

## 14. Recent Discovery

```js
const RECENT_DISCOVERY_KEY =
  "idolTierRecentDiscoveries";
```

최근 20개 유지.

RANDOM / HIDDEN GEM / TASTE / EXPAND 모두 최근 발견 그룹을 기본 제외.

---

## 15. Discovery History

```js
const DISCOVERY_HISTORY_KEY =
  "idolTierDiscoveryHistory";
```

최대 50개.

```json
[
  {
    "id": "JP-042",
    "mode": "hiddenGem",
    "timestamp": 1790560000000
  }
]
```

---

## 16. 완전 랜덤

후보:
```text
활동중
+ 국가 범위
+ recent 제외
```

후보 중 random.

---

## 17. Favorite Taste Profile

최애 2팀 이상일 때 사용.

수치 평균:
- popularity
- fandom
- live
- digital
- momentum
- mapX
- mapY

스타일은 빈도 기반 가중치.

예:
```text
퍼포먼스 1.00
팝       0.67
R&B      0.33
```

---

## 18. Taste Discovery

TOP 10~15 후보 생성 후 weighted random.

```js
weight =
  Math.pow(matchScore / 100, 3);
```

항상 TOP1을 보여주지 않는다.

---

## 19. Hidden Gem

조건:
```text
totalPercentile < 65
AND
max(popularity, fandom, live, digital) >= 80
```

가중치 예:
```js
maxAxis = Math.max(
  popularity,
  fandom,
  live,
  digital
);

weight =
  (maxAxis / 100) *
  (1.2 - totalPercentile / 100);
```

---

## 20. Expansion Discovery

조건:
```text
match >= 60
match <= 82
style >= 50
map >= 40
map <= 85
```

목적:
> 비슷하지만 새로운 방향으로 취향을 넓혀주는 팀

---

## 21. HOT

```text
momentum >= 80
```

후보 중 weighted random.

---

## 22. 자동 DISCOVER

### 최애 2팀 이상
```text
45% TASTE
25% HIDDEN GEM
20% EXPAND
10% RANDOM
```

### 최애 0~1팀
```text
45% RANDOM
35% HIDDEN GEM
20% HOT
```

---

## 23. DISCOVER 카드

```text
💎 숨은 보석 추천

yosugala 🇯🇵
B+ · 54점

ROCK / LIVE

라이브 성향
일본 전체 상위 12%

록·얼터 계열을 좋아한다면
한번 들어볼 만한 그룹입니다.

[Spotify ▶]
[상세보기]
[🗺 지도]
[♡ 저장]

[🔄 다른 그룹]
```

---

## 24. Spotify

```js
const spotifyUrl =
  group.대표곡목록?.[0]?.spotify_url;
```

없으면 숨김.

---

## 25. 기존 최애 기능 재사용

DISCOVER에서 `♡ 저장`은 기존 favorite key와 기존 함수를 재사용한다.

새 favorite storage key 금지.

---

## 26. 기능 연결

```text
RANKING
↓
DETAIL
↓
SAME SCENE
↓
DISCOVER
↓
IDOL MAP
↓
IDOL MATCH
```

반대로 DISCOVER에서 시작해도 상세 → SAME SCENE → MAP으로 이어져야 한다.

---

## 27. 권장 함수

```js
calculateSameSceneScore()
calculateSameSceneBreakdown()
mapSimilarity()

getSameSceneMatches()
getTasteExpansionMatches()
generateSameSceneReason()

buildFavoriteTasteProfile()

getDiscoverPool()
getRandomDiscovery()
getTasteDiscovery()
getHiddenGemDiscovery()
getExpansionDiscovery()
getHotDiscovery()

chooseDiscoveryMode()
weightedRandom()

loadRecentDiscoveries()
saveRecentDiscovery()

loadDiscoveryHistory()
saveDiscoveryHistory()

generateDiscoveryReason()
```

---

## 28. 권장 파일 구조

```text
js/
  idol-recommendation-core.js
  idol-match.js
  idol-map.js
  same-scene.js
  discover.js
```

기존 구조가 다르면 최소 변경 우선.

---

## 29. 모바일

- DISCOVER는 modal / bottom sheet 추천
- SAME SCENE은 vertical cards 또는 horizontal snap
- 터치 버튼 44px 이상
- hover-only 금지

---

## 30. 접근성

- 키보드 접근
- focus-visible
- aria-label
- MATCH % 텍스트 표시
- 버튼 아이콘만 쓰지 말 것

---

## 31. Sanity Check

하드코딩 금지. 방향 확인용.

한국:
```text
aespa
→ NMIXX / Dreamcatcher / Billlie 계열
```

일본:
```text
FRUITS ZIPPER
→ CUTIE STREET / CANDY TUNE / SWEET STEADY 계열
```

PassCode:
```text
→ NEO JAPONISM / INUWASI 등 라이브·록 계열
```

---

## 32. 금지사항

1. 총점만으로 SAME SCENE 추천 금지
2. 인기순 추천으로 대체 금지
3. 추천 결과 하드코딩 금지
4. 최근 발견 반복 금지
5. TASTE에서 항상 TOP1 고정 금지
6. 활동종료 그룹 기본 추천 금지
7. favorite storage 중복 생성 금지
8. rendering jitter 좌표로 similarity 계산 금지
9. 세대/계열 과반영 금지
10. IDOL MATCH / MAP 공통 로직 중복 구현 금지

---

## 33. V1

### SAME SCENE
- TOP3
- 이유
- Spotify
- 상세
- 지도

### DISCOVER
- RANDOM
- HIDDEN GEM
- 국가 범위
- 최근 발견 제외

---

## 34. V2

- TASTE
- EXPAND
- 자동 모드
- 발견 기록
- 오늘의 아이돌

---

## 35. V3

- 공유 가능한 발견 카드
- URL state
- 발견 컬렉션
- 월간 개인 발견 리포트

---

## 36. 완료 기준

### SAME SCENE
- [ ] 한국→한국
- [ ] 일본→일본
- [ ] TOP3
- [ ] 취향 확장
- [ ] 추천 이유
- [ ] Spotify
- [ ] 상세
- [ ] 지도 연동
- [ ] 활동종료 제외

### DISCOVER
- [ ] RANDOM
- [ ] TASTE
- [ ] HIDDEN GEM
- [ ] EXPAND
- [ ] HOT
- [ ] 국가 범위
- [ ] recent exclusion
- [ ] favorites integration
- [ ] Spotify
- [ ] 상세
- [ ] 지도
- [ ] 모바일

---

## 37. 제품 철학

SAME SCENE은:
> 이 그룹과 비슷한 팀은?

DISCOVER는:
> 아직 모르는 팀 중 무엇을 볼까?

두 기능의 목적은 랭킹을 복잡하게 만드는 것이 아니라,
사용자가 사이트 안에서 계속 새로운 그룹을 탐색하도록 만드는 것이다.
