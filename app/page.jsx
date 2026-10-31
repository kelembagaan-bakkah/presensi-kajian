"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Radar from "../components/Radar";
import { haversine, offsetMeters } from "../lib/geo";

const JENIS = [
  { value: "Mulai", hint: "Kajian akan dimulai" },
  { value: "Selesai", hint: "Kajian telah usai" },
];

const STORAGE_KEY = "presensi-kajian:pegawai";

const fmtTime = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Makassar",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const fmtDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Makassar",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function geoMessage(err) {
  if (err.code === 1)
    return "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser, lalu coba lagi.";
  if (err.code === 2) return "Lokasi tidak tersedia. Pastikan GPS perangkat menyala.";
  return "Pencarian lokasi terlalu lama. Coba lagi di area terbuka.";
}

function formatDistance(m) {
  return m < 10 ? m.toFixed(1).replace(".", ",") : String(Math.round(m));
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
  const watchRef = useRef(null);

  /* Jam berjalan (diisi setelah mount agar tidak beda dengan HTML server) */
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* Ambil konfigurasi lokasi dan daftar pegawai dari spreadsheet */
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

  /* Pantau posisi GPS */
  const startWatch = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current);
    if (!("geolocation" in navigator)) {
      setGeo({ state: "error", pos: null, error: "Perangkat ini tidak mendukung GPS." });
      return;
    }
    setGeo((g) => ({ ...g, state: "loading", error: "" }));
    watchRef.current = navigator.geolocation.watchPosition(
      (p) =>
        setGeo({
          state: "ok",
          pos: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy },
          error: "",
        }),
      (err) =>
        setGeo((g) =>
          g.pos && err.code === 3
            ? g
            : { state: err.code === 1 ? "denied" : "error", pos: null, error: geoMessage(err) }
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }, []);

  useEffect(() => {
    startWatch();
    return () => {
      if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current);
    };
  }, [startWatch]);

  const cfg = boot.config;

  const metrics = useMemo(() => {
    if (!cfg || !geo.pos) return null;
    const { lat, lng, acc } = geo.pos;
    return {
      dist: haversine(cfg.latitude, cfg.longitude, lat, lng),
      ...offsetMeters(cfg.latitude, cfg.longitude, lat, lng),
      acc,
    };
  }, [cfg, geo.pos]);

  const inRange = !!metrics && metrics.dist <= cfg.radiusMeter;
  const accOk = !!metrics && metrics.acc <= cfg.maxAkurasi;

  const status = (() => {
    if (boot.state === "error") return { tone: "bad", text: "Data kajian belum termuat." };
    if (geo.state === "denied" || geo.state === "error") return { tone: "bad", text: geo.error };
    if (!metrics) return { tone: "idle", text: "Mencari lokasi Anda…" };
    if (!accOk)
      return {
        tone: "warn",
        text: `Sinyal GPS masih lemah (±${Math.round(metrics.acc)} m). Pindah ke area terbuka dan tunggu sebentar.`,
      };
    if (inRange) return { tone: "ok", text: "Anda berada di dalam area kajian." };
    return {
      tone: "warn",
      text: `Mendekatlah sekitar ${Math.ceil(metrics.dist - cfg.radiusMeter)} m lagi ke titik kajian.`,
    };
  })();

  const blocker = !pegawaiId
    ? "Pilih nama Anda untuk melanjutkan."
    : pin.length < 4
    ? "Masukkan PIN Anda."
    : !metrics
    ? "Menunggu lokasi Anda."
    : !accOk || !inRange
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
    ? `Posisi Anda ${Math.round(metrics.dist)} meter dari titik kajian, batas ${cfg.radiusMeter} meter.`
    : "Menunggu posisi Anda.";

  return (
    <main>
      <header className="hero">
        <div className="hero-inner">
          <div>
            <h1>Presensi kajian pegawai</h1>
            {cfg?.namaLokasi && <p className="place">{cfg.namaLokasi}</p>}
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
          <Radar
            radius={cfg?.radiusMeter ?? 20}
            point={metrics}
            inRange={inRange}
            label={radarLabel}
          />
          <div className="readout">
            <div className="big">
              {metrics ? formatDistance(metrics.dist) : "–"}
              <span> m</span>
            </div>
            <p className="caption">
              {cfg ? `dari titik kajian, batas presensi ${cfg.radiusMeter} m` : "dari titik kajian"}
            </p>
            <p className={`status ${status.tone}`}>
              <i aria-hidden="true" />
              {status.text}
            </p>
            {metrics && <p className="acc">Akurasi GPS ±{Math.round(metrics.acc)} m</p>}
            {(geo.state === "denied" || geo.state === "error") && (
              <button type="button" className="ghost" onClick={startWatch}>
                Cari lokasi lagi
              </button>
            )}
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

      <footer>
        Lokasi Anda hanya dibaca saat halaman ini terbuka, untuk memastikan Anda berada di area kajian.
      </footer>
    </main>
  );
}
