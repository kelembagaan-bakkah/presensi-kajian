"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hero from "../components/Hero";
import LokasiCard from "../components/LokasiCard";
import Riwayat from "../components/Riwayat";
import useLokasi, { formatDistance } from "../lib/useLokasi";
import { fmtDate, fmtIso, fmtTime } from "../lib/waktu";

const JENIS = [
  { value: "Mulai", hint: "Awal kajian" },
  { value: "Selesai", hint: "Akhir kajian" },
];

const STORAGE_KEY = "presensi-kajian:pegawai";
const POLL_MS = 60000; // segarkan riwayat otomatis
const CARI_DELAY_MS = 500; // jeda setelah berhenti mengetik PIN sebelum mencari nama

export default function Page() {
  const [boot, setBoot] = useState({ state: "loading", config: null, error: "" });
  const [pegawaiId, setPegawaiId] = useState("");
  const [pin, setPin] = useState("");
  const [cari, setCari] = useState({ state: "idle", pegawai: [], error: "" }); // pencarian nama berdasarkan PIN
  const [jenis, setJenis] = useState("Mulai");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(null);
  const [today, setToday] = useState("");
  const [tanggal, setTanggal] = useState("");
  const [riwayat, setRiwayat] = useState({ state: "loading", rows: [], error: "" });
  const reqRef = useRef(0);
  const cariReq = useRef(0);

  const cfg = boot.config;
  const lokasi = useLokasi(cfg, boot.state === "error");
  const { geo, metrics, inRange, accOk } = lokasi;

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

  /* Konfigurasi lokasi */
  const loadBoot = useCallback(async () => {
    setBoot((b) => ({ ...b, state: "loading", error: "" }));
    try {
      const res = await fetch("/api/presensi", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Data kajian belum bisa dimuat.");
      setBoot({ state: "ready", config: data.config, error: "" });
    } catch (e) {
      setBoot({ state: "error", config: null, error: e.message });
    }
  }, []);

  useEffect(() => {
    loadBoot();
  }, [loadBoot]);

  /* Cari nama sesuai PIN. Hanya nama dengan PIN yang cocok yang diterima dari server. */
  useEffect(() => {
    const id = ++cariReq.current;
    setPegawaiId("");
    if (pin.length < 4) {
      setCari({ state: "idle", pegawai: [], error: "" });
      return;
    }
    setCari({ state: "loading", pegawai: [], error: "" });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/presensi/cari", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Nama belum bisa dicari.");
        if (id !== cariReq.current) return;
        const list = data.pegawai || [];
        setCari({ state: list.length ? "found" : "none", pegawai: list, error: "" });
        if (list.length === 1) setPegawaiId(list[0].id);
        else if (list.length > 1) {
          try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved && list.some((p) => p.id === saved)) setPegawaiId(saved);
          } catch {}
        }
      } catch (e) {
        if (id === cariReq.current) setCari({ state: "error", pegawai: [], error: e.message });
      }
    }, CARI_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pin]);

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

  const blocker = pin.length < 4
    ? "Masukkan PIN Anda."
    : cari.state === "loading"
    ? "Mencari nama sesuai PIN…"
    : cari.state === "none"
    ? "PIN tidak ditemukan."
    : cari.state === "error"
    ? cari.error
    : !pegawaiId
    ? "Pilih nama Anda untuk melanjutkan."
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

  return (
    <main>
      <Hero
        title="Presensi kajian pegawai"
        place={cfg?.namaLokasi}
        time={now ? fmtTime.format(now) : "--.--.--"}
        date={now ? `${fmtDate.format(now)}, WITA` : "\u00A0"}
        active="kajian"
      />

      <div className="grid">
        <LokasiCard cfg={cfg} lokasi={lokasi} />

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
            <label htmlFor="pin">PIN</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setNotice(null);
              }}
              placeholder="Masukan 6 Digit Pertama ID Pegawai"
            />
          </div>

          {cari.state === "found" && (
            <div className="field">
              {cari.pegawai.length === 1 ? (
                <>
                  <span className="label" id="pegawai-label">Nama pegawai</span>
                  <output className="nama-pegawai" aria-labelledby="pegawai-label">
                    {cari.pegawai[0].nama}
                    {cari.pegawai[0].jabatan ? ` (${cari.pegawai[0].jabatan})` : ""}
                  </output>
                </>
              ) : (
                <>
                  <label htmlFor="pegawai">Nama pegawai</label>
                  <select id="pegawai" value={pegawaiId} onChange={(e) => onPickPegawai(e.target.value)}>
                    <option value="">Pilih nama Anda</option>
                    {cari.pegawai.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nama}
                        {p.jabatan ? ` (${p.jabatan})` : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}

          <button type="submit" className="primary" disabled={!canSubmit}>
            {sending ? "Mencatat…" : `Catat presensi ${jenis.toLowerCase()}`}
          </button>
          {blocker && boot.state === "ready" && <p className="blocker">{blocker}</p>}

          {boot.state === "error" && (
            <div className="notice err" role="alert">
              <strong>Data kajian belum termuat</strong>
              <p>{boot.error}</p>
              <button type="button" className="ghost small" onClick={loadBoot}>
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
