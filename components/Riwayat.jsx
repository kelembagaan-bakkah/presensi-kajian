const fmtJam = (j) => (j ? j.replace(":", ".") : "");

export default function Riwayat({ tanggal, today, onTanggal, state, rows, error, onRefresh }) {
  const mulai = rows.length;
  const selesai = rows.filter((r) => r.selesai).length;

  return (
    <section className="panel history" aria-labelledby="riwayat-judul">
      <div className="history-head">
        <div>
          <h2 id="riwayat-judul">Riwayat presensi</h2>
          <p className="caption">
            {state === "ready" || rows.length
              ? `${mulai} pegawai sudah mulai, ${selesai} sudah selesai`
              : "\u00A0"}
          </p>
        </div>
        <div className="history-tools">
          <label className="sr-only" htmlFor="tanggal-riwayat">
            Tanggal riwayat
          </label>
          <input
            id="tanggal-riwayat"
            type="date"
            value={tanggal || today}
            max={today}
            onChange={(e) => e.target.value && onTanggal(e.target.value)}
          />
          <button type="button" className="ghost" onClick={onRefresh}>
            Segarkan
          </button>
        </div>
      </div>

      {state === "loading" && !rows.length && <p className="empty">Memuat riwayat…</p>}
      {state === "error" && (
        <div className="notice err" role="alert">
          <strong>Riwayat belum termuat</strong>
          <p>{error}</p>
        </div>
      )}
      {state === "ready" && rows.length === 0 && (
        <p className="empty">Belum ada presensi pada tanggal ini. Pegawai yang sudah presensi mulai akan tampil di sini.</p>
      )}

      {rows.length > 0 && (
        <ul className="hist-list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="who">
                <span className="avatar" aria-hidden="true">
                  {r.nama.trim().charAt(0).toUpperCase()}
                </span>
                <div>
                  <strong>{r.nama}</strong>
                  {r.jabatan && <small>{r.jabatan}</small>}
                </div>
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
    </section>
  );
}
