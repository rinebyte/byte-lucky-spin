#!/usr/bin/env python3
"""Jalankan suite tes Lucky Spin secara headless.

  python3 run-tests.py

Menyajikan folder ini lewat HTTP server lokal, membuka index.html?test=1 di
Chromium headless, lalu membaca window.__TEST_RESULTS__.
Exit code 1 kalau ada tes gagal atau ada error JavaScript di halaman.
"""
import functools
import http.server
import pathlib
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright, Error as PlaywrightError

ROOT = pathlib.Path(__file__).parent.resolve()


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


def run_unit_suite(page, base):
    page.goto(f"{base}/index.html?test=1")
    try:
        page.wait_for_function("window.__TEST_RESULTS__ !== undefined", timeout=20000)
    except PlaywrightError:
        return {"total": 0, "failed": 1,
                "results": [{"name": "suite unit selesai jalan", "ok": False,
                             "err": "window.__TEST_RESULTS__ tidak pernah terisi"}]}
    return page.evaluate("window.__TEST_RESULTS__")


def main():
    port = serve()
    base = f"http://127.0.0.1:{port}"
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--mute-audio"])
        page = browser.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        # Blokir Google Fonts supaya tes tetap cepat dan deterministik saat offline.
        page.route("**://fonts.googleapis.com/**", lambda r: r.abort())
        page.route("**://fonts.gstatic.com/**", lambda r: r.abort())

        results = run_unit_suite(page, base)
        browser.close()

    for r in results["results"]:
        print(("  \033[32mPASS\033[0m  " if r["ok"] else "  \033[31mFAIL\033[0m  ") + r["name"])
        if not r["ok"]:
            print("        " + r["err"])

    for e in page_errors:
        print("  \033[31mERROR JS\033[0m  " + e)

    passed = results["total"] - results["failed"]
    print(f"\n{passed}/{results['total']} lolos")
    return 1 if results["failed"] or page_errors else 0


if __name__ == "__main__":
    sys.exit(main())
