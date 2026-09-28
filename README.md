# 여자아이돌 체급 점수표 (idol_tier_2026)

한국 86팀 · 일본 126팀 여자아이돌의 체급 점수표와, 그 데이터로 만든 탐색 기능 모음입니다. GitHub Pages로 배포되는 정적 사이트이며 빌드 도구 없이 바닐라 HTML/CSS/JS로 동작합니다.

사이트: https://rererererete45.github.io/idol_tier_2026/

## 기능

| 기능 | 위치 | 설명 |
|---|---|---|
| 점수표 | `kr-idol-tier-2026-09.html`, `jp-idol-tier-2026-09.html` | 랭킹, 상세 필터, 그룹 상세(대표곡·Spotify·에디터 코멘트), 그룹 비교(레이더 6팀), 최애 저장 |
| IDOL MATCH | 그룹 상세 안 | 한국↔일본 취향 유사도 추천 |
| SAME SCENE | 그룹 상세 안 | 같은 나라에서 비슷한 그룹 TOP 3 + 취향 확장 |
| IDOL MAP | `idol-map.html` | 팬덤↔대중 / 디지털↔라이브 두 축의 시장 포지셔닝 지도 |
| DISCOVER | 상단 🎲 버튼 | 랜덤·내 취향·숨은 보석·취향 확장·HOT·자동·오늘의 아이돌, 컬렉션, 월간 리포트, 공유 카드 |
| 월별 순위 변동 | 점수표 카드·그룹 상세 하단 | 전월 대비 ▲▼–/NEW 배지, 순위·점수 시계열 차트(3·6·12개월·전체), 최고/최저 순위, 같은 국가 그룹 순위 추이 비교 |
| 상단 내비게이션 | 모든 페이지 | 홈·한국·일본·지도·검색·최애·이전 화면 (사이트 안 이동은 브라우저 기록을 쌓지 않음) |

## 파일 구조

```text
index.html                     홈
kr-/jp-idol-tier-2026-09.html  점수표 (tools/build_pages.py 가 생성)
idol-map.html                  IDOL MAP
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

- 그룹 연결은 `id` 기준이라 이름이 바뀌어도 시계열이 이어집니다. 전월에 없던 id는 `NEW`, 누락된 달은 보간하지 않습니다.
- 한국/일본 snapshot은 metric 키가 달라 파일을 분리했습니다. 두 나라 점수를 직접 비교하는 차트는 없습니다.
- history 로딩이 실패해도 랭킹·검색·필터·상세·비교는 그대로 동작하고 history 영역만 숨겨집니다.

## 로컬 실행 · 테스트

```bash
python -m http.server 8770
```

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
