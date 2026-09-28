# IDOL TIER 월별 순위 변동·시계열 설계서

## 1. 목적

`idol_tier_2026`에 월별 랭킹 스냅샷을 누적해 다음 기능을 구현한다.

- 전월 대비 순위 상승/하락
- 신규 진입 `NEW`
- 그룹별 순위 시계열
- 그룹별 점수 시계열
- 최고/최저 순위
- 기간별 추이 확인
- 향후 급상승·급하락·NEW PEAK 확장

---

## 2. 기존 상세 팝업

상세 팝업은 이미 존재한다.

현재 팝업에는 다음 정보가 표시된다.

- 그룹 소개
- 티어
- 총점
- 세부 평가 점수
- 대표곡
- Spotify 링크
- 데뷔일
- 소속사
- 멤버수
- 에디터 코멘트

시계열 기능은 기존 팝업을 교체하지 않고 **하단에 추가 섹션으로 삽입**한다.

---

## 3. 핵심 데이터 원칙

### 3.1 월별 snapshot은 덮어쓰지 않는다

```text
2026-09.json
2026-10.json
2026-11.json
...
```

과거 데이터가 남아 있어야 순위 변화와 점수 변화를 계산할 수 있다.

### 3.2 rank를 직접 저장

순위는 배열 위치로 다시 계산하지 않는다.

```json
{
  "id": "KR-003",
  "rank": 3
}
```

동점 순위도 원본 값을 유지한다.

### 3.3 그룹 연결은 id 기준

표시명보다 `id`를 우선한다.
이름이 변경돼도 같은 id라면 같은 그룹의 역사로 이어진다.

### 3.4 한국과 일본은 분리

한국과 일본은 평가항목과 배점이 다르므로 history도 분리한다.

---

## 4. 폴더 구조

```text
data/
└── history/
    ├── index.json
    ├── kr/
    │   ├── 2026-09.json
    │   ├── 2026-10.json
    │   └── 2026-11.json
    └── jp/
        ├── 2026-09.json
        ├── 2026-10.json
        └── 2026-11.json
```

---

## 5. history index

```json
{
  "KR": ["2026-09", "2026-10"],
  "JP": ["2026-09", "2026-10"]
}
```

항상 과거 → 최신 순으로 정렬한다.

---

## 6. snapshot 공통 필드

```text
id
group
rank
tier
score
metrics
```

---

## 7. 한국 snapshot 예시

```json
{
  "meta": {
    "country": "KR",
    "period": "2026-09",
    "published_at": "2026-09-28",
    "revision": 1
  },
  "groups": [
    {
      "id": "KR-003",
      "group": "aespa",
      "rank": 3,
      "tier": "S",
      "score": 88,
      "metrics": {
        "domestic_digital": 17,
        "album_fandom": 18,
        "performance": 18,
        "global": 14,
        "recognition": 14,
        "momentum": 7
      }
    }
  ]
}
```

---

## 8. 일본 snapshot 예시

```json
{
  "meta": {
    "country": "JP",
    "period": "2026-09",
    "published_at": "2026-09-28",
    "revision": 1
  },
  "groups": [
    {
      "id": "JP-001",
      "group": "=LOVE",
      "rank": 1,
      "tier": "S+",
      "score": 97,
      "metrics": {
        "live": 25,
        "fandom": 20,
        "recognition": 18,
        "streaming_sns": 15,
        "momentum": 10,
        "industry": 9
      }
    }
  ]
}
```

한국 metric과 일본 metric은 통합하지 않는다.

---

## 9. 순위 변동 계산

```js
rankDelta = previousRank - currentRank;
```

| 전월 | 현재 | 결과 |
|---:|---:|---|
| 8 | 5 | ▲3 |
| 2 | 6 | ▼4 |
| 4 | 4 | – |

### 신규

전월 snapshot에 동일 id가 없으면:

```text
NEW
```

### 최초 월

전월 snapshot 자체가 없다면:

```text
–
```

---

## 10. 점수 변동

```js
scoreDelta = currentScore - previousScore;
```

예:

```text
88 (+2)
84 (-1)
90 (±0)
```

---

## 11. 메인 카드 UI

```text
#3 aespa ▲1
S · 88점
```

상태 배지:

```text
▲3
▼2
–
NEW
```

상승/하락은 색상만으로 표현하지 않는다.

---

## 12. 상세 팝업 UI

기존 상세 팝업 하단에 추가한다.

```text
📈 순위 추이

현재 순위     #3 ▲1
전월 순위     #4
최고 순위     #2
최저 순위     #5
현재 점수     88 (+2)
```

그 아래:

```text
[3개월] [6개월] [12개월] [전체]
```

---

## 13. 순위 차트

x축:

```text
2026.09
2026.10
2026.11
```

y축: 순위

**1위가 차트 위쪽에 표시되어야 한다.**

즉 y축을 역방향으로 처리한다.

---

## 14. 최초 데이터

2026-09는 첫 snapshot이다.
따라서 모든 그룹의 변동 표시는 `–`.

데이터가 하나뿐인 경우:

```text
📈 2026.09 첫 기록
다음 월 평가부터 순위 변동이 표시됩니다.
```

---

## 15. NEW 그룹

```text
2026-09 없음
2026-10 #25
```

표시:

```text
#25 NEW
```

그래프는 2026-10부터 시작한다.
0위 등의 가짜 데이터는 넣지 않는다.

---

## 16. 누락 월

```text
2026-09
2026-10
2026-12
```

11월 데이터를 임의 생성하거나 보간하지 않는다.
실제 snapshot만 표시한다.

---

## 17. 활동 종료·해산

현재 목록에서 빠져도 과거 history에서는 삭제하지 않는다.
과거 기록은 그대로 보존한다.

---

## 18. 과거 데이터 정정

```json
{
  "revision": 2,
  "corrected_at": "2026-10-15",
  "correction_note": "동점 순위 입력 오류 수정"
}
```

---

## 19. 로딩 전략

### 최초 페이지 로드

현재월 + 이전월만 로드해 카드의 변동을 계산한다.

### 상세 팝업 오픈

필요한 history snapshot을 추가 로드한다.
이미 받은 snapshot은 메모리 캐시한다.

---

## 20. 권장 함수

```js
loadHistoryIndex()
loadCountrySnapshot(country, period)
getGroupHistory(country, groupId)
getRankDelta(current, previous)
getScoreDelta(current, previous)
getBestRank(history)
getWorstRank(history)
renderRankDeltaBadge()
renderGroupTimeline()
renderHistoryStats()
```

---

## 21. fetch 실패

history JSON 로딩에 실패해도 기존 기능은 정상이어야 한다.

- 현재 랭킹
- 검색
- 필터
- 상세 팝업
- 최애
- 비교
- Spotify
- IDOL MAP

history 영역만 fallback 처리한다.

---

## 22. 2026-09 초기 snapshot

초기 생성 확인:

```text
KR = 86팀
JP = 126팀
```

각 그룹에 다음을 저장한다.

```text
id
group
rank
tier
score
metrics
```

---

## 23. 다음 달 업데이트

예: 2026-10

1. 10월 평가 완료
2. `kr/2026-10.json` 생성
3. `jp/2026-10.json` 생성
4. `history/index.json`에 2026-10 추가
5. 현재 랭킹 페이지를 10월 데이터로 갱신
6. 전월과 비교해 ▲▼NEW 자동 계산
7. 상세 팝업은 9월→10월 시계열 표시

다음 달에도 같은 방식으로 snapshot만 추가한다.

---

## 24. 테스트

### 상승
`8 → 5 = ▲3`

### 하락
`2 → 6 = ▼4`

### 동일
`4 → 4 = –`

### 신규
`이전 없음 → 현재 #20 = NEW`

### 최초 월
`2026-09 = –`

추가 확인:
- 동점 rank가 배열 순서 때문에 바뀌지 않는지
- 이름 변경 후 같은 id로 history가 이어지는지
- KR/JP history가 섞이지 않는지
- snapshot fetch 실패 시 기존 화면이 정상인지
- 모바일 상세 팝업에서 차트가 넘치지 않는지

---

## 25. 향후 확장

시계열이 3개월 이상 쌓이면 다음 기능을 추가할 수 있다.

- 급상승 TOP 10
- 급하락 TOP 10
- `NEW PEAK`
- `CAREER HIGH SCORE`
- 3개월 연속 상승
- 티어 변화 `A+ → S`
- 점수 추세 `82 → 84 → 88`

---

## 26. 최종 목표

기존에는:

```text
현재 몇 위인가?
```

만 확인했다면, 시계열 도입 후에는:

```text
지난달보다 올랐나?
최근 계속 상승 중인가?
언제 최고 순위였나?
점수는 어떻게 변했나?
```

까지 확인할 수 있어야 한다.

즉 사이트를 **정적인 월간 티어표**에서 **매월 변화가 누적되는 아이돌 랭킹 데이터베이스**로 발전시키는 것이 목표다.
