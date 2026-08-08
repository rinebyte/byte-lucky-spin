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

Karakter non-ASCII di dalam string JavaScript ditulis pakai escape (`✓`, bukan `✓`)
supaya halaman tetap benar walau pernah didekode sebagai selain UTF-8 — misalnya saat
disajikan lewat live-server yang menyuntik script sendiri di atas `<meta charset>`.

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
