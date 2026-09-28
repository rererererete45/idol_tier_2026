# -*- coding: utf-8 -*-
"""월간 업데이트 파이프라인 — 매달 이 한 줄로 같은 순서를 실행한다.

  python tools/monthly_update.py 2026-10 --published 2026-10-28 --expect-kr 86 --expect-jp 126
  python tools/monthly_update.py 2026-10 --dry-run      # 아무것도 쓰지 않고 검증·요약만
  python tools/monthly_update.py 2026-10 --bump         # 끝에 캐시 버전(?v=)도 1 올린다

순서 (앞 단계가 실패하면 뒤 단계를 하지 않는다)
  1. data/kr_db.json, data/jp_db.json 확인 (팀 수 · id 중복 · 필수 값)   ← 이 파일은 미리 사람이 갱신해 둔다
  2. 이번 달 snapshot 을 메모리에서 만들어 무결성 검사 (오류가 있으면 파일을 쓰기 전에 중단)
  3. data/history/{kr,jp}/<period>.json 생성 + index.json 등록 (algorithm_version / map_version 자동 기록)
  4. 전월 snapshot 과 비교: 순위 변동 · 티어 변동 · 신규 진입 · 시장 내 위치 지수 이동 요약
     + 구간 경계 후보 점검 (다수 그룹이 한꺼번에 크게 변했으면 data/history/breaks.json 에 등록할지 알려 준다)
  5. 전체 history 무결성 검사 (validate_history.py)
  6. (--bump) 캐시 버전 올리기 → 7. kr.html / jp.html 다시 빌드

HOT · 순위 변동 배지 · 기록(RECORD BOOK) · MOVERS · MAP REPLAY 는 snapshot 을 읽어 브라우저에서 계산하므로
snapshot 이 index.json 에 등록되는 순간 코드 수정 없이 자동 반영된다.
"""
import argparse
import datetime
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_history as bh  # noqa: E402
import validate_history as vh  # noqa: E402


def step(n, title):
    print("\n[%d] %s" % (n, title))


def pct(rank, n):
    return 100.0 if n <= 1 else 100.0 * (1 - (rank - 1) / (n - 1))


def prev_period(country, period):
    idx = vh.load(os.path.join(bh.HIST, "index.json")).get(country, [])
    older = [p for p in idx if vh.month_index(p) < vh.month_index(period)]
    return max(older, key=vh.month_index) if older else None


def summarize(country, period, snap):
    """전월과 비교한 요약을 출력하고, 구간 경계 후보 여부를 돌려준다."""
    pp = prev_period(country, period)
    if not pp:
        print("  %s: 비교할 전월 snapshot 이 없습니다(첫 기록)" % country)
        return False
    prev = vh.load(os.path.join(bh.HIST, country.lower(), pp + ".json"))
    before = {g["id"]: g for g in prev["groups"]}
    n0, n1 = len(prev["groups"]), len(snap["groups"])
    rows, new, tier_up = [], [], 0
    order = {t: i for i, t in enumerate(vh.TIERS)}
    for g in snap["groups"]:
        b = before.get(g["id"])
        if not b:
            new.append(g)
            continue
        raw = b["rank"] - g["rank"]
        mv = pct(g["rank"], n1) - pct(b["rank"], n0)
        rows.append((g, b, raw, mv, g["score"] - b["score"]))
        if order[g["tier"]] < order[b["tier"]]:
            tier_up += 1
    ups = sorted([r for r in rows if r[2] > 0], key=lambda r: (-r[3], -r[4], r[0]["id"]))
    downs = sorted([r for r in rows if r[2] < 0], key=lambda r: (r[3], r[4], r[0]["id"]))
    print("  %s %s → %s · 평가 %d팀 → %d팀 · 순위 상승 %d · 하락 %d · 티어 상승 %d · 신규 %d · 점수 변동 그룹 %d" % (
        country, pp, period, n0, n1, len(ups), len(downs), tier_up, len(new), sum(1 for r in rows if r[4] != 0)))
    for label, lst in (("상승", ups), ("하락", downs)):
        for g, b, raw, mv, sd in lst[:3]:
            print("     %s  %-24s #%d → #%d (%+d) · 위치 %+.1f%%p · 점수 %+d" % (label, g["group"], b["rank"], g["rank"], raw, mv, sd))
    for g in new[:5]:
        print("     신규  %-24s #%d · %d점" % (g["group"], g["rank"], g["score"]))
    # 구간 경계 후보: 평소(0~2팀)보다 훨씬 많은 그룹이 한꺼번에 크게 움직임
    big_rank = sum(1 for r in rows if abs(r[2]) >= 5)
    big_score = sum(1 for r in rows if abs(r[4]) >= 10)
    changed = sum(1 for r in rows if r[4] != 0)
    suspicious = big_score >= 5 or big_rank >= max(8, len(rows) // 8)
    if suspicious:
        print("  ⚠ %s: 5위 이상 이동 %d팀 · 10점 이상 변동 %d팀 · 점수 바뀐 그룹 %d/%d — 평가 기준·자료 갱신 가능성.\n"
              "     월간 변화가 아니라면 data/history/breaks.json 에 %s → %s 구간을 등록하세요(값은 고치지 않고 단월 기록에서만 제외됩니다)." % (
                  country, big_rank, big_score, changed, len(rows), pp, period))
    return suspicious


def bump_version():
    src = open(os.path.join(ROOT, "js", "rank-history.js"), encoding="utf-8").read()
    m = re.search(r"var VERSION = '(\d+)'", src)
    if not m:
        sys.exit("js/rank-history.js 에서 VERSION 을 찾지 못했습니다")
    cur = m.group(1)
    new = str(int(cur) + 1)
    changed = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in (".git", "data", "img", "icons", "node_modules", "__pycache__")]
        for f in files:
            if not f.endswith((".html", ".js", ".py", ".css")) or f in ("kr.html", "jp.html", "monthly_update.py"):
                continue
            path = os.path.join(base, f)
            try:
                text = open(path, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            if cur in text:
                open(path, "w", encoding="utf-8", newline="\n").write(text.replace(cur, new))
                changed.append(os.path.relpath(path, ROOT))
    print("  캐시 버전 %s → %s (%d개 파일)" % (cur, new, len(changed)))
    return new


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("period", help="YYYY-MM")
    ap.add_argument("--kr-db", default=os.path.join(ROOT, "data", "kr_db.json"))
    ap.add_argument("--jp-db", default=os.path.join(ROOT, "data", "jp_db.json"))
    ap.add_argument("--published", default=datetime.date.today().isoformat())
    ap.add_argument("--expect-kr", type=int, default=0)
    ap.add_argument("--expect-jp", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--bump", action="store_true", help="끝에 ?v= 캐시 버전을 1 올린다")
    a = ap.parse_args()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", a.period):
        sys.exit("period 는 YYYY-MM 형식이어야 합니다")

    step(1, "DB 확인")
    snaps, ids = {}, {}
    for country, path, expect in (("KR", a.kr_db, a.expect_kr), ("JP", a.jp_db, a.expect_jp)):
        rows = bh.load_rows(path, country)
        if expect and len(rows) != expect:
            sys.exit("  ✗ %s 팀 수 %d != 기대값 %d (--expect-%s)" % (country, len(rows), expect, country.lower()))
        dup = {r["id"] for r in rows if [x["id"] for x in rows].count(r["id"]) > 1}
        if dup:
            sys.exit("  ✗ %s 중복 id: %s" % (country, ", ".join(sorted(dup))))
        print("  ✓ %s %d팀" % (country, len(rows)))
        snaps[country] = bh.build_snapshot(rows, country, a.period, a.published)

    step(2, "이번 달 snapshot 검사 (파일을 쓰기 전)")
    bad = False
    for country, snap in snaps.items():
        errs, warns = vh.validate_snapshot(country, a.period, snap, vh.db_ids(country))
        for e in errs:
            print("  ✗ %s: %s" % (country, e))
        for w in warns:
            print("  ! %s: %s" % (country, w))
        bad = bad or bool(errs)
        if not errs:
            print("  ✓ %s 오류 없음" % country)
    if bad:
        sys.exit("\n오류를 고친 뒤 다시 실행하세요. 아무 파일도 쓰지 않았습니다.")

    step(3, "snapshot 생성 + index 등록")
    exists = [c for c in ("kr", "jp") if os.path.exists(os.path.join(bh.HIST, c, a.period + ".json"))]
    if exists:
        sys.exit("  ✗ %s 가 이미 있습니다. 덮어쓰지 않아요. 정정하려면 build_history.py --correct \"사유\" 를 쓰세요." % ", ".join(exists))
    if a.dry_run:
        print("  (dry-run) 쓰지 않음")
    else:
        for country, snap in snaps.items():
            bh.write_json(os.path.join(bh.HIST, country.lower(), a.period + ".json"), snap)
            bh.update_index(country, a.period)
            print("  ✓ data/history/%s/%s.json (%d팀)" % (country.lower(), a.period, len(snap["groups"])))

    step(4, "전월 대비 요약")
    flagged = False
    for country, snap in snaps.items():
        flagged = summarize(country, a.period, snap) or flagged

    if a.dry_run:
        print("\n(dry-run) 여기까지. 문제가 없으면 --dry-run 없이 다시 실행하세요.")
        return
    step(5, "전체 history 무결성 검사")
    r = subprocess.run([sys.executable, os.path.join(HERE, "validate_history.py")], cwd=ROOT)
    if r.returncode:
        sys.exit("무결성 오류가 있습니다. 위 내용을 고친 뒤 다시 확인하세요.")

    step(6, "캐시 버전")
    if a.bump:
        bump_version()
    else:
        print("  (건너뜀) 새 snapshot 이 브라우저 캐시에 남아 있으면 --bump 로 ?v= 를 올리세요")

    step(7, "kr.html / jp.html 빌드")
    subprocess.check_call([sys.executable, os.path.join(HERE, "build_pages.py"), a.kr_db, a.jp_db], cwd=ROOT)

    print("\n완료. 다음: tools/history-tests.html 과 tools/tests.html 을 열어 전부 통과하는지 확인 → 커밋·푸시.")
    if flagged:
        print("⚠ 구간 경계 후보가 있었어요. data/history/breaks.json 을 확인하세요.")


if __name__ == "__main__":
    main()
