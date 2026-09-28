# -*- coding: utf-8 -*-
import html as htmllib
import json
import re
import sys
import time
import urllib.parse

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
OG_IMG = re.compile(r'<meta property="og:image"[^>]*content="([^"]*)"')
OG_DESC = re.compile(r'<meta property="og:description"[^>]*content="([^"]*)"')
TITLE = re.compile(r"<title>([^<]*)</title>")


def try_one(session, title):
    url = "https://namu.wiki/w/" + urllib.parse.quote(title, safe="")
    try:
        r = session.get(url, headers={"User-Agent": UA}, timeout=15, allow_redirects=True)
    except requests.RequestException as e:
        return None
    if r.status_code != 200:
        return None
    t = TITLE.search(r.text)
    d = OG_DESC.search(r.text)
    i = OG_IMG.search(r.text)
    img = i.group(1) if i else ""
    if img.startswith("//"):
        img = "https:" + img
    return {
        "doc_title": htmllib.unescape(t.group(1).replace(" - 나무위키", "").strip()) if t else "",
        "desc": htmllib.unescape(d.group(1)) if d else "",
        "image": img,
        "tried": title,
    }


def find(session, name):
    cands = [name, name + "(아이돌)", name + "(일본 아이돌)", name + "(아이돌 그룹)"]
    best = None
    for c in cands:
        res = try_one(session, c)
        time.sleep(0.3)
        if not res:
            continue
        ok_img = res["image"].startswith("http")
        idol = ("아이돌" in res["desc"]) or ("걸그룹" in res["desc"]) or ("그룹" in res["desc"] and "일본" in res["desc"])
        res["idol"] = idol
        res["ok_img"] = ok_img
        if idol and ok_img:
            return res
        if best is None:
            best = res
    return best


if __name__ == "__main__":
    names = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
    out = {}
    with requests.Session() as s:
        for i, n in enumerate(names, 1):
            r = find(s, n)
            out[n] = r
            flag = "ok" if (r and r.get("idol") and r.get("ok_img")) else ("weak" if r else "none")
            print(f"[{i}/{len(names)}] {n} -> {flag} {r['doc_title'] if r else ''}", flush=True)
    json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("DONE")
