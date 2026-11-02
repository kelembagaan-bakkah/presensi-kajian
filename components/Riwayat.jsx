"use client";

import { useEffect, useState } from "react";

const PER_PAGE = 10;
const fmtJam = (j) => (j ? j.replace(":", ".") : "");

export default function Riwayat({ tanggal, today, onTanggal, state, rows, error, onRefresh }) {
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [tanggal]);

  const total = rows.length;
  const selesai = rows.filter((r) => r.selesai).length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const cur = Math.min(page, pages);
  const from = (cur - 1) * PER_PAGE;
  const view = rows.slice(from, from + PER_PAGE);
  const tgl = tanggal || today;

  return (
    <section className="panel history" aria-labelledby="riwayat-judul">
      <div className="history-head">
        <div>
          <h2 id="riwayat-judul">Riwayat presensi</h2>
          <p className="caption">
            {total || state === "ready" ? `${total} sudah mulai, ${selesai} sudah selesai` : "\u00A0"}
          </p>
        </div>
        <div className="history-tools">
          <label className="sr-only" htmlFor="tanggal-riwayat">
            Tanggal riwayat
          </label>
          <input
            id="tanggal-riwayat"
            type="date"
            value={tgl}
            max={today}
            onChange={(e) => e.target.value && onTanggal(e.target.value)}
          />
          <button type="button" className="ghost small" onClick={onRefresh}>
            Segarkan
          </button>
          {total > 0 ? (
            <a className="ghost small solid" href={`/api/presensi/export?tanggal=${tgl}`} download>
              Excel
            </a>
          ) : (
            <button type="button" className="ghost small solid" disabled>
              Excel
            </button>
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
      {state === "ready" && total === 0 && (
        <p className="empty">Belum ada presensi pada tanggal ini.</p>
      )}

      {total > 0 && (
        <ul className="hist-list">
          {view.map((r) => (
            <li key={r.id}>
              <span className="avatar" aria-hidden="true">
                {r.nama.trim().charAt(0).toUpperCase()}
              </span>
              <div className="who">
                <strong>{r.nama}</strong>
                {r.jabatan && <small>{r.jabatan}</small>}
              </div>
              <div className="times">
                <span className={`chip${r.mulai ? " start" : " pending"}`}>
                  <small>Mulai</small>
                  {r.mulai ? fmtJam(r.mulai) : "–"}
                </span>
                <span className={`chip${r.selesai ? " end" : " pending"}`}>
                  <small>Selesai</small>
                  {r.selesai ? fmtJam(r.selesai) : "Belum"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > PER_PAGE && (
        <nav className="pager" aria-label="Halaman riwayat">
          <button
            type="button"
            className="ghost small"
            onClick={() => setPage(cur - 1)}
            disabled={cur <= 1}
          >
            Sebelumnya
          </button>
          <span>
            {from + 1}–{Math.min(from + PER_PAGE, total)} dari {total}
          </span>
          <button
            type="button"
            className="ghost small"
            onClick={() => setPage(cur + 1)}
            disabled={cur >= pages}
          >
            Berikutnya
          </button>
        </nav>
      )}
    </section>
  );
}
