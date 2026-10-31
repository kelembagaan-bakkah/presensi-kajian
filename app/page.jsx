"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Radar from "../components/Radar";
import Riwayat from "../components/Riwayat";
import { haversine, offsetMeters } from "../lib/geo";

const JENIS = [
  { value: "Mulai", hint: "Kajian akan dimulai" },
  { value: "Selesai", hint: "Kajian telah usai" },
];

const STORAGE_KEY = "presensi-kajian:pegawai";
const SAMPLE_WINDOW_MS = 15000; // pembacaan GPS yang digabung
const POLL_MS = 60000; // segarkan riwayat otomatis

const TZ = "Asia/Makassar";
const fmtTime = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const fmtDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric",
});
const fmtIso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }); // yyyy-mm-dd

function geoMessage(err) {
  if (err.code === 1)
    return "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser, lalu cari lokasi lagi.";
  if (err.code === 2) return "Lokasi tidak tersedia. Pastikan GPS perangkat menyala.";
  return "Pencarian lokasi terlalu lama. Coba lagi di area terbuka.";
}

function formatDistance(m) {
  return m < 10 ? m.toFixed(1).replace(".", ",") : String(Math.round(m));
}

/**
 * Gabungkan beberapa pembacaan GPS terbaru: titik dirata-rata dengan bobot 1/akurasi²,
 * sehingga pembacaan kasar (Wi-Fi/jaringan) hampir tidak berpengaruh.
 * Akurasi yang dilaporkan = akurasi terbaik (konservatif).
 */
function fuse(samples) {
  const best = samples.reduce((a, b) => (b.acc < a.acc ? b : a));
  let w = 0, lat = 0, lng = 0;
  for (const s of samples) {
    if (s.acc > best.acc * 2) continue;
    const k = 1 / (s.acc * s.acc);
    w += k; lat += s.lat * k; lng += s.lng * k;
  }
  return { lat: lat / w, lng: lng / w, acc: best.acc };
}

function accLabel(acc, max) {
  if (acc <= 20) return "baik";
  if (acc <= max) return "cukup";
  return "lemah";
}

export default function Page() {
  const [boot, setBoot] = useState({ state: "loading", config: null, pegawai: [], error: "" });
  const [pegawaiId, setPegawaiId] = useState("");
  const [pin, setPin] = useState("");
  const [jenis, setJenis] = useState("Mulai");
  const [geo, setGeo] = useState({ state: "loading", pos: null, error: "" });
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(null);
  const [today, setToday] = useState("");
  const [tanggal, setTanggal] = useState("");
  const [riwayat, setRiwayat] = useState({ state: "loading", rows: [], error: "" });
  const watchRef = useRef(null);
  const samplesRef = useRef([]);
  const reqRef = useRef(0);

  /* Jam berjalan dan tanggal hari ini (WITA), diisi setelah mount */
  useEffect(() => {
    const t = new Date();
    setNow(t);
    const iso = fmtIso.format(t);
    setToday(iso);
    setTanggal(iso);
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* Konfigurasi lokasi dan daftar pegawai */
  const loadBoot = useCallback(async () => {
    setBoot((b) => ({ ...b, state: "loading", error: "" }));
    try {
      const res = await fetch("/api/presensi", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Data kajian belum bisa dimuat.");
      setBoot({ state: "ready", config: data.config, pegawai: data.pegawai, error: "" });
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && data.pegawai.some((p) => p.id === saved)) setPegawaiId(saved);
      } catch {}
    } catch (e) {
      setBoot({ state: "error", config: null, pegawai: [], error: e.message });
    }
  }, []);

  useEffect(() => {
    loadBoot();
  }, [loadBoot]);

  /* Riwayat presensi */
  const loadRiwayat = useCallback(async (tgl, silent = false) => {
    if (!tgl) return;
    const id = ++reqRef.current;
    if (!silent) setRiwayat((r) => ({ ...r, state: "loading", error: "" }));
    try {
      const res = await fetch(`/api/presensi?action=riwayat&tanggal=${tgl}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Riwayat belum bisa dimuat.");
      if (id === reqRef.current) setRiwayat({ state: "ready", rows: data.rows, error: "" });
    } catch (e) {
      if (id === reqRef.current) setRiwayat((r) => ({ ...r, state: "error", error: e.message }));
    }
  }, []);

  useEffect(() => {
    loadRiwayat(tanggal);
  }, [tanggal, loadRiwayat]);

  useEffect(() => {
    if (!tanggal) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadRiwayat(tanggal, true);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [tanggal, loadRiwayat]);

  /* Pantau GPS dan gabungkan pembacaan terbaru */
  const startWatch = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current);
    samplesRef.current = [];
    if (!("geolocation" in navigator)) {
      setGeo({ state: "error", pos: null, error: "Perangkat ini tidak mendukung GPS." });
      return;
    }
    setGeo({ state: "loading", pos: null, error: "" });
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const t = Date.now();
        samplesRef.current = [
          ...samplesRef.current.filter((s) => t - s.t <= SAMPLE_WINDOW_MS),
          { t, lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.max(p.coords.accuracy, 1) },
        ];
        setGeo({ state: "ok", pos: fuse(samplesRef.current), error: "" });
      },
      (err) =>
        setGeo((g) =>
          g.pos && err.code === 3
            ? g
            : { state: err.code === 1 ? "denied" : "error", pos: null, error: geoMessage(err) }
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }, []);

  useEffect(() => {
    startWatch();
    return () => {
      if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current);
    };
  }, [startWatch]);

  const cfg = boot.config;
  const limit = cfg ? cfg.radiusMeter + (cfg.toleransiMeter || 0) : 20;

  const metrics = useMemo(() => {
    if (!cfg || !geo.pos) return null;
    const { lat, lng, acc } = geo.pos;
    return {
      dist: haversine(cfg.latitude, cfg.longitude, lat, lng),
      ...offsetMeters(cfg.latitude, cfg.longitude, lat, lng),
      acc,
    };
  }, [cfg, geo.pos]);

  const inRange = !!metrics && metrics.dist <= limit;
  const accOk = !!metrics && metrics.acc <= cfg.maxAkurasi;

  const status = (() => {
    if (boot.state === "error") return { tone: "bad", text: "Data kajian belum termuat." };
    if (geo.state === "denied" || geo.state === "error") return { tone: "bad", text: geo.error };
    if (!metrics) return { tone: "idle", text: "Mencari lokasi Anda…" };
    if (!accOk) {
      const tip =
        metrics.acc > 150
          ? "Perangkat ini tampaknya memakai lokasi dari Wi-Fi atau jaringan. Gunakan HP, aktifkan GPS dengan akurasi tinggi, dan izinkan lokasi presisi untuk browser."
          : "Keluar ke area terbuka atau dekat jendela, lalu tunggu 10 sampai 20 detik.";
      return {
        tone: "warn",
        text: `Akurasi GPS ±${Math.round(metrics.acc)} m belum cukup (maksimal ${cfg.maxAkurasi} m). ${tip}`,
      };
    }
    if (inRange) return { tone: "ok", text: "Anda berada di dalam area kajian." };
    return {
      tone: "warn",
      text: `Mendekatlah sekitar ${Math.ceil(metrics.dist - limit)} m lagi ke titik kajian.`,
    };
  })();

  const blocker = !pegawaiId
    ? "Pilih nama Anda untuk melanjutkan."
    : pin.length < 4
    ? "Masukkan PIN Anda."
    : !metrics
    ? "Menunggu lokasi Anda."
    : !accOk
    ? "Tunggu hingga akurasi GPS membaik."
    : !inRange
    ? "Presensi aktif setelah Anda berada di area kajian."
    : "";

  const canSubmit = !blocker && !sending && boot.state === "ready";

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/presensi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pegawaiId,
          pin,
          jenis,
          lat: geo.pos.lat,
          lng: geo.pos.lng,
          akurasi: geo.pos.acc,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Presensi belum bisa dicatat.");
      setNotice({
        type: "ok",
        title: `Presensi ${jenis.toLowerCase()} tercatat`,
        detail: `${data.data.nama} pada pukul ${data.data.jam} WITA, ${formatDistance(
          data.data.jarak
        )} m dari titik kajian.`,
      });
      setPin("");
      if (tanggal !== today) setTanggal(today);
      else loadRiwayat(today, true);
    } catch (err) {
      setNotice({ type: "err", title: "Presensi belum tercatat", detail: err.message });
    } finally {
      setSending(false);
    }
  }

  function onPickPegawai(id) {
    setPegawaiId(id);
    setNotice(null);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
  }

  const radarLabel = metrics
    ? `Posisi Anda ${Math.round(metrics.dist)} meter dari titik kajian, batas ${limit} meter.`
    : "Menunggu posisi Anda.";

  return (
    <main>
      <header className="hero">
        <div className="hero-inner">
          <div className="brand">
            <span className="badge">
              <img src="/logo.png" alt="Logo Yayasan Sa'adah Martapura" width="68" height="68" />
            </span>
            <div>
              <h1>Presensi kajian pegawai</h1>
              {cfg?.namaLokasi && <p className="place">{cfg.namaLokasi}</p>}
            </div>
          </div>
          <div className="clock" aria-hidden={!now}>
            <time>{now ? fmtTime.format(now) : "--.--.--"}</time>
            <span>{now ? `${fmtDate.format(now)}, WITA` : "\u00A0"}</span>
          </div>
        </div>
      </header>

      <div className="grid">
        {/* Radar posisi */}
        <section className="panel" aria-live="polite">
          <Radar radius={limit} point={metrics} inRange={inRange} label={radarLabel} />
          <div className="readout">
            <div className="big">
              {metrics ? formatDistance(metrics.dist) : "–"}
              <span> m</span>
            </div>
            <p className="caption">
              {cfg ? `dari titik kajian, batas presensi ${limit} m` : "dari titik kajian"}
            </p>
            <p className={`status ${status.tone}`}>
              <i aria-hidden="true" />
              {status.text}
            </p>
            {metrics && (
              <p className="acc">
                Akurasi GPS ±{Math.round(metrics.acc)} m ({accLabel(metrics.acc, cfg.maxAkurasi)})
              </p>
            )}
            <button type="button" className="ghost" onClick={startWatch}>
              {geo.state === "denied" || geo.state === "error" ? "Cari lokasi lagi" : "Perbarui lokasi"}
            </button>
          </div>
        </section>

        {/* Formulir */}
        <form className="panel form" onSubmit={onSubmit} noValidate>
          <fieldset className="field">
            <legend>Jenis presensi</legend>
            <div className="choice">
              {JENIS.map((j) => (
                <label key={j.value}>
                  <input
                    type="radio"
                    name="jenis"
                    value={j.value}
                    checked={jenis === j.value}
                    onChange={() => {
                      setJenis(j.value);
                      setNotice(null);
                    }}
                  />
                  <span className="tile">
                    <i className="dot" aria-hidden="true" />
                    <strong>{j.value}</strong>
                    <small>{j.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="pegawai">Nama pegawai</label>
            <select
              id="pegawai"
              value={pegawaiId}
              onChange={(e) => onPickPegawai(e.target.value)}
              disabled={boot.state !== "ready"}
            >
              <option value="">
                {boot.state === "loading" ? "Memuat daftar pegawai…" : "Pilih nama Anda"}
              </option>
              {boot.pegawai.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama}
                  {p.jabatan ? ` (${p.jabatan})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pin">PIN</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="Minimal 4 angka"
            />
          </div>

          <button type="submit" className="primary" disabled={!canSubmit}>
            {sending ? "Mencatat…" : `Catat presensi ${jenis.toLowerCase()}`}
          </button>
          {blocker && boot.state === "ready" && <p className="blocker">{blocker}</p>}

          {boot.state === "error" && (
            <div className="notice err" role="alert">
              <strong>Data kajian belum termuat</strong>
              <p>{boot.error}</p>
              <button type="button" className="ghost" onClick={loadBoot}>
                Muat ulang data
              </button>
            </div>
          )}

          {notice && (
            <div className={`notice ${notice.type}`} role={notice.type === "err" ? "alert" : "status"}>
              <strong>{notice.title}</strong>
              <p>{notice.detail}</p>
            </div>
          )}
        </form>
      </div>

      <div className="below">
        <Riwayat
          tanggal={tanggal}
          today={today}
          onTanggal={setTanggal}
          state={riwayat.state}
          rows={riwayat.rows}
          error={riwayat.error}
          onRefresh={() => loadRiwayat(tanggal)}
        />
      </div>

      <footer>
        Lokasi Anda hanya dibaca saat halaman ini terbuka, untuk memastikan Anda berada di area kajian.
      </footer>
    </main>
  );
}
