/**
 * Backend Presensi Kajian Pegawai (Google Apps Script + Google Sheets).
 * Jalankan setup() satu kali untuk membuat sheet Config, Pegawai, Presensi dan API_KEY.
 */
const TZ = 'Asia/Makassar';
const SHEET = { CONFIG: 'Config', PEGAWAI: 'Pegawai', PRESENSI: 'Presensi' };
const JENIS_VALID = ['Mulai', 'Selesai'];

/* ============ SETUP (jalankan sekali dari editor) ============ */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let cfg = ss.getSheetByName(SHEET.CONFIG) || ss.insertSheet(SHEET.CONFIG);
  if (cfg.getLastRow() === 0) {
    cfg.getRange(1, 1, 7, 3).setValues([
      ['Kunci', 'Nilai', 'Keterangan'],
      ['namaKegiatan', 'Kajian Pegawai', 'Judul kegiatan'],
      ['namaLokasi', 'Masjid Syarifah Shalihah', 'Nama lokasi kajian'],
      ['latitude', -3.4331621, 'Titik pusat presensi'],
      ['longitude', 114.845775, 'Titik pusat presensi'],
      ['radiusMeter', 20, 'Jarak maksimal dari titik pusat (meter)'],
      ['maxAkurasi', 50, 'Presensi ditolak jika akurasi GPS lebih buruk dari ini (meter)'],
    ]);
    cfg.setFrozenRows(1);
    cfg.setColumnWidths(1, 3, 220);
  }

  let peg = ss.getSheetByName(SHEET.PEGAWAI) || ss.insertSheet(SHEET.PEGAWAI);
  if (peg.getLastRow() === 0) {
    peg.getRange('D:D').setNumberFormat('@'); // PIN sebagai teks agar angka 0 di depan tidak hilang
    peg.getRange(1, 1, 3, 4).setValues([
      ['ID', 'Nama', 'Jabatan', 'PIN'],
      ['P001', 'Contoh Pegawai 1', 'Guru', '1234'],
      ['P002', 'Contoh Pegawai 2', 'Staf', '5678'],
    ]);
    peg.setFrozenRows(1);
  }

  let pr = ss.getSheetByName(SHEET.PRESENSI) || ss.insertSheet(SHEET.PRESENSI);
  if (pr.getLastRow() === 0) {
    pr.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    pr.getRange('B:C').setNumberFormat('@');
    pr.getRange(1, 1, 1, 12).setValues([[
      'Timestamp', 'Tanggal', 'Jam', 'ID Pegawai', 'Nama', 'Jabatan',
      'Jenis', 'Latitude', 'Longitude', 'Akurasi (m)', 'Jarak (m)', 'Status',
    ]]);
    pr.setFrozenRows(1);
  }

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) {
    props.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, ''));
  }
  Logger.log('API_KEY (salin ke environment variable Vercel): ' + props.getProperty('API_KEY'));
}

/* ============ ENDPOINT ============ */
function doGet(e) {
  try {
    assertKey_(e && e.parameter && e.parameter.key);
    if (!e.parameter || e.parameter.action !== 'init') throw new Error('Aksi tidak dikenal.');

    const rows = sheet_(SHEET.PEGAWAI).getDataRange().getValues().slice(1);
    const pegawai = rows
      .filter(function (r) { return r[0] && r[1]; })
      .map(function (r) {
        return { id: String(r[0]).trim(), nama: String(r[1]).trim(), jabatan: String(r[2] || '').trim() };
      });

    return json_({ ok: true, config: readConfig_(), pegawai: pegawai });
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
      throw new Error('Akurasi GPS ±' + Math.round(akurasi) + ' m terlalu rendah. Pindah ke area terbuka lalu coba lagi.');
    }

    const jarak = haversine_(cfg.latitude, cfg.longitude, lat, lng);
    if (jarak > cfg.radiusMeter) {
      throw new Error('Anda berada ' + Math.round(jarak) + ' m dari ' + cfg.namaLokasi +
        '. Batas presensi ' + cfg.radiusMeter + ' m.');
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
        return String(r[0]) === tanggal && String(r[2]) === peg.id && String(r[5]) === jenis;
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
    maxAkurasi: Number(m.maxAkurasi) || 50,
  };
  if (!isFinite(cfg.latitude) || !isFinite(cfg.longitude)) throw new Error('Koordinat pada sheet Config tidak valid.');
  return cfg;
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
