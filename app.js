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
      const center = i * SEG + SEG / 2;
      const g = el('g', { transform: `rotate(${center} ${CX} ${CY})` });
      const t = el('text', {
        class: prize.id === 'zonk' ? 'seg-label zonk' : 'seg-label',
        x: CX, y: CY - LABEL_R,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      // Rotasi grup melempar label paruh bawah jadi terbalik. Diputar 180°
      // lagi terhadap titiknya sendiri supaya tetap terbaca normal.
      if (center > 90 && center < 270) {
        t.setAttribute('transform', `rotate(180 ${CX} ${CY - LABEL_R})`);
      }
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

/* ═══════════════ SUARA ═══════════════
   Tidak butuh file audio sama sekali — semua nada dibangkitkan WebAudio.
   AudioContext baru dibuat saat klik SPIN pertama; browser memblokir audio
   yang jalan sebelum ada interaksi user. */

const MUTED_KEY = 'luckyspin.muted';
const WIN_SOUND_URL = 'sounds/win.mp3';

function createSound(storage, makeContext) {
  const factory = makeContext || (() => new (window.AudioContext || window.webkitAudioContext)());
  let ctx = null;
  let broken = false;
  let muted = false;

  // Suara menang pakai rekaman asli; tik dan zonk tetap dibangkitkan WebAudio
  // supaya tik bisa terikat ke posisi roda.
  let winAudio = null;
  try {
    winAudio = new Audio(WIN_SOUND_URL);
    winAudio.preload = 'auto';
  } catch (e) {
    winAudio = null;
  }

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
      if (muted || !winAudio) return;
      try {
        winAudio.currentTime = 0;
        const p = winAudio.play();
        // play() ditolak kalau browser memblokir autoplay. Ditelan supaya
        // tidak jadi unhandled rejection yang bikin halaman terlihat error.
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        /* biarkan senyap; spin tetap jalan normal */
      }
    },
    lose() { beep(150, 0.42, 'sine', 0.11); },
    setMuted(v) {
      muted = !!v;
      try { storage.setItem(MUTED_KEY, String(muted)); } catch (e) { /* fallback: sesi ini saja */ }
    },
    isMuted() { return muted; },
  };
}

/* ═══════════════ APLIKASI ═══════════════ */

/* Ikon garis tipis, bukan emoji — emoji dirender pakai gaya masing-masing
   sistem dan bentrok dengan tema Noir & Gold. */
const SPEAKER_BODY = '<path d="M4 9.4v5.2h3.3L12 18.6V5.4L7.3 9.4H4z"/>';
const ICONS = {
  on: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER_BODY}` +
      '<path d="M15.5 9.3a4 4 0 0 1 0 5.4"/><path d="M18 6.8a7.4 7.4 0 0 1 0 10.4"/></svg>',
  off: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER_BODY}` +
       '<path d="M16.2 10.2l4.4 4.4"/><path d="M20.6 10.2l-4.4 4.4"/></svg>',
};

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
  const subEl    = document.getElementById('result-sub');
  const closeBtn = document.getElementById('close-result');
  const panel    = document.querySelector('.panel');
  const muteBtn  = document.getElementById('mute-btn');

  function syncMuteButton() {
    const m = sound ? sound.isMuted() : true;
    muteBtn.dataset.muted = String(m);
    muteBtn.innerHTML = m ? ICONS.off : ICONS.on;
    muteBtn.setAttribute('aria-label', m ? 'Nyalakan suara' : 'Matikan suara');
  }

  function toggleMute() {
    if (!sound) return;
    sound.setMuted(!sound.isMuted());
    syncMuteButton();
  }

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
    validate.textContent = next === 'VALIDATING' ? 'MEMPROSES\u2026' : 'VALIDASI TOKEN';
    statusEl.textContent =
      next === 'READY'   ? '\u2713 Token valid \u2014 tekan SPIN' :
      next === 'SPINNING' ? 'Memutar\u2026' : '';
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
    // "Kamu mendapatkan Zonk" bertabrakan dengan "Belum beruntung".
    subEl.textContent = lose ? 'Hasil putaran' : 'Kamu mendapatkan';
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
      muteBtn.addEventListener('click', toggleMute);
      syncMuteButton();
      setState('IDLE');
    },
  };
}

/* ═══════════════ BOOT ═══════════════
   Script klasik, BUKAN type="module" — module diblokir CORS di file://,
   yang berarti klik-dua-kali index.html akan mati total. */

function startApp() {
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
    sound: createSound(safeStorage()),
  }).start();
}

if (IS_TEST) {
  // Kode tes hanya diunduh saat diminta — tidak ikut terkirim ke user biasa.
  const s = document.createElement('script');
  s.src = 'tests.js';
  document.head.appendChild(s);
} else {
  startApp();
}
