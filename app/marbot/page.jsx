"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hero from "../../components/Hero";
import LokasiCard from "../../components/LokasiCard";
import RiwayatMarbot from "../../components/RiwayatMarbot";
import useLokasi, { formatDistance } from "../../lib/useLokasi";
import { fmtJam, formatJamTotal, sesiKeluar, sesiTerbuka } from "../../lib/marbot";
import { fmtDate, fmtIso, fmtTime, menitHariIni } from "../../lib/waktu";

const STORAGE_KEY = "presensi-marbot:id";
const POLL_MS = 60000;
const JENIS = [
  { value: "masuk", label: "Masuk", hint: "Awal sesi" },
  { value: "keluar", label: "Keluar", hint: "Akhir sesi" },
];

const pad = (n) => String(n).padStart(2, "0");
const jamDariMenit = (m) => `${pad(Math.floor(m / 60))}.${pad(Math.round(m % 60))}`;
const infoSesi = (s) => [s.kegiatan && s.shift && `Shift ${s.shift}`, s.keterangan].filter(Boolean).join(". ");

export default function MarbotPage() {
  const [boot, setBoot] = useState({
    state: "loading", config: null, marbot: [], jadwal: [], totalMenit: 0, jadwalMenit: 0, error: "",
  });
  const [marbotId, setMarbotId] = useState("");
  const [pin, setPin] = useState("");
  const [jenis, setJenis] = useState("masuk");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(null);
  const [today, setToday] = useState("");
  const [tanggal, setTanggal] = useState("");
  const [todayData, setTodayData] = useState({ state: "loading", rows: [], error: "" });
  const [otherData, setOtherData] = useState({ state: "loading", rows: [], error: "" });
  const offsetRef = useRef(0); // selisih jam perangkat terhadap jam server
  const reqToday = useRef(0);
  const reqOther = useRef(0);

  const cfg = boot.config;
  const lokasi = useLokasi(cfg, boot.state === "error");
  const { geo, metrics, inRange, accOk } = lokasi;

  /* Jam berjalan (WITA) mengikuti jam server */
  useEffect(() => {
    const tick = () => {
      const t = new Date(Date.now() + offsetRef.current);
      setNow(t);
      const iso = fmtIso.format(t);
      setToday((p) => (p === iso ? p : iso));
      setTanggal((p) => p || iso);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  /* Lokasi, daftar marbot, dan jadwal sesi */
  const loadBoot = useCallback(async () => {
    setBoot((b) => ({ ...b, state: "loading", error: "" }));
    try {
      const res = await fetch("/api/marbot", { cache: "no-store" });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "Data marbot belum bisa dimuat.");
      if (d.serverMs) offsetRef.current = d.serverMs - Date.now();
      setBoot({ state: "ready", config: d.config, marbot: d.marbot, jadwal: d.jadwal, totalMenit: d.totalMenit, jadwalMenit: d.jadwalMenit || d.totalMenit, error: "" });
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && d.marbot.some((m) => m.id === saved)) setMarbotId(saved);
      } catch {}
    } catch (e) {
      setBoot({ state: "error", config: null, marbot: [], jadwal: [], totalMenit: 0, jadwalMenit: 0, error: e.message });
    }
  }, []);

  useEffect(() => {
    loadBoot();
  }, [loadBoot]);

  /* Riwayat hari ini (dipakai juga untuk menentukan sesi) dan riwayat tanggal lain */
  const fetchRiwayat = useCallback(async (tgl) => {
    const res = await fetch(`/api/marbot?action=riwayat&tanggal=${tgl}`, { cache: "no-store" });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || "Riwayat belum bisa dimuat.");
    return d;
  }, []);

  const loadToday = useCallback(async (silent = false) => {
    if (!today) return;
    const id = ++reqToday.current;
    if (!silent) setTodayData((r) => ({ ...r, state: "loading", error: "" }));
    try {
      const d = await fetchRiwayat(today);
      if (id === reqToday.current) setTodayData({ state: "ready", rows: d.rows, error: "" });
    } catch (e) {
      if (id === reqToday.current) setTodayData((r) => ({ ...r, state: "error", error: e.message }));
    }
  }, [today, fetchRiwayat]);

  const loadOther = useCallback(async (silent = false) => {
    if (!tanggal || tanggal === today) return;
    const id = ++reqOther.current;
    if (!silent) setOtherData((r) => ({ ...r, state: "loading", error: "" }));
    try {
      const d = await fetchRiwayat(tanggal);
      if (id === reqOther.current) setOtherData({ state: "ready", rows: d.rows, error: "" });
    } catch (e) {
      if (id === reqOther.current) setOtherData((r) => ({ ...r, state: "error", error: e.message }));
    }
  }, [tanggal, today, fetchRiwayat]);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { loadOther(); }, [loadOther]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadToday(true);
      loadOther(true);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [loadToday, loadOther]);

  const view = !tanggal || tanggal === today ? todayData : otherData;

  /* Sesi yang bisa dipresensi sekarang (aturan sama dengan server) */
  const nowMin = now ? menitHariIni(now) : null;
  const me = todayData.rows.find((r) => r.id === marbotId);
  const sudah = useMemo(() => Object.fromEntries((me?.sesi || []).map((x) => [x.key, x])), [me]);
  const buka = cfg?.marbotBukaSebelumMenit ?? 15;
  const toleransi = cfg?.marbotToleransiMenit ?? 10;
  const setelah = cfg?.marbotKeluarSetelahMenit ?? 5;
  const ready = nowMin !== null && boot.state === "ready";
  const sel = ready ? sesiTerbuka(boot.jadwal, nowMin, buka, sudah) : null;
  const selKeluar = ready ? sesiKeluar(boot.jadwal, nowMin, setelah, sudah) : null;
  const keluar = jenis === "keluar";

  const sesiInfo = (() => {
    if (!ready) return { tone: "none", head: "Memuat jadwal…", body: "" };
    if (keluar) {
      if (!marbotId) return { tone: "none", head: "Presensi keluar", body: "Pilih nama Anda untuk melihat sesi yang perlu ditutup." };
      if (!selKeluar) {
        return { tone: "none", head: "Tidak ada sesi yang perlu keluar", body: "Presensi keluar tersedia setelah Anda presensi masuk pada suatu sesi." };
      }
      const s = selKeluar;
      const x = sudah[s.key];
      const cepat = s.endMin - nowMin > toleransi;
      return {
        tone: cepat ? "late" : "ok",
        head: `${s.nama} ${fmtJam(s.mulai)}–${fmtJam(s.selesai)}`,
        body: cepat
          ? `Masuk ${fmtJam(x.jam)}. Keluar sebelum sesi berakhir (${fmtJam(s.selesai)}): menit dihitung sampai sekarang.`
          : `Masuk ${fmtJam(x.jam)}. Presensi keluar menandai sesi berakhir.`,
        note: `Batas presensi keluar pukul ${jamDariMenit(s.endMin + setelah)}. ${infoSesi(s)}`.trim(),
      };
    }
    if (!sel) return { tone: "none", head: "Memuat jadwal…", body: "" };
    if (sel.state === "aktif") {
      const s = sel.sesi;
      const telat = nowMin - s.startMin > toleransi;
      return {
        tone: telat ? "late" : "ok",
        head: `${s.nama} ${fmtJam(s.mulai)}–${fmtJam(s.selesai)}`,
        body: telat
          ? `Terlambat. Menit yang dikreditkan sekitar ${Math.max(0, Math.round(s.endMin - nowMin))} dari ${s.durasi} menit.`
          : `${s.durasi} menit. Presensi masuk sesi ini terbuka.`,
        note: [
          infoSesi(s),
          `Presensi keluar paling lambat ${jamDariMenit(s.endMin + setelah)}. Bila lupa keluar, menit dihitung 1/3 dari durasi sesi (${Math.round(s.durasi / 3)} menit).`,
        ].filter(Boolean).join(" "),
      };
    }
    if (sel.state === "sudah") return { tone: "none", head: "Sesi ini sudah tercatat", body: "Presensi untuk sesi yang sedang berjalan sudah masuk." };
    if (sel.state === "nanti") {
      const s = sel.sesi;
      return {
        tone: "none",
        head: "Belum ada sesi dibuka",
        body: `Berikutnya ${s.nama} ${fmtJam(s.mulai)}–${fmtJam(s.selesai)}, presensi dibuka pukul ${jamDariMenit(s.startMin - buka)}.`,
        note: infoSesi(s),
      };
    }
    return { tone: "none", head: "Semua sesi hari ini sudah berakhir", body: "" };
  })();

  const blocker = !marbotId
    ? "Pilih nama Anda untuk melanjutkan."
    : pin.length < 4
    ? "Masukkan PIN Anda."
    : keluar && !selKeluar
    ? "Presensi keluar aktif setelah Anda presensi masuk."
    : !keluar && (!sel || sel.state !== "aktif")
    ? "Presensi masuk aktif saat sesi dibuka."
    : !metrics
    ? "Menunggu lokasi Anda."
    : !accOk
    ? "Tunggu hingga akurasi GPS membaik."
    : !inRange
    ? "Presensi aktif setelah Anda berada di area masjid."
    : "";

  const canSubmit = !blocker && !sending && boot.state === "ready";

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/marbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jenis, id: marbotId, pin, lat: geo.pos.lat, lng: geo.pos.lng, akurasi: geo.pos.acc }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "Presensi belum bisa dicatat.");
      const x = d.data;
      const batas = x.dibatasi ? ` (batas ${formatJamTotal(x.maksMenit)} per hari tercapai, kelebihan tidak dihitung)` : "";
      setNotice(
        x.jenis === "keluar"
          ? {
              type: "ok",
              title: `Keluar ${x.sesi.nama} ${fmtJam(x.sesi.mulai)} tercatat`,
              detail: `${x.nama} masuk ${fmtJam(x.jamMasuk.slice(0, 5))}, keluar ${fmtJam(x.jam.slice(0, 5))} WITA${
                x.pulangCepat ? " (sebelum sesi berakhir)" : ""
              }, ${x.menit} menit dikreditkan${batas}, ${formatDistance(x.jarak)} m dari titik masjid.`,
            }
          : {
              type: "ok",
              title: `Masuk ${x.sesi.nama} ${fmtJam(x.sesi.mulai)} tercatat`,
              detail: `${x.nama} pukul ${x.jam} WITA, ${x.status.toLowerCase()}, ${x.menit} menit dikreditkan sementara${batas}, ${formatDistance(x.jarak)} m dari titik masjid. Presensi keluar paling lambat pukul ${fmtJam(x.keluarBatas)}; bila lupa, menit dihitung ${x.lupaMenit} (1/3 durasi sesi).`,
            }
      );
      setPin("");
      if (tanggal !== today) setTanggal(today);
      loadToday(true);
    } catch (err) {
      setNotice({ type: "err", title: "Presensi belum tercatat", detail: err.message });
    } finally {
      setSending(false);
    }
  }

  function onPick(id) {
    setMarbotId(id);
    setNotice(null);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  }

  const menit = boot.totalMenit ? Math.min(me?.menit || 0, boot.totalMenit) : me?.menit || 0;

  return (
    <main>
      <Hero
        title="Presensi marbot masjid"
        place={cfg?.namaLokasi}
        time={now ? fmtTime.format(now) : "--.--.--"}
        date={now ? `${fmtDate.format(now)}, WITA` : "\u00A0"}
        active="marbot"
      />

      <div className="grid">
        <LokasiCard cfg={cfg} lokasi={lokasi} />

        <form className="panel form" onSubmit={onSubmit} noValidate>
          <div className={`sesi-now ${sesiInfo.tone}`} aria-live="polite">
            <small>{sel?.state === "aktif" ? "Sesi sekarang" : "Status sesi"}</small>
            <strong>{sesiInfo.head}</strong>
            {sesiInfo.body && <span>{sesiInfo.body}</span>}
            {sesiInfo.note && <span className="sesi-ket">{sesiInfo.note}</span>}
          </div>

          <fieldset className="field">
            <legend>Jenis presensi</legend>
            <div className="choice">
              {JENIS.map((j) => (
                <label key={j.value}>
                  <input
                    type="radio"
                    name="jenis-marbot"
                    value={j.value}
                    checked={jenis === j.value}
                    onChange={() => {
                      setJenis(j.value);
                      setNotice(null);
                    }}
                  />
                  <span className="tile">
                    <i className="dot" aria-hidden="true" />
                    <strong>{j.label}</strong>
                    <small>{j.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="marbot">Nama marbot</label>
            <select id="marbot" value={marbotId} onChange={(e) => onPick(e.target.value)} disabled={boot.state !== "ready"}>
              <option value="">{boot.state === "loading" ? "Memuat daftar marbot…" : "Pilih nama Anda"}</option>
              {boot.marbot.map((m) => (
                <option key={m.id} value={m.id}>{m.nama}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pin-marbot">PIN</label>
            <input
              id="pin-marbot"
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
            {sending
              ? "Mencatat…"
              : keluar
              ? selKeluar
                ? `Catat keluar ${fmtJam(selKeluar.mulai)}`
                : "Catat keluar"
              : sel?.state === "aktif"
              ? `Catat masuk ${fmtJam(sel.sesi.mulai)}`
              : "Catat masuk"}
          </button>
          {blocker && boot.state === "ready" && <p className="blocker">{blocker}</p>}

          {boot.state === "error" && (
            <div className="notice err" role="alert">
              <strong>Data marbot belum termuat</strong>
              <p>{boot.error}</p>
              <button type="button" className="ghost small" onClick={loadBoot}>Muat ulang data</button>
            </div>
          )}

          {notice && (
            <div className={`notice ${notice.type}`} role={notice.type === "err" ? "alert" : "status"}>
              <strong>{notice.title}</strong>
              <p>{notice.detail}</p>
            </div>
          )}

          {boot.state === "ready" && (
            <div className="field">
              <div className="prog-label">
                <span>Jadwal hari ini</span>
                {marbotId && (
                  <span>
                    {menit} dari {boot.totalMenit} menit ({formatJamTotal(menit)} dari {formatJamTotal(boot.totalMenit)})
                  </span>
                )}
              </div>
              {marbotId && (
                <div className="progress" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, (menit / (boot.totalMenit || 1)) * 100)}%` }} />
                </div>
              )}
              {boot.totalMenit > 0 && (
                <p className="caption batas">
                  <strong>
                    Maksimal {formatJamTotal(boot.totalMenit)} ({boot.totalMenit} menit) dihitung per hari.
                  </strong>{" "}
                  {boot.jadwalMenit > boot.totalMenit
                    ? `Jadwal ${formatJamTotal(boot.jadwalMenit)}; kelebihan tidak dihitung.`
                    : "Kelebihan tidak dihitung."}
                </p>
              )}
              <ol className="jadwal">
                {boot.jadwal.map((s) => {
                  const x = sudah[s.key];
                  const cls = x
                    ? x.statusKeluar === "Lupa keluar"
                      ? "telat"
                      : `${x.status === "Terlambat" ? "telat" : "hadir"}${x.keluar || !x.statusKeluar ? "" : " belum-keluar"}`
                    : nowMin !== null && nowMin >= s.endMin
                    ? "lewat"
                    : sel?.state === "aktif" && sel.sesi.key === s.key
                    ? "aktif"
                    : "";
                  return (
                    <Fragment key={s.key}>
                      <li className={`jd ${cls}`}>
                        <span className="jd-shift" aria-hidden="true">{s.no}</span>
                        <div className="jd-main">
                          <strong>{s.nama}</strong>
                          <small>{fmtJam(s.mulai)}–{fmtJam(s.selesai)}{s.keterangan ? `, ${s.keterangan}` : ""}</small>
                        </div>
                        <span className="jd-stat">
                          {x
                            ? x.keluar
                              ? `${fmtJam(x.jam)}–${fmtJam(x.keluar)}`
                              : x.statusKeluar === "Lupa keluar"
                              ? `${fmtJam(x.jam)}, lupa keluar`
                              : `Masuk ${fmtJam(x.jam)}`
                            : `${s.durasi} mnt`}
                        </span>
                      </li>
                      {s.jeda && <li className="jd-break" aria-label="Break">Break</li>}
                    </Fragment>
                  );
                })}
              </ol>
            </div>
          )}
        </form>
      </div>

      <div className="below">
        <RiwayatMarbot
          tanggal={tanggal}
          today={today}
          onTanggal={setTanggal}
          state={view.state}
          rows={view.rows}
          error={view.error}
          jadwal={boot.jadwal}
          totalMenit={boot.totalMenit}
          onRefresh={() => (tanggal === today ? loadToday() : loadOther())}
        />
      </div>

      <footer>
        Lokasi Anda hanya dibaca saat halaman ini terbuka, untuk memastikan Anda berada di area masjid.
      </footer>
    </main>
  );
}
