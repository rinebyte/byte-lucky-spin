# Lucky Spin — Design Spec

Tanggal: 2026-08-08
Status: disetujui, siap masuk tahap implementation plan

## 1. Ringkasan

Website satu halaman berisi roda hadiah. User memasukkan token, sistem memvalidasi token
dan menentukan hadiahnya secara diam-diam, lalu user memutar roda dan roda berhenti tepat
di hadiah yang sudah ditentukan itu.

Ini murni sisi user. Tidak ada halaman admin, tidak ada pembuatan token, tidak ada laporan.
Data token masih dummy di dalam file.

### Alur

```
IDLE ──validasi──▶ VALIDATING ──▶ READY ──spin──▶ SPINNING ──▶ RESULT ──▶ IDLE
  ▲                    │
  └────── ERROR ◀──────┘   (token kosong / tidak valid / sudah dipakai)
```

### Yang TIDAK dibuat

- Halaman admin atau CRUD token
- Backend, database, autentikasi
- Riwayat spin lintas perangkat
- Klaim hadiah / integrasi pembayaran
- Multi-bahasa (Indonesia saja)

## 2. Keputusan yang sudah diambil

| Topik | Keputusan | Alasan |
|---|---|---|
| Sumber data | Dummy di dalam file | Fokus ke sisi user dulu |
| Reveal hadiah | Hanya sistem yang tahu sampai roda berhenti | Spin jadi punya unsur kejutan |
| Isi roda | 8 segmen, hadiah saldo Rupiah + 1 ZONK | Teks masih terbaca di layar HP |
| Stack | Single-file HTML + vanilla JS | Diminta user; nol dependency |
| Render roda | SVG + CSS transform | Teks tajam, gradien rapi, animasi diurus browser |
| Token bekas | Ditolak mentah, tanpa info hadiah | Diminta user |
| Tema | Noir & Gold (casino luxe) | Kontras emas di atas hitam paling terbaca |
| Suara | Tik per segmen + nada penutup, via WebAudio | Menambah rasa; tidak butuh file audio |

### Konsekuensi yang diterima

Karena single-file, **seluruh daftar token dan hadiahnya ada di source code klien**. Siapa
pun yang membuka View Source bisa membacanya. Ini sudah disepakati untuk tahap dummy.
`prizeId` tetap dijaga agar tidak pernah masuk DOM sebelum roda berhenti, sehingga tidak
terbaca dari panel Elements — tapi itu bukan pengamanan sungguhan.

Pengamanan sungguhnya baru ada saat validasi pindah ke server (lihat §11).

## 3. Struktur

**Diperbarui 2026-08-08 (upgrade tampilan):** aplikasi dipecah jadi empat berkas.

| Berkas | Isi | Dimuat |
|---|---|---|
| `index.html` | Markup saja, nol logika | selalu |
| `styles.css` | Seluruh gaya | selalu |
| `app.js` | Semua modul + boot | selalu |
| `tests.js` | Harness + seluruh tes | hanya saat `?test=1` |

Semua memakai `<script>` klasik, **bukan** `type="module"` — module diblokir CORS di
`file://`, yang berarti klik-dua-kali `index.html` akan mati total.

Modul di dalam `app.js`, dengan batas yang sama seperti rancangan awal:

| Blok | Tanggung jawab | Bergantung pada |
|---|---|---|
| `PRIZES` | Daftar 8 hadiah + urutannya di roda | — |
| `UsedTokens` | Catat token terpakai di localStorage | — |
| `TokenService` | Kode token → `{ok, prizeId, reason}` | `PRIZES`, `UsedTokens` |
| `Wheel` | Gambar SVG, hitung sudut, jalankan putaran | `PRIZES` |
| `Sound` | AudioContext, bunyi tik, nada penutup | — |
| `App` | State machine + wiring DOM | semua di atas |

File pendukung: `README.md` (cara pakai + daftar token dummy), `sounds/win.mp3`.

## 4. Data

```js
const PRIZES = [                          // urutan array = urutan searah jarum jam
  { id: 'p10',  label: 'Rp 10.000',    short: '10K',  value: 10000   },
  { id: 'p500', label: 'Rp 500.000',   short: '500K', value: 500000  },
  { id: 'p50',  label: 'Rp 50.000',    short: '50K',  value: 50000   },
  { id: 'p1jt', label: 'Rp 1.000.000', short: '1 JT', value: 1000000 },
  { id: 'p25',  label: 'Rp 25.000',    short: '25K',  value: 25000   },
  { id: 'p250', label: 'Rp 250.000',   short: '250K', value: 250000  },
  { id: 'zonk', label: 'Zonk',         short: 'ZONK', value: 0       },
  { id: 'p100', label: 'Rp 100.000',   short: '100K', value: 100000  },
];
```

Nilai sengaja diselang-seling (10K → 500K → 50K → 1JT), bukan urut kecil-ke-besar. Kalau
urut, user langsung sadar rodanya dekoratif begitu melihat jarum mendekat.
Field `value` dipakai HANYA untuk mengurutkan Daftar Hadiah (§12), bukan oleh roda.

```js
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
```

Delapan token dummy, satu per hadiah, supaya tiap segmen bisa diuji manual.

## 5. Kontrak antar blok

### `TokenService.validate(rawInput) → Promise<Result>`

```js
// Result:
{ ok: true,  prizeId: 'p100' }
{ ok: false, reason: 'empty' | 'unknown' | 'used' }
```

Sengaja `async`. Isinya sekarang: normalisasi input, cek `UsedTokens`, lookup
`DUMMY_TOKENS`, plus delay 700ms supaya terasa "diproses". Saat backend siap, isi fungsi
diganti `fetch('/api/validate')` — tanda tangan fungsi tidak berubah. Titik ini ditandai
komentar `// SWAP POINT` di kode.

Normalisasi: `String(raw).trim().toUpperCase()`. Jadi `lucky100`, ` LUCKY100 `, dan
`LUCKY100` semuanya diterima.

### `UsedTokens`

```js
UsedTokens.has(token)  → boolean
UsedTokens.add(token)  → void
```

Disimpan di localStorage, key `luckyspin.used`, isinya array kode token. Kalau localStorage
diblokir (mode private), fallback ke `Set` di memori — aplikasi tetap jalan, catatannya saja
yang hilang saat tab ditutup.

### `Wheel`

```js
Wheel.render(container)        // gambar SVG sekali
Wheel.spinTo(index) → Promise  // resolve saat roda benar-benar berhenti
```

### `Sound`

```js
Sound.unlock()      // dipanggil di klik SPIN pertama
Sound.tick()
Sound.win() / Sound.lose()
Sound.setMuted(bool) / Sound.isMuted()
```

## 6. Mekanika putaran

### Sistem sudut

`viewBox="0 0 400 400"`, pusat (200,200), radius roda 180. Segmen `i` menempati sudut
`i×45°` sampai `(i+1)×45°` diukur searah jarum jam dari jam 12. Titik tengah segmen `i`
ada di `c(i) = i×45 + 22.5`.

Jarum penunjuk **diam di jam 12**; yang berputar hanya rodanya.

### Menghitung sudut berhenti

```js
const SEG = 360 / PRIZES.length;          // 45°
const MARGIN = 5;                          // jarak aman dari garis pembatas
const TURNS = 6;

function targetRotation(current, index) {
  const jitter  = (Math.random() * 2 - 1) * (SEG / 2 - MARGIN);   // ±17.5°
  const desired = (360 - (index * SEG + SEG / 2) + jitter + 360) % 360;
  const delta   = ((desired - current) % 360 + 360) % 360;        // selalu maju
  return current + TURNS * 360 + delta;
}
```

Tiga hal yang dijaga rumus ini:

- **`jitter`** membuat roda berhenti agak meleset dari titik tengah segmen. Tanpa ini roda
  selalu mendarat presisi di tengah setiap kali, dan itu terasa palsu. `MARGIN` 5°
  memastikan melesetnya tetap aman di dalam segmen, tidak pernah nyangkut di garis
  pembatas.
- **`delta` selalu positif** — roda hanya pernah berputar searah jarum jam.
- **`current` diakumulasi, tidak pernah di-reset.** Spin kedua lanjut dari 2160° ke 4320°.
  Kalau di-reset, CSS akan menganimasikan putaran mundur yang panjang.

### Fungsi kebalikan (verifikasi)

```js
const segmentAtPointer = r => Math.floor((((-r % 360) + 360) % 360) / SEG);
```

Setelah animasi selesai, `segmentAtPointer(rotasiAkhir)` harus sama persis dengan index
hadiah target. Inilah yang diuji otomatis di §8, bukan sekadar dilihat mata.

### Animasi

`transition: transform 5.2s cubic-bezier(0.12, 0.72, 0.08, 1)` pada grup SVG — ngebut di
awal, melambat panjang di akhir. Angka easing disetel lagi sambil melihat hasil.

Penyelesaian dideteksi lewat `transitionend` (difilter `propertyName === 'transform'`),
**plus timer pengaman** `durasi + 300ms`. `transitionend` tidak jalan kalau user pindah tab
di tengah putaran; tanpa pengaman itu aplikasi nyangkut di `SPINNING` selamanya. Mana pun
yang duluan, `spinTo` resolve tepat sekali.

Kalau `prefers-reduced-motion: reduce`: durasi 900ms, `TURNS = 1`.

## 7. Perilaku

### Urutan kejadian

1. **IDLE** — input token aktif, tombol "Validasi Token".
2. **VALIDATING** — tombol jadi spinner, input dikunci, `TokenService.validate()` jalan.
3. **ERROR** — pesan muncul di bawah input, panel bergetar, kembali ke IDLE.
4. **READY** — panel: "✓ Token valid — tekan SPIN". Hub tengah aktif dan berdenyut pelan.
   `prizeId` disimpan di variabel JS, **tidak pernah ditulis ke DOM**.
5. **SPINNING** — token langsung ditandai terpakai, roda berputar, tik berbunyi.
6. **RESULT** — modal: "Selamat! Kamu dapat Rp X" atau tampilan ZONK. Tombol "Selesai".
7. Kembali ke **IDLE**, input dikosongkan, rotasi roda dibiarkan di posisi terakhir.

**Token ditandai terpakai saat spin dimulai, bukan saat hasil keluar.** Kalau ditandai di
akhir, user tinggal refresh di tengah animasi dan tokennya utuh lagi.

### Penanganan error

| Kejadian | Respons |
|---|---|
| Input kosong | Inline: "Masukkan token dulu" |
| Token tidak ada di daftar | Panel bergetar + "Token tidak valid" |
| Token sudah dipakai | "Token sudah digunakan" — tanpa info hadiah |
| Klik SPIN dua kali | Diabaikan; dikunci oleh state `SPINNING` |
| `transitionend` tidak jalan | Timer pengaman tetap menyelesaikan ke `RESULT` |
| localStorage diblokir | Fallback `Set` di memori; aplikasi tetap jalan |
| WebAudio gagal dibuat | Semua fungsi `Sound` jadi no-op; spin tetap normal |

## 8. Tampilan

### Layout (mobile-first)

Satu halaman, isi panel berubah menurut state:

```
        LUCKY SPIN              ← serif emas + garis tipis emas
   putar & menangkan hadiah
   ─────────────────────────
              ▼                 ← jarum emas, diam di jam 12
         ╭─────────╮
        │  ╲  │  ╱  │           ← roda SVG, min(86vw, 360px)
        │ ───(SPIN)─── │        ← hub tengah = tombol spin
        │  ╱  │  ╲  │
         ╰─────────╯
   ─────────────────────────
   [ MASUKKAN TOKEN     ]       ← panel; isinya ganti per state
   [    VALIDASI TOKEN   ]
```

Di layar lebar, konten dibatasi `max-width: 480px` dan ditengahkan. Tidak ada layout desktop
terpisah — ini bukan aplikasi yang butuh dua kolom.

### Palet

| Peran | Warna |
|---|---|
| Latar | `#08080B` |
| Panel | `#101016`, garis rambut `rgba(212,175,55,.25)` |
| Emas utama | `#D4AF37` |
| Emas sorot | `#F7E7A8` |
| Emas gelap | `#7A5F17` |
| Segmen ganjil / genap | `#14141B` / `#1E1608` |
| Label hadiah | `#F0E2B6` |
| Label ZONK | `#7C7C86` (sengaja redup, bukan emas) |
| Error | `#C6413C` |

Kedua warna segmen sama-sama gelap, jadi teks emas kontras di semuanya.

### Tipografi

Angka hadiah dan judul: `'Playfair Display', Georgia, serif` (Google Fonts). UI: system sans
stack. Google Fonts adalah satu-satunya hal yang diambil dari internet; fallback `Georgia`
membuat halaman tetap layak kalau offline.

### Aksesibilitas

- Target sentuh minimal 44×44px.
- Input token: `autocapitalize="characters"`, `autocomplete="off"`, `enterkeyhint="go"`.
- Perubahan state diumumkan lewat `aria-live="polite"` di panel status.
- Modal hasil: `role="dialog"`, fokus dipindah ke sana, Esc menutup.
- Roda diberi `aria-hidden` — hasilnya sudah disampaikan lewat teks.

## 9. Suara

`AudioContext` dibuat **saat klik SPIN pertama**, bukan saat halaman load — browser
memblokir audio yang jalan sebelum ada interaksi user.

Selama animasi, loop `requestAnimationFrame` membaca sudut roda saat itu dari
`getComputedStyle(el).transform`, di-decode pakai `DOMMatrixReadOnly`:

```js
const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
const ang = Math.atan2(m.b, m.a) * 180 / Math.PI;
```

Tiap kali `Math.floor(ang / SEG)` berubah nilainya, satu segmen baru barusan lewat jarum →
bunyikan tik.

Tik: oscillator triangle ~1100Hz dengan envelope gain turun cepat (~30ms). Tidak butuh file
audio. Karena tik terikat ke **posisi** roda dan bukan ke waktu, tiknya melambat sendiri
seiring roda melambat — itu yang membuat telinga percaya roda melambat karena gesekan.

Nada penutup: satu nada rendah saat ZONK, tetap dibangkitkan WebAudio.

Suara menang memakai rekaman asli `sounds/win.mp3` (mixkit-bonus-collect-award, 1,8
detik). Ini satu-satunya aset audio, dan konsekuensinya aplikasi tidak lagi benar-benar
satu file — folder `sounds/` harus ikut dibawa. Tik sengaja TIDAK diganti rekaman
karena keterikatannya ke posisi roda itulah yang memberi rasa melambat.

Tombol kecil di pojok kanan atas, pilihannya disimpan di localStorage key
`luckyspin.muted`. Default nyala.

Ikonnya SVG garis tipis (speaker bergelombang / speaker bersilang), bukan emoji —
emoji dirender dengan gaya masing-masing sistem operasi dan bentrok dengan tema
Noir & Gold. Saat nyala ikonnya emas; saat mute jadi abu redup.

## 10. Tes

`index.html?test=1` menjalankan rangkaian tes di overlay, tanpa framework:

1. **Ketepatan sudut** — untuk 8 hadiah × 200 rotasi awal acak:
   `segmentAtPointer(targetRotation(acak, i)) === i`. 1600 kasus. Ini tes terpenting; kalau
   hijau, roda dijamin tidak akan pernah berhenti di hadiah yang salah.
2. **Selalu maju** — `targetRotation(c, i) ≥ c + TURNS×360` untuk semua input.
3. **Aman dari batas** — jarak sudut akhir ke garis pembatas terdekat selalu ≥ `MARGIN`.
4. **Normalisasi token** — huruf kecil dan spasi di ujung diterima.
5. **Token bekas ditolak** — `add()` lalu `validate()` menghasilkan `reason: 'used'`.
6. **Token asing ditolak** — menghasilkan `reason: 'unknown'`.
7. **Fallback localStorage** — dengan storage disabotase, `UsedTokens` tetap berfungsi.

Overlay menampilkan jumlah lolos/gagal dan detail tiap kegagalan.

Cek manual tambahan: screenshot viewport HP (390×844) pakai Playwright untuk memastikan
tidak ada yang terpotong.

## 11. Jalur ke backend

Saat validasi dipindah ke server, yang berubah hanya isi `TokenService.validate()`:

```js
const res  = await fetch('/api/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),
});
return res.json();   // { ok, prizeId } | { ok: false, reason }
```

Server yang memegang daftar token, menentukan hadiah, dan mencatat token terpakai.
`UsedTokens` di localStorage turun peran jadi cache tampilan saja. `PRIZES` tetap di klien
karena hanya dipakai menggambar roda — server cukup mengirim `prizeId`.

Setelah itu barulah hadiah benar-benar tidak bisa diintip dari browser.


## 12. Upgrade tampilan (2026-08-08)

Tujuan: halaman tidak lagi terasa suram, sedikit lebih ramai, tanpa melepas kesan
premium. Arah yang dipilih adalah **Noir & Gold diangkat**, bukan pindah palet.

### Palet

| Peran | Sebelum | Sesudah |
|---|---|---|
| Latar | `#08080B` | `#0E0E16` (charcoal kebiruan) |
| Panel | `#101016` | `#16161F` |
| Teks redup | `#7C7C86` | `#8E8E9C` |
| Garis rambut | `rgba(212,175,55,.25)` | `rgba(212,175,55,.32)` |

### Latar

Kisi berlian art-deko dari dua `repeating-linear-gradient` bersilang di ±45°,
opacity `.05`. Nol byte gambar dan tajam di DPI berapa pun. Opacity sengaja rendah:
pattern latar yang kentara akan berkelahi dengan teks.

Di atasnya, `body::before` **fixed** membawa dua lapis cahaya ambient — sorot emas
di atas, pendar biru-violet di bawah. Dipasang fixed supaya tidak melar mengikuti
tinggi halaman saat section bertambah. Kegelapan berlapis terbaca "mewah";
kegelapan rata terbaca "suram".

### Section baru

**Cara Main** — tiga langkah bernomor, markup statis.

**Daftar Hadiah** — grid dua kolom, digambar dari `PRIZES` sehingga tidak pernah
bisa melenceng dari isi roda. Urutannya **sengaja beda dari roda**: roda diacak agar
tidak terlihat dekoratif, sedangkan daftar diurutkan dari nilai terbesar karena
daftar berurutan acak terbaca sembarangan. Untuk itu setiap hadiah mendapat field
`value`. ZONK diredupkan dan selalu di posisi terakhir.

**Pemenang Terbaru** — tabel tiga kolom (Pemain / Hadiah / Waktu), maksimal
`MAX_WINNER_ROWS` = 8 baris.

### WinnerStore

```js
createWinnerStore(storage, key?, seeds?) → {
  add(prize: string, token: string): void,   // HANYA dipanggil saat menang
  list(now?): Array<{name, prize, token, at, own}>,
}
```

Kemenangan user disimpan di localStorage key `luckyspin.winners` dan selalu berada
di atas seed. Barisnya diberi label `Kamu` dengan token tersamar (`LUCKY100` →
`LUC•••00`). Fallback ke memori kalau storage diblokir, sama seperti `UsedTokens`.

`relativeTime(ms, now?)` memetakan selisih waktu ke `baru saja` / `N menit lalu` /
`N jam lalu` / `kemarin` / `N hari lalu`.

**ZONK tidak pernah masuk tabel.** Ada tesnya.

### Kejujuran data

Enam baris seed adalah **data karangan** — pemain-pemain itu tidak ada. Tujuannya
supaya tabel tidak kosong melompong saat pertama dibuka. Tidak ada jackpot di seed,
supaya kemenangan besar user sendiri tidak terlihat murahan.

Kalau halaman ini nanti dipakai dengan user sungguhan, seed harus diganti catatan
pemenang asli dari server. Menampilkan pemenang karangan seolah nyata kepada user
sungguhan adalah klaim palsu, bukan sekadar dekorasi.

### Ikon dan ornamen

Halaman versi pertama nyaris seluruhnya teks — hanya roda yang berupa grafik. Untuk
memecah itu:

- **Ikon garis dari Lucide (ISC)** di tiap judul kartu (`book-open`, `gift`, `trophy`),
  tiap langkah Cara Main (`ticket`, `rotate-cw`, `hand-coins`), dan tiap sel Daftar
  Hadiah (`coins`, `circle-off` untuk ZONK).
- **Ornamen art-deko** di antara section: berlian kecil diapit garis emas yang
  meredup. Dibangun dari CSS, bukan gambar.

Gaya garis dipilih supaya senada dengan ikon tombol mute yang lebih dulu ada.
Mencampur gaya garis dan siluet padat akan membuat halaman terlihat lebih berantakan,
bukan lebih kaya — karena itu **semua** ikon wajib memakai kelas `.ico` yang sama, dan
ada tes yang gagal begitu ada `<svg>` ikon lolos tanpa kelas itu.

Nomor pada langkah Cara Main diganti ikon: urutannya sudah jelas dari susunan vertikal,
sementara ikon menambah isi visual yang justru sedang dicari.

Asset raster tidak dipakai sama sekali. Ikon stock bergaya game (mis. Kenney) sudah
dipertimbangkan dan ditolak: gayanya flat dan berwarna, bertabrakan dengan Noir & Gold.
