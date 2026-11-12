import Radar from "./Radar";
import { accLabel, formatDistance } from "../lib/useLokasi";

export default function LokasiCard({ cfg, lokasi }) {
  const { geo, startWatch, metrics, limit, inRange, status, radarLabel } = lokasi;
  return (
    <section className="panel loc" aria-live="polite">
      <Radar radius={limit} point={metrics} inRange={inRange} label={radarLabel} />
      <div className="readout">
        <div className="big">
          {metrics ? formatDistance(metrics.dist) : "–"}
          <span> m</span>
        </div>
        <p className="caption">{cfg ? `dari titik masjid, batas ${limit} m` : "dari titik masjid"}</p>
        {metrics && (
          <p className="acc">
            Akurasi GPS ±{Math.round(metrics.acc)} m ({accLabel(metrics.acc, cfg.maxAkurasi)})
          </p>
        )}
        <button type="button" className="ghost small" onClick={startWatch}>
          {geo.state === "denied" || geo.state === "error" ? "Cari lokasi lagi" : "Perbarui lokasi"}
        </button>
      </div>
      <p className={`status ${status.tone}`}>
        <i aria-hidden="true" />
        {status.text}
      </p>
    </section>
  );
}
