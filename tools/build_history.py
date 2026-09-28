# -*- coding: utf-8 -*-
"""월별 순위 snapshot 생성/정정 도구 (IDOL_RANK_HISTORY_SPEC.md)

  # 새 달 추가: data/history/kr/<period>.json, jp/<period>.json 생성 + index.json 갱신
  python tools/build_history.py 2026-10 data/kr_db.json data/jp_db.json --published 2026-10-28

  # 이미 있는 달에 버전 표기만 추가 (algorithm_version / map_version, 순위·점수는 그대로)
  python tools/build_history.py --stamp 2026-09

  # 이미 있는 달 정정: revision 을 올리고 corrected_at / correction_note 를 남긴다 (과거 snapshot 은 덮어쓰기 전에 revision 으로만 구분)
  python tools/build_history.py 2026-09 data/kr_db.json data/jp_db.json --correct "동점 순위 입력 오류 수정"

원칙
- snapshot 은 월마다 별도 파일로 영구 보존한다 (기존 달은 --correct 없이는 덮어쓰지 않는다).
- rank 는 DB 의 '순위' 값을 그대로 저장한다 (동점 순위 유지, 배열 위치로 재계산하지 않는다).
- 그룹 식별은 id. 한국/일본은 metric 이 달라 파일도 분리한다.
"""
import argparse
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST = os.path.join(ROOT, "data", "history")

# snapshot 메타에 남기는 버전. 알고리즘/정규화/지도 공식이 바뀌면 여기 값을 올리고, 과거 snapshot 은 고치지 않는다.
#  - normalization_version: percentile 등 정규화의 의미가 같은가 (직접 비교 가능 여부)
#  - algorithm_version:     이 달의 점수/순위를 낸 사이트 알고리즘 버전 (Algorithm v2.1 = V2 + snapshot 버전 기록·HISTORY 지원)
#  - map_version:           IDOL MAP 좌표 공식 버전 (좌표는 저장하지 않고 metrics 에서 같은 함수로 다시 계산한다)
NORMALIZATION_VERSION = "v2"
ALGORITHM_VERSION = "v2.1"
MAP_VERSION = "v1"

# DB 컬럼 -> snapshot metric 키 (한국/일본은 통합하지 않는다)
KR_METRICS = [("국내음원", "domestic_digital"), ("음반·팬덤", "album_fandom"), ("공연", "performance"),
              ("글로벌", "global"), ("국내인지도", "recognition"), ("현재기세", "momentum")]
JP_METRICS = [("공연·현장", "live"), ("팬덤·구매력", "fandom"), ("대중인지도", "recognition"),
              ("스트리밍·SNS", "streaming_sns"), ("현재기세", "momentum"), ("업계영향력", "industry")]


def load_rows(path, country):
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("korea") if country == "KR" else (data.get("japan") or data)
    return data


def competition_ranks(rows):
    """향후 월 순위를 자동 생성할 때의 고정 정책: competition rank (1, 2, 2, 4).
    동점 그룹의 화면 표시 순서(점수 > 현재기세 > id)는 표시용일 뿐 published rank 를 바꾸지 않는다."""
    order = sorted(rows, key=lambda r: -r["총점"])
    out, prev, cur = {}, None, 0
    for i, r in enumerate(order):
        if r["총점"] != prev:
            cur, prev = i + 1, r["총점"]
        out[r["id"]] = cur
    return out


def build_snapshot(rows, country, period, published, revision=1, extra_meta=None):
    metrics = KR_METRICS if country == "KR" else JP_METRICS
    groups = []
    computed = competition_ranks(rows)
    mismatch = [r["그룹"] for r in rows if r.get("순위") is not None and int(r["순위"]) != computed[r["id"]]]
    if mismatch:
        print("경고: DB 순위가 competition rank(1,2,2,4)와 다른 그룹 %d개 (DB 값을 그대로 저장합니다): %s" % (len(mismatch), ", ".join(mismatch[:5])))
    for r in rows:
        m = {key: r[col] for col, key in metrics}
        score = r["총점"]
        if abs(sum(m.values()) - score) > 0.01:
            raise SystemExit("%s %s: metric 합(%s)과 총점(%s)이 다릅니다" % (country, r["그룹"], sum(m.values()), score))
        groups.append({"id": r["id"], "group": r["그룹"], "rank": int(r["순위"]) if r.get("순위") is not None else computed[r["id"]], "tier": r["티어"], "score": score, "metrics": m})
    groups.sort(key=lambda g: (g["rank"], g["id"]))  # 저장 순서만 정렬. rank 값은 그대로 보존
    ids = [g["id"] for g in groups]
    if len(set(ids)) != len(ids):
        raise SystemExit("%s: 중복 id 가 있습니다" % country)
    # percentile 은 '해당 월, 자국 시장 안에서의 상대 위치'다. 팀 수(population)와 정규화 버전을 함께 기록한다.
    meta = {"country": country, "period": period, "published_at": published, "revision": revision,
            "population_count": len(groups), "normalization_version": NORMALIZATION_VERSION, "algorithm_version": ALGORITHM_VERSION, "map_version": MAP_VERSION,
            "percentile_scope": "same-country, same-period relative position"}
    meta.update(extra_meta or {})
    return {"meta": meta, "groups": groups}


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def update_index(country, period):
    p = os.path.join(HIST, "index.json")
    idx = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"KR": [], "JP": []}
    lst = set(idx.get(country, []))
    lst.add(period)
    idx[country] = sorted(lst)  # 과거 -> 최신
    write_json(p, idx)


def stamp_versions(period):
    """이미 있는 달의 meta 에 algorithm_version / map_version 이 비어 있으면 채운다. groups(순위·점수·metrics)는 그대로 둔다."""
    for country in ("kr", "jp"):
        path = os.path.join(HIST, country, period + ".json")
        if not os.path.exists(path):
            sys.exit("%s 가 없습니다" % path)
        snap = json.load(open(path, encoding="utf-8"))
        meta, changed = snap["meta"], False
        for k, v in (("algorithm_version", ALGORITHM_VERSION), ("map_version", MAP_VERSION)):
            if k not in meta:
                meta[k], changed = v, True
        if changed:
            meta["versions_stamped_at"] = datetime.date.today().isoformat()
            write_json(path, snap)
        print("%s %s: algorithm_version=%s map_version=%s%s" % (country.upper(), period, meta.get("algorithm_version"), meta.get("map_version"), " (표기됨)" if changed else " (이미 있음)"))


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--stamp":
        return stamp_versions(sys.argv[2])
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("period", help="YYYY-MM")
    ap.add_argument("kr_db")
    ap.add_argument("jp_db")
    ap.add_argument("--published", default=datetime.date.today().isoformat())
    ap.add_argument("--correct", metavar="NOTE", help="이미 있는 달을 정정(revision+1)")
    ap.add_argument("--expect-kr", type=int, default=0, help="기대 KR 팀 수(다르면 중단)")
    ap.add_argument("--expect-jp", type=int, default=0, help="기대 JP 팀 수(다르면 중단)")
    a = ap.parse_args()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", a.period):
        sys.exit("period 는 YYYY-MM 형식이어야 합니다")

    for country, path, expect in (("KR", a.kr_db, a.expect_kr), ("JP", a.jp_db, a.expect_jp)):
        rows = load_rows(path, country)
        if expect and len(rows) != expect:
            sys.exit("%s 팀 수 %d != 기대값 %d" % (country, len(rows), expect))
        out = os.path.join(HIST, country.lower(), a.period + ".json")
        revision, extra, published = 1, None, a.published
        if os.path.exists(out):
            if not a.correct:
                sys.exit("%s 가 이미 있습니다. 덮어쓰지 않습니다. 정정하려면 --correct \"사유\" 를 쓰세요." % out)
            old = json.load(open(out, encoding="utf-8"))["meta"]
            revision = int(old.get("revision", 1)) + 1
            published = old.get("published_at", published)
            extra = {"corrected_at": datetime.date.today().isoformat(), "correction_note": a.correct}
        elif a.correct:
            sys.exit("정정할 %s 가 없습니다" % out)
        snap = build_snapshot(rows, country, a.period, published, revision, extra)
        write_json(out, snap)
        update_index(country, a.period)
        ties = len(snap["groups"]) - len({g["rank"] for g in snap["groups"]})
        print("%s %s: %d teams, revision %d (동점으로 겹친 순위 %d) -> %s" % (country, a.period, len(snap["groups"]), revision, ties, os.path.relpath(out, ROOT)))


if __name__ == "__main__":
    main()
