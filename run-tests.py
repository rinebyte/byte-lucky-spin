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


FLOW_TESTS = []


def flow(name):
    def deco(fn):
        FLOW_TESTS.append((name, fn))
        return fn
    return deco


@flow("token valid bisa divalidasi lalu di-spin sampai muncul hadiahnya")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "lucky100")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    assert "valid" in page.inner_text("#status").lower(), page.inner_text("#status")
    page.click("#spin-btn")
    page.wait_for_selector("#result-modal[data-open='true']", timeout=15000)
    assert "Rp 100.000" in page.inner_text("#result-text"), page.inner_text("#result-text")


@flow("hadiah tidak bocor ke panel sebelum roda berhenti")
def _(page, base):
    # Catatan: roda memang selalu menampilkan SEMUA label hadiah — itu wajar.
    # Yang diuji di sini: panel, status, dan modal tidak boleh membocorkan
    # hadiah MANA yang bakal keluar.
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "JACKPOT")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    assert page.get_attribute("#result-modal", "data-open") == "false"
    for sel in ("#status", "#error", "#result-text"):
        assert "1.000.000" not in page.inner_text(sel), f"{sel} membocorkan hadiah"
    panel_html = page.inner_html(".panel")
    assert "p1jt" not in panel_html and "1.000.000" not in panel_html, panel_html


@flow("token asing ditolak")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "NGARANGWAE")
    page.click("#validate-btn")
    page.wait_for_selector("#error:not(:empty)", timeout=10000)
    assert "tidak valid" in page.inner_text("#error").lower(), page.inner_text("#error")


@flow("input kosong ditolak")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.click("#validate-btn")
    page.wait_for_selector("#error:not(:empty)", timeout=10000)
    assert "masukkan token" in page.inner_text("#error").lower(), page.inner_text("#error")


@flow("token bekas ditolak tanpa membocorkan hadiah")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "LUCKY50")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    page.click("#spin-btn")
    page.wait_for_selector("#result-modal[data-open='true']", timeout=15000)
    page.click("#close-result")

    page.fill("#token-input", "lucky50")
    page.click("#validate-btn")
    page.wait_for_selector("#error:not(:empty)", timeout=10000)
    msg = page.inner_text("#error")
    assert "sudah digunakan" in msg.lower(), msg
    assert page.get_attribute("#result-modal", "data-open") == "false"
    assert "50.000" not in msg, "token bekas tidak boleh membocorkan hadiah"
    assert page.is_disabled("#spin-btn"), "token bekas tidak boleh mengaktifkan tombol spin"


@flow("token ditandai terpakai saat spin dimulai, bukan saat hasil keluar")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "LUCKY250")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    page.click("#spin-btn")
    page.wait_for_function(
        "() => (localStorage.getItem('luckyspin.used') || '').includes('LUCKY250')",
        timeout=5000,
    )


@flow("tombol mute bisa ditekan dan pilihannya tersimpan")
def _(page, base):
    page.goto(f"{base}/index.html")
    assert page.get_attribute("#mute-btn", "data-muted") == "false"
    page.click("#mute-btn")
    assert page.get_attribute("#mute-btn", "data-muted") == "true"
    page.reload()
    assert page.get_attribute("#mute-btn", "data-muted") == "true", "pilihan mute harus bertahan"


COUNT_OSCILLATORS = """() => {
  window.__osc = 0;
  const proto = (window.AudioContext || window.webkitAudioContext).prototype;
  const orig = proto.createOscillator;
  proto.createOscillator = function () { window.__osc++; return orig.call(this); };

  // Suara menang datang dari file, bukan oscillator — dicatat terpisah.
  window.__played = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    return play.call(this);
  };
}"""


@flow("spin membangkitkan bunyi, dan benar-benar senyap saat di-mute")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.evaluate(COUNT_OSCILLATORS)
    page.fill("#token-input", "LUCKY10")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    page.click("#spin-btn")
    page.wait_for_selector("#result-modal[data-open='true']", timeout=15000)
    page.wait_for_timeout(600)          # beri waktu arpeggio penutup selesai
    loud = page.evaluate("window.__osc")
    assert loud >= 3, f"harusnya ada tik selama berputar, dapatnya {loud} oscillator"
    played = page.evaluate("window.__played")
    assert any("win.mp3" in s for s in played), f"suara menang harus dari file, terputar: {played}"

    # Modal menutupi tombol mute selama masih terbuka — itu memang tugas modal.
    page.click("#close-result")
    # state="hidden": modal tertutup itu display:none, jadi menunggu "visible"
    # (default Playwright) akan selalu timeout.
    page.wait_for_selector("#result-modal[data-open='false']", state="hidden", timeout=5000)
    page.click("#mute-btn")
    page.evaluate("window.__osc = 0; window.__played = [];")
    page.fill("#token-input", "LUCKY25")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    page.click("#spin-btn")
    page.wait_for_selector("#result-modal[data-open='true']", timeout=15000)
    page.wait_for_timeout(600)
    quiet = page.evaluate("window.__osc")
    assert quiet == 0, f"saat mute harusnya nol bunyi, dapatnya {quiet}"
    diam = page.evaluate("window.__played")
    assert diam == [], f"saat mute file audio tidak boleh diputar, terputar: {diam}"


@flow("tidak ada source code yang bocor kerender ke halaman")
def _(page, base):
    # Kalau sebuah <script> terpotong, sisa JS-nya dirender sebagai teks biasa
    # dan markup di dalam string jadi elemen sungguhan. Gampang lolos dari mata.
    page.goto(f"{base}/index.html")
    body = page.inner_text("body")
    for needle in ("const ", "function ", "ERROR_TEXT", "=>"):
        assert needle not in body, f"source bocor ke halaman: {needle!r}"
    stray = page.evaluate("document.querySelectorAll('body > svg').length")
    assert stray == 0, f"ada {stray} <svg> liar langsung di body — tanda script terpotong"


@flow("modal hasil bisa ditutup pakai Escape dan fokus pindah ke tombolnya")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "LUCKY25")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    page.click("#spin-btn")
    page.wait_for_selector("#result-modal[data-open='true']", timeout=15000)
    assert page.evaluate("document.activeElement.id") == "close-result"
    page.keyboard.press("Escape")
    page.wait_for_selector("#result-modal[data-open='false']", state="hidden", timeout=5000)
    assert page.input_value("#token-input") == "", "input harus dikosongkan setelah selesai"


@flow("halaman punya deskripsi dan tidak scroll horizontal di layar HP")
def _(page, base):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{base}/index.html")
    assert page.get_attribute("html", "lang") == "id"
    desc = page.get_attribute("meta[name='description']", "content")
    assert desc and len(desc) > 20, f"meta description belum memadai: {desc!r}"
    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    assert overflow <= 0, f"halaman melebar {overflow}px di viewport 390"


@flow("tombol mute tidak menabrak judul di layar sempit")
def _(page, base):
    page.set_viewport_size({"width": 320, "height": 568})
    page.goto(f"{base}/index.html")
    h1 = page.locator(".head h1").bounding_box()
    btn = page.locator("#mute-btn").bounding_box()
    dx = min(h1["x"] + h1["width"], btn["x"] + btn["width"]) - max(h1["x"], btn["x"])
    dy = min(h1["y"] + h1["height"], btn["y"] + btn["height"]) - max(h1["y"], btn["y"])
    assert dx <= 0 or dy <= 0, f"judul dan tombol mute tumpang tindih {dx:.0f}x{dy:.0f}px"

    baris = page.evaluate("""() => {
      const e = document.querySelector('.tagline');
      const r = document.createRange(); r.selectNodeContents(e);
      return r.getClientRects().length;
    }""")
    assert baris == 1, f"tagline pecah jadi {baris} baris di 320px"


@flow("daftar hadiah digambar dari PRIZES, bukan ditulis ulang di markup")
def _(page, base):
    page.goto(f"{base}/index.html")
    labels = page.eval_on_selector_all("#prize-list li", "els => els.map(e => e.textContent)")
    expected = page.evaluate("PRIZES.slice().sort((a,b) => b.value - a.value).map(p => p.label)")
    assert labels == expected, f"daftar hadiah melenceng dari PRIZES: {labels}"
    assert labels[0] == "Rp 1.000.000", f"hadiah terbesar harus di atas, dapatnya {labels[0]}"
    assert labels[-1] == "Zonk", f"Zonk harus paling bawah, dapatnya {labels[-1]}"
    zonk = page.eval_on_selector_all("#prize-list li.zonk", "els => els.length")
    assert zonk == 1, f"ZONK harus ditandai tepat sekali, dapatnya {zonk}"


@flow("tabel pemenang sudah terisi seed saat halaman dibuka")
def _(page, base):
    page.goto(f"{base}/index.html")
    rows = page.eval_on_selector_all("#winner-body tr", "els => els.length")
    assert rows >= 6, f"tabel harusnya terisi seed, dapatnya {rows} baris"
    own = page.eval_on_selector_all("#winner-body tr.own", "els => els.length")
    assert own == 0, "belum ada kemenangan tapi sudah ada baris bertanda Kamu"


@flow("kemenangan user muncul di baris teratas dan bertahan setelah reload")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "JACKPOT")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    page.click("#spin-btn")
    page.wait_for_selector("#result-modal[data-open='true']", timeout=15000)

    first = page.eval_on_selector("#winner-body tr:first-child", "e => e.className + '|' + e.textContent")
    assert "own" in first and "Kamu" in first, f"baris teratas bukan milik user: {first}"
    assert "1.000.000" in first, first

    page.reload()
    first = page.eval_on_selector("#winner-body tr:first-child", "e => e.className + '|' + e.textContent")
    assert "own" in first and "1.000.000" in first, f"kemenangan hilang setelah reload: {first}"


@flow("ZONK tidak pernah masuk tabel pemenang")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "APESBGT")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    page.click("#spin-btn")
    page.wait_for_selector("#result-modal[data-open='true']", timeout=15000)
    own = page.eval_on_selector_all("#winner-body tr.own", "els => els.length")
    assert own == 0, "ZONK tidak boleh tercatat sebagai kemenangan"
    body = page.inner_text("#winner-body")
    assert "Zonk" not in body, f"kata Zonk bocor ke tabel pemenang: {body}"


@flow("ikon terpasang di tiap kartu dan seragam satu gaya")
def _(page, base):
    page.goto(f"{base}/index.html")
    for sel in ("#how-to h2 .ico", "#prizes h2 .ico", "#winners h2 .ico"):
        assert page.locator(sel).count() == 1, f"judul tanpa ikon: {sel}"

    steps = page.eval_on_selector_all(".step-n .ico", "els => els.length")
    assert steps == 3, f"tiap langkah harus punya ikon, dapatnya {steps}"

    cells = page.eval_on_selector_all("#prize-list li .ico", "els => els.length")
    assert cells == 8, f"tiap sel hadiah harus punya ikon, dapatnya {cells}"

    # Gaya tunggal: tidak boleh ada <svg> ikon yang lupa memakai kelas .ico.
    # #wheel dikecualikan — itu grafik, bukan ikon.
    liar = page.eval_on_selector_all(
        "svg:not(.ico)", "els => els.filter(e => e.id !== 'wheel').length"
    )
    assert liar == 0, f"ada {liar} svg ikon di luar gaya .ico"

    orn = page.eval_on_selector_all(".ornament", "els => els.length")
    assert orn == 3, f"harusnya 3 ornamen antar section, dapatnya {orn}"


@flow("sorotan baris Kamu punya ruang napas dan isinya tercentang vertikal")
def _(page, base):
    page.goto(f"{base}/index.html")
    page.fill("#token-input", "JACKPOT")
    page.click("#validate-btn")
    page.wait_for_selector("#spin-btn:not([disabled])", timeout=10000)
    page.click("#spin-btn")
    page.wait_for_selector("#result-modal[data-open='true']", timeout=15000)
    page.click("#close-result")
    page.wait_for_selector("#result-modal[data-open='false']", state="hidden", timeout=5000)

    m = page.evaluate("""() => {
      const row = document.querySelector('#winner-body tr.own');
      const td = [...row.children];
      const isi = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
      const rowBox = row.getBoundingClientRect();
      return {
        pusatBaris:  rowBox.top + rowBox.height / 2,
        pusatHadiah: isi(td[1]).top + isi(td[1]).height / 2,
        pusatWaktu:  isi(td[2]).top + isi(td[2]).height / 2,
        kiriBand:  td[0].getBoundingClientRect().left,
        kiriTeks:  isi(td[0]).left,
        kananBand: td[2].getBoundingClientRect().right,
        kananTeks: isi(td[2]).right,
      };
    }""")

    # Nama di baris ini dua baris; kalau hadiah/waktu pakai vertical-align top,
    # keduanya nempel ke atas dan barisnya terlihat pincang.
    assert abs(m["pusatBaris"] - m["pusatHadiah"]) <= 3, \
        f"hadiah tidak tercentang vertikal (selisih {m['pusatBaris'] - m['pusatHadiah']:.1f}px)"
    assert abs(m["pusatBaris"] - m["pusatWaktu"]) <= 3, \
        f"waktu tidak tercentang vertikal (selisih {m['pusatBaris'] - m['pusatWaktu']:.1f}px)"

    # Tanpa ruang napas, sorotan mepet ke teks dan terbaca seperti kotak kepotong.
    kiri = m["kiriTeks"] - m["kiriBand"]
    kanan = m["kananBand"] - m["kananTeks"]
    assert kiri >= 6, f"sorotan mepet di kiri ({kiri:.1f}px)"
    assert kanan >= 6, f"sorotan mepet di kanan ({kanan:.1f}px)"


def run_flow_tests(browser, base):
    results = []
    for name, fn in FLOW_TESTS:
        context = browser.new_context()
        # Tanpa ini, tes yang gagal menunggu 30 detik per aksi — satu suite
        # merah jadi butuh bermenit-menit sebelum ketahuan.
        context.set_default_timeout(8000)
        context.add_init_script("window.__SPIN_DURATION__ = 120")
        context.route("**://fonts.googleapis.com/**", lambda r: r.abort())
        context.route("**://fonts.gstatic.com/**", lambda r: r.abort())
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            fn(page, base)
            if errors:
                raise AssertionError("error JS di halaman: " + "; ".join(errors))
            results.append({"name": name, "ok": True})
        except Exception as e:
            results.append({"name": name, "ok": False, "err": str(e).strip() or repr(e)})
        finally:
            context.close()
    return results


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
        page.close()

        flow_results = run_flow_tests(browser, base)
        browser.close()

    results["results"] = results["results"] + flow_results
    results["total"] += len(flow_results)
    results["failed"] += sum(1 for r in flow_results if not r["ok"])

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
