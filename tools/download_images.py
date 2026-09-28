# -*- coding: utf-8 -*-
"""Download Namu Wiki representative images into img/ as small local thumbnails.

Namu Wiki's og:image URLs are signed and expire within days, so hotlinking them breaks. This script
re-fetches a fresh URL for every group listed in data/namu_images.json and saves it to img/<ID>.<ext>,
then rewrites data/namu_images.json as {"KR": {name: {"img": "img/KR-001.webp", "wiki": title}}, ...}.

Usage (from repo root): python tools/download_images.py data/kr_db.json data/jp_db.json
"""
import json
import os
import re
import sys
import time
import urllib.parse

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
OG_IMG = re.compile(r'<meta property="og:image"[^>]*content="([^"]*)"')
path = os.path.join(ROOT, "data", "namu_images.json")
imgs = json.load(open(path, encoding="utf-8"))

kr = json.load(open(sys.argv[1], encoding="utf-8"))["korea"]
jp = json.load(open(sys.argv[2], encoding="utf-8"))
os.makedirs(os.path.join(ROOT, "img"), exist_ok=True)

out = {"KR": {}, "JP": {}}
with requests.Session() as s:
    for country, rows in (("KR", kr), ("JP", jp)):
        for r in rows:
            name = r["그룹"]
            e = imgs.get(country, {}).get(name)
            if not e:
                continue
            title = e.get("wiki") or name
            try:
                p = s.get("https://namu.wiki/w/" + urllib.parse.quote(title, safe=""), headers={"User-Agent": UA}, timeout=15)
                m = OG_IMG.search(p.text)
                u = m.group(1) if m else ""
                if u.startswith("//"):
                    u = "https:" + u
                if not u.startswith("http"):
                    print("no image", country, name)
                    continue
                x = s.get(u, headers={"User-Agent": UA}, timeout=15)
                if x.status_code != 200 or len(x.content) < 500:
                    print("bad download", country, name, x.status_code)
                    continue
                ext = os.path.splitext(urllib.parse.urlparse(u).path)[1] or ".webp"
                fn = "img/%s%s" % (r["id"], ext)
                open(os.path.join(ROOT, fn), "wb").write(x.content)
                out[country][name] = {"img": fn, "wiki": e.get("wiki", "")}
                print("ok", country, name, len(x.content))
            except requests.RequestException as ex:
                print("error", country, name, ex)
            time.sleep(0.3)

json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print({k: len(v) for k, v in out.items()})
