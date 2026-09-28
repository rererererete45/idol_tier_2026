# -*- coding: utf-8 -*-
"""로컬 개발 서버: GitHub Pages 처럼 /kr, /jp, /map (확장자 없음) 주소를 .html 파일로 연결한다.
  python tools/serve.py [port]      # 기본 8770, 저장소 루트를 서비스
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = super().translate_path(path)
        if not os.path.exists(p) and not os.path.splitext(p)[1] and os.path.exists(p + ".html"):
            return p + ".html"
        return p

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
    os.chdir(ROOT)
    print("http://localhost:%d/" % port)
    ThreadingHTTPServer(("", port), Handler).serve_forever()
