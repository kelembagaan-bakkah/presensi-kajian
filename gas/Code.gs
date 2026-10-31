/**
 * Backend Presensi Kajian Pegawai (Google Apps Script + Google Sheets).
 * Jalankan setup() satu kali (atau lagi setelah update kode) untuk menyiapkan sheet dan API_KEY.
 */
const TZ = 'Asia/Makassar';
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
];

/* ============ SETUP (aman dijalankan berulang) ============ */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const cfg = ss.getSheetByName(SHEET.CONFIG) || ss.insertSheet(SHEET.CONFIG);
  if (cfg.getLastRow() === 0) {
    cfg.getRange(1, 1, 1, 3).setValues([['Kunci', 'Nilai', 'Keterangan']]);
    cfg.setFrozenRows(1);
    cfg.setColumnWidths(1, 3, 220);
  }
  const have = {};
  cfg.getDataRange().getValues().forEach(function (r, i) { if (r[0]) have[String(r[0]).trim()] = i + 1; });
  DEFAULT_CONFIG.forEach(function (d) { if (!have[d[0]]) cfg.appendRow(d); });
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
    const p = (e && e.parameter) || {};
    assertKey_(p.key);

    if (p.action === 'init') {
      const rows = sheet_(SHEET.PEGAWAI).getDataRange().getValues().slice(1);
      const pegawai = rows
        .filter(function (r) { return r[0] && r[1]; })
        .map(function (r) {
          return { id: String(r[0]).trim(), nama: String(r[1]).trim(), jabatan: String(r[2] || '').trim() };
        });
      return json_({ ok: true, config: readConfig_(), pegawai: pegawai });
    }

    if (p.action === 'riwayat') {
      const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(p.tanggal || '')
        ? p.tanggal
        : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
      return json_({ ok: true, tanggal: tanggal, rows: riwayat_(tanggal) });
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
