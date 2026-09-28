# 여자아이돌 체급 점수표 (idol_tier_2026)

한국 86팀 · 일본 126팀 여자아이돌의 체급 점수표와, 그 데이터로 만든 탐색 기능 모음입니다. GitHub Pages로 배포되는 정적 사이트이며 빌드 도구 없이 바닐라 HTML/CSS/JS로 동작합니다.

사이트: https://rererererete45.github.io/idol_tier_2026/

## 기능

| 기능 | 위치 | 설명 |
|---|---|---|
| 점수표 | `/kr`, `/jp` (`kr.html`, `jp.html`) | 랭킹, 상세 필터, 그룹 상세(대표곡·Spotify·에디터 코멘트), 그룹 비교(레이더 6팀), 최애 저장 |
| IDOL MATCH | 그룹 상세 안 | 한국↔일본 취향 유사도 추천 |
| SAME SCENE | 그룹 상세 안 | 같은 나라에서 비슷한 그룹 TOP 3 + 취향 확장 |
| IDOL MAP | `/map` (`map.html`) | 팬덤↔대중 / 디지털↔라이브 두 축의 시장 포지셔닝 지도 |
| DISCOVER | 상단 🎲 버튼 | 랜덤·내 취향·숨은 보석·취향 확장·HOT·자동·오늘의 아이돌, 컬렉션, 월간 리포트, 공유 카드 |
| 월별 순위 변동 | 점수표 카드·그룹 상세 하단 | 전월 대비 ▲▼–/NEW 배지, 순위·점수 시계열 차트(3·6·12개월·전체), 최고/최저 순위, 같은 국가 그룹 순위 추이 비교 |
| 상단 내비게이션 | 모든 페이지 | 홈·한국·일본·지도·검색·최애·이전 화면 (사이트 안 이동은 브라우저 기록을 쌓지 않음) |

## 파일 구조

```text
index.html                     홈 (/)
kr.html, jp.html               점수표 (/kr, /jp — tools/build_pages.py 가 생성)
map.html                       IDOL MAP (/map)
kr-idol-tier-2026-09.html 등    예전 주소 → 새 주소 리다이렉트(쿼리·해시 유지)
404.html, manifest.webmanifest

js/
  site-nav.js                  공통 상단 바, 사이트 내 이동, DISCOVER 로더
  idol-match.js                데이터 로드, percentile 정규화, 스타일 태그, IDOL MATCH, 최애 저장
  idol-recommendation-core.js  IDOL MAP 논리 좌표 + SAME SCENE + DISCOVER 공통 엔진 (window.IdolRec)
  same-scene.js                SAME SCENE 카드 UI
  rank-history.js              월별 순위 변동·시계열 (window.RankHistory)
  discover.js                  DISCOVER 모달 UI
  idol-map.js                  IDOL MAP 렌더링
css/idol-map.css
data/history/                  월별 순위 snapshot (index.json, kr/YYYY-MM.json, jp/YYYY-MM.json)
data/                          kr_db.json, jp_db.json (+ file:// 폴백용 *_db.js), namu_images.json
img/                           그룹 프로필 썸네일 (KR-###.webp / JP-###.webp)
icons/                         파비콘·홈 화면 아이콘
tools/                         페이지 빌더, 이미지 수집 스크립트, 엔진 테스트(tests.html)
*_SPEC.md                      IDOL MATCH / IDOL MAP / SAME SCENE·DISCOVER 설계서
```

## 데이터 갱신 방법

1. 새 DB JSON을 `data/kr_db.json`, `data/jp_db.json`으로 교체합니다 (KR은 `{"korea":[...]}`, JP는 배열).
2. 페이지와 폴백 데이터를 다시 만듭니다.

   ```bash
   python tools/build_pages.py data/kr_db.json data/jp_db.json
   ```

3. 새 그룹의 사진이 필요하면 `tools/fetch_namu_images.py` → `tools/download_images.py` 순서로 실행하고 `data/namu_images.json`을 갱신합니다.
4. 브라우저 캐시를 위해 `?v=` 값을 함께 올립니다 (`index.html`, `idol-map.html`, `tools/page.head.html`, `tools/build_pages.py`, `js/site-nav.js`).

## 다음 달 순위 데이터 추가 (월간 업데이트)

기존 달의 snapshot은 덮어쓰지 않고 새 달을 **추가**합니다. 순위(`rank`)는 DB의 `순위` 값을 그대로 저장하므로 동점 순위도 유지됩니다.

1. 새 평가 결과로 `data/kr_db.json`, `data/jp_db.json`을 갱신합니다.
2. 이번 달 snapshot을 만들고 `data/history/index.json`에 달을 추가합니다.

   ```bash
   python tools/build_history.py 2026-10 data/kr_db.json data/jp_db.json --published 2026-10-28
   ```

3. 페이지를 다시 빌드합니다 (`python tools/build_pages.py data/kr_db.json data/jp_db.json`). 카드의 ▲▼NEW는 페이지가 열릴 때 마지막 두 달 snapshot으로 자동 계산됩니다.
4. 과거 달의 값을 정정할 때는 `--correct "사유"`를 붙입니다. `revision`이 올라가고 `corrected_at`/`correction_note`가 기록됩니다.

- **월말 평가 엑셀에서 여러 달을 한 번에** 넣을 수도 있습니다 (시트 이름이 `YYYY-MM`인 월별 점수표). 그룹 이름 매칭·지표 합계=총점을 먼저 검증하고, 이미 있는 달은 건너뜁니다. `--dry-run`으로 검증만 할 수 있습니다.

  ```bash
  python tools/import_monthly_xlsx.py 한국_여자아이돌_월말평가_2025-01_12.xlsx 일본_여자아이돌_월말평가_2025-01_12.xlsx
  ```

  현재 이력: 2025-01 ~ 2026-09 (21개월, 후향적 평가는 각 월 말일까지 공개된 자료만 반영).
- 그룹 연결은 `id` 기준이라 이름이 바뀌어도 시계열이 이어집니다. 전월에 없던 id는 `NEW`, 누락된 달은 보간하지 않습니다.
- 한국/일본 snapshot은 metric 키가 달라 파일을 분리했습니다. 두 나라 점수를 직접 비교하는 차트는 없습니다.
- history 로딩이 실패해도 랭킹·검색·필터·상세·비교는 그대로 동작하고 history 영역만 숨겨집니다.

## 추천 알고리즘 V2 (IDOL_ALGORITHM_V2_SPEC.md)

- **결측은 50점이 아니다**: 데이터가 없는 항목(스타일 태그, 활동형태, 지표)은 계산에서 빼고 남은 가중치를 다시 정규화합니다. 사용 가능한 가중치 비율이 `coverage`이고, coverage < 0.55인 후보는 TOP 추천에서 제외, 0.55~0.70은 "데이터 제한" 배지를 붙입니다.
- **유사도와 신뢰도 분리**: 화면에는 `MATCH 91`(상대 유사도 점수, 확률 아님)과 `신뢰도 높음/보통/낮음`을 따로 보여줍니다. 정렬만 `점수 × (0.85 + 0.15 × 신뢰도)`로 약하게 보정합니다. 신뢰도 = coverage × √(두 그룹 데이터신뢰도), 데이터신뢰도 = 완성도 × 검증상태(공식 1.0 / 1차 검증완료 0.95 / 부분검증 0.8 / 추가검증필요 0.6 / 확인필요 0.4).
- **IDOL MATCH**: 스타일 45 · 라이브 13 · 팬덤 12 · 대중성 10 · 디지털 10 · 기세 5 · 활동형태 5. 스타일은 exact 1.0 → 같은 카테고리 0.72 → 명시적 관련쌍 → 무관 0 의 3단계이고, 흔한 태그는 IDF로 비중을 낮춥니다. 최소 기준(점수 58 · 스타일 40 · coverage 0.55)을 통과한 후보만 TOP이며, 부족하면 "완전히 비슷한 팀이 적어 취향 확장 후보를 보여줍니다."라고 안내합니다.
- **SAME SCENE**: 스타일 45 · 4축 profile(대중성·팬덤·라이브·디지털을 한 번의 거리로) 35 · 현재기세 5 · 체급 5. 지도 좌표는 점수에 넣지 않습니다(중복 가중 제거). 같은 세대(+2)/같은 계열(+3) 보정은 기준을 통과한 뒤에만 적용합니다.
- **다양성 재정렬**: 상위 12개 안에서 같은 계열·같은 스타일 복제본에 아주 작은 감점만 줘서, 실제 유사도 차이가 크면 순서를 뒤집지 않습니다.
- **최애 취향**: 후보마다 (가장 잘 맞는 최애 × 0.55 + 상위 2개 평균 × 0.45). 최애가 5팀 이상이고 취향이 뚜렷이 갈리면 취향군 A/B로 나눠 추천합니다. 최애는 `{country, id, slug}`로 저장되고 예전 `{country, group}` 형식은 첫 로딩 때 자동 변환됩니다.
- **DISCOVER**: ALL은 KR/JP를 먼저 50:50으로 고른 뒤 그 안에서 뽑고, 최근 20개 제외에 더해 노출 횟수 페널티(1/√(1+횟수))를 씁니다. 숨은 보석은 완성도·검증·총점 상위권 제외·강점 축 2개(또는 1개 90 이상) 조건이고, HOT은 월별 history가 있으면 현재기세 50 / 순위 위치 백분위 상승 25 / 점수 상승 15 / NEW PEAK·티어 상승 10으로 계산합니다(첫 달은 현재기세만).
- **IDOL MAP**: 스케일은 MAD → IQR → 표준편차 → 0 순으로 fallback하고, logical 좌표(추천·시계열용)와 screen 좌표(표시용)를 분리합니다. zone은 지터 전 logical 위치로만 분류합니다.
- **순위 시계열**: 화면에는 raw `▲/▼N`과 점수 변화를 함께 보여주고, 알고리즘은 순위 위치 백분위 이동 `100·(1−(rank−1)/(N−1))`을 씁니다. 향후 자동 순위 생성은 competition rank(1,2,2,4)로 고정합니다.
- **결정적 정렬**: 모든 추천 정렬은 점수 → 신뢰도 → 스타일 → id 순으로 타이브레이크하며 입력 배열 순서에 의존하지 않습니다.

### 디버그 · 재현

- `?debugMatch=1`(MATCH·SAME SCENE 구성요소/가중치/결측/coverage/confidence/다양성 감점), `?debugDiscover=1`(발견 사유·노출 페널티·후보 수), `?debugMap=1`(스케일 방식·logical/screen 좌표), `?seed=1234`(DISCOVER 재현).
- 스타일 태그는 DB에 `styleTags` 배열을 넣으면 그것을 우선 사용하고, 없으면 `스타일` 문자열 파싱으로 대체합니다. 브라우저 콘솔의 `IdolMatch.exportStyleTags()`로 현재 태그를 JSON으로 뽑아 DB에 저장할 수 있습니다.
- 한국 DB에는 활동형태 필드가 없어 `unknown`으로 처리합니다(가정하지 않음). `활동형태` 필드를 추가하면 자동으로 반영됩니다.

## 로컬 실행 · 테스트

```bash
python tools/serve.py 8770
```

`tools/serve.py`는 GitHub Pages처럼 확장자 없는 주소(`/kr`, `/jp`, `/map`)를 `.html` 파일로 연결해 줍니다. (`python -m http.server`로는 `/kr`가 열리지 않아요. `file://`로 직접 열 때는 `kr.html`처럼 확장자를 붙여야 합니다.)

- 사이트: http://localhost:8770/
- 엔진 자체 테스트: http://localhost:8770/tools/tests.html (SAME SCENE·DISCOVER·지도 좌표 불변식 검사, 전부 통과해야 함)

## localStorage 키

| 키 | 용도 |
|---|---|
| `idolTierFavorites` | 최애 목록 (점수표·MATCH·DISCOVER·지도 공통) |
| `idolTierRecentDiscoveries` | 최근 발견 그룹 ID 20개 (반복 방지) |
| `idolTierDiscoveryHistory` | 발견 기록 50개 (컬렉션·월간 리포트) |
| `idolMatchIncludeEnded` | MATCH 결과에 활동종료 그룹 포함 여부 |
| `idolNavStack` (sessionStorage) | 상단 바 "이전 화면" 목록 |

## 설계 원칙

- 한국·일본 총점을 직접 비교하지 않습니다. 모든 추천은 **국가별 percentile**로 정규화한 뒤 계산합니다.
- IDOL MAP 위치는 우열이 아니라 성향입니다. 총점은 버블 크기에만 쓰이고 좌표에는 쓰지 않습니다.
- SAME SCENE / DISCOVER는 IDOL MAP의 **논리 좌표**(지터·충돌 보정 전)를 사용합니다.
- 점수는 공식 통계가 아닌 동일 기준 상대평가입니다. 프로필 사진은 나무위키 등에서 축소 저장한 것이며 저작권은 각 권리자에게 있습니다.
