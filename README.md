# Presensi Kajian Pegawai

Web app presensi kajian berbasis lokasi. Pegawai memilih **Mulai** atau **Selesai**, mengisi **PIN** (nama yang sesuai PIN tampil otomatis, nama pegawai lain tidak ditampilkan), lalu presensi hanya bisa dicatat bila posisi GPS berada dalam radius **20 m** dari **Masjid Syarifah Shalihah** (-3.4331621, 114.845775). Semua data tersimpan di Google Sheets.

**Stack:** Next.js (App Router) + Google Apps Script + Google Sheets, deploy di Vercel.

```
Browser (GPS) -> Next.js /api/presensi -> Apps Script (validasi jarak, PIN, duplikat) -> Google Sheets
```

Jarak dihitung ulang di Apps Script, jadi validasi tidak hanya bergantung pada browser.

## 1. Siapkan Spreadsheet dan Apps Script

1. Buat Google Spreadsheet baru.
2. Buka **Extensions > Apps Script**, hapus isi default, tempel seluruh isi `gas/Code.gs`.
3. Pilih fungsi `setup` lalu klik **Run**, dan izinkan akses. Fungsi ini membuat sheet `Config`, `Pegawai`, `Presensi`, dan membuat `API_KEY`.
4. Buka **View > Logs** (atau Execution log), salin nilai `API_KEY`.
5. Klik **Deploy > New deployment > Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Salin URL Web App (berakhiran `/exec`).

Setiap mengubah `Code.gs`, buat **New deployment / Manage deployments > New version** agar perubahan aktif.

## 2. Isi data di spreadsheet

- **Config**: koordinat, `radiusMeter` (default 20), `maxAkurasi` (default 100 m), dan `toleransiMeter` (default 0). Ubah di sini tanpa deploy ulang.
- **Pegawai**: kolom `ID`, `Nama`, `Jabatan`, `PIN`. Ganti dua baris contoh dengan data asli. Kolom PIN berformat teks. PIN sebaiknya unik per pegawai; bila dua pegawai memakai PIN yang sama, setelah PIN diisi muncul pilihan nama yang hanya berisi pegawai dengan PIN itu.
- **Presensi**: terisi otomatis (Timestamp, Tanggal, Jam, pegawai, Jenis, koordinat, akurasi, jarak, status). Sheet ini juga menjadi sumber **Riwayat presensi** di bagian bawah halaman.

## Riwayat dan export Excel

- Riwayat tampil 10 baris per halaman, dengan tombol Sebelumnya dan Berikutnya. Pilih tanggal untuk melihat hari lain.
- Tombol **Excel** mengunduh `riwayat-presensi-yyyy-mm-dd.xlsx` berisi semua pegawai pada tanggal terpilih (bukan hanya halaman yang tampil): No, Nama, Jabatan, Mulai, Selesai, Durasi, Status. File dibuat di server Next.js memakai paket `exceljs`, jadi jalankan `npm install` setelah memperbarui proyek.

## Presensi marbot masjid (halaman `/marbot`)

Marbot presensi pada setiap shift di sheet **JadwalMarbot**. Jadwal totalnya 11 jam, tetapi **jam kerja yang dihitung maksimal 9 jam (540 menit) per hari**. Kelebihan tidak dihitung. Lokasi dan radius memakai pengaturan yang sama dengan kajian (sheet Config).

| No | Shift | Jam | Durasi |
|---|---|---|---|
| 1 | Pagi | 04.30 - 07.30 | 3 jam |
| 2 | Siang | 10.30 - 13.30 | 3 jam |
| 3 | Sore | 15.00 - 16.00 | 1 jam |
| 4 | Malam | 17.30 - 21.30 | 4 jam |
| | Jumlah jadwal | | 11 jam |
| | Maksimal dihitung | | 9 jam |

Cara batas 9 jam bekerja: saat marbot presensi, menit yang dikreditkan dikurangi bila totalnya hari itu akan melewati batas. Contoh: hadir tepat waktu di empat shift = 3 + 3 + 1 + 4 = 11 jam, tercatat 9 jam (shift Malam dikreditkan 2 jam). Riwayat dan Excel juga membatasi total harian ke 9 jam. Batas ini bisa diubah di sheet **Config** pada kunci `marbotMaksJam` (dalam jam, `0` = tanpa batas).

Sheet yang dibuat otomatis oleh `setup()`:

- **Marbot**: `ID`, `Nama`, `PIN`. Ganti dua baris contoh dengan data asli.
- **JadwalMarbot**: `No`, `Shift`, `Kegiatan`, `Mulai`, `Selesai`, `Durasi (menit)`, `Keterangan`, `Break`. Tulis jam sebagai teks, mis. `04:30`. Durasi dihitung otomatis. `Kegiatan` boleh kosong (nama sesi memakai nama shift). Isi kolom `Break` (mis. `Break`) bila setelah sesi itu ada waktu istirahat. Kolom dibaca berdasarkan nama header. Jadwal dapat diubah kapan saja tanpa deploy ulang.
- **PresensiMarbot**: hasil presensi (waktu, sesi, kegiatan, status, menit dikreditkan, koordinat, jarak, shift).

Aturan presensi (server yang menentukan sesi dari jam WITA, bukan pilihan marbot):

- Sesi dibuka `marbotBukaSebelumMenit` (default 15) menit sebelum jam mulai dan tertutup saat jam selesai.
- Hadir sampai `marbotToleransiMenit` (default 10) menit setelah jam mulai dinilai **Tepat waktu** dan dikreditkan sebesar durasi penuh sesi.
- Lebih dari itu dinilai **Terlambat** dan hanya dikreditkan sisa menit sampai sesi berakhir.
- Satu sesi hanya bisa dipresensi satu kali per marbot per hari. Bila dua sesi bersambung (mis. 11.10-12.00 dan 12.00-12.50), marbot presensi sekali di tiap sesi.
- Riwayat menampilkan semua marbot terdaftar, termasuk yang belum hadir, 10 baris per halaman. Tombol **Excel** menghasilkan dua sheet: Ringkasan (per marbot) dan Detail (per sesi, lengkap dengan shift dan kegiatan).

## Alur presensi kajian

1. Pilih jenis presensi (Mulai atau Selesai).
2. Isi PIN. Setelah berhenti mengetik, aplikasi mencari nama yang PIN-nya cocok dan menampilkannya. Daftar nama semua pegawai tidak lagi dikirim ke browser.
3. Pastikan lokasi sesuai, lalu klik **Catat presensi**. Server tetap memeriksa ulang PIN, jarak, dan duplikat.

Pencarian nama dibatasi 10 percobaan PIN yang tidak cocok per 10 menit per alamat IP, supaya PIN tidak bisa ditebak untuk mengetahui nama. Hanya PIN dengan panjang yang dipakai pegawai yang dihitung sebagai percobaan. Bila banyak pegawai memakai Wi-Fi yang sama, batas ini dihitung bersama untuk IP tersebut.

## Memperbarui dari versi sebelumnya

1. Ganti isi Apps Script dengan `gas/Code.gs` terbaru, lalu jalankan `setup()` sekali lagi. Fungsi ini menambah kunci Config baru, membuat sheet Marbot, JadwalMarbot, dan PresensiMarbot, serta mengubah `maxAkurasi` dari 50 menjadi 100 bila masih nilai lama. Data yang sudah ada tidak dihapus.
   `setup()` menulis ulang sheet **JadwalMarbot** dengan jadwal bawaan di atas satu kali setiap jadwal bawaan diganti versi (termasuk pada pembaruan ini). Perubahan jadwal yang Anda buat manual di sheet itu akan tertimpa saat itu, jadi catat dulu bila perlu; setelahnya `setup()` tidak menimpa lagi. Kunci `marbotMaksJam` ditambahkan otomatis ke sheet Config. Sheet **PresensiMarbot** hanya diubah header-nya (kolom G menjadi `Kegiatan`, kolom O `Shift` ditambahkan); data presensi lama tetap ada.
2. **Deploy > Manage deployments > Edit > New version** agar kode baru aktif. URL tidak berubah. Lakukan langkah 1 dan 2 **sebelum** men-deploy Next.js, karena halaman kajian yang baru memakai aksi `cari_pegawai` di Apps Script.
3. **Zona waktu WITA**: di Apps Script buka **Project Settings (ikon roda gigi)**, centang **Show "appsscript.json" manifest file in editor**, lalu pastikan `"timeZone": "Asia/Makassar"` (contoh ada di `gas/appsscript.json`). Fungsi `setup()` juga menyetel zona waktu spreadsheet ke WITA. Cek manual di spreadsheet: **File > Settings > Time zone** harus `(GMT+08:00) Makassar`.
4. Ganti `public/logo.png` dan `app/icon.png` bila logo berubah.

## 3. Jalankan di VS Code

```bash
npm install
cp .env.example .env.local   # isi GAS_URL dan API_KEY
npm run dev
```

Buka http://localhost:3000. Geolocation butuh HTTPS, tetapi `localhost` tetap diizinkan browser. Untuk uji dari HP, gunakan URL Vercel.

## 4. Simpan ke GitHub

```bash
git init
git add .
git commit -m "Presensi kajian pegawai"
git branch -M main
git remote add origin https://github.com/USERNAME/presensi-kajian.git
git push -u origin main
```

`.env.local` sudah masuk `.gitignore`.

## 5. Deploy ke Vercel

1. Di Vercel: **Add New > Project**, impor repo GitHub.
2. Isi **Environment Variables**: `GAS_URL` dan `API_KEY`.
3. Klik **Deploy**. Setiap `git push` ke `main` akan otomatis deploy ulang.

## Bila GPS masih dinilai lemah

- Laptop atau PC tidak punya GPS. Browser memakai Wi-Fi atau IP dengan akurasi ratusan meter, sehingga selalu ditolak. Gunakan HP.
- Di HP: aktifkan GPS dengan mode akurasi tinggi, dan izinkan lokasi presisi (iPhone: Precise Location) untuk browser.
- Di dalam bangunan, dekati jendela atau pintu dan tunggu 10 sampai 20 detik. Aplikasi menggabungkan pembacaan 15 detik terakhir sehingga hasilnya makin stabil.
- Bila akurasi sudah baik tetapi jarak tampak berbeda 5 sampai 15 m dari kenyataan, isi `toleransiMeter` di sheet Config (misalnya 10). Batas presensi menjadi radius ditambah toleransi.

## Catatan keamanan

- GPS di browser tetap bisa dipalsukan (aplikasi fake GPS). PIN, batas akurasi, pencegahan presensi ganda, dan pembatasan percobaan PIN (5 kali per 10 menit) mengurangi risikonya, tetapi tidak menghilangkannya.
- `GAS_URL` dan `API_KEY` hanya dipakai di server Next.js, tidak dikirim ke browser.
- Ganti PIN contoh sebelum dipakai.
- Riwayat presensi (nama, jabatan, jam mulai dan selesai) dapat dilihat siapa pun yang memiliki URL web. PIN dan koordinat tidak ditampilkan.
