# -*- coding: utf-8 -*-
"""Build kr/jp idol tier pages from the detail DB JSON files.

Usage (from repo root):
  python tools/build_pages.py <kr_db.json> <jp_db.json>

Namu Wiki thumbnails are saved under img/ by tools/download_images.py; data/namu_images.json maps
{"KR": {name: {"img": "img/KR-001.webp", "wiki": docTitle}}, "JP": {...}}.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEAD = open(os.path.join(ROOT, "tools", "page.head.html"), encoding="utf-8").read()
SCRIPT = open(os.path.join(ROOT, "tools", "page.script.js"), encoding="utf-8").read()
IMGS = json.load(open(os.path.join(ROOT, "data", "namu_images.json"), encoding="utf-8"))

KR_KEYS = ["국내음원", "음반·팬덤", "공연", "글로벌", "국내인지도", "현재기세"]
JP_KEYS = ["공연·현장", "팬덤·구매력", "대중인지도", "스트리밍·SNS", "현재기세", "업계영향력"]

PERIOD_FIX = {"2017~2019": "2015~2019", "2023~": "2023~현재"}
LINEAGE_FIX = {"ハロプロ": "Hello! Project", "—": "기타/독립"}

FONT_KR = '<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;900&display=swap" rel="stylesheet">'
FONT_JP = '<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;900&family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">'
FS_KR = '"Figtree","Helvetica Neue",helvetica,arial,"Apple SD Gothic Neo","Malgun Gothic",sans-serif'
FS_JP = '"Figtree","Noto Sans JP","Helvetica Neue",helvetica,arial,"Hiragino Sans","Hiragino Kaku Gothic ProN",Meiryo,"MS Gothic",sans-serif'


def tags(pairs):
    return "\n    ".join('<span class="tag">%s <b>%s</b></span>' % (a, b) for a, b in pairs)


def img_of(country, name):
    r = IMGS.get(country, {}).get(name) or {}
    return r.get("img", ""), r.get("wiki", ""), r.get("page", "") if r.get("src") == "official" else ""


def tracks_of(r):
    return [[t["title"], t["spotify_url"]] for t in r.get("대표곡목록", []) if t.get("title") and t.get("spotify_url")]


def members(v):
    if v is None:
        return "확인필요"
    if isinstance(v, float):
        return int(v)
    return v


def kr_rows(rows):
    out = []
    for r in rows:
        img, wiki, imgpage = img_of("KR", r["그룹"])
        out.append({
            "id": r["id"], "n": r["그룹"], "v": [r[k] for k in KR_KEYS], "slug": r["slug"],
            "gen": r["세대"], "style": r["스타일"], "agency": r["소속사"], "status": r["활동상태"],
            "debut": r["데뷔일"], "members": members(r["멤버수"]), "songs": r["대표곡"],
            "link": r["공식링크/SNS"], "verify": r["검증상태"], "note": r["대표출처/메모"],
            "img": img, "wiki": wiki, "imgpage": imgpage, "tracks": tracks_of(r), "intro": r.get("소개글", ""), "editor": r.get("에디터 코멘트(주관)", ""),
        })
    return out


def jp_rows(rows):
    out = []
    for r in rows:
        img, wiki, imgpage = img_of("JP", r["그룹"])
        out.append({
            "id": r["id"], "n": r["그룹"], "v": [r[k] for k in JP_KEYS], "slug": r["id"].lower(),
            "period": PERIOD_FIX.get(r["결성시기"], r["결성시기"]),
            "lineage": LINEAGE_FIX.get(r["계열"], r["계열"]),
            "form": r["활동형태"], "style": r["스타일"], "status": r["활동상태"],
            "debut": r["결성/데뷔일"], "members": members(r["멤버수"]), "songs": r["대표곡"],
            "agency": r["소속/운영"], "link": r["공식링크/SNS"], "verify": r["검증상태"],
            "note": r["대표출처/메모"], "img": img, "wiki": wiki, "imgpage": imgpage, "tracks": tracks_of(r), "intro": r.get("소개글", ""), "editor": r.get("에디터 코멘트(주관)", ""),
        })
    return out


KR = dict(
    file="kr.html", icon="kr",
    title="2026 한국 여자아이돌 티어리스트",
    eyebrow="2026.09.28 기준 · {n}팀",
    h1="한국 여자아이돌<br>티어리스트",
    sub="국내 음원·음반 시장과 팬덤 규모, 공연·글로벌 소비력을 함께 반영해 100점 만점으로 환산한 점수입니다. 공식 통계가 아니라 같은 기준으로 매긴 상대평가라서 ±2~3점 차이는 같은 급으로 봅니다.",
    formula=tags([("국내음원", 20), ("음반·팬덤", 20), ("공연", 20), ("글로벌", 15), ("국내인지도", 15), ("현재기세", 10)]),
    navhref="./jp", navtext="일본 여자아이돌 티어리스트 보기 →",
    font=FONT_KR, fs=FS_KR,
    footer=(
        "<p>점수는 Circle Chart·Melon 등 국내음원 성적, 앨범 판매·팬덤 구매력, 국내외 단독공연·투어 규모, Spotify·해외 차트·글로벌 투어 소비력, 대중 인지도, 최근 12개월 기세를 교차 반영한 상대평가 지수입니다. 점수·티어는 2026년 9월 평가 스냅샷이며, 멤버수·활동상태 등 상세 정보는 2026-09-28 기준 공식 사이트·소속사 공지·보도를 반영했습니다. 카드에 <b style=\"color:var(--warn)\">부분검증</b>이 표시된 항목은 최신 공식 정보 재확인이 필요합니다.</p>\n"
        "  <p>카드를 클릭하면 데뷔일·소속사·멤버수·대표곡·SNS 등을 담은 그룹 상세 정보가 열립니다. 상세 화면의 ‘에디터 코멘트’는 객관 데이터와 별개의 주관적 해석이며 순위·티어·점수에는 영향을 주지 않습니다. 프로필 사진은 나무위키 문서의 대표 이미지를 작게 축소해 저장한 것으로, 출처는 상세 화면에 표기했으며 저작권은 각 권리자에게 있습니다.</p>\n"
        "  <p>Spotify · YouTube 버튼은 채널이나 아티스트 페이지가 아니라 각 서비스의 그룹명 검색 결과로 연결됩니다. PC에서는 새 탭으로 열리고, 모바일에서는 현재 화면에서 바로 연결되어 해당 앱이 설치되어 있으면 자동으로 앱이 열립니다(앱이 없으면 웹페이지로 이동). 나무위키 버튼은 그룹명 문서로 바로 이동하며, 문서가 없는 경우 나무위키 검색 화면이 뜹니다.</p>"
    ),
    cfg=dict(
        country="KR", other={"page": "jp", "label": "일본", "code": "JP"}, LB=["음원", "팬덤", "공연", "글로벌", "인지도", "기세"], MX=[20, 20, 20, 15, 15, 10],
        facets=[
            {"key": "gen", "label": "세대", "order": ["1세대", "2세대", "3세대", "4세대", "5세대", "6세대"]},
            {"key": "tier", "label": "티어"},
            {"key": "style", "label": "스타일", "split": "/"},
            {"key": "agency", "label": "소속사"},
            {"key": "status", "label": "활동상태", "bucket": True,
             "order": ["현역", "신인", "재편·복귀", "비정기·휴지", "참고군", "활동종료"]},
        ],
        info=[["데뷔일", "debut"], ["소속사", "agency"], ["멤버수", "members"], ["대표곡", "songs"],
              ["세대", "gen"], ["스타일", "style"], ["활동상태", "status"]],
        stats=[{"k": "수록 그룹", "t": "count"}, {"k": "평균 총점", "t": "avgTotal"},
               {"k": "평균 공연점수", "t": "avgMetric", "i": 2}, {"k": "S+ 이상", "t": "splus"},
               {"k": "소속사 수", "t": "distinct", "f": "agency"}],
    ),
)
JP = dict(
    file="jp.html", icon="jp",
    title="2026 일본 여자아이돌 티어리스트",
    eyebrow="2026.09.28 기준 · {n}팀",
    h1="일본 여자아이돌<br>티어리스트",
    sub="일본 시장 구조에 맞춰 현장 동원력에 가장 큰 배점을 두고 100점 만점으로 환산한 점수입니다. 공식 통계가 아니라 같은 기준으로 매긴 상대평가라서 ±2~3점 차이는 같은 급으로 봅니다.",
    formula=tags([("공연·현장", 25), ("팬덤·구매력", 20), ("대중인지도", 20), ("스트리밍·SNS", 15), ("현재 기세", 10), ("업계 영향력", 10)]),
    navhref="./kr", navtext="한국 여자아이돌 티어리스트 보기 →",
    font=FONT_JP, fs=FS_JP,
    footer=(
        "<p>점수는 공개 공연 규모·투어 회차·매진 여부, CD/특전·팬클럽 구매력, 대중 인지도, 스트리밍·SNS 화제량, 최근 12개월 성장세, 메이저 미디어 존재감을 교차 반영한 상대평가 지수입니다. 점수·티어는 2026년 9월 평가 스냅샷이며, 멤버수·활동상태 등 상세 정보는 2026-09-28 기준 공식 사이트·공지·보도를 반영했습니다. 카드에 <b style=\"color:var(--warn)\">부분검증·추가검증필요·인원변동형</b>이 표시된 항목은 최신 공식 정보 재확인이 필요하며, 확인되지 않은 정보는 '확인필요'로 표기했습니다.</p>\n"
        "  <p>카드를 클릭하면 결성/데뷔일·소속/운영·멤버수·대표곡·SNS 등을 담은 그룹 상세 정보가 열립니다. 상세 화면의 ‘에디터 코멘트’는 객관 데이터와 별개의 주관적 해석이며 순위·티어·점수에는 영향을 주지 않습니다. 프로필 사진은 나무위키 문서의 대표 이미지(문서가 없는 그룹은 공식 사이트의 공유용 대표 이미지)를 작게 축소해 저장한 것으로(사진을 구하지 못한 그룹은 이니셜로 대체), 출처는 상세 화면에 표기했으며 저작권은 각 권리자에게 있습니다.</p>\n"
        "  <p>Spotify · YouTube 버튼은 채널이나 아티스트 페이지가 아니라 각 서비스의 그룹명 검색 결과로 연결됩니다. PC에서는 새 탭으로 열리고, 모바일에서는 현재 화면에서 바로 연결되어 해당 앱이 설치되어 있으면 자동으로 앱이 열립니다(앱이 없으면 웹페이지로 이동). 나무위키 버튼은 그룹명 문서로 바로 이동하며, 문서가 없는 경우 나무위키 검색 화면이 뜹니다.</p>"
    ),
    cfg=dict(
        country="JP", other={"page": "kr", "label": "한국", "code": "KR"}, LB=["공연", "팬덤", "인지도", "SNS", "기세", "업계"], MX=[25, 20, 20, 15, 10, 10],
        facets=[
            {"key": "period", "label": "결성시기",
             "order": ["~2009", "2010~2014", "2015~2019", "2020~2022", "2023~현재", "확인필요"]},
            {"key": "lineage", "label": "계열"},
            {"key": "form", "label": "활동형태"},
            {"key": "style", "label": "스타일", "split": "/"},
            {"key": "tier", "label": "티어"},
            {"key": "status", "label": "활동상태", "bucket": True, "order": ["현역", "해산예정", "활동종료"]},
        ],
        info=[["결성/데뷔일", "debut"], ["소속/운영", "agency"], ["멤버수", "members"], ["대표곡", "songs"],
              ["결성시기", "period"], ["계열", "lineage"], ["활동형태", "form"], ["스타일", "style"], ["활동상태", "status"]],
        stats=[{"k": "수록 그룹", "t": "count"}, {"k": "평균 총점", "t": "avgTotal"},
               {"k": "평균 공연점수", "t": "avgMetric", "i": 0}, {"k": "S+ 이상", "t": "splus"},
               {"k": "현역 그룹", "t": "bucket", "v": "현역"}],
    ),
)


def icons(k):
    return chr(10).join([
        '<link rel="icon" type="image/png" sizes="32x32" href="icons/%s-32.png">' % k,
        '<link rel="icon" type="image/png" sizes="192x192" href="icons/%s-192.png">' % k,
        '<link rel="apple-touch-icon" href="icons/%s-180.png">' % k,
        '<meta name="theme-color" content="#121212">',
    ])


SITE = "https://rererererete45.github.io/idol_tier_2026/"


def metas(page):
    """검색/공유용 메타 태그 (description, Open Graph, Twitter, manifest)."""
    desc = page["sub"].replace('"', "&quot;")
    return chr(10).join([
        '<meta name="description" content="%s">' % desc,
        '<meta property="og:type" content="website">',
        '<meta property="og:title" content="%s">' % page["title"],
        '<meta property="og:description" content="%s">' % desc,
        '<meta property="og:image" content="%sicons/%s-192.png">' % (SITE, page["icon"]),
        '<meta property="og:url" content="%s%s">' % (SITE, page["file"][:-5]),
        '<meta name="twitter:card" content="summary">',
        '<link rel="manifest" href="manifest.webmanifest">',
    ])


def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def build(page, data):
    h = HEAD
    rep = {
        "@@TITLE@@": page["title"], "@@ICONS@@": icons(page["icon"]) + chr(10) + metas(page), "@@FONTLINK@@": page["font"], "@@FSVAR@@": page["fs"],
        "@@EYEBROW@@": page["eyebrow"].format(n=len(data)), "@@H1@@": page["h1"], "@@SUB@@": page["sub"],
        "@@FORMULA@@": page["formula"], "@@NAVHREF@@": page["navhref"], "@@NAVTEXT@@": page["navtext"], "@@CC@@": page["icon"].upper(),
        "@@FOOTER@@": "\n  " + page["footer"] + "\n",
    }
    for k, v in rep.items():
        h = h.replace(k, v)
    html = h + '<script src="js/idol-match.js?v=20260955"></script>\n<script src="js/idol-recommendation-core.js?v=20260955"></script>\n<script src="js/same-scene.js?v=20260955"></script>\n<script src="js/rank-history.js?v=20260955"></script>\n<script src="js/history-analytics.js?v=20260955"></script>\n' + "<script>\nconst D=" + dumps(data) + ";\nconst CFG=" + dumps(page["cfg"]) + ";\n" + SCRIPT + "</script>\n</body>\n</html>\n"
    open(os.path.join(ROOT, page["file"]), "w", encoding="utf-8", newline="\n").write(html)
    noimg = [d["n"] for d in data if not d["img"]]
    print(page["file"], len(data), "groups; without photo:", len(noimg))


if __name__ == "__main__":
    kr = json.load(open(sys.argv[1], encoding="utf-8"))["korea"]
    jp = json.load(open(sys.argv[2], encoding="utf-8"))
    build(KR, kr_rows(kr))
    build(JP, jp_rows(jp))
    # file:// 등 fetch가 막힌 환경용 script 태그 로드 사본 (js/idol-match.js가 폴백으로 사용)
    for code, rows in (("KR", kr), ("JP", jp)):
        path = os.path.join(ROOT, "data", "%s_db.js" % code.lower())
        text = "window.IDOL_DB_%s=%s;" % (code, dumps(rows))
        open(path, "w", encoding="utf-8", newline=chr(10)).write(text + chr(10))
        print(path, len(rows))
