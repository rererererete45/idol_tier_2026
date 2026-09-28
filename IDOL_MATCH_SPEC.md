# IDOL MATCH 🇰🇷↔🇯🇵
## 한국 ↔ 일본 여자아이돌 취향 매칭 기능 설계서

**버전:** 1.0  
**기준일:** 2026-09-28  
**대상:** 한국 86팀 + 일본 126팀

---

## 1. 목적

현재 사이트는 국가별로 별도의 여자아이돌 체급 점수표를 운영한다.

- `kr-idol-tier-2026-09.html`
- `jp-idol-tier-2026-09.html`

두 시장은 평가 기준 자체가 다르기 때문에 총점이나 개별 점수를 직접 비교하면 안 된다.

IDOL MATCH의 목적은:

> "한국에서 이 그룹을 좋아한다면 일본에서는 어떤 그룹이 취향에 맞을까?"

또는 그 반대를 **음악 스타일 + 활동 성향 + 각 시장 내 상대 체급**을 이용해 추천하는 것이다.

이 기능은 **우열 비교**가 아니라 **취향 유사도 추천**이다.

---

# 2. 핵심 원칙

## 2.1 총점 직접 비교 금지

한국 90점과 일본 90점은 서로 같은 의미가 아니다.

따라서:

```text
한국 raw score
   ↓
한국 86팀 내부 percentile
   ↓
공통 취향 벡터

일본 raw score
   ↓
일본 126팀 내부 percentile
   ↓
공통 취향 벡터
```

방식을 사용한다.

---

## 2.2 스타일 유사도가 가장 중요

숫자 체급이 비슷하더라도 음악 성향이 다르면 좋은 추천이 아니다.

예:

- Dreamcatcher ↔ PassCode: 적합
- Dreamcatcher ↔ 왕도 청순형: 숫자가 비슷해도 낮은 추천

따라서 최종 점수에서 **스타일 40%**를 차지한다.

---

# 3. 입력 데이터

## 한국

예상 필드:

```js
{
  그룹,
  티어,
  총점,
  세대,
  스타일,
  소속사,
  활동상태,
  국내음원,
  "음반·팬덤",
  공연,
  글로벌,
  국내인지도,
  현재기세,
  소개글,
  "에디터 코멘트(주관)",
  대표곡목록
}
```

## 일본

```js
{
  그룹,
  티어,
  총점,
  결성시기,
  계열,
  활동형태,
  스타일,
  활동상태,
  "공연·현장",
  "팬덤·구매력",
  대중인지도,
  "스트리밍·SNS",
  현재기세,
  업계영향력,
  소개글,
  "에디터 코멘트(주관)",
  대표곡목록
}
```

---

# 4. Percentile 정규화

각 평가축을 국가 내부 분포 기준 0~100으로 변환한다.

권장 구현:

```js
function percentileRank(value, values) {
  const valid = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!valid.length) return 50;
  if (valid.length === 1) return 100;

  const less = valid.filter(v => v < value).length;
  const equal = valid.filter(v => v === value).length;

  const rank = less + (equal - 1) / 2;

  return (rank / (valid.length - 1)) * 100;
}
```

동점 처리 방식은 구현 상황에 따라 보정 가능하나,
동일 원점수에는 동일 percentile이 나오는 것이 바람직하다.

---

# 5. 공통 취향 벡터

```ts
type TasteVector = {
  popularity: number;
  fandom: number;
  live: number;
  digital: number;
  momentum: number;
  styleTags: string[];
  activityType: string;
};
```

---

# 6. 한국 → TasteVector

모든 원점수는 먼저 한국 그룹 내부 percentile로 변환한다.

```text
popularity
= 국내음원 P × 0.60
+ 국내인지도 P × 0.40

fandom
= 음반·팬덤 P

live
= 공연 P

digital
= 국내음원 P × 0.40
+ 글로벌 P × 0.60

momentum
= 현재기세 P
```

`P` = percentile 값.

---

# 7. 일본 → TasteVector

```text
popularity
= 대중인지도 P × 0.65
+ 스트리밍·SNS P × 0.35

fandom
= 팬덤·구매력 P

live
= 공연·현장 P

digital
= 스트리밍·SNS P

momentum
= 현재기세 P
```

업계영향력은 기본 점수에서 제외.

필요하면:
- 동점 보정
- 에디터 설명
- 추천 이유

에만 약하게 사용한다.

---

# 8. 스타일 태그 표준화

## 공통 vocabulary

```js
const STYLE_TAGS = [
  "왕도",
  "카와이",
  "청순",
  "청춘",
  "몽환",
  "걸크러시",
  "쿨",
  "힙합",
  "R&B",
  "록",
  "밴드",
  "얼터너티브",
  "일렉트로",
  "퍼포먼스",
  "보컬",
  "레트로",
  "서브컬처",
  "실험적",
  "다크",
  "글로벌",
  "팝",
  "성숙",
  "세련됨"
];
```

---

## 8.1 키워드 매핑 예시

```js
const STYLE_KEYWORD_MAP = {
  "걸크러시": ["걸크러시"],
  "힙합": ["힙합"],
  "R&B": ["R&B"],
  "록": ["록"],
  "밴드": ["밴드"],
  "얼터": ["얼터너티브"],
  "일렉트로": ["일렉트로"],
  "EDM": ["일렉트로", "퍼포먼스"],
  "퍼포먼스": ["퍼포먼스"],
  "보컬": ["보컬"],
  "청순": ["청순"],
  "청춘": ["청춘"],
  "카와이": ["카와이"],
  "왕도": ["왕도"],
  "몽환": ["몽환"],
  "레트로": ["레트로"],
  "서브컬처": ["서브컬처"],
  "다크": ["다크"],
  "쿨": ["쿨"],
  "글로벌": ["글로벌"],
  "팝": ["팝"]
};
```

`스타일` 필드를 우선 사용한다.

필요시 소개글에서 보조 키워드를 추출할 수 있으나,
소개글 자연어를 과도하게 분석해서 추천 결과가 흔들리지 않도록 한다.

---

# 9. 스타일 유사 관계

```js
const RELATED_STYLE_WEIGHTS = {
  "청순|왕도": 0.70,
  "청춘|왕도": 0.70,
  "카와이|왕도": 0.80,
  "걸크러시|쿨": 0.80,
  "록|얼터너티브": 0.80,
  "밴드|록": 0.90,
  "힙합|퍼포먼스": 0.60,
  "몽환|청순": 0.60,
  "R&B|보컬": 0.70,
  "일렉트로|실험적": 0.70,
  "다크|쿨": 0.70,
  "팝|왕도": 0.50,
  "팝|카와이": 0.55,
  "퍼포먼스|쿨": 0.50
};
```

lookup 시 양방향 처리:

```js
function getRelatedWeight(a, b) {
  if (a === b) return 1;
  return (
    RELATED_STYLE_WEIGHTS[`${a}|${b}`] ??
    RELATED_STYLE_WEIGHTS[`${b}|${a}`] ??
    0
  );
}
```

---

# 10. Style Similarity

권장 알고리즘:

```js
function directionalStyleScore(sourceTags, targetTags) {
  if (!sourceTags.length || !targetTags.length) return 50;

  const scores = sourceTags.map(sourceTag => {
    return Math.max(
      ...targetTags.map(targetTag =>
        getRelatedWeight(sourceTag, targetTag)
      )
    );
  });

  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function styleSimilarity(aTags, bTags) {
  const ab = directionalStyleScore(aTags, bTags);
  const ba = directionalStyleScore(bTags, aTags);

  return ((ab + ba) / 2) * 100;
}
```

---

# 11. Numeric Similarity

```js
function numericSimilarity(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return 50;
  }

  return Math.max(0, 100 - Math.abs(a - b));
}
```

---

# 12. 활동형태

일본 예:

- 메이저
- 라이브
- 라이브 아이돌
- 로컬
- 성우·2.5D

한국은 기본:

```text
메이저
```

로 처리.

특수 매핑 가능:

```js
const KR_ACTIVITY_OVERRIDES = {
  "QWER": "밴드/메이저",
  "Dreamcatcher": "메이저/라이브",
  "KATSEYE": "글로벌/메이저"
};
```

---

## 12.1 활동형태 유사도

```js
function activityTypeSimilarity(a, b) {
  if (a === b) return 100;

  const key = `${a}|${b}`;

  const map = {
    "메이저|라이브": 75,
    "메이저|라이브 아이돌": 75,
    "메이저|로컬": 55,
    "메이저|성우·2.5D": 65,
    "라이브|로컬": 75,
    "라이브 아이돌|로컬": 75,
    "라이브|라이브 아이돌": 95
  };

  return map[key] ?? map[`${b}|${a}`] ?? 60;
}
```

이 값은 비중 5%라 정교함보다 안정성이 중요하다.

---

# 13. 최종 점수

```js
function calculateMatchScore(source, target) {
  const style = styleSimilarity(
    source.styleTags,
    target.styleTags
  );

  const live = numericSimilarity(
    source.live,
    target.live
  );

  const fandom = numericSimilarity(
    source.fandom,
    target.fandom
  );

  const popularity = numericSimilarity(
    source.popularity,
    target.popularity
  );

  const digital = numericSimilarity(
    source.digital,
    target.digital
  );

  const momentum = numericSimilarity(
    source.momentum,
    target.momentum
  );

  const activity = activityTypeSimilarity(
    source.activityType,
    target.activityType
  );

  return Math.round(
    style * 0.40 +
    live * 0.15 +
    fandom * 0.12 +
    popularity * 0.12 +
    digital * 0.10 +
    momentum * 0.06 +
    activity * 0.05
  );
}
```

---

# 14. 활동종료 그룹 필터

기본 추천에서는 제외한다.

```js
function isActive(group) {
  const status = group.활동상태 ?? "";

  return !(
    status.includes("활동종료") ||
    status.includes("해산")
  );
}
```

`해산예정`은 현재 활동 중이면 기본적으로 유지할 수 있다.

원한다면 별도 옵션:

```text
☐ 활동종료 그룹 포함
```

---

# 15. TOP 추천

```js
function getCrossCountryMatches(
  source,
  targets,
  limit = 3
) {
  return targets
    .filter(isActive)
    .map(group => ({
      group,
      matchScore: calculateMatchScore(
        source.tasteVector,
        group.tasteVector
      )
    }))
    .sort((a, b) =>
      b.matchScore - a.matchScore
    )
    .slice(0, limit);
}
```

---

# 16. 숨은 취향 발견

목표:

> 비슷하지만 사용자가 아직 모를 가능성이 높은 그룹

후보 기준:

```text
styleSimilarity >= 70
matchScore >= 65
```

권장 점수:

```js
hiddenGemScore =
  matchScore +
  Math.max(
    0,
    75 - target.popularity
  ) * 0.20;
```

단:

```js
if (matchScore < 65) exclude;
```

그리고 대형 그룹만 반복되지 않도록
상대 국가 popularity percentile `<= 75`인 팀을 우선한다.

---

# 17. 추천 이유

각 그룹의 세부 유사도를 별도로 보관한다.

```ts
type MatchBreakdown = {
  style: number;
  live: number;
  fandom: number;
  popularity: number;
  digital: number;
  momentum: number;
  activity: number;
};
```

상위 2~3개 요소로 추천 이유 생성.

예:

```js
if (style >= 85)
  reasons.push("음악·콘셉트 취향이 매우 비슷함");

if (live >= 85)
  reasons.push("라이브 성향이 비슷함");

if (fandom >= 85)
  reasons.push("팬덤 체급과 소비 성향이 비슷함");

if (popularity >= 85)
  reasons.push("대중성 포지션이 비슷함");

if (digital >= 85)
  reasons.push("디지털 반응 성향이 비슷함");

if (momentum >= 85)
  reasons.push("현재 상승세가 비슷함");
```

출력은 최대 2줄.

---

# 18. 결과 UI

## 한국 그룹 상세페이지

```text
🇯🇵 일본에서 비슷한 취향 찾기

🥇 =LOVE
91% MATCH

왕도 · 청순 · 강한 팬덤
대중성과 팬덤의 균형이 비슷한 팀

[상세보기] [Spotify ▶]
```

## 일본 그룹 상세페이지

```text
🇰🇷 한국에서 비슷한 취향 찾기

🥇 ILLIT
89% MATCH
```

---

# 19. 딥링크

추천 상대 페이지로 이동 시:

```text
jp-idol-tier-2026-09.html?group=FRUITS%20ZIPPER
```

```text
kr-idol-tier-2026-09.html?group=IVE
```

페이지 로딩:

```js
const params =
  new URLSearchParams(location.search);

const groupName =
  params.get("group");

if (groupName) {
  openGroupDetail(groupName);
}
```

---

# 20. Spotify

데이터:

```json
{
  "대표곡목록": [
    {
      "title": "LOVE DIVE",
      "spotify_url": "https://open.spotify.com/search/IVE%20LOVE%20DIVE"
    }
  ]
}
```

추천 카드의 Spotify 버튼은 대표곡목록 첫 번째 곡으로 연결.

```js
const spotifyUrl =
  group.대표곡목록?.[0]?.spotify_url;
```

없으면 버튼 숨김.

---

# 21. 최애 기반 취향 추천 V2

localStorage:

```js
const FAVORITE_KEY = "idolTierFavorites";
```

저장 예:

```json
[
  {
    "country": "KR",
    "group": "IVE"
  },
  {
    "country": "KR",
    "group": "aespa"
  }
]
```

최애 2팀 이상이면:

```text
내 최애 취향으로 일본 그룹 찾기
```

버튼 표시.

---

## 21.1 평균 수치 벡터

```js
function averageNumericProfile(vectors) {
  return {
    popularity: mean(
      vectors.map(v => v.popularity)
    ),
    fandom: mean(
      vectors.map(v => v.fandom)
    ),
    live: mean(
      vectors.map(v => v.live)
    ),
    digital: mean(
      vectors.map(v => v.digital)
    ),
    momentum: mean(
      vectors.map(v => v.momentum)
    )
  };
}
```

---

## 21.2 스타일 빈도

```text
IVE
→ 팝 / 청춘 / 퍼포먼스

aespa
→ 일렉트로 / 퍼포먼스 / 다크

KISS OF LIFE
→ R&B / 팝 / 퍼포먼스
```

결과:

```text
퍼포먼스 3/3
팝       2/3
청춘     1/3
일렉트로 1/3
다크     1/3
R&B      1/3
```

스타일 유사도 계산 시 태그 빈도를 weight로 사용할 수 있다.

---

# 22. 검증용 기대 사례

이것은 하드코딩 값이 아니다.

알고리즘의 sanity check 용이다.

| 한국 그룹 | 일본 추천이 대략 이 계열이면 정상 |
|---|---|
| IVE | =LOVE / 超ときめき♡宣伝部 / FRUITS ZIPPER |
| aespa | 櫻坂46 / HANA / IS:SUE |
| LE SSERAFIM | HANA / 櫻坂46 / ME:I |
| ILLIT | CUTIE STREET / FRUITS ZIPPER / CANDY TUNE |
| Dreamcatcher | PassCode / NEO JAPONISM / INUWASI |
| KISS OF LIFE | HANA / iScream / IS:SUE |
| QWER | PassCode / INUWASI / THE ORCHESTRA TOKYO |
| CSR | =LOVE / 高嶺のなでしこ / 可憐なアイボリー |

반대:

```text
FRUITS ZIPPER
→ ILLIT / STAYC / IVE / KiiiKiii
```

완전히 동떨어진 결과가 반복될 경우
먼저 STYLE_KEYWORD_MAP과 RELATED_STYLE_WEIGHTS를 조정한다.

가중치 자체를 계속 임의 조정하는 것은 후순위.

---

# 23. 파일 구조 권장

```text
/
├─ kr-idol-tier-2026-09.html
├─ jp-idol-tier-2026-09.html
│
├─ data/
│  ├─ kr-idols.json
│  └─ jp-idols.json
│
├─ js/
│  └─ idol-match.js
│
└─ IDOL_MATCH_SPEC.md
```

---

# 24. 함수 구조 권장

```js
buildPercentileMaps()
percentileRank()

normalizeKoreanGroup()
normalizeJapaneseGroup()

extractStyleTags()
getRelatedStyleWeight()
calculateStyleSimilarity()

numericSimilarity()
activityTypeSimilarity()

calculateMatchBreakdown()
calculateMatchScore()

getCrossCountryMatches()
getHiddenGems()

generateMatchReason()

getFavorites()
saveFavorite()
buildFavoriteTasteProfile()
```

---

# 25. 캐시 버전

GitHub Pages JSON fetch:

```js
const DATA_VERSION = "20260928";

fetch(
  `./data/kr-idols.json?v=${DATA_VERSION}`
);
```

---

# 26. 성능

212팀뿐이므로 전체 조합 계산도 매우 작다.

최대:

```text
86 × 126 = 10,836 comparisons
```

브라우저에서 충분히 즉시 계산 가능.

서버 필요 없음.

---

# 27. 접근성

- 추천 카드 키보드 접근 가능
- 클릭 가능한 영역에 `cursor:pointer`
- focus-visible 스타일
- 버튼 최소 높이 약 44px
- `% MATCH`를 색으로만 전달하지 않음
- `aria-label` 활용

---

# 28. UI 컬러 제안

```css
:root {
  --bg: #121212;
  --surface: #181818;
  --surface-hover: #242424;
  --green: #1ed760;
  --sakura: #f3727f;
  --text: #ffffff;
  --muted: #b3b3b3;
}
```

한국/공통 추천:
- green 중심

일본 요소:
- sakura pink는 아이콘/작은 badge 정도만

과하게 국가색을 넣지 않는다.

---

# 29. 중요한 금지사항

1. 한국 총점 ↔ 일본 총점 직접 비교 금지
2. 추천 결과 하드코딩 금지
3. 인기순으로 추천을 대체하지 말 것
4. 스타일 문자열 완전일치만 사용하지 말 것
5. 활동종료 그룹을 기본 TOP3에 올리지 말 것
6. 기존 랭킹/검색/정렬 기능을 깨지 말 것
7. 상세페이지 212개를 따로 만들지 말 것
8. Spotify 트랙이 없는데 임의 URL 생성하지 말 것

---

# 30. 구현 우선순위

## Phase 1

- 데이터 로드
- percentile 정규화
- 스타일 매핑
- cross-country match
- TOP3
- 추천 이유
- Spotify 버튼
- 딥링크

## Phase 2

- 숨은 취향 발견
- 최애 저장
- 최애 평균 취향 추천

## Phase 3

- 추천 결과 공유
- 취향 프로필 시각화
- 매칭 알고리즘 튜닝 UI/관리용 로그

---

# 31. 완료 기준

다음 조건을 만족하면 V1 완료.

- [ ] 한국 그룹에서 일본 TOP3 추천 가능
- [ ] 일본 그룹에서 한국 TOP3 추천 가능
- [ ] 국가별 percentile 정규화 적용
- [ ] 스타일 유사도 적용
- [ ] MATCH % 표시
- [ ] 추천 이유 표시
- [ ] 활동종료 그룹 기본 제외
- [ ] Spotify 버튼 표시
- [ ] 상대 페이지 상세 딥링크
- [ ] 모바일 정상
- [ ] 기존 기능 회귀 없음
- [ ] 콘솔 오류 없음

---

## 최종 목표

사용자가 랭킹만 보고 나가는 사이트가 아니라:

> "내가 좋아하는 한국 그룹과 비슷한 일본 그룹은 누구지?"

를 눌러보면서 새로운 그룹을 발견하는 **한국 ↔ 일본 아이돌 취향 탐색 사이트**로 확장하는 것.
