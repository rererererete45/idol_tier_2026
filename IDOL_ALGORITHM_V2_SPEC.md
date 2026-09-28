# IDOL TIER Algorithm V2 — 알고리즘 감사 및 강화 설계

## 1. 감사 결론

현재 구조의 방향은 좋다. 특히 한국/일본 raw score 직접 비교를 피하고 자국 percentile을 사용하는 점, 스타일을 추천의 핵심으로 둔 점, 지도에서 총점을 좌표에 사용하지 않는 점은 유지한다.

다만 V2에서는 아래 문제를 반드시 보정한다.

1. 결측값을 `50`으로 처리하면 **데이터 부족 그룹이 가짜 중간 유사도**를 얻는다.
2. IDOL MATCH의 스타일 태그가 자유문자열과 sparse 관계표에 의존하면 **동의어·새 장르에 취약**하다.
3. 최애 프로필 단순 평균은 서로 다른 두 취향을 **존재하지 않는 중간 취향**으로 만들 수 있다.
4. SAME SCENE은 지도 위치가 이미 4개 시장축에서 만들어졌는데, 같은 축들을 다시 가중하면 **중복가중**이 생긴다.
5. ALL 랜덤은 팀 수가 많은 일본이 더 자주 뽑히는 **국가 노출 편향**이 생긴다.
6. HIDDEN GEM은 한 축만 높은 팀도 선정돼 **원히트 지표 문제**가 생긴다.
7. HOT을 현재기세 하나로 정의하면 **월간 변화 기능을 제대로 활용하지 못한다.**
8. IDOL MAP의 MAD가 0이면 전체가 중앙으로 붕괴할 수 있다.
9. 동점 추천의 fallback이 없으면 **입력 배열 순서에 따라 결과가 바뀔 수 있다.**
10. rank delta는 팀 수가 달라지면 같은 `▲10`도 의미가 다르므로 알고리즘 내부에서는 rank percentile movement가 필요하다.

---

## 2. 결측값 정책

### 잘못된 방식

```js
missing => 50
```

### V2

결측 component는 **점수 계산에서 제외**한다.

```js
{
  score: null,
  available: false
}
```

남은 weight를 재정규화한다.

### Coverage

```text
coverage = 사용 가능한 weight / 전체 weight
```

권장 기준:

| Coverage | 처리 |
|---:|---|
| 0.70 이상 | 정상 |
| 0.55~0.70 | 데이터 제한 표시 |
| 0.55 미만 | TOP 추천 제외 권장 |

---

## 3. Data Confidence

추천 유사도와 데이터 신뢰도를 분리한다.

```text
matchScore ≠ confidence
```

예:

```text
MATCH 88
신뢰도 높음

MATCH 91
데이터 제한
```

검증상태와 데이터 완성도를 함께 이용한다.

---

## 4. IDOL MATCH V2

### 권장 가중치

| 요소 | 비중 |
|---|---:|
| 스타일 | 45% |
| 라이브 | 13% |
| 팬덤 | 12% |
| 대중성 | 10% |
| 디지털 | 10% |
| 기세 | 5% |
| 활동 생태계 | 5% |

결측 dimension은 제외 후 재정규화한다.

### 스타일

DB에 `styleTags`를 명시적으로 저장하는 것을 우선한다.

```json
["록","얼터너티브","다크"]
```

자유문자열 파싱은 fallback.

스타일 비교 단계:

1. exact
2. same category
3. related
4. unrelated

흔한 태그는 specificity를 낮춘다.

### 다양성 재정렬

TOP3가 동일 계열 세 팀으로만 채워지는 것을 방지한다.

단, 유사도 차이가 큰 경우 다양성을 위해 더 나쁜 결과를 강제로 올리지 않는다.

---

## 5. 최애 취향 V2

단순 평균만 사용하지 않는다.

후보마다:

```text
가장 잘 맞는 최애와의 유사도
+
상위 2개 최애 평균 유사도
```

를 결합한다.

```text
profileScore =
bestFavoriteSimilarity × 0.55
+
top2Mean × 0.45
```

최애가 많고 두 개 이상의 뚜렷한 취향군이 생기면 향후 2-cluster 지원.

---

## 6. SAME SCENE V2

### 현재 위험

Map similarity와 fandom/live/digital/popularity를 동시에 크게 넣으면 같은 정보를 두 번 센다.

### 권장

```text
스타일                 45%
4축 profile similarity 35%
현재기세                5%
체급 유사도             5%
세대/계열 보정          5%
나머지/여유             5%
```

4축:

```text
popularity
fandom
live
digital
```

은 한 번의 다차원 거리로 처리.

Map 좌표는 설명/시각화에 사용하고 점수에 다시 중복 반영하지 않는다.

---

## 7. DISCOVER V2

### RANDOM

ALL 모드:

```text
KR / JP를 먼저 50:50 선택
→ 해당 국가에서 그룹 선택
```

팀 수 차이 때문에 일본이 자동으로 더 자주 노출되는 것을 막는다.

### 노출 보정

```js
noveltyWeight =
1 / Math.sqrt(1 + exposureCount);
```

최근 20개 제외 + 장기 exposure penalty를 동시에 사용한다.

---

## 8. HIDDEN GEM V2

조건 예:

```text
활동중
coverage >= 0.70
confidence >= 0.65
totalPercentile <= 70
강점축 2개 이상 >= 75
또는 1개 축 >= 90
```

최애가 있으면 **취향 관련성**을 가장 크게 반영한다.

---

## 9. HOT V2

### 첫 달

history가 없으면 기존 current momentum을 사용.

### 2개월 이상

```text
현재기세                50%
rank percentile 상승     25%
점수 상승                15%
NEW PEAK / 티어 상승     10%
```

결측 history component는 제외 후 재정규화.

### Rank Position Percentile

```js
100 * (1 - (rank - 1) / (N - 1))
```

알고리즘 내부 월간 상승세는 raw `▲N` 대신 이 값을 사용한다.

UI에는 기존 `▲N / ▼N`을 보여준다.

---

## 10. IDOL MAP V2

### logical vs screen

반드시 분리:

```text
logicalX / logicalY
screenX / screenY
```

추천, SAME SCENE, 시계열 분석에 `screenX/Y`를 쓰지 않는다.

### MAD=0

fallback 순서:

1. MAD
2. IQR
3. SD
4. 모두 0이면 0

이렇게 해야 동점이 많은 월에 전체 좌표가 중앙으로 붕괴하는 문제를 막는다.

Zone은 jitter 전 좌표로 계산한다.

---

## 11. 시계열 강화

UI:

```text
#8 ▼2
84점 (+3)
```

순위 하락과 점수 하락을 같은 의미로 해석하지 않는다.

알고리즘:
- raw rank delta
- rank-position percentile delta
- score delta

세 개를 별도 저장/계산.

---

## 12. Tie Policy

추천 정렬:

```js
finalScore desc
confidence desc
styleScore desc
id asc
```

향후 월별 랭킹 자동 생성 시 competition rank 권장:

```text
1, 2, 2, 4
```

과거 published rank는 재계산 금지.

---

## 13. Stable ID

최애/localStorage:

기존:

```json
{"country":"KR","group":"IVE"}
```

V2:

```json
{"country":"KR","id":"KR-004","slug":"ive"}
```

기존 데이터는 migration.

딥링크도 장기적으로:

```text
?id=KR-004
```

우선, slug/group은 fallback.

---

## 14. 추천 결과 threshold

무조건 3팀을 채우지 않는다.

예:

```text
match >= 58
style >= 40
coverage >= 0.55
```

후보가 적으면:

> 완전히 비슷한 팀이 적어 취향 확장 후보를 보여줍니다.

라고 명시한다.

---

## 15. MATCH 숫자 의미

`91%`를 확률처럼 오해할 수 있다.

권장:

```text
유사도 91
```

퍼센트를 유지하면:

> 이 수치는 추천 알고리즘의 상대 유사도이며 확률이 아닙니다.

설명을 제공한다.

---

## 16. Debug / Audit

추천마다 개발 모드에서 확인:

```text
style
live
fandom
popularity
digital
momentum
coverage
confidence
diversity penalty
exposure penalty
final score
```

Query:

```text
?debugMatch=1
?debugDiscover=1
?debugMap=1
```

---

## 17. 핵심 테스트

- missing이 50점 보너스를 받지 않는가
- low coverage 그룹이 TOP 추천을 독점하지 않는가
- 동일 input에서 결과 순서가 매번 같은가
- ALL RANDOM이 장기적으로 KR/JP 약 50:50인가
- 서로 다른 최애 2개가 엉뚱한 평균 취향으로 붕괴하지 않는가
- SAME SCENE 중복가중이 제거됐는가
- MAD=0에서도 Map이 정상인가
- HOT이 월간 변화 데이터를 이용하는가
- rank 변화와 score 변화를 별도로 설명하는가
- 기존 상세팝업/검색/필터/Spotify/최애/지도 기능이 유지되는가

---

## 18. 구현 우선순위

### P0
1. missing=50 제거
2. coverage/confidence
3. stable ID
4. deterministic tie-break

### P1
5. SAME SCENE 중복가중 제거
6. 최애 multi-taste
7. RANDOM 국가 균형
8. Hidden Gem 개선

### P2
9. HOT + history 연동
10. Map robust scaling fallback
11. diversity reranking
12. debug/audit UI

---

## 19. V2 목표

V1이 '그럴듯한 추천'이었다면 V2의 목표는:

- 데이터가 부족하면 모른다고 말하기
- 같은 입력이면 같은 결과
- 국가/팀 수 차이 때문에 노출이 왜곡되지 않기
- 사용자의 여러 취향을 평균으로 뭉개지 않기
- 같은 정보를 두 번 가중하지 않기
- 월별 변화가 실제 추천과 HOT에 반영되기

이다.
