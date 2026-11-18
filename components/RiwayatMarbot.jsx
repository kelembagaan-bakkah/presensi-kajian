"use client";

import { useEffect, useState } from "react";
import { fmtJam } from "../lib/marbot";

const PER_PAGE = 10;

export default function RiwayatMarbot({
  tanggal, today, onTanggal, state, rows, error, jadwal, totalMenit, onRefresh,
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [tanggal]);

  const total = rows.length;
  const hadir = rows.filter((r) => r.sesi.length > 0).length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const cur = Math.min(page, pages);
  const from = (cur - 1) * PER_PAGE;
  const view = rows.slice(from, from + PER_PAGE);
  const tgl = tanggal || today;

  return (
    <section className="panel history" aria-labelledby="riwayat-marbot">
      <div className="history-head">
        <div>
          <h2 id="riwayat-marbot">Riwayat presensi marbot</h2>
          <p className="caption">
            {total || state === "ready" ? `${hadir} dari ${total} marbot sudah presensi` : "\u00A0"}
          </p>
        </div>
        <div className="history-tools">
          <label className="sr-only" htmlFor="tanggal-marbot">Tanggal riwayat</label>
          <input
            id="tanggal-marbot"
            type="date"
            value={tgl}
            max={today}
            onChange={(e) => e.target.value && onTanggal(e.target.value)}
          />
          <button type="button" className="ghost small" onClick={onRefresh}>Segarkan</button>
          {total > 0 ? (
            <a className="ghost small solid" href={`/api/marbot/export?tanggal=${tgl}`} download>Excel</a>
          ) : (
            <button type="button" className="ghost small solid" disabled>Excel</button>
          )}
        </div>
      </div>

      {state === "loading" && !total && <p className="empty">Memuat riwayat…</p>}
      {state === "error" && (
        <div className="notice err" role="alert">
          <strong>Riwayat belum termuat</strong>
          <p>{error}</p>
        </div>
      )}
      {state === "ready" && total === 0 && <p className="empty">Belum ada data marbot.</p>}

      {total > 0 && (
        <ul className="hist-list">
          {view.map((r) => (
            <li key={r.id}>
              <span className="avatar" aria-hidden="true">{r.nama.trim().charAt(0).toUpperCase()}</span>
              <div className="who">
                <strong>{r.nama}</strong>
                <small>{r.sesi.length} dari {jadwal.length} sesi</small>
              </div>
              <span className={`chip${r.menit ? " start" : " pending"}`}>
                <small>Menit</small>
                {Math.min(r.menit, totalMenit || r.menit)}/{totalMenit}
              </span>
              <div className="dots" role="img" aria-label={`${r.sesi.length} dari ${jadwal.length} sesi hadir`}>
                {jadwal.map((s) => {
                  const x = r.sesi.find((v) => v.key === s.key);
                  const cls = x ? `${x.status === "Terlambat" || x.statusKeluar === "Lupa keluar" ? "t" : "h"}${x.keluar || !x.statusKeluar ? "" : " o"}` : "";
                  const tip = `${s.nama} ${fmtJam(s.mulai)}–${fmtJam(s.selesai)}: ${
                    x
                      ? `${x.status}, masuk ${fmtJam(x.jam)}${
                          x.keluar
                            ? `, keluar ${fmtJam(x.keluar)}`
                            : x.statusKeluar === "Lupa keluar"
                            ? ", lupa keluar (dihitung 1/3 durasi)"
                            : x.statusKeluar
                            ? ", belum keluar"
                            : ""
                        }`
                      : "belum hadir"
                  }`;
                  return <i key={s.key} className={cls} title={tip} />;
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > PER_PAGE && (
        <nav className="pager" aria-label="Halaman riwayat">
          <button type="button" className="ghost small" onClick={() => setPage(cur - 1)} disabled={cur <= 1}>
            Sebelumnya
          </button>
          <span>{from + 1}–{Math.min(from + PER_PAGE, total)} dari {total}</span>
          <button type="button" className="ghost small" onClick={() => setPage(cur + 1)} disabled={cur >= pages}>
            Berikutnya
          </button>
        </nav>
      )}
    </section>
  );
}
