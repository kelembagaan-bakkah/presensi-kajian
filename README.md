# Presensi Kajian Pegawai

Web app presensi kajian berbasis lokasi. Pegawai memilih **Mulai** atau **Selesai**, lalu presensi hanya bisa dicatat bila posisi GPS berada dalam radius **20 m** dari **Masjid Syarifah Shalihah** (-3.4331621, 114.845775). Semua data tersimpan di Google Sheets.

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

- **Config**: koordinat, radius (`radiusMeter`, default 20), dan `maxAkurasi` (default 50 m). Ubah di sini tanpa deploy ulang.
- **Pegawai**: kolom `ID`, `Nama`, `Jabatan`, `PIN`. Ganti dua baris contoh dengan data asli. Kolom PIN berformat teks.
- **Presensi**: terisi otomatis (Timestamp, Tanggal, Jam, pegawai, Jenis, koordinat, akurasi, jarak, status).

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

## Catatan keamanan

- GPS di browser tetap bisa dipalsukan (aplikasi fake GPS). PIN, batas akurasi, pencegahan presensi ganda, dan pembatasan percobaan PIN (5 kali per 10 menit) mengurangi risikonya, tetapi tidak menghilangkannya.
- `GAS_URL` dan `API_KEY` hanya dipakai di server Next.js, tidak dikirim ke browser.
- Ganti PIN contoh sebelum dipakai.
