# -*- coding: utf-8 -*-
"""월별 snapshot 무결성 검사 (IDOL_HISTORY_SUITE_V3_SPEC.md §13)

  python tools/validate_history.py            # data/history 전체 검사, 오류가 있으면 종료 코드 1
  python tools/validate_history.py --strict   # 경고도 실패로 취급

검사 항목
  index.json   : 기간 형식 · 오름차순 · 중복 없음 · 각 기간의 파일 존재 · index 에 없는 파일(고아) 없음
  snapshot     : meta.country/period 가 경로와 일치 · published_at 형식 · population_count == 팀 수
                 id 중복 없음 · 국가 접두사(KR-/JP-) · rank 정수(>=1) · score 유한 · tier 유효
                 국가별 metric 6개 존재·범위(0~만점) · metric 합 == score · 점수와 순위 순서 모순(경고)
  월 간 연속성 : 이전 달 대비 점수가 한 번에 ±15 이상 바뀐 그룹(경고, 입력 실수 발견용)
  DB 대응      : snapshot 의 id 가 data/{kr,jp}_db.json 에 있는지(경고)
같은 규칙이 브라우저의 HistoryAnalytics.validateSnapshot 에도 있고, tools/history-tests.html 이 실제 데이터를 그 규칙으로 검사한다.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST = os.path.join(ROOT, "data", "history")
TIERS = ["S+", "S", "A+", "A", "B+", "B", "C+", "C", "D+", "D"]
METRICS = {
    "KR": [("domestic_digital", 20), ("album_fandom", 20), ("performance", 20), ("global", 15), ("recognition", 15), ("momentum", 10)],
    "JP": [("live", 25), ("fandom", 20), ("recognition", 20), ("streaming_sns", 15), ("momentum", 10), ("industry", 10)],
}
PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
JUMP = 15


def month_index(p):
    return int(p[:4]) * 12 + int(p[5:]) - 1


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def db_ids(country):
    try:
        d = load(os.path.join(ROOT, "data", "%s_db.json" % country.lower()))
        rows = d if isinstance(d, list) else (d.get("korea") if country == "KR" else d.get("japan")) or []
        return {r["id"] for r in rows}
    except Exception:
        return None


def validate_snapshot(country, period, snap, ids):
    errors, warnings = [], []
    m = snap.get("meta") or {}
    groups = snap.get("groups")
    if not isinstance(groups, list):
        return ["groups 배열이 없습니다"], []
    if m.get("country") != country:
        errors.append("meta.country=%r != %s" % (m.get("country"), country))
    if m.get("period") != period:
        errors.append("meta.period=%r != 파일 기간 %s" % (m.get("period"), period))
    if not DATE_RE.match(str(m.get("published_at", ""))):
        errors.append("meta.published_at 형식 오류: %r" % m.get("published_at"))
    if m.get("population_count") != len(groups):
        warnings.append("population_count(%s) != 팀 수(%d)" % (m.get("population_count"), len(groups)))
    seen = set()
    for g in groups:
        gid = g.get("id", "(id 없음)")
        if gid in seen:
            errors.append("중복 id %s" % gid)
        seen.add(gid)
        if not str(gid).startswith(country + "-"):
            errors.append("%s: 국가 접두사 오류" % gid)
        if not isinstance(g.get("rank"), int) or g["rank"] < 1:
            errors.append("%s: rank 오류 %r" % (gid, g.get("rank")))
        if not isinstance(g.get("score"), (int, float)):
            errors.append("%s: score 오류 %r" % (gid, g.get("score")))
        if g.get("tier") not in TIERS:
            errors.append("%s: 티어 오류 %r" % (gid, g.get("tier")))
        mm = g.get("metrics") or {}
        total = 0
        for key, mx in METRICS[country]:
            v = mm.get(key)
            if not isinstance(v, (int, float)):
                errors.append("%s: metric %s 누락" % (gid, key))
                continue
            if v < 0 or v > mx:
                errors.append("%s: metric %s=%s 범위(0~%d) 초과" % (gid, key, v, mx))
            total += v
        if isinstance(g.get("score"), (int, float)) and abs(total - g["score"]) > 0.01:
            errors.append("%s: metric 합 %s != score %s" % (gid, total, g["score"]))
        if ids is not None and gid not in ids:
            warnings.append("%s: DB(data/%s_db.json)에 없는 id" % (gid, country.lower()))
    order = sorted(groups, key=lambda g: -g.get("score", 0))
    for a, b in zip(order, order[1:]):
        if b["score"] < a["score"] and b["rank"] < a["rank"]:
            warnings.append("점수와 순위 순서 모순: %s / %s" % (a["id"], b["id"]))
            break
    return errors, warnings


def main():
    strict = "--strict" in sys.argv
    idx_path = os.path.join(HIST, "index.json")
    idx = load(idx_path)
    total_err = total_warn = 0

    def out(kind, msg):
        nonlocal total_err, total_warn
        if kind == "E":
            total_err += 1
        else:
            total_warn += 1
        print("  %s %s" % ("✗" if kind == "E" else "!", msg))

    for country in ("KR", "JP"):
        periods = idx.get(country, [])
        print("%s: %d개월 %s ~ %s" % (country, len(periods), periods[0] if periods else "-", periods[-1] if periods else "-"))
        for i, p in enumerate(periods):
            if not PERIOD_RE.match(p):
                out("E", "index: 잘못된 period %r" % p)
            elif i and month_index(p) <= month_index(periods[i - 1]):
                out("E", "index: 오름차순/중복 위반 %s -> %s" % (periods[i - 1], p))
        folder = os.path.join(HIST, country.lower())
        files = sorted(f[:-5] for f in os.listdir(folder) if f.endswith(".json"))
        for p in periods:
            if p not in files:
                out("E", "index 에 있으나 파일 없음: %s/%s.json" % (country.lower(), p))
        for f in files:
            if f not in periods:
                out("E", "파일은 있으나 index 에 없음(고아): %s/%s.json" % (country.lower(), f))
        ids = db_ids(country)
        prev = None
        for p in periods:
            path = os.path.join(folder, p + ".json")
            if not os.path.exists(path):
                prev = None
                continue
            snap = load(path)
            errs, warns = validate_snapshot(country, p, snap, ids)
            for e in errs:
                out("E", "%s %s: %s" % (country, p, e))
            for w in warns:
                out("W", "%s %s: %s" % (country, p, w))
            if prev and month_index(p) - month_index(prev["meta"]["period"]) == 1:
                before = {g["id"]: g for g in prev["groups"]}
                for g in snap["groups"]:
                    b = before.get(g["id"])
                    if b and abs(g["score"] - b["score"]) >= JUMP:
                        out("W", "%s %s: %s 점수가 한 번에 %+g (%s→%s) — 입력 실수인지 확인" % (country, p, g["id"], g["score"] - b["score"], b["score"], g["score"]))
            prev = snap
    print("\n오류 %d · 경고 %d" % (total_err, total_warn))
    sys.exit(1 if total_err or (strict and total_warn) else 0)


if __name__ == "__main__":
    main()
