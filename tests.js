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
    `<div class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '\u2713' : '\u2717'} ${r.name}` +
    (r.ok ? '' : `<br><small>${r.err}</small>`) + `</div>`
  ).join('');
  box.innerHTML =
    `<h1 class="${failed ? 'bad' : 'ok'}">${results.length - failed}/${results.length} lolos</h1>${rows}`;
  document.body.appendChild(box);
}

/* ═══════════════ TES: MATEMATIKA PUTARAN ═══════════════ */
test('sudut berhenti selalu mendarat di segmen target (8 hadiah \u00D7 200 acak)', () => {
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
        `jarak ke pembatas cuma ${Math.min(local, SEG - local).toFixed(2)}\u00B0`);
    }
  }
});

test('jumlah putaran bisa dikurangi lewat parameter turns', () => {
  const r = targetRotation(0, 3, 1);
  assert(r >= 360 && r < 720, `dengan turns=1 harusnya 360\u2013720, dapatnya ${r}`);
  assertEq(segmentAtPointer(r), 3);
});

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

test('label di paruh bawah dibalik supaya tidak terbaca terbalik', () => {
  const { svg } = makeTestWheel();
  const texts = [...svg.querySelectorAll('text.seg-label')];
  texts.forEach((t, i) => {
    const center = i * SEG + SEG / 2;
    const flipped = (t.getAttribute('transform') || '').includes('rotate(180');
    assertEq(flipped, center > 90 && center < 270,
      `segmen ${i} di ${center}\u00B0 salah orientasi`);
  });
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

runTests();
