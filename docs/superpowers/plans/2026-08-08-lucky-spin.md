# Lucky Spin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun website satu halaman di mana user memasukkan token, sistem menentukan hadiahnya diam-diam, lalu roda berputar dan berhenti tepat di hadiah itu.

**Architecture:** Satu file `index.html` berisi seluruh aplikasi, dipecah menjadi blok-blok berbatas jelas (`PRIZES`, math, `UsedTokens`, `TokenService`, `Wheel`, `Sound`, `App`). Setiap blok dibuat sebagai factory function yang menerima dependensinya, sehingga bisa diuji terpisah. Roda digambar sebagai SVG dan diputar dengan CSS transform; sudut berhentinya dihitung agar segmen target selalu mendarat di bawah jarum. Suite tes unit ikut tinggal di dalam file yang sama dan aktif lewat `?test=1`; `run-tests.py` menjalankannya headless plus menguji alur user sungguhan lewat Playwright.

**Tech Stack:** HTML + vanilla JS (nol dependency runtime), SVG, CSS transform, WebAudio API, Playwright Python (khusus test runner, bukan dependency aplikasi).

**Spec:** `docs/superpowers/specs/2026-08-08-lucky-spin-design.md`

## Global Constraints

- Aplikasi harus tetap satu file: `index.html`. Tidak boleh ada file `.js` atau `.css` terpisah.
- Nol dependency runtime. Satu-satunya resource eksternal yang diizinkan adalah Google Fonts (`Playfair Display`), dan halaman harus tetap layak tanpanya lewat fallback `Georgia, serif`.
- Bahasa seluruh teks UI: Indonesia.
- 8 segmen. `SEG = 45`, `MARGIN = 5`, `TURNS = 6`.
- Urutan `PRIZES` adalah urutan searah jarum jam dan **tidak boleh** diurutkan dari nilai kecil ke besar.
- `prizeId` tidak boleh pernah ditulis ke DOM sebelum roda berhenti.
- Token ditandai terpakai saat spin **dimulai**, bukan saat hasil keluar.
- Token bekas ditolak tanpa menampilkan info hadiah.
- Palet: latar `#08080B`, panel `#101016`, emas `#D4AF37`, sorot `#F7E7A8`, emas gelap `#7A5F17`, segmen `#14141B`/`#1E1608`, label `#F0E2B6`, ZONK `#7C7C86`, error `#C6413C`.
- Target sentuh minimal 44×44px.
- Mobile-first. Konten dibatasi `max-width: 480px` dan ditengahkan di layar lebar.
- Setiap task berakhir dengan `python3 run-tests.py` hijau sebelum commit.

---

### Task 1: Kerangka file, test harness, dan matematika putaran

Ini fondasinya. Setelah task ini selesai, ada loop tes yang benar-benar jalan, dan bagian paling kritis dari aplikasi — rumus sudut yang menjamin roda berhenti di hadiah yang benar — sudah terbukti lewat 1600 kasus.

**Files:**
- Create: `index.html`
- Create: `run-tests.py`
- Create: `.gitignore`

**Interfaces:**
- Consumes: —
- Produces:
  - `PRIZES: Array<{id: string, label: string, short: string}>` — 8 elemen, urutan searah jarum jam
  - `SEG: number` (45), `MARGIN: number` (5), `TURNS: number` (6)
  - `targetRotation(current: number, index: number, turns?: number) → number`
  - `segmentAtPointer(rotation: number) → number`
  - `test(name: string, fn: () => void | Promise<void>) → void` — daftarkan tes
  - `assert(cond: any, msg?: string) → void`
  - `assertEq(actual: any, expected: any, msg?: string) → void`
  - `window.__TEST_RESULTS__: {total: number, failed: number, results: Array<{name, ok, err?}>}` — diisi setelah suite selesai
  - `IS_TEST: boolean` — true kalau URL punya query `test`

- [ ] **Step 1: Buat `.gitignore`**

```
__pycache__/
.DS_Store
*.png
```

- [ ] **Step 2: Buat `index.html` berisi data, harness tes, dan tes yang gagal**

Perhatikan: `targetRotation` dan `segmentAtPointer` **sengaja belum ditulis**. Tesnya harus gagal dulu.

```html
<!doctype html>
<html lang="id">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Lucky Spin</title>

<svg id="wheel" viewBox="0 0 400 400" aria-hidden="true"></svg>

<script>
/* ═══════════════ KONFIGURASI HADIAH ═══════════════
   Urutan array = urutan searah jarum jam di roda.
   Nilainya sengaja diselang-seling, JANGAN diurutkan kecil-ke-besar —
   kalau urut, user langsung sadar rodanya cuma dekoratif. */
const PRIZES = [
  { id: 'p10',  label: 'Rp 10.000',    short: '10K'  },
  { id: 'p500', label: 'Rp 500.000',   short: '500K' },
  { id: 'p50',  label: 'Rp 50.000',    short: '50K'  },
  { id: 'p1jt', label: 'Rp 1.000.000', short: '1 JT' },
  { id: 'p25',  label: 'Rp 25.000',    short: '25K'  },
  { id: 'p250', label: 'Rp 250.000',   short: '250K' },
  { id: 'zonk', label: 'Zonk',         short: 'ZONK' },
  { id: 'p100', label: 'Rp 100.000',   short: '100K' },
];

const SEG    = 360 / PRIZES.length;  // 45°
const MARGIN = 5;                    // jarak aman dari garis pembatas
const TURNS  = 6;                    // putaran penuh sebelum berhenti

const IS_TEST = new URLSearchParams(location.search).has('test');
</script>

<script>
/* ═══════════════ HARNESS TES ═══════════════ */
const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion gagal');
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ': ' : ''}harusnya ${expected}, dapatnya ${actual}`);
  }
}

async function runTests() {
  const results = [];
  for (const t of TESTS) {
    try {
      await t.fn();
      results.push({ name: t.name, ok: true });
    } catch (e) {
      results.push({ name: t.name, ok: false, err: e && e.message ? e.message : String(e) });
    }
  }
  const failed = results.filter(r => !r.ok).length;
  renderTestOverlay(results, failed);
  window.__TEST_RESULTS__ = { total: results.length, failed, results };
}

function renderTestOverlay(results, failed) {
  const box = document.createElement('div');
  box.id = 'test-overlay';
  const rows = results.map(r =>
    `<div class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${r.name}` +
    (r.ok ? '' : `<br><small>${r.err}</small>`) + `</div>`
  ).join('');
  box.innerHTML =
    `<h1 class="${failed ? 'bad' : 'ok'}">${results.length - failed}/${results.length} lolos</h1>${rows}`;
  document.body.appendChild(box);
}
</script>

<script>
/* ═══════════════ TES: MATEMATIKA PUTARAN ═══════════════ */
test('sudut berhenti selalu mendarat di segmen target (8 hadiah × 200 acak)', () => {
  for (let i = 0; i < PRIZES.length; i++) {
    for (let k = 0; k < 200; k++) {
      const current = Math.random() * 10000;
      const r = targetRotation(current, i);
      assertEq(segmentAtPointer(r), i, `hadiah ${i}, rotasi awal ${current.toFixed(1)}`);
    }
  }
});

test('roda selalu berputar maju minimal TURNS putaran', () => {
  for (let i = 0; i < PRIZES.length; i++) {
    for (let k = 0; k < 50; k++) {
      const current = Math.random() * 10000;
      assert(targetRotation(current, i) >= current + TURNS * 360,
        `rotasi target harus >= ${current + TURNS * 360}`);
    }
  }
});

test('sudut berhenti tidak pernah lebih dekat dari MARGIN ke garis pembatas', () => {
  for (let i = 0; i < PRIZES.length; i++) {
    for (let k = 0; k < 200; k++) {
      const r = targetRotation(Math.random() * 10000, i);
      const local = (((-r % 360) + 360) % 360) % SEG;
      assert(local >= MARGIN && SEG - local >= MARGIN,
        `jarak ke pembatas cuma ${Math.min(local, SEG - local).toFixed(2)}°`);
    }
  }
});

test('jumlah putaran bisa dikurangi lewat parameter turns', () => {
  const r = targetRotation(0, 3, 1);
  assert(r >= 360 && r < 720, `dengan turns=1 harusnya 360–720, dapatnya ${r}`);
  assertEq(segmentAtPointer(r), 3);
});
</script>

<script>
if (IS_TEST) runTests();
</script>
```

- [ ] **Step 3: Buat `run-tests.py`**

Halaman disajikan lewat HTTP server lokal, bukan `file://` — supaya `localStorage` dan perilaku origin-nya sama persis dengan saat di-hosting nanti.

```python
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
```

- [ ] **Step 4: Jalankan tes untuk memastikan GAGAL**

Run: `python3 run-tests.py`
Expected: FAIL. Semua 4 tes matematika gagal dengan pesan seperti `targetRotation is not defined`, dan baris terakhir `0/4 lolos`. Exit code 1.

- [ ] **Step 5: Tulis implementasi matematikanya**

Sisipkan blok ini di `index.html`, **setelah** blok konfigurasi hadiah dan **sebelum** blok harness tes:

```html
<script>
/* ═══════════════ MATEMATIKA PUTARAN ═══════════════
   Segmen i menempati sudut i×45° s/d (i+1)×45°, diukur searah jarum jam
   dari jam 12. Jarum penunjuk DIAM di jam 12; yang berputar hanya rodanya. */

function targetRotation(current, index, turns = TURNS) {
  // jitter bikin roda berhenti agak meleset dari titik tengah segmen.
  // Tanpa ini roda selalu mendarat presisi di tengah, dan itu terasa palsu.
  const jitter  = (Math.random() * 2 - 1) * (SEG / 2 - MARGIN);
  const desired = (360 - (index * SEG + SEG / 2) + jitter + 360) % 360;
  // delta selalu positif: roda cuma pernah berputar searah jarum jam.
  const delta   = ((desired - current) % 360 + 360) % 360;
  // current diakumulasi, tidak pernah di-reset — kalau di-reset, CSS akan
  // menganimasikan putaran mundur yang panjang di spin berikutnya.
  return current + turns * 360 + delta;
}

/* Kebalikan targetRotation: segmen mana yang sedang ada di bawah jarum. */
function segmentAtPointer(rotation) {
  return Math.floor((((-rotation % 360) + 360) % 360) / SEG);
}
</script>
```

- [ ] **Step 6: Jalankan tes untuk memastikan LULUS**

Run: `python3 run-tests.py`
Expected: PASS, `4/4 lolos`, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add .gitignore index.html run-tests.py
git commit -m "feat: add spin angle math with headless test harness"
```

---

### Task 2: Penyimpanan token terpakai dan layanan validasi

**Files:**
- Modify: `index.html` (tambah blok penyimpanan + token service, dan blok tesnya)

**Interfaces:**
- Consumes: `test`, `assert`, `assertEq` dari Task 1
- Produces:
  - `memoryStorage() → {getItem(k): string|null, setItem(k, v): void}`
  - `safeStorage() → Storage | ReturnType<typeof memoryStorage>` — localStorage kalau bisa dipakai, kalau tidak fallback ke memori
  - `createUsedTokens(storage, key?: string) → {has(token: string): boolean, add(token: string): void}` — `key` default `'luckyspin.used'`
  - `normalizeToken(raw: any) → string` — trim + uppercase
  - `DUMMY_TOKENS: Record<string, string>` — kode token → `prizeId`
  - `createTokenService({tokens, usedTokens, delayMs?}) → {validate(raw): Promise<Result>}`
    dengan `Result = {ok: true, prizeId: string, token: string} | {ok: false, reason: 'empty'|'unknown'|'used'}`

- [ ] **Step 1: Tulis tes yang gagal**

Sisipkan blok `<script>` ini setelah blok tes matematika:

```html
<script>
/* ═══════════════ TES: PENYIMPANAN & TOKEN ═══════════════ */

// Storage palsu yang selalu melempar error — meniru mode private browsing.
function brokenStorage() {
  return {
    getItem() { throw new Error('storage diblokir'); },
    setItem() { throw new Error('storage diblokir'); },
  };
}

test('normalizeToken menerima huruf kecil dan spasi di ujung', () => {
  assertEq(normalizeToken(' lucky100 '), 'LUCKY100');
  assertEq(normalizeToken('LUCKY100'), 'LUCKY100');
  assertEq(normalizeToken(''), '');
  assertEq(normalizeToken(null), '');
  assertEq(normalizeToken(undefined), '');
});

test('UsedTokens mencatat dan mengingat token terpakai', () => {
  const used = createUsedTokens(memoryStorage(), 'tes.used');
  assertEq(used.has('LUCKY100'), false);
  used.add('LUCKY100');
  assertEq(used.has('LUCKY100'), true);
  assertEq(used.has('LUCKY50'), false);
});

test('UsedTokens tetap jalan saat storage diblokir', () => {
  const used = createUsedTokens(brokenStorage(), 'tes.used');
  assertEq(used.has('LUCKY100'), false);
  used.add('LUCKY100');
  assertEq(used.has('LUCKY100'), true, 'harus fallback ke memori, bukan melempar error');
});

test('safeStorage mengembalikan storage yang bisa dipakai', () => {
  const s = safeStorage();
  s.setItem('tes.probe', 'x');
  assertEq(s.getItem('tes.probe'), 'x');
});

test('token valid mengembalikan prizeId-nya', async () => {
  const svc = createTokenService({
    tokens: { 'LUCKY100': 'p100' },
    usedTokens: createUsedTokens(memoryStorage(), 'tes.used'),
    delayMs: 0,
  });
  const res = await svc.validate('lucky100');
  assertEq(res.ok, true);
  assertEq(res.prizeId, 'p100');
  assertEq(res.token, 'LUCKY100');
});

test('input kosong ditolak dengan reason empty', async () => {
  const svc = createTokenService({
    tokens: {}, usedTokens: createUsedTokens(memoryStorage(), 'tes.used'), delayMs: 0,
  });
  assertEq((await svc.validate('   ')).reason, 'empty');
});

test('token asing ditolak dengan reason unknown', async () => {
  const svc = createTokenService({
    tokens: { 'LUCKY100': 'p100' },
    usedTokens: createUsedTokens(memoryStorage(), 'tes.used'),
    delayMs: 0,
  });
  assertEq((await svc.validate('NGARANG')).reason, 'unknown');
});

test('token bekas ditolak dengan reason used dan tanpa bocorin hadiah', async () => {
  const used = createUsedTokens(memoryStorage(), 'tes.used');
  const svc = createTokenService({ tokens: { 'LUCKY100': 'p100' }, usedTokens: used, delayMs: 0 });
  used.add('LUCKY100');
  const res = await svc.validate('LUCKY100');
  assertEq(res.ok, false);
  assertEq(res.reason, 'used');
  assertEq(res.prizeId, undefined, 'hadiah tidak boleh ikut dikirim untuk token bekas');
});

test('setiap hadiah punya satu token dummy', () => {
  const ids = Object.values(DUMMY_TOKENS);
  for (const prize of PRIZES) {
    assert(ids.includes(prize.id), `tidak ada token dummy untuk ${prize.id}`);
  }
});
</script>
```

- [ ] **Step 2: Jalankan tes untuk memastikan GAGAL**

Run: `python3 run-tests.py`
Expected: FAIL. 9 tes baru gagal dengan `normalizeToken is not defined`, `createUsedTokens is not defined`, dst. `4/13 lolos`.

- [ ] **Step 3: Tulis implementasinya**

Sisipkan blok ini setelah blok matematika putaran, sebelum harness tes:

```html
<script>
/* ═══════════════ PENYIMPANAN TOKEN TERPAKAI ═══════════════ */

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

/* localStorage bisa melempar error di mode private. Kita probe dulu;
   kalau gagal, aplikasi tetap jalan pakai memori — catatannya saja yang
   hilang saat tab ditutup. */
function safeStorage() {
  try {
    localStorage.setItem('luckyspin.probe', '1');
    localStorage.removeItem('luckyspin.probe');
    return localStorage;
  } catch (e) {
    return memoryStorage();
  }
}

function createUsedTokens(storage, key = 'luckyspin.used') {
  let fallback = null;

  function read() {
    if (fallback) return fallback;
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      fallback = [];
      return fallback;
    }
  }

  function write(list) {
    if (fallback) { fallback = list; return; }
    try {
      storage.setItem(key, JSON.stringify(list));
    } catch (e) {
      fallback = list;
    }
  }

  return {
    has: (token) => read().includes(token),
    add: (token) => {
      const list = read();
      if (!list.includes(token)) { list.push(token); write(list); }
    },
  };
}

/* ═══════════════ TOKEN ═══════════════ */

const DUMMY_TOKENS = {
  'LUCKY10':  'p10',
  'LUCKY25':  'p25',
  'LUCKY50':  'p50',
  'LUCKY100': 'p100',
  'LUCKY250': 'p250',
  'LUCKY500': 'p500',
  'JACKPOT':  'p1jt',
  'APESBGT':  'zonk',
};

const normalizeToken = (raw) => String(raw == null ? '' : raw).trim().toUpperCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* SWAP POINT — saat backend siap, ganti isi validate() jadi:
     const res = await fetch('/api/validate', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ token }),
     });
     return res.json();
   Tanda tangan fungsinya tidak berubah, jadi App tidak perlu disentuh. */
function createTokenService({ tokens, usedTokens, delayMs = 700 }) {
  return {
    async validate(raw) {
      const token = normalizeToken(raw);
      if (!token) return { ok: false, reason: 'empty' };

      await sleep(delayMs);   // meniru waktu proses server

      if (usedTokens.has(token)) return { ok: false, reason: 'used' };

      const prizeId = tokens[token];
      if (!prizeId) return { ok: false, reason: 'unknown' };

      return { ok: true, prizeId, token };
    },
  };
}
</script>
```

- [ ] **Step 4: Jalankan tes untuk memastikan LULUS**

Run: `python3 run-tests.py`
Expected: PASS, `13/13 lolos`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add used-token storage and dummy token validation service"
```

---

### Task 3: Roda SVG dan animasi putaran

**Files:**
- Modify: `index.html` (tambah blok `Wheel`, CSS roda, dan tesnya)

**Interfaces:**
- Consumes: `PRIZES`, `SEG`, `TURNS`, `targetRotation`, `segmentAtPointer` dari Task 1
- Produces:
  - `prizeIndexById(prizeId: string) → number` — -1 kalau tidak ketemu
  - `createWheel(svgEl: SVGSVGElement, opts?: {durationMs?: number, turns?: number}) → Wheel`
    - `Wheel.render(): void` — gambar ulang isi SVG dari nol
    - `Wheel.rotation: number` (getter) — rotasi absolut terakhir dalam derajat
    - `Wheel.spinTo(index: number, opts?: {onTick?: () => void}): Promise<void>` — resolve tepat sekali saat roda benar-benar berhenti

- [ ] **Step 1: Tulis tes yang gagal**

Sisipkan setelah blok tes token:

```html
<script>
/* ═══════════════ TES: RODA ═══════════════ */

// Roda uji dipasang di dokumen (bukan detached) supaya transisi CSS
// benar-benar jalan, tapi tidak kelihatan dan tidak bisa diklik.
function makeTestWheel(opts) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 400 400');
  svg.style.cssText =
    'position:fixed;top:0;left:0;width:200px;height:200px;opacity:0;pointer-events:none';
  document.body.appendChild(svg);
  const wheel = createWheel(svg, opts);
  wheel.render();
  return { svg, wheel };
}

test('prizeIndexById memetakan id hadiah ke posisinya di roda', () => {
  assertEq(prizeIndexById('p10'), 0);
  assertEq(prizeIndexById('p100'), 7);
  assertEq(prizeIndexById('ngaco'), -1);
});

test('roda menggambar satu segmen per hadiah', () => {
  const { svg } = makeTestWheel();
  assertEq(svg.querySelectorAll('path.seg').length, PRIZES.length);
});

test('label segmen sesuai urutan PRIZES', () => {
  const { svg } = makeTestWheel();
  const labels = [...svg.querySelectorAll('text.seg-label')].map(t => t.textContent);
  assertEq(labels.join('|'), PRIZES.map(p => p.short).join('|'));
});

test('label ZONK ditandai beda supaya bisa diredupkan', () => {
  const { svg } = makeTestWheel();
  const zonk = [...svg.querySelectorAll('text.seg-label')]
    .find(t => t.textContent === 'ZONK');
  assert(zonk && zonk.classList.contains('zonk'), 'label ZONK harus punya class zonk');
});

test('render dua kali tidak menggandakan isi roda', () => {
  const { svg, wheel } = makeTestWheel();
  wheel.render();
  assertEq(svg.querySelectorAll('path.seg').length, PRIZES.length);
});

test('spinTo berhenti tepat di segmen yang diminta', async () => {
  const { wheel } = makeTestWheel({ durationMs: 60, turns: 1 });
  for (const index of [0, 3, 7]) {
    await wheel.spinTo(index);
    assertEq(segmentAtPointer(wheel.rotation), index, `spinTo(${index})`);
  }
});

test('spin berikutnya selalu maju, tidak pernah mundur', async () => {
  const { wheel } = makeTestWheel({ durationMs: 60, turns: 1 });
  await wheel.spinTo(2);
  const first = wheel.rotation;
  await wheel.spinTo(5);
  assert(wheel.rotation > first, `rotasi harus naik dari ${first}, dapatnya ${wheel.rotation}`);
});

test('spinTo memicu onTick beberapa kali selama berputar', async () => {
  const { wheel } = makeTestWheel({ durationMs: 400, turns: 1 });
  let ticks = 0;
  await wheel.spinTo(4, { onTick: () => { ticks++; } });
  assert(ticks >= 3, `harusnya ada beberapa tik selama satu putaran, dapatnya ${ticks}`);
});
</script>
```

- [ ] **Step 2: Jalankan tes untuk memastikan GAGAL**

Run: `python3 run-tests.py`
Expected: FAIL. 8 tes baru gagal dengan `createWheel is not defined` / `prizeIndexById is not defined`. `13/21 lolos`.

- [ ] **Step 3: Tulis implementasi roda**

Sisipkan setelah blok token, sebelum harness tes:

```html
<script>
/* ═══════════════ RODA ═══════════════ */

const prizeIndexById = (prizeId) => PRIZES.findIndex(p => p.id === prizeId);

function createWheel(svgEl, { durationMs = 5200, turns = TURNS } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const CX = 200, CY = 200, R = 180, LABEL_R = 118;

  let rotation = 0;
  let rotor = null;

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  };

  // 0° = jam 12, searah jarum jam.
  const pointAt = (deg, radius) => {
    const a = (deg - 90) * Math.PI / 180;
    return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
  };

  function wedge(startDeg, endDeg) {
    const [x1, y1] = pointAt(startDeg, R);
    const [x2, y2] = pointAt(endDeg, R);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
           `A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  }

  function render() {
    svgEl.textContent = '';   // render ulang dari nol, tidak menumpuk

    const defs = el('defs');
    const grad = el('linearGradient', { id: 'goldRim', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.append(
      el('stop', { offset: '0',   'stop-color': '#F7E7A8' }),
      el('stop', { offset: '0.5', 'stop-color': '#D4AF37' }),
      el('stop', { offset: '1',   'stop-color': '#7A5F17' }),
    );
    defs.append(grad);
    svgEl.append(defs);

    rotor = el('g', { class: 'rotor' });

    PRIZES.forEach((prize, i) => {
      rotor.append(el('path', {
        class: 'seg',
        d: wedge(i * SEG, (i + 1) * SEG),
        fill: i % 2 === 0 ? '#14141B' : '#1E1608',
        stroke: 'rgba(212,175,55,.35)',
        'stroke-width': '1',
      }));
    });

    PRIZES.forEach((prize, i) => {
      const g = el('g', { transform: `rotate(${i * SEG + SEG / 2} ${CX} ${CY})` });
      const t = el('text', {
        class: prize.id === 'zonk' ? 'seg-label zonk' : 'seg-label',
        x: CX, y: CY - LABEL_R,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      t.textContent = prize.short;
      g.append(t);
      rotor.append(g);
    });

    svgEl.append(rotor);
    svgEl.append(el('circle', {
      class: 'rim', cx: CX, cy: CY, r: R + 8,
      fill: 'none', stroke: 'url(#goldRim)', 'stroke-width': '9',
    }));

    rotor.style.transformBox = 'view-box';
    rotor.style.transformOrigin = `${CX}px ${CY}px`;
    rotor.style.transform = `rotate(${rotation}deg)`;
  }

  // Sudut roda saat ini, dibaca dari matriks transform hasil animasi CSS.
  function liveAngle() {
    const tr = getComputedStyle(rotor).transform;
    if (!tr || tr === 'none') return 0;
    try {
      const m = new DOMMatrixReadOnly(tr);
      return Math.atan2(m.b, m.a) * 180 / Math.PI;
    } catch (e) {
      return 0;
    }
  }

  function spinTo(index, { onTick } = {}) {
    const to = targetRotation(rotation, index, turns);
    rotation = to;

    return new Promise((resolve) => {
      let done = false;
      let rafId = 0;
      let lastSlot = Math.floor(liveAngle() / SEG);

      function finish() {
        if (done) return;
        done = true;
        cancelAnimationFrame(rafId);
        clearTimeout(timer);
        rotor.removeEventListener('transitionend', onEnd);
        resolve();
      }

      function onEnd(e) {
        if (e.propertyName === 'transform') finish();
      }

      // Jaring pengaman: transitionend tidak jalan kalau user pindah tab di
      // tengah putaran. Tanpa ini aplikasi nyangkut di SPINNING selamanya.
      const timer = setTimeout(finish, durationMs + 300);
      rotor.addEventListener('transitionend', onEnd);

      // Tik terikat ke POSISI roda, bukan ke waktu — jadi tiknya melambat
      // sendiri seiring roda melambat.
      function loop() {
        if (done) return;
        const slot = Math.floor(liveAngle() / SEG);
        if (slot !== lastSlot) {
          lastSlot = slot;
          if (onTick) onTick();
        }
        rafId = requestAnimationFrame(loop);
      }

      rotor.style.transition = `transform ${durationMs}ms cubic-bezier(0.12, 0.72, 0.08, 1)`;
      void rotor.getBoundingClientRect();   // paksa reflow supaya transisi jalan
      rotor.style.transform = `rotate(${to}deg)`;
      rafId = requestAnimationFrame(loop);
    });
  }

  return {
    render,
    spinTo,
    get rotation() { return rotation; },
  };
}
</script>
```

- [ ] **Step 4: Jalankan tes untuk memastikan LULUS**

Run: `python3 run-tests.py`
Expected: PASS, `21/21 lolos`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: render SVG wheel and animate spin to a fixed segment"
```

---

### Task 4: Halaman, state machine, dan gaya Noir & Gold

Task terbesar. Setelah ini aplikasinya sudah bisa dipakai sungguhan dari ujung ke ujung.

**Files:**
- Modify: `index.html` (markup halaman, CSS lengkap, blok `App`)
- Modify: `run-tests.py` (tambah tes alur user lewat Playwright)

**Interfaces:**
- Consumes: `PRIZES`, `prizeIndexById`, `createWheel`, `createTokenService`, `createUsedTokens`, `safeStorage`, `DUMMY_TOKENS`, `IS_TEST`
- Produces:
  - `createApp({wheel, tokenService, usedTokens, sound?}) → {start(): void}`
  - `window.__SPIN_DURATION__?: number` — kalau di-set sebelum halaman jalan, dipakai sebagai durasi animasi (dipakai tes alur supaya cepat)
  - Id DOM yang dipakai tes: `#token-input`, `#validate-btn`, `#status`, `#error`, `#spin-btn`, `#result-modal`, `#result-text`, `#close-result`

- [ ] **Step 1: Tulis tes alur user yang gagal**

Tambahkan ke `run-tests.py`. Sisipkan fungsi berikut sebelum `def main():`:

```python
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


def run_flow_tests(browser, base):
    results = []
    for name, fn in FLOW_TESTS:
        context = browser.new_context()
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
```

Lalu ganti isi `main()` supaya menjalankan kedua suite. Ganti blok `with sync_playwright() as p:` sampai `browser.close()` dengan:

```python
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--mute-audio"])
        page = browser.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.route("**://fonts.googleapis.com/**", lambda r: r.abort())
        page.route("**://fonts.gstatic.com/**", lambda r: r.abort())

        results = run_unit_suite(page, base)
        page.close()

        flow_results = run_flow_tests(browser, base)
        browser.close()

    results["results"] = results["results"] + flow_results
    results["total"] += len(flow_results)
    results["failed"] += sum(1 for r in flow_results if not r["ok"])
```

- [ ] **Step 2: Jalankan tes untuk memastikan GAGAL**

Run: `python3 run-tests.py`
Expected: FAIL. 21 tes unit lolos, 6 tes alur gagal dengan timeout menunggu `#token-input` / `#validate-btn` karena elemennya belum ada. `21/27 lolos`.

- [ ] **Step 3: Tulis markup halaman**

Ganti baris `<svg id="wheel" ...></svg>` di `index.html` dengan markup lengkap ini:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap">

<main class="shell">
  <header class="head">
    <h1>LUCKY SPIN</h1>
    <p class="tagline">putar &amp; menangkan hadiah</p>
  </header>

  <div class="stage">
    <div class="pointer" aria-hidden="true"></div>
    <svg id="wheel" viewBox="0 0 400 400" aria-hidden="true"></svg>
    <button id="spin-btn" type="button" class="hub" disabled>SPIN</button>
  </div>

  <section class="panel">
    <form id="token-form" autocomplete="off">
      <label class="label" for="token-input">Masukkan token</label>
      <input id="token-input" name="token" type="text" placeholder="LUCKY100"
             autocapitalize="characters" autocomplete="off" spellcheck="false"
             enterkeyhint="go" maxlength="24">
      <button id="validate-btn" type="submit" class="cta">VALIDASI TOKEN</button>
    </form>
    <p id="error" role="alert"></p>
    <p id="status" aria-live="polite"></p>
  </section>
</main>

<div id="result-modal" data-open="false" role="dialog" aria-modal="true"
     aria-labelledby="result-title">
  <div class="modal-card">
    <h2 id="result-title">SELAMAT!</h2>
    <p class="modal-sub">Kamu mendapatkan</p>
    <p id="result-text">—</p>
    <button id="close-result" type="button" class="cta">SELESAI</button>
  </div>
</div>
```

- [ ] **Step 4: Tulis CSS**

Sisipkan `<style>` ini tepat setelah `<title>`:

```html
<style>
:root {
  --bg:      #08080B;
  --panel:   #101016;
  --gold:    #D4AF37;
  --gold-hi: #F7E7A8;
  --gold-lo: #7A5F17;
  --label:   #F0E2B6;
  --muted:   #7C7C86;
  --error:   #C6413C;
  --hairline: rgba(212, 175, 55, .25);
  --serif: 'Playfair Display', Georgia, 'Times New Roman', serif;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100dvh;
  background: var(--bg);
  background-image: radial-gradient(circle at 50% 32%, rgba(212,175,55,.10), transparent 62%);
  color: var(--label);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
}

.shell {
  max-width: 480px;
  margin: 0 auto;
  padding: 28px 20px calc(32px + env(safe-area-inset-bottom));
}

/* ── kepala ── */
.head { text-align: center; margin-bottom: 22px; }
.head h1 {
  font-family: var(--serif);
  font-size: clamp(30px, 9vw, 42px);
  letter-spacing: .10em;
  margin: 0;
  background: linear-gradient(180deg, var(--gold-hi), var(--gold) 55%, var(--gold-lo));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tagline {
  margin: 6px 0 0;
  font-size: 12px;
  letter-spacing: .22em;
  text-transform: uppercase;
  color: var(--muted);
}
.head::after {
  content: '';
  display: block;
  width: 76px; height: 1px;
  margin: 16px auto 0;
  background: linear-gradient(90deg, transparent, var(--gold), transparent);
}

/* ── panggung roda ── */
.stage {
  position: relative;
  width: min(86vw, 360px);
  aspect-ratio: 1;
  margin: 0 auto;
}
#wheel { width: 100%; height: 100%; display: block; }

.pointer {
  position: absolute;
  top: -6px; left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 13px solid transparent;
  border-right: 13px solid transparent;
  border-top: 26px solid var(--gold);
  filter: drop-shadow(0 2px 4px rgba(0,0,0,.8));
  z-index: 3;
}

.hub {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 27%; height: 27%;
  min-width: 76px; min-height: 76px;
  border-radius: 50%;
  border: 2px solid var(--gold);
  background: radial-gradient(circle at 50% 35%, #23231C, #0C0C10 70%);
  color: var(--gold-hi);
  font-family: var(--serif);
  font-size: clamp(13px, 3.6vw, 16px);
  letter-spacing: .12em;
  cursor: pointer;
  z-index: 2;
}
.hub[disabled] { opacity: .45; cursor: default; }
.hub:not([disabled]) { animation: hub-pulse 1.9s ease-in-out infinite; }
@keyframes hub-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(212,175,55,.42); }
  50%      { box-shadow: 0 0 0 13px rgba(212,175,55,0); }
}

.seg-label {
  font-family: var(--serif);
  font-size: 25px;
  font-weight: 700;
  fill: var(--label);
}
.seg-label.zonk { fill: var(--muted); font-size: 21px; }

/* ── panel ── */
.panel {
  margin-top: 26px;
  padding: 20px;
  background: var(--panel);
  border: 1px solid var(--hairline);
  border-radius: 14px;
}
.label {
  display: block;
  font-size: 11px;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 8px;
}
#token-input {
  width: 100%;
  min-height: 52px;
  padding: 0 16px;
  background: #08080C;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  color: var(--gold-hi);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 17px;
  letter-spacing: .16em;
  text-transform: uppercase;
}
#token-input::placeholder { color: #3A3A44; letter-spacing: .16em; }
#token-input:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
#token-input[disabled] { opacity: .5; }

.cta {
  width: 100%;
  min-height: 52px;
  margin-top: 12px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(180deg, var(--gold-hi), var(--gold) 52%, var(--gold-lo));
  color: #14100A;
  font-family: var(--serif);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: .16em;
  cursor: pointer;
}
.cta[disabled] { opacity: .55; cursor: default; }
.cta:focus-visible { outline: 2px solid var(--gold-hi); outline-offset: 3px; }

#error, #status { margin: 12px 0 0; font-size: 13px; text-align: center; min-height: 18px; }
#error  { color: var(--error); }
#status { color: var(--gold); letter-spacing: .04em; }
#error:empty, #status:empty { margin: 0; min-height: 0; }

.shake { animation: shake .34s ease; }
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-7px); }
  45% { transform: translateX(6px); }
  70% { transform: translateX(-3px); }
}

/* ── modal hasil ── */
#result-modal {
  position: fixed;
  inset: 0;
  display: none;
  place-items: center;
  padding: 22px;
  background: rgba(4, 4, 6, .82);
  backdrop-filter: blur(5px);
  z-index: 10;
}
#result-modal[data-open='true'] { display: grid; }
.modal-card {
  width: 100%;
  max-width: 340px;
  padding: 30px 24px;
  text-align: center;
  background: var(--panel);
  border: 1px solid var(--gold);
  border-radius: 16px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, .7);
}
.modal-card h2 {
  margin: 0;
  font-family: var(--serif);
  font-size: 25px;
  letter-spacing: .12em;
  color: var(--gold);
}
.modal-sub {
  margin: 14px 0 4px;
  font-size: 11px;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: var(--muted);
}
#result-text {
  margin: 0 0 22px;
  font-family: var(--serif);
  font-size: 33px;
  font-weight: 700;
  color: var(--gold-hi);
}
#result-modal[data-lose='true'] .modal-card h2,
#result-modal[data-lose='true'] #result-text { color: var(--muted); }
#result-modal[data-lose='true'] .modal-card { border-color: var(--hairline); }

/* ── overlay tes ── */
#test-overlay {
  position: fixed; inset: 0; overflow: auto; z-index: 99;
  padding: 18px; background: #05050A;
  font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; color: #C9C9D2;
}
#test-overlay h1 { font-size: 17px; margin: 0 0 14px; }
#test-overlay .ok  { color: #4FBF7B; }
#test-overlay .bad { color: #E0524C; }
#test-overlay small { color: #E0A0A0; }
</style>
```

- [ ] **Step 5: Tulis `createApp` dan titik start**

Sisipkan blok ini setelah blok roda, sebelum harness tes:

```html
<script>
/* ═══════════════ APLIKASI ═══════════════ */

const ERROR_TEXT = {
  empty:   'Masukkan token dulu',
  unknown: 'Token tidak valid',
  used:    'Token sudah digunakan',
};

function createApp({ wheel, tokenService, usedTokens, sound }) {
  const form     = document.getElementById('token-form');
  const input    = document.getElementById('token-input');
  const validate = document.getElementById('validate-btn');
  const spinBtn  = document.getElementById('spin-btn');
  const errorEl  = document.getElementById('error');
  const statusEl = document.getElementById('status');
  const modal    = document.getElementById('result-modal');
  const resultEl = document.getElementById('result-text');
  const titleEl  = document.getElementById('result-title');
  const closeBtn = document.getElementById('close-result');
  const panel    = document.querySelector('.panel');

  let state = 'IDLE';
  // Dipegang di variabel JS saja — tidak pernah ditulis ke DOM sebelum
  // roda berhenti, supaya tidak terbaca dari panel Elements.
  let session = null;

  function setState(next) {
    state = next;
    const busy = next === 'VALIDATING' || next === 'SPINNING';
    input.disabled = busy || next === 'READY';
    validate.disabled = busy || next === 'READY';
    spinBtn.disabled = next !== 'READY';
    validate.textContent = next === 'VALIDATING' ? 'MEMPROSES…' : 'VALIDASI TOKEN';
    statusEl.textContent =
      next === 'READY'   ? '✓ Token valid — tekan SPIN' :
      next === 'SPINNING' ? 'Memutar…' : '';
  }

  function showError(reason) {
    errorEl.textContent = ERROR_TEXT[reason] || 'Terjadi kesalahan';
    panel.classList.remove('shake');
    void panel.offsetWidth;          // paksa reflow supaya animasi bisa diulang
    panel.classList.add('shake');
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (state !== 'IDLE') return;

    errorEl.textContent = '';
    setState('VALIDATING');

    const res = await tokenService.validate(input.value);
    if (!res.ok) {
      setState('IDLE');
      showError(res.reason);
      return;
    }

    session = { token: res.token, prizeId: res.prizeId };
    setState('READY');
  }

  async function onSpin() {
    if (state !== 'READY' || !session) return;
    setState('SPINNING');

    // Ditandai terpakai saat spin DIMULAI. Kalau ditandai di akhir, user
    // tinggal refresh di tengah animasi dan tokennya utuh lagi.
    usedTokens.add(session.token);

    if (sound) sound.unlock();

    const index = prizeIndexById(session.prizeId);
    await wheel.spinTo(index, { onTick: () => { if (sound) sound.tick(); } });

    const prize = PRIZES[index];
    const lose = prize.id === 'zonk';

    modal.dataset.lose = String(lose);
    titleEl.textContent = lose ? 'BELUM BERUNTUNG' : 'SELAMAT!';
    resultEl.textContent = lose ? 'Zonk' : prize.label;
    modal.dataset.open = 'true';
    closeBtn.focus();

    if (sound) (lose ? sound.lose() : sound.win());
  }

  function closeResult() {
    modal.dataset.open = 'false';
    session = null;
    input.value = '';
    errorEl.textContent = '';
    setState('IDLE');
    input.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && modal.dataset.open === 'true') closeResult();
  }

  return {
    start() {
      wheel.render();
      form.addEventListener('submit', onSubmit);
      spinBtn.addEventListener('click', onSpin);
      closeBtn.addEventListener('click', closeResult);
      document.addEventListener('keydown', onKeydown);
      setState('IDLE');
    },
  };
}
</script>
```

Lalu ganti blok start di paling bawah `index.html` (`if (IS_TEST) runTests();`) dengan:

```html
<script>
if (IS_TEST) {
  runTests();
} else {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wheel = createWheel(document.getElementById('wheel'), {
    durationMs: window.__SPIN_DURATION__ || (reduce ? 900 : 5200),
    turns: reduce ? 1 : TURNS,
  });
  const usedTokens = createUsedTokens(safeStorage());
  createApp({
    wheel,
    usedTokens,
    tokenService: createTokenService({ tokens: DUMMY_TOKENS, usedTokens }),
    sound: null,
  }).start();
}
</script>
```

- [ ] **Step 6: Jalankan tes untuk memastikan LULUS**

Run: `python3 run-tests.py`
Expected: PASS, `27/27 lolos`.

- [ ] **Step 7: Lihat hasilnya di viewport HP**

```bash
python3 - <<'PY'
import pathlib
from playwright.sync_api import sync_playwright
url = (pathlib.Path.cwd() / "index.html").as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    pg.goto(url); pg.wait_for_timeout(1200)
    pg.screenshot(path="shot-idle.png")
    pg.fill("#token-input", "JACKPOT"); pg.click("#validate-btn")
    pg.wait_for_selector("#spin-btn:not([disabled])"); pg.wait_for_timeout(400)
    pg.screenshot(path="shot-ready.png")
    b.close()
PY
```

Buka `shot-idle.png` dan `shot-ready.png`. Periksa: judul tidak terpotong, seluruh roda muat tanpa scroll horizontal, ke-8 label terbaca, jarum tepat di jam 12, panel tidak terdorong keluar layar. Perbaiki CSS kalau ada yang meleset, lalu jalankan `python3 run-tests.py` lagi.

- [ ] **Step 8: Commit**

```bash
git add index.html run-tests.py
git commit -m "feat: add page shell, state machine, and Noir & Gold styling"
```

---

### Task 5: Suara tik dan nada penutup

**Files:**
- Modify: `index.html` (blok `Sound`, tombol mute, wiring ke `createApp`)
- Modify: `run-tests.py` (satu tes alur tambahan)

**Interfaces:**
- Consumes: `createApp` dari Task 4 (parameter `sound` sudah ada, sekarang diisi)
- Produces:
  - `createSound(storage) → {unlock(): void, tick(): void, win(): void, lose(): void, setMuted(v: boolean): void, isMuted(): boolean}`
  - Id DOM: `#mute-btn` dengan atribut `data-muted="true"|"false"`
  - localStorage key: `luckyspin.muted`

- [ ] **Step 1: Tulis tes yang gagal**

Sisipkan blok tes ini di `index.html` setelah blok tes roda:

```html
<script>
/* ═══════════════ TES: SUARA ═══════════════ */

test('mute default mati dan bisa dinyalakan', () => {
  const s = createSound(memoryStorage());
  assertEq(s.isMuted(), false);
  s.setMuted(true);
  assertEq(s.isMuted(), true);
});

test('pilihan mute diingat lewat storage', () => {
  const store = memoryStorage();
  createSound(store).setMuted(true);
  assertEq(createSound(store).isMuted(), true, 'instance baru harus ingat pilihan mute');
});

test('bunyi tidak melempar error walau AudioContext belum di-unlock', () => {
  const s = createSound(memoryStorage());
  s.tick(); s.win(); s.lose();   // harus aman dipanggil kapan pun
});

test('bunyi tidak melempar error saat AudioContext gagal dibuat', () => {
  const s = createSound(memoryStorage(), () => { throw new Error('tidak didukung'); });
  s.unlock(); s.tick(); s.win(); s.lose();
});
</script>
```

Dan tambahkan tes alur ini ke `run-tests.py`, setelah tes alur terakhir:

```python
@flow("tombol mute bisa ditekan dan pilihannya tersimpan")
def _(page, base):
    page.goto(f"{base}/index.html")
    assert page.get_attribute("#mute-btn", "data-muted") == "false"
    page.click("#mute-btn")
    assert page.get_attribute("#mute-btn", "data-muted") == "true"
    page.reload()
    assert page.get_attribute("#mute-btn", "data-muted") == "true", "pilihan mute harus bertahan"
```

- [ ] **Step 2: Jalankan tes untuk memastikan GAGAL**

Run: `python3 run-tests.py`
Expected: FAIL. 4 tes unit gagal dengan `createSound is not defined`, 1 tes alur gagal karena `#mute-btn` tidak ada. `27/32 lolos`.

- [ ] **Step 3: Tulis implementasi suara**

Sisipkan setelah blok roda, sebelum blok aplikasi:

```html
<script>
/* ═══════════════ SUARA ═══════════════
   Tidak butuh file audio sama sekali — semua nada dibangkitkan WebAudio.
   AudioContext baru dibuat saat klik SPIN pertama; browser memblokir audio
   yang jalan sebelum ada interaksi user. */

const MUTED_KEY = 'luckyspin.muted';

function createSound(storage, makeContext) {
  const factory = makeContext || (() => new (window.AudioContext || window.webkitAudioContext)());
  let ctx = null;
  let broken = false;
  let muted = false;

  try {
    muted = storage.getItem(MUTED_KEY) === 'true';
  } catch (e) {
    muted = false;
  }

  function ready() {
    if (muted || broken) return null;
    if (!ctx) {
      try {
        ctx = factory();
      } catch (e) {
        broken = true;
        return null;   // suara mati total, tapi spin tetap normal
      }
    }
    return ctx;
  }

  function beep(freq, durationSec, type, gainPeak) {
    const c = ready();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      gain.gain.setValueAtTime(gainPeak, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + durationSec);
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + durationSec);
    } catch (e) {
      broken = true;
    }
  }

  return {
    unlock() {
      const c = ready();
      if (c && c.state === 'suspended') c.resume();
    },
    // Sedikit variasi frekuensi supaya tiap tik tidak terdengar identik.
    tick() { beep(1050 + Math.random() * 110, 0.03, 'triangle', 0.09); },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.16, 'sine', 0.13), i * 95));
    },
    lose() { beep(150, 0.42, 'sine', 0.11); },
    setMuted(v) {
      muted = !!v;
      try { storage.setItem(MUTED_KEY, String(muted)); } catch (e) { /* fallback: sesi ini saja */ }
    },
    isMuted() { return muted; },
  };
}
</script>
```

- [ ] **Step 4: Tambahkan tombol mute ke markup**

Sisipkan tepat setelah `<main class="shell">` dibuka, sebelum `<header class="head">`:

```html
<button id="mute-btn" type="button" data-muted="false" aria-label="Matikan suara">🔊</button>
```

Tambahkan CSS ini di dalam blok `<style>`, sebelum bagian overlay tes:

```css
#mute-btn {
  position: absolute;
  top: 14px; right: 14px;
  width: 44px; height: 44px;
  display: grid; place-items: center;
  background: transparent;
  border: 1px solid var(--hairline);
  border-radius: 50%;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  z-index: 5;
}
#mute-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
```

Dan tambahkan `position: relative;` ke aturan `.shell` yang sudah ada.

- [ ] **Step 5: Sambungkan mute ke aplikasi**

Di dalam `createApp`, tambahkan setelah baris `const panel = ...`:

```js
  const muteBtn = document.getElementById('mute-btn');

  function syncMuteButton() {
    const m = sound ? sound.isMuted() : true;
    muteBtn.dataset.muted = String(m);
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', m ? 'Nyalakan suara' : 'Matikan suara');
  }

  function toggleMute() {
    if (!sound) return;
    sound.setMuted(!sound.isMuted());
    syncMuteButton();
  }
```

Lalu di dalam `start()`, tambahkan sebelum `setState('IDLE');`:

```js
      muteBtn.addEventListener('click', toggleMute);
      syncMuteButton();
```

Terakhir, di blok start paling bawah `index.html`, ganti `sound: null,` dengan:

```js
    sound: createSound(safeStorage()),
```

- [ ] **Step 6: Jalankan tes untuk memastikan LULUS**

Run: `python3 run-tests.py`
Expected: PASS, `32/32 lolos`.

- [ ] **Step 7: Dengarkan sendiri**

```bash
open index.html
```

Masukkan `LUCKY500`, tekan SPIN. Pastikan: tik terdengar tiap segmen lewat jarum, tiknya **melambat** seiring roda melambat, arpeggio naik terdengar saat modal muncul. Coba juga `APESBGT` untuk nada ZONK, dan tekan 🔊 lalu spin lagi untuk memastikan benar-benar senyap.

- [ ] **Step 8: Commit**

```bash
git add index.html run-tests.py
git commit -m "feat: add WebAudio tick and result tones with persisted mute"
```

---

### Task 6: Aksesibilitas, reduced-motion, README, dan QA akhir

**Files:**
- Modify: `index.html` (aturan reduced-motion, `lang`, deskripsi)
- Create: `README.md`
- Modify: `run-tests.py` (dua tes alur aksesibilitas)

**Interfaces:**
- Consumes: seluruh hasil Task 1–5
- Produces: —

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan ke `run-tests.py` setelah tes alur terakhir:

```python
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
    page.wait_for_selector("#result-modal[data-open='false']", timeout=5000)
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
```

- [ ] **Step 2: Jalankan tes untuk memastikan GAGAL**

Run: `python3 run-tests.py`
Expected: FAIL. Tes deskripsi gagal karena `meta[name=description]` belum ada (`None`). `33/34 lolos` — tes Escape kemungkinan sudah lolos karena Task 4 sudah memasang handler-nya; itu wajar, fungsinya sebagai penjaga regresi.

- [ ] **Step 3: Tambahkan deskripsi dan aturan reduced-motion**

Sisipkan di `index.html` tepat setelah `<meta name="viewport" ...>`:

```html
<meta name="description" content="Masukkan token, putar roda, dan menangkan hadiahmu.">
<meta name="theme-color" content="#08080B">
```

Tambahkan di akhir blok `<style>`:

```css
@media (prefers-reduced-motion: reduce) {
  .hub:not([disabled]) { animation: none; }
  .shake { animation: none; }
  .rotor { transition-duration: 900ms !important; }
}
```

- [ ] **Step 4: Jalankan tes untuk memastikan LULUS**

Run: `python3 run-tests.py`
Expected: PASS, `34/34 lolos`.

- [ ] **Step 5: Tulis `README.md`**

````markdown
# Lucky Spin

Website satu halaman: user memasukkan token, sistem menentukan hadiahnya diam-diam,
lalu roda berputar dan berhenti tepat di hadiah itu.

## Cara pakai

Buka `index.html` di browser. Tidak perlu build, tidak perlu install apa pun.

## Token dummy

Satu token untuk tiap hadiah. Token bersifat **sekali pakai** — sekali dipakai spin,
token itu ditolak. Catatannya disimpan di localStorage browser.

| Token      | Hadiah        |
|------------|---------------|
| `LUCKY10`  | Rp 10.000     |
| `LUCKY25`  | Rp 25.000     |
| `LUCKY50`  | Rp 50.000     |
| `LUCKY100` | Rp 100.000    |
| `LUCKY250` | Rp 250.000    |
| `LUCKY500` | Rp 500.000    |
| `JACKPOT`  | Rp 1.000.000  |
| `APESBGT`  | Zonk          |

Untuk mereset token yang sudah terpakai, jalankan di DevTools console:

```js
localStorage.removeItem('luckyspin.used')
```

## Mengubah hadiah atau token

Semuanya ada di `index.html`. Cari `const PRIZES` untuk daftar hadiah dan
`const DUMMY_TOKENS` untuk pemetaan token → hadiah. Urutan `PRIZES` adalah urutan
searah jarum jam di roda, dan sengaja tidak diurutkan dari nilai kecil ke besar —
kalau urut, user langsung sadar rodanya cuma dekoratif.

Jumlah segmen mengikuti panjang `PRIZES` secara otomatis.

## Tes

```bash
python3 run-tests.py
```

Butuh Playwright Python (`pip install playwright && playwright install chromium`).
Menjalankan suite unit di dalam halaman plus tes alur user lewat browser headless.
Exit code 1 kalau ada yang gagal.

Suite unit-nya juga bisa dilihat langsung di browser: buka `index.html?test=1`.

## Catatan keamanan

Ini masih tahap dummy. **Seluruh daftar token dan hadiahnya ada di source code**,
jadi siapa pun bisa membacanya lewat View Source. `prizeId` memang dijaga agar tidak
pernah masuk DOM sebelum roda berhenti, tapi itu bukan pengamanan sungguhan.

Pengamanan sungguhnya baru ada saat validasi dipindah ke server. Titik penggantiannya
sudah ditandai komentar `SWAP POINT` di dalam `index.html`; yang berubah hanya isi
`TokenService.validate()`, tanda tangan fungsinya tetap.
````

- [ ] **Step 6: QA akhir di viewport HP**

```bash
python3 - <<'PY'
import pathlib
from playwright.sync_api import sync_playwright
url = (pathlib.Path.cwd() / "index.html").as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, w, h in [("hp", 390, 844), ("kecil", 320, 568), ("desktop", 1280, 900)]:
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
        pg.goto(url); pg.wait_for_timeout(1200)
        pg.screenshot(path=f"qa-{name}.png", full_page=True)
        pg.close()
    b.close()
PY
```

Periksa ketiga screenshot: tidak ada teks terpotong atau tumpang tindih, roda dan panel utuh, tombol mute tidak menabrak judul, dan di desktop konten tetap terpusat rapi selebar 480px. Perbaiki CSS kalau ada yang meleset.

- [ ] **Step 7: Jalankan tes terakhir kali**

Run: `python3 run-tests.py`
Expected: PASS, `34/34 lolos`.

- [ ] **Step 8: Commit**

```bash
git add index.html README.md run-tests.py
git commit -m "feat: add accessibility, reduced-motion support, and README"
```
