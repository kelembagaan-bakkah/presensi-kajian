/**
 * Peta radar sederhana: titik pusat = lokasi kajian, lingkaran putus-putus = radius presensi,
 * titik emas = posisi pegawai. Skala otomatis menyesuaikan jarak.
 */
export default function Radar({ radius, point, inRange, label }) {
  const S = 300;
  const C = S / 2;
  const R = 132;

  const dist = point ? Math.hypot(point.dx, point.dy) : 0;
  const view = Math.max(radius * 2.4, dist * 1.12);
  const k = R / view;
  const ring = radius * k;
  const ux = point ? C + point.dx * k : C;
  const uy = point ? C - point.dy * k : C;

  return (
    <svg className="radar" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={label}>
      {[0.33, 0.66, 1].map((f) => (
        <circle key={f} className="r-guide" cx={C} cy={C} r={R * f} />
      ))}
      <line className="r-guide" x1={C - R} y1={C} x2={C + R} y2={C} />
      <line className="r-guide" x1={C} y1={C - R} x2={C} y2={C + R} />
      <text className="r-north" x={C} y={C - R - 8} textAnchor="middle">
        U
      </text>

      <circle className={`r-fence${inRange ? " in" : ""}`} cx={C} cy={C} r={ring} />
      <text className="r-ring" x={C} y={C - ring - 7} textAnchor="middle">
        {radius} m
      </text>

      <path
        className="r-center"
        d={`M ${C} ${C - 7} L ${C + 7} ${C} L ${C} ${C + 7} L ${C - 7} ${C} Z`}
      />

      {point && (
        <g>
          <line className="r-link" x1={C} y1={C} x2={ux} y2={uy} />
          <circle className="r-pulse" cx={ux} cy={uy} r="7" />
          <circle className={`r-user${inRange ? " in" : ""}`} cx={ux} cy={uy} r="7" />
        </g>
      )}
    </svg>
  );
}
