/**
 * Backend Presensi Kajian Pegawai (Google Apps Script + Google Sheets).
 * Jalankan setup() satu kali (atau lagi setelah update kode) untuk menyiapkan sheet dan API_KEY.
 */
const TZ = 'Asia/Makassar'; // WITA (UTC+8). Semua tanggal dan jam presensi memakai zona ini.
const SHEET = { CONFIG: 'Config', PEGAWAI: 'Pegawai', PRESENSI: 'Presensi' };
const JENIS_VALID = ['Mulai', 'Selesai'];

const DEFAULT_CONFIG = [
  ['namaKegiatan', 'Kajian Pegawai', 'Judul kegiatan'],
  ['namaLokasi', 'Masjid Syarifah Shalihah', 'Nama lokasi kajian'],
  ['latitude', -3.4331621, 'Titik pusat presensi'],
  ['longitude', 114.845775, 'Titik pusat presensi'],
  ['radiusMeter', 20, 'Jarak maksimal dari titik pusat (meter)'],
  ['maxAkurasi', 100, 'Presensi ditolak jika akurasi GPS lebih buruk dari ini (meter)'],
  ['toleransiMeter', 0, 'Tambahan jarak (meter) untuk selisih GPS. 0 = ketat sesuai radius'],
  ['marbotBukaSebelumMenit', 15, 'Marbot: presensi sesi dibuka sekian menit sebelum jam mulai'],
  ['marbotToleransiMenit', 10, 'Marbot: dianggap terlambat bila melewati jam mulai lebih dari sekian menit'],
  ['marbotMaksJam', 9, 'Marbot: batas jam kerja yang dihitung per hari. Kelebihan tidak dihitung (0 = tanpa batas)'],
  ['marbotKeluarSetelahMenit', 5, 'Marbot: toleransi presensi keluar, sekian menit setelah sesi berakhir. Lewat dari itu dianggap lupa keluar'],
];

/* ============ SETUP (aman dijalankan berulang) ============ */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ); // kolom Timestamp mengikuti zona waktu spreadsheet, samakan dengan WITA

  const cfg = ss.getSheetByName(SHEET.CONFIG) || ss.insertSheet(SHEET.CONFIG);
  if (cfg.getLastRow() === 0) {
    cfg.getRange(1, 1, 1, 3).setValues([['Kunci', 'Nilai', 'Keterangan']]);
    cfg.setFrozenRows(1);
    cfg.setColumnWidths(1, 3, 220);
  }
  const have = {};
  cfg.getDataRange().getValues().forEach(function (r, i) { if (r[0]) have[String(r[0]).trim()] = i + 1; });
  DEFAULT_CONFIG.forEach(function (d) { if (!have[d[0]]) cfg.appendRow(d); });
  // Toleransi keluar bawaan sebelumnya 60 menit; aturan sekarang 5 menit
  if (have.marbotKeluarSetelahMenit && Number(cfg.getRange(have.marbotKeluarSetelahMenit, 2).getValue()) === 60) {
    cfg.getRange(have.marbotKeluarSetelahMenit, 2).setValue(5);
    cfg.getRange(have.marbotKeluarSetelahMenit, 3).setValue(DEFAULT_CONFIG.filter(function (d) { return d[0] === 'marbotKeluarSetelahMenit'; })[0][2]);
  }
  // Nilai awal lama (50 m) terlalu ketat untuk GPS di dalam bangunan
  if (have.maxAkurasi && Number(cfg.getRange(have.maxAkurasi, 2).getValue()) === 50) {
    cfg.getRange(have.maxAkurasi, 2).setValue(100);
  }

  const peg = ss.getSheetByName(SHEET.PEGAWAI) || ss.insertSheet(SHEET.PEGAWAI);
  if (peg.getLastRow() === 0) {
    peg.getRange('D:D').setNumberFormat('@'); // PIN sebagai teks agar angka 0 di depan tidak hilang
    peg.getRange(1, 1, 3, 4).setValues([
      ['ID', 'Nama', 'Jabatan', 'PIN'],
      ['P001', 'Contoh Pegawai 1', 'Guru', '1234'],
      ['P002', 'Contoh Pegawai 2', 'Staf', '5678'],
    ]);
    peg.setFrozenRows(1);
  }

  const pr = ss.getSheetByName(SHEET.PRESENSI) || ss.insertSheet(SHEET.PRESENSI);
  if (pr.getLastRow() === 0) {
    pr.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    pr.getRange('B:C').setNumberFormat('@');
    pr.getRange(1, 1, 1, 12).setValues([[
      'Timestamp (WITA)', 'Tanggal', 'Jam (WITA)', 'ID Pegawai', 'Nama', 'Jabatan',
      'Jenis', 'Latitude', 'Longitude', 'Akurasi (m)', 'Jarak (m)', 'Status',
    ]]);
    pr.setFrozenRows(1);
  }
  pr.getRange('A1').setValue('Timestamp (WITA)');
  pr.getRange('C1').setValue('Jam (WITA)');

  setupMarbot_(ss);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) {
    props.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, ''));
  }
  Logger.log('API_KEY (salin ke environment variable Vercel): ' + props.getProperty('API_KEY'));
}

/* ============ ENDPOINT ============ */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    assertKey_(p.key);

    // Daftar nama pegawai tidak dikirim ke browser. Nama dicari lewat PIN (aksi cari_pegawai).
    if (p.action === 'init') return json_({ ok: true, config: readConfig_() });

    if (p.action === 'riwayat') {
      const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(p.tanggal || '')
        ? p.tanggal
        : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
      return json_({ ok: true, tanggal: tanggal, rows: riwayat_(tanggal) });
    }

    if (p.action === 'marbot_init') return json_(marbotInit_());

    if (p.action === 'marbot_riwayat') {
      const tgl = /^\d{4}-\d{2}-\d{2}$/.test(p.tanggal || '')
        ? p.tanggal
        : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
      return json_(marbotRiwayat_(tgl));
    }

    throw new Error('Aksi tidak dikenal.');
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const b = JSON.parse(e.postData.contents);
    assertKey_(b.key);
    if (b.action === 'marbot_presensi') return json_(marbotPresensi_(b));
    if (b.action === 'cari_pegawai') return json_(cariPegawai_(b));
    if (b.action !== 'presensi') throw new Error('Aksi tidak dikenal.');

    const jenis = String(b.jenis);
    if (JENIS_VALID.indexOf(jenis) === -1) throw new Error('Jenis presensi tidak valid.');

    const lat = Number(b.lat), lng = Number(b.lng), akurasi = Number(b.akurasi);
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(akurasi)) throw new Error('Data lokasi tidak valid.');

    const cfg = readConfig_();
    const id = String(b.id || '').trim();

    // Batasi percobaan PIN salah: 5 kali per 10 menit per pegawai
    const cache = CacheService.getScriptCache();
    const failKey = 'fail_' + id;
    const fails = Number(cache.get(failKey) || 0);
    if (fails >= 5) throw new Error('Terlalu banyak PIN salah. Coba lagi dalam 10 menit.');

    const peg = findPegawai_(id);
    if (!peg || peg.pin !== String(b.pin || '').trim()) {
      cache.put(failKey, String(fails + 1), 600);
      throw new Error('Nama atau PIN tidak sesuai.');
    }
    cache.remove(failKey);

    if (akurasi > cfg.maxAkurasi) {
      throw new Error('Akurasi GPS ±' + Math.round(akurasi) + ' m belum cukup (maksimal ' + cfg.maxAkurasi +
        ' m). Pindah ke area terbuka lalu coba lagi.');
    }

    const batas = cfg.radiusMeter + cfg.toleransiMeter;
    const jarak = haversine_(cfg.latitude, cfg.longitude, lat, lng);
    if (jarak > batas) {
      throw new Error('Anda berada ' + Math.round(jarak) + ' m dari ' + cfg.namaLokasi +
        '. Batas presensi ' + batas + ' m.');
    }

    const now = new Date();
    const tanggal = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const jam = Utilities.formatDate(now, TZ, 'HH:mm:ss');

    // Cegah presensi ganda (pegawai + tanggal + jenis yang sama)
    const sh = sheet_(SHEET.PRESENSI);
    const last = sh.getLastRow();
    if (last > 1) {
      const from = Math.max(2, last - 499);
      const vals = sh.getRange(from, 2, last - from + 1, 6).getValues(); // kolom B..G
      const dup = vals.some(function (r) {
        return text_(r[0], 'yyyy-MM-dd') === tanggal && String(r[2]) === peg.id && String(r[5]) === jenis;
      });
      if (dup) throw new Error(peg.nama + ' sudah tercatat ' + jenis.toLowerCase() + ' hari ini.');
    }

    const jarakBulat = Math.round(jarak * 10) / 10;
    sh.appendRow([now, tanggal, jam, peg.id, peg.nama, peg.jabatan, jenis, lat, lng,
      Math.round(akurasi), jarakBulat, 'Valid']);

    return json_({ ok: true, data: { nama: peg.nama, jenis: jenis, tanggal: tanggal, jam: jam, jarak: jarakBulat } });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ============ HELPER ============ */
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" tidak ditemukan. Jalankan setup() terlebih dahulu.');
  return sh;
}

/** Nilai sel sebagai teks (jaga-jaga jika Sheets mengubahnya menjadi tanggal/jam). */
function text_(v, fmt) {
  return v instanceof Date ? Utilities.formatDate(v, TZ, fmt) : String(v);
}

/** Riwayat per pegawai pada satu tanggal: jam Mulai dan jam Selesai (jika sudah). */
function riwayat_(tanggal) {
  const sh = sheet_(SHEET.PRESENSI);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 2, last - 1, 6).getValues(); // B..G: Tanggal, Jam, ID, Nama, Jabatan, Jenis
  const map = {}, order = [];
  vals.forEach(function (r) {
    if (text_(r[0], 'yyyy-MM-dd') !== tanggal) return;
    const id = String(r[2]);
    if (!map[id]) {
      map[id] = { id: id, nama: String(r[3]), jabatan: String(r[4]), mulai: '', selesai: '' };
      order.push(id);
    }
    const jam = text_(r[1], 'HH:mm:ss').slice(0, 5);
    const jenis = String(r[5]);
    if (jenis === 'Mulai' && !map[id].mulai) map[id].mulai = jam;
    if (jenis === 'Selesai' && !map[id].selesai) map[id].selesai = jam;
  });
  return order.map(function (id) { return map[id]; }).sort(function (a, b) {
    return (a.mulai || '99:99').localeCompare(b.mulai || '99:99') || a.nama.localeCompare(b.nama);
  });
}

function readConfig_() {
  const rows = sheet_(SHEET.CONFIG).getDataRange().getValues().slice(1);
  const m = {};
  rows.forEach(function (r) { if (r[0]) m[String(r[0]).trim()] = r[1]; });
  const cfg = {
    namaKegiatan: String(m.namaKegiatan || 'Kajian Pegawai'),
    namaLokasi: String(m.namaLokasi || ''),
    latitude: Number(m.latitude),
    longitude: Number(m.longitude),
    radiusMeter: Number(m.radiusMeter) || 20,
    maxAkurasi: Number(m.maxAkurasi) || 100,
    toleransiMeter: Number(m.toleransiMeter) || 0,
    marbotBukaSebelumMenit: num_(m.marbotBukaSebelumMenit, 15),
    marbotToleransiMenit: num_(m.marbotToleransiMenit, 10),
    marbotMaksJam: num_(m.marbotMaksJam, 9),
    marbotKeluarSetelahMenit: num_(m.marbotKeluarSetelahMenit, 5),
  };
  if (!isFinite(cfg.latitude) || !isFinite(cfg.longitude)) throw new Error('Koordinat pada sheet Config tidak valid.');
  return cfg;
}

/** Angka dari sel; nilai kosong atau tidak valid memakai nilai bawaan (0 tetap dianggap valid). */
function num_(v, def) {
  const n = Number(v);
  return v === '' || v === null || v === undefined || !isFinite(n) ? def : n;
}

/**
 * Cari pegawai berdasarkan PIN. Hanya nama yang PIN-nya cocok yang dikembalikan (biasanya satu orang).
 * Percobaan PIN yang tidak cocok dibatasi per klien (IP): 10 kali per 10 menit.
 * Hanya PIN dengan panjang yang dipakai pegawai yang dihitung sebagai percobaan,
 * sehingga ketikan setengah jalan (mis. 4 dari 6 angka) tidak menghabiskan jatah.
 */
function cariPegawai_(b) {
  const pin = String(b.pin || '').trim();
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN harus 4 sampai 8 angka.');

  const client = String(b.client || 'anon').replace(/[^0-9a-zA-Z.:_-]/g, '').slice(0, 64) || 'anon';
  const cache = CacheService.getScriptCache();
  const failKey = 'failcari_' + client;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 10) throw new Error('Terlalu banyak percobaan PIN. Coba lagi dalam 10 menit.');

  const rows = sheet_(SHEET.PEGAWAI).getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) {
      return { id: String(r[0]).trim(), nama: String(r[1]).trim(), jabatan: String(r[2] || '').trim(), pin: String(r[3] || '').trim() };
    });

  const cocok = rows.filter(function (r) { return r.pin === pin; });
  if (!cocok.length) {
    if (rows.some(function (r) { return r.pin.length === pin.length; })) cache.put(failKey, String(fails + 1), 600);
    return { ok: true, pegawai: [] };
  }
  return {
    ok: true,
    pegawai: cocok.map(function (r) { return { id: r.id, nama: r.nama, jabatan: r.jabatan }; }),
  };
}

function findPegawai_(id) {
  const rows = sheet_(SHEET.PEGAWAI).getDataRange().getValues().slice(1);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      return {
        id: id,
        nama: String(rows[i][1]).trim(),
        jabatan: String(rows[i][2] || '').trim(),
        pin: String(rows[i][3] || '').trim(),
      };
    }
  }
  return null;
}

function assertKey_(key) {
  const real = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!real || key !== real) throw new Error('Akses ditolak.');
}

function haversine_(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.pow(Math.sin(dLat / 2), 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


/* ================================================================
 * MARBOT: presensi per shift (Pagi, Siang, Sore, Malam), jam kerja dihitung maksimal 9 jam per hari
 * Sheet: Marbot (ID, Nama, PIN), JadwalMarbot (shift, kegiatan, jam sesi), PresensiMarbot (hasil per sesi),
 * rekap-presensi-marbot (satu baris per marbot per hari: jam masuk dan jam keluar)
 * ================================================================ */
const M = { MARBOT: 'Marbot', JADWAL: 'JadwalMarbot', PRESENSI: 'PresensiMarbot', REKAP: 'rekap-presensi-marbot' };

// Jadwal marbot: 4 shift dengan total 11 jam, tetapi yang dihitung maksimal 9 jam (540 menit) per hari
// (config marbotMaksJam). Kelebihan tidak dihitung. Semua kolom bisa diubah di sheet JadwalMarbot.
// Format: [Shift, Kegiatan, Mulai, Selesai, Keterangan, Break]. Kegiatan boleh kosong (nama sesi memakai nama shift).
// Break = 'Break' bila setelah sesi itu ada waktu istirahat.
// Naikkan JADWAL_VERSI bila JADWAL_AWAL diganti, agar setup() menulis ulang sheet JadwalMarbot satu kali.
const JADWAL_VERSI = 'rundown-4-shift-2026-11';
const JADWAL_AWAL = [
  ['Pagi', '', '04:30', '07:30', '', ''],
  ['Siang', '', '10:30', '13:30', '', ''],
  ['Sore', '', '15:00', '16:00', '', ''],
  ['Malam', '', '17:30', '21:30', '', ''],
];

function setupMarbot_(ss) {
  const mb = ss.getSheetByName(M.MARBOT) || ss.insertSheet(M.MARBOT);
  if (mb.getLastRow() === 0) {
    mb.getRange('C:C').setNumberFormat('@');
    mb.getRange(1, 1, 3, 3).setValues([
      ['ID', 'Nama', 'PIN'],
      ['M001', 'Contoh Marbot 1', '1111'],
      ['M002', 'Contoh Marbot 2', '2222'],
    ]);
    mb.setFrozenRows(1);
  }

  const jd = ss.getSheetByName(M.JADWAL) || ss.insertSheet(M.JADWAL);
  // Tulis jadwal bila sheet kosong, berformat lama (kolom Kelompok), atau versi jadwal bawaan berubah.
  // Setelah itu setup() tidak menimpa perubahan manual Anda sampai JADWAL_VERSI diganti lagi.
  const props = PropertiesService.getScriptProperties();
  if (jd.getLastRow() === 0 || String(jd.getRange(1, 2).getValue()).trim() === 'Kelompok' ||
      props.getProperty('jadwalMarbotVersi') !== JADWAL_VERSI) {
    tulisJadwal_(jd);
    props.setProperty('jadwalMarbotVersi', JADWAL_VERSI);
  }

  const pm = ss.getSheetByName(M.PRESENSI) || ss.insertSheet(M.PRESENSI);
  if (pm.getLastRow() === 0) {
    pm.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    pm.getRange('B:C').setNumberFormat('@');
    pm.getRange('F:F').setNumberFormat('@');
    pm.getRange(1, 1, 1, 21).setValues([[
      'Timestamp (WITA)', 'Tanggal', 'Jam Masuk (WITA)', 'ID Marbot', 'Nama', 'Sesi', 'Kegiatan',
      'Durasi Jadwal (menit)', 'Menit Dikreditkan', 'Status', 'Latitude', 'Longitude', 'Akurasi (m)', 'Jarak (m)', 'Shift',
      'Jam Keluar (WITA)', 'Latitude Keluar', 'Longitude Keluar', 'Akurasi Keluar (m)', 'Jarak Keluar (m)', 'Status Keluar',
    ]]);
    pm.setFrozenRows(1);
  } else {
    // Sheet versi lama: kolom G dulu bernama Kelompok, kolom Shift dan kolom keluar (P..T) belum ada. Data lama tidak diubah.
    pm.getRange('G1').setValue('Kegiatan');
    pm.getRange('C1').setValue('Jam Masuk (WITA)');
    if (!String(pm.getRange('O1').getValue()).trim()) pm.getRange('O1').setValue('Shift');
    if (!String(pm.getRange('P1').getValue()).trim()) {
      pm.getRange(1, 16, 1, 5).setValues([['Jam Keluar (WITA)', 'Latitude Keluar', 'Longitude Keluar', 'Akurasi Keluar (m)', 'Jarak Keluar (m)']]);
    }
  }
  if (!String(pm.getRange('U1').getValue()).trim()) pm.getRange('U1').setValue('Status Keluar');
  pm.getRange('P:P').setNumberFormat('@'); // jam keluar sebagai teks

  sheetRekap_(ss);
}

/** Menulis ulang sheet JadwalMarbot dengan jadwal terbaru: No, Shift, Kegiatan, Mulai, Selesai, Durasi, Keterangan, Break. */
function tulisJadwal_(jd) {
  jd.clear();
  jd.getRange('D:E').setNumberFormat('@'); // jam ditulis sebagai teks, mis. 04:30
  jd.getRange(1, 1, 1, 8).setValues([['No', 'Shift', 'Kegiatan', 'Mulai', 'Selesai', 'Durasi (menit)', 'Keterangan', 'Break']]);
  const rows = JADWAL_AWAL.map(function (r, i) { return [i + 1, r[0], r[1], r[2], r[3], '', r[4], r[5]]; });
  jd.getRange(2, 1, rows.length, 8).setValues(rows);
  for (var i = 0; i < rows.length; i++) {
    const r = i + 2;
    jd.getRange(r, 6).setFormula('=ROUND((TIMEVALUE(E' + r + ')-TIMEVALUE(D' + r + '))*1440,0)');
  }
  const t = rows.length + 3;
  jd.getRange(t, 5).setValue('Total menit');
  jd.getRange(t, 6).setFormula('=SUM(F2:F' + (rows.length + 1) + ')');
  jd.getRange(t + 1, 5).setValue('Total jam');
  jd.getRange(t + 1, 6).setFormula('=F' + t + '/60');
  jd.getRange(t + 2, 5).setValue('Dihitung per hari (menit)');
  jd.getRange(t + 2, 6).setFormula('=MIN(F' + t + ', IFERROR(INDEX(' + SHEET.CONFIG + '!B:B, MATCH("marbotMaksJam", ' +
    SHEET.CONFIG + '!A:A, 0))*60, 540))');
  jd.getRange(t + 3, 5).setValue('Kelebihan tidak dihitung');
  jd.getRange(1, 1, 1, 8).setFontWeight('bold');
  jd.setColumnWidth(3, 150);
  jd.setColumnWidth(7, 420);
  jd.setFrozenRows(1);
}

/* ---- baca data ---- */
function hhmm_(v) {
  const t = v instanceof Date ? Utilities.formatDate(v, TZ, 'HH:mm') : String(v).trim();
  const m = /^(\d{1,2})[:.](\d{2})/.exec(t);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function toMin_(t) {
  const p = t.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

/**
 * Jadwal sesi urut jam mulai. Kolom dibaca berdasarkan nama header (Shift, Kegiatan, Mulai, Selesai,
 * Keterangan, Break), jadi urutan kolom boleh diubah. Durasi dihitung dari jam mulai dan selesai.
 */
function readJadwal_() {
  const vals = sheet_(M.JADWAL).getDataRange().getValues();
  const head = (vals[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  const cMulai = head.indexOf('mulai'), cSelesai = head.indexOf('selesai');
  if (cMulai < 0 || cSelesai < 0) throw new Error('Sheet JadwalMarbot tidak memiliki kolom Mulai dan Selesai. Jalankan setup().');
  var cKeg = head.indexOf('kegiatan');
  if (cKeg < 0) cKeg = head.indexOf('kelompok'); // format lama
  const cShift = head.indexOf('shift'), cKet = head.indexOf('keterangan'), cBrk = head.indexOf('break');
  const cell = function (r, c) { return c < 0 ? '' : String(r[c] === null || r[c] === undefined ? '' : r[c]).trim(); };

  const out = [];
  var shift = '';
  vals.slice(1).forEach(function (r) {
    const mulai = hhmm_(r[cMulai]), selesai = hhmm_(r[cSelesai]);
    if (!mulai || !selesai) return;
    const a = toMin_(mulai), b = toMin_(selesai);
    if (!(b > a)) return;
    if (cell(r, cShift)) shift = cell(r, cShift); // sel Shift yang dikosongkan mengikuti baris di atasnya
    const kegiatan = cell(r, cKeg);
    out.push({
      key: mulai + '-' + selesai,
      shift: shift,
      kegiatan: kegiatan,
      nama: kegiatan || (shift ? 'Shift ' + shift : ''),
      keterangan: cell(r, cKet),
      jeda: cell(r, cBrk) !== '',
      mulai: mulai, selesai: selesai, startMin: a, endMin: b, durasi: b - a,
    });
  });
  out.sort(function (x, y) { return x.startMin - y.startMin; });
  out.forEach(function (s, i) { s.no = i + 1; if (!s.nama) s.nama = 'Sesi ' + s.no; });
  return out;
}

/** Total menit jadwal dan batas menit yang dihitung per hari (config marbotMaksJam; 0 atau kosong = tanpa batas). */
function totalMenit_(jadwal, cfg) {
  const jadwalMenit = jadwal.reduce(function (a, s) { return a + s.durasi; }, 0);
  const maks = cfg.marbotMaksJam > 0 ? Math.round(cfg.marbotMaksJam * 60) : jadwalMenit;
  return { jadwalMenit: jadwalMenit, maksMenit: Math.min(jadwalMenit, maks) };
}

function readMarbot_() {
  return sheet_(M.MARBOT).getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) { return { id: String(r[0]).trim(), nama: String(r[1]).trim(), pin: String(r[2] || '').trim() }; });
}

function findMarbot_(id) {
  const list = readMarbot_();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function marbotInit_() {
  const jadwal = readJadwal_();
  const cfg = readConfig_();
  const tm = totalMenit_(jadwal, cfg);
  return {
    ok: true,
    config: cfg,
    marbot: readMarbot_().map(function (m) { return { id: m.id, nama: m.nama }; }),
    jadwal: jadwal,
    totalMenit: tm.maksMenit,
    jadwalMenit: tm.jadwalMenit,
    serverMs: Date.now(),
  };
}

/** Baris presensi marbot tertentu pada satu tanggal, lengkap dengan nomor baris di sheet. */
function barisHari_(sh, tanggal, id) {
  const out = [];
  const last = sh.getLastRow();
  if (last < 2) return out;
  const from = Math.max(2, last - 599);
  sh.getRange(from, 1, last - from + 1, 21).getValues().forEach(function (r, i) { // A..U
    if (text_(r[1], 'yyyy-MM-dd') === tanggal && String(r[3]) === id) {
      out.push({
        row: from + i, ts: r[0], jam: text_(r[2], 'HH:mm:ss'), key: String(r[5]),
        kredit: Number(r[8]) || 0, status: String(r[9]),
        keluar: r[15] === '' || r[15] === null ? '' : text_(r[15], 'HH:mm:ss'),
        statusKeluar: String(r[20] || ''),
      });
    }
  });
  return out;
}

/** Tanggal dan menit (WITA) saat ini. */
function waktuSekarang_() {
  const now = new Date();
  return {
    tanggal: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    nowMin: Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm')) +
      Number(Utilities.formatDate(now, TZ, 's')) / 60,
  };
}

/**
 * Lupa presensi keluar: sesi yang sudah masuk tetapi tidak keluar sampai (jam selesai + toleransi keluar)
 * dihitung 1/3 dari durasi sesi (tidak lebih dari menit yang sebelumnya dikreditkan sementara).
 * Hanya baris bertanda 'Menunggu' yang diproses, jadi presensi lama sebelum fitur keluar tidak berubah.
 * Pemanggil harus memegang lock. Mengembalikan jumlah baris yang diubah.
 */
function finalisasiLupaKeluar_(sh, cfg, tanggalIni, nowMin) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const from = Math.max(2, last - 599);
  var n = 0;
  sh.getRange(from, 1, last - from + 1, 21).getValues().forEach(function (r, i) { // A..U
    if (String(r[20]) !== 'Menunggu') return;
    if (r[15] !== '' && r[15] !== null) return;
    const selesai = String(r[5]).split('-')[1];
    if (!selesai) return;
    const tgl = text_(r[1], 'yyyy-MM-dd');
    const lewat = tgl < tanggalIni || (tgl === tanggalIni && nowMin > toMin_(selesai) + cfg.marbotKeluarSetelahMenit);
    if (!lewat) return;
    const durasi = Number(r[7]) || 0, kredit = Number(r[8]) || 0;
    sh.getRange(from + i, 9).setValue(Math.min(Math.round(durasi / 3), kredit));
    sh.getRange(from + i, 21).setValue('Lupa keluar');
    n++;
  });
  return n;
}

/** Untuk pemicu berkala (lihat pasangPemicuFinalisasi). Aman dijalankan manual. */
function finalisasiLupaKeluar() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const w = waktuSekarang_();
    return finalisasiLupaKeluar_(sheet_(M.PRESENSI), readConfig_(), w.tanggal, w.nowMin);
  } finally {
    lock.releaseLock();
  }
}

/** Opsional: jalankan sekali dari editor agar lupa keluar diproses tiap 10 menit walau tidak ada yang membuka aplikasi. */
function pasangPemicuFinalisasi() {
  const ada = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'finalisasiLupaKeluar'; });
  if (!ada) ScriptApp.newTrigger('finalisasiLupaKeluar').timeBased().everyMinutes(10).create();
}

/** Sesi yang sudah dipresensi masuk oleh marbot tertentu pada satu tanggal: { 'mulai-selesai': true }. */
function sesiHariIni_(sh, tanggal, id) {
  const sudah = {};
  barisHari_(sh, tanggal, id).forEach(function (r) { sudah[r.key] = true; });
  return sudah;
}

/** Total menit yang sudah dikreditkan ke marbot tertentu pada satu tanggal (kecuali baris kecualiRow). */
function kreditHariIni_(sh, tanggal, id, kecualiRow) {
  var total = 0;
  barisHari_(sh, tanggal, id).forEach(function (r) { if (r.row !== kecualiRow) total += r.kredit; });
  return total;
}

/**
 * Pilih sesi yang dipresensi: sesi terbuka (dari mulai dikurangi menit buka sampai selesai)
 * paling awal yang belum dipresensi.
 */
function pilihSesi_(jadwal, nowMin, buka, sudah) {
  var terbuka = false;
  for (var i = 0; i < jadwal.length; i++) {
    const s = jadwal[i];
    if (nowMin >= s.startMin - buka && nowMin < s.endMin) {
      terbuka = true;
      if (!sudah[s.key]) return s;
    }
  }
  if (terbuka) throw new Error('Presensi untuk sesi yang sedang berjalan sudah tercatat.');
  for (var j = 0; j < jadwal.length; j++) {
    if (jadwal[j].startMin - buka > nowMin) {
      const n = jadwal[j], t = n.startMin - buka;
      throw new Error('Belum ada sesi yang dibuka. Sesi berikutnya ' + n.mulai.replace(':', '.') +
        ', presensi dibuka pukul ' + ('0' + Math.floor(t / 60)).slice(-2) + '.' + ('0' + Math.round(t % 60)).slice(-2) + '.');
    }
  }
  throw new Error('Semua sesi hari ini sudah berakhir.');
}

/* ---- presensi masuk dan keluar ---- */
function marbotPresensi_(b) {
  const lat = Number(b.lat), lng = Number(b.lng), akurasi = Number(b.akurasi);
  if (!isFinite(lat) || !isFinite(lng) || !isFinite(akurasi)) throw new Error('Data lokasi tidak valid.');
  const jenis = String(b.jenis || 'masuk').toLowerCase();
  if (jenis !== 'masuk' && jenis !== 'keluar') throw new Error('Jenis presensi tidak dikenal.');

  const cfg = readConfig_();
  const id = String(b.id || '').trim();

  const cache = CacheService.getScriptCache();
  const failKey = 'failm_' + id;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('Terlalu banyak PIN salah. Coba lagi dalam 10 menit.');

  const m = findMarbot_(id);
  if (!m || m.pin !== String(b.pin || '').trim()) {
    cache.put(failKey, String(fails + 1), 600);
    throw new Error('Nama atau PIN tidak sesuai.');
  }
  cache.remove(failKey);

  if (akurasi > cfg.maxAkurasi) {
    throw new Error('Akurasi GPS ±' + Math.round(akurasi) + ' m belum cukup (maksimal ' + cfg.maxAkurasi +
      ' m). Pindah ke area terbuka lalu coba lagi.');
  }
  const batas = cfg.radiusMeter + cfg.toleransiMeter;
  const jarak = haversine_(cfg.latitude, cfg.longitude, lat, lng);
  if (jarak > batas) {
    throw new Error('Anda berada ' + Math.round(jarak) + ' m dari ' + cfg.namaLokasi +
      '. Batas presensi ' + batas + ' m.');
  }

  const now = new Date();
  const tanggal = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const jam = Utilities.formatDate(now, TZ, 'HH:mm:ss');
  const nowMin = Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm')) +
    Number(Utilities.formatDate(now, TZ, 's')) / 60;

  const sh = sheet_(M.PRESENSI);
  finalisasiLupaKeluar_(sh, cfg, tanggal, nowMin); // sesi yang lupa keluar dihitung 1/3 sebelum menghitung sisa batas harian
  const jadwal = readJadwal_();
  const jarakBulat = Math.round(jarak * 10) / 10;
  const maks = totalMenit_(jadwal, cfg).maksMenit;

  if (jenis === 'keluar') {
    return keluarMarbot_(sh, cfg, jadwal, m, tanggal, jam, nowMin, maks,
      { lat: lat, lng: lng, akurasi: Math.round(akurasi), jarak: jarakBulat });
  }

  const s = pilihSesi_(jadwal, nowMin, cfg.marbotBukaSebelumMenit, sesiHariIni_(sh, tanggal, m.id));

  // Tepat waktu: durasi penuh. Terlambat: hanya sisa menit sampai sesi berakhir.
  var status = 'Tepat waktu', kredit = s.durasi;
  if (nowMin - s.startMin > cfg.marbotToleransiMenit) {
    status = 'Terlambat';
    kredit = Math.max(0, Math.round(s.endMin - nowMin));
  }

  // Jam kerja per hari dihitung maksimal marbotMaksJam: kelebihan tidak dikreditkan.
  const sisa = Math.max(0, maks - kreditHariIni_(sh, tanggal, m.id, 0));
  const kreditPenuh = kredit;
  kredit = Math.min(kredit, sisa);

  // Menit dikreditkan sementara seolah marbot bertahan sampai sesi berakhir. Presensi keluar mengoreksinya;
  // bila lupa keluar, nanti diganti menjadi 1/3 durasi sesi (kolom U = Menunggu).
  sh.appendRow([now, tanggal, jam, m.id, m.nama, s.key, s.nama, s.durasi, kredit, status,
    lat, lng, Math.round(akurasi), jarakBulat, s.shift, '', '', '', '', '', 'Menunggu']);

  // Rekap harian (satu baris per marbot per hari). Kegagalan rekap tidak boleh menggagalkan presensi yang sudah tercatat.
  try {
    perbaruiRekapMarbot_(sh, tanggal, m, cfg);
  } catch (e) {
    console.error('Rekap marbot gagal: ' + e.message);
  }

  return {
    ok: true,
    data: {
      jenis: 'masuk',
      nama: m.nama,
      sesi: sesiRingkas_(s),
      tanggal: tanggal, jam: jam, status: status, menit: kredit, jarak: jarakBulat,
      dibatasi: kredit < kreditPenuh, maksMenit: maks,
      keluarBatas: jamDariDetik_((s.endMin + cfg.marbotKeluarSetelahMenit) * 60).slice(0, 5),
      lupaMenit: Math.round(s.durasi / 3),
    },
  };
}

function sesiRingkas_(s) {
  return { key: s.key, shift: s.shift, kegiatan: s.kegiatan, nama: s.nama, keterangan: s.keterangan,
    mulai: s.mulai, selesai: s.selesai, durasi: s.durasi };
}

/**
 * Presensi keluar = tanda berakhir sesi. Berlaku untuk sesi yang sudah masuk dan belum keluar, paling awal dulu,
 * sampai marbotKeluarSetelahMenit (default 5) menit setelah sesi berakhir; lewat dari itu dianggap lupa keluar. Menit dihitung dari awal kredit sampai jam keluar,
 * paling banyak sampai sesi berakhir. Keluar lebih awal dari akhir sesi (di luar toleransi) memotong menit.
 */
function keluarMarbot_(sh, cfg, jadwal, m, tanggal, jam, nowMin, maks, lokasi) {
  const baris = barisHari_(sh, tanggal, m.id);
  if (!baris.length) throw new Error('Anda belum presensi masuk hari ini. Presensi masuk dulu sebelum keluar.');

  const byKey = {};
  jadwal.forEach(function (j) { byKey[j.key] = j; });
  const terbuka = baris
    .filter(function (r) { return !r.keluar && r.statusKeluar !== 'Lupa keluar' && byKey[r.key]; })
    .sort(function (x, y) { return byKey[x.key].startMin - byKey[y.key].startMin; });
  if (!terbuka.length) {
    if (baris.some(function (r) { return r.statusKeluar === 'Lupa keluar'; })) {
      throw new Error('Batas presensi keluar sudah lewat (' + cfg.marbotKeluarSetelahMenit +
        ' menit setelah sesi berakhir). Sesi yang lupa keluar dihitung 1/3 dari durasi sesi.');
    }
    throw new Error('Semua sesi Anda hari ini sudah tercatat keluar.');
  }

  const kandidat = terbuka.filter(function (r) { return nowMin <= byKey[r.key].endMin + cfg.marbotKeluarSetelahMenit; });
  if (!kandidat.length) {
    const t = byKey[terbuka[terbuka.length - 1].key];
    throw new Error('Batas presensi keluar untuk ' + t.nama + ' ' + t.mulai.replace(':', '.') + '-' + t.selesai.replace(':', '.') +
      ' sudah lewat (' + cfg.marbotKeluarSetelahMenit + ' menit setelah sesi berakhir). Sesi ini dihitung 1/3 dari durasi.');
  }

  const r = kandidat[0], s = byKey[r.key];
  const masukMenit = detik_(r.jam) / 60;
  const telat = r.status === 'Terlambat';
  const pulangCepat = s.endMin - nowMin > cfg.marbotToleransiMenit;
  const keluarEfektif = pulangCepat ? nowMin : s.endMin;
  const mulaiKredit = telat ? masukMenit : s.startMin;
  const kreditHitung = Math.max(0, Math.min(s.durasi, Math.round(keluarEfektif - mulaiKredit)));

  const sisa = Math.max(0, maks - kreditHariIni_(sh, tanggal, m.id, r.row));
  const kredit = Math.min(kreditHitung, sisa);

  sh.getRange(r.row, 9).setValue(kredit);
  sh.getRange(r.row, 16, 1, 5).setValues([[jam, lokasi.lat, lokasi.lng, lokasi.akurasi, lokasi.jarak]]);
  sh.getRange(r.row, 21).setValue(pulangCepat ? 'Pulang cepat' : 'Tepat waktu');

  try {
    perbaruiRekapMarbot_(sh, tanggal, m, cfg);
  } catch (e) {
    console.error('Rekap marbot gagal: ' + e.message);
  }

  return {
    ok: true,
    data: {
      jenis: 'keluar',
      nama: m.nama,
      sesi: sesiRingkas_(s),
      tanggal: tanggal, jam: jam, jamMasuk: r.jam, status: r.status, menit: kredit, jarak: lokasi.jarak,
      pulangCepat: pulangCepat, dibatasi: kredit < kreditHitung, maksMenit: maks,
    },
  };
}

/* ---- rekap harian: satu baris per marbot per hari ---- */
const REKAP_HEADER = ['Timestamp', 'ID Pegawai', 'Nama', 'Jam Masuk', 'Jam Keluar'];

/** Sheet rekap-presensi-marbot; dibuat bila belum ada. */
function sheetRekap_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(M.REKAP);
  if (!sh) sh = ss.insertSheet(M.REKAP);
  if (sh.getLastRow() === 0) {
    sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sh.getRange('B:E').setNumberFormat('@'); // ID dan jam sebagai teks agar tidak diubah otomatis
    sh.getRange(1, 1, 1, REKAP_HEADER.length).setValues([REKAP_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, 5, 150);
  }
  return sh;
}

function detik_(hhmmss) {
  const p = String(hhmmss).split(':');
  return Number(p[0]) * 3600 + Number(p[1] || 0) * 60 + Number(p[2] || 0);
}

function jamDariDetik_(d) {
  d = Math.max(0, Math.round(d));
  const z = function (n) { return (n < 10 ? '0' : '') + n; };
  return z(Math.floor(d / 3600)) + ':' + z(Math.floor((d % 3600) / 60)) + ':' + z(d % 60);
}

/**
 * Rekap satu marbot pada satu hari dari semua sesi yang sudah dipresensi.
 * entri: [{ ts: Date, jam: 'HH:mm:ss' (masuk), keluar: 'HH:mm:ss' atau '' }]
 * Jam Masuk  = jam presensi masuk paling awal hari itu.
 * Jam Keluar = jam presensi keluar paling akhir hari itu (kosong bila belum ada yang keluar). Selisih dengan
 *              Jam Masuk tidak boleh lebih dari maksJam jam (0 = tanpa batas); bila lebih, Jam Keluar = Jam Masuk + maksJam.
 * Timestamp  = waktu aktivitas terakhir (masuk atau keluar) hari itu.
 */
function hitungRekap_(entri, maksJam, tanggal) {
  if (!entri.length) return null;
  var masuk = Infinity, keluar = -1, ts = 0;
  entri.forEach(function (e) {
    masuk = Math.min(masuk, detik_(e.jam));
    ts = Math.max(ts, e.ts instanceof Date ? e.ts.getTime() : 0);
    if (e.keluar) {
      keluar = Math.max(keluar, detik_(e.keluar));
      ts = Math.max(ts, new Date(tanggal + 'T' + e.keluar + '+08:00').getTime() || 0); // WITA = UTC+8
    }
  });
  var keluarTeks = '';
  if (keluar >= 0) {
    keluar = Math.max(keluar, masuk);
    if (maksJam > 0 && keluar - masuk > maksJam * 3600) keluar = masuk + maksJam * 3600;
    keluarTeks = jamDariDetik_(keluar);
  }
  return { ts: ts ? new Date(ts) : new Date(), masuk: jamDariDetik_(masuk), keluar: keluarTeks };
}

/** Tambah atau perbarui baris rekap marbot pada tanggal itu. */
function perbaruiRekapMarbot_(shPresensi, tanggal, m, cfg) {
  const entri = barisHari_(shPresensi, tanggal, m.id);
  const rk = hitungRekap_(entri, cfg.marbotMaksJam, tanggal);
  if (!rk) return;
  const rekap = sheetRekap_();
  const baris = [rk.ts, m.id, m.nama, rk.masuk, rk.keluar];

  const last = rekap.getLastRow();
  if (last >= 2) {
    const from = Math.max(2, last - 599);
    const vals = rekap.getRange(from, 1, last - from + 1, 2).getValues(); // A..B
    for (var i = vals.length - 1; i >= 0; i--) {
      if (text_(vals[i][0], 'yyyy-MM-dd') === tanggal && String(vals[i][1]) === m.id) {
        rekap.getRange(from + i, 1, 1, 5).setValues([baris]);
        return;
      }
    }
  }
  rekap.appendRow(baris);
}

/**
 * Susun ulang seluruh sheet rekap-presensi-marbot dari PresensiMarbot. Jalankan dari editor Apps Script
 * untuk mengisi rekap dari data presensi yang sudah ada (aman diulang; isi lama sheet rekap diganti).
 */
function bangunUlangRekapMarbot() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const cfg = readConfig_();
    const sh = sheet_(M.PRESENSI);
    const last = sh.getLastRow();
    const grup = {}, urut = [];
    if (last >= 2) {
      sh.getRange(2, 1, last - 1, 16).getValues().forEach(function (r) { // A..P
        const tanggal = text_(r[1], 'yyyy-MM-dd'), id = String(r[3]);
        if (!tanggal || !id) return;
        const k = tanggal + '|' + id;
        if (!grup[k]) { grup[k] = { id: id, nama: String(r[4]), tanggal: tanggal, entri: [] }; urut.push(k); }
        grup[k].entri.push({
          ts: r[0], jam: text_(r[2], 'HH:mm:ss'),
          keluar: r[15] === '' || r[15] === null ? '' : text_(r[15], 'HH:mm:ss'),
        });
      });
    }
    const rows = urut.map(function (k) {
      const g = grup[k], rk = hitungRekap_(g.entri, cfg.marbotMaksJam, g.tanggal);
      return [rk.ts, g.id, g.nama, rk.masuk, rk.keluar];
    }).sort(function (a, b) { return a[0] - b[0]; });

    const rekap = sheetRekap_();
    const lastR = rekap.getLastRow();
    if (lastR >= 2) rekap.getRange(2, 1, lastR - 1, 5).clearContent();
    if (rows.length) rekap.getRange(2, 1, rows.length, 5).setValues(rows);
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

/* ---- riwayat: semua marbot terdaftar, termasuk yang belum hadir ---- */
function marbotRiwayat_(tanggal) {
  const jadwal = readJadwal_();
  const cfg = readConfig_();
  const tm = totalMenit_(jadwal, cfg);

  // Proses sesi yang lupa keluar lebih dulu (dilewati bila lock sedang dipakai; akan diproses pada pembacaan berikutnya)
  const lock = LockService.getScriptLock();
  if (lock.tryLock(3000)) {
    try {
      const w = waktuSekarang_();
      finalisasiLupaKeluar_(sheet_(M.PRESENSI), cfg, w.tanggal, w.nowMin);
    } catch (e) {
      console.error('Finalisasi lupa keluar gagal: ' + e.message);
    } finally {
      lock.releaseLock();
    }
  }
  const map = {}, order = [];
  readMarbot_().forEach(function (m) {
    map[m.id] = { id: m.id, nama: m.nama, sesi: [], menit: 0 };
    order.push(m.id);
  });

  const sh = sheet_(M.PRESENSI);
  const last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 2, last - 1, 20).getValues().forEach(function (r) { // B..U
      if (text_(r[0], 'yyyy-MM-dd') !== tanggal) return;
      const id = String(r[2]);
      if (!map[id]) { map[id] = { id: id, nama: String(r[3]), sesi: [], menit: 0 }; order.push(id); }
      const kredit = Number(r[7]) || 0;
      const keluar = r[14] === '' || r[14] === null ? '' : text_(r[14], 'HH:mm:ss').slice(0, 5);
      map[id].sesi.push({
        key: String(r[4]), jam: text_(r[1], 'HH:mm:ss').slice(0, 5), keluar: keluar,
        statusKeluar: String(r[19] || ''), status: String(r[8]), menit: kredit,
      });
      map[id].menit += kredit;
    });
  }

  const rows = order.map(function (id) {
    const r = map[id];
    r.menit = Math.min(r.menit, tm.maksMenit); // kelebihan di atas batas harian tidak dihitung
    return r;
  }).sort(function (a, b) { return a.nama.localeCompare(b.nama); });
  return {
    ok: true,
    tanggal: tanggal,
    jadwal: jadwal,
    totalMenit: tm.maksMenit,
    jadwalMenit: tm.jadwalMenit,
    rows: rows,
  };
}
