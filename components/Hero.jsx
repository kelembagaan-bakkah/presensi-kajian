import Link from "next/link";

const TABS = [
  { key: "kajian", href: "/", label: "Kajian pegawai" },
  { key: "marbot", href: "/marbot", label: "Marbot masjid" },
];

export default function Hero({ title, place, time, date, active }) {
  return (
    <header className="hero">
      <div className="hero-inner">
        <div className="brand">
          <span className="badge">
            <img src="/logo.png" alt="Logo Yayasan Sa'adah Martapura" width="40" height="40" />
          </span>
          <div>
            <h1>{title}</h1>
            {place && <p className="place">{place}</p>}
          </div>
        </div>
        <div className="clock">
          <time>{time}</time>
          <span>{date}</span>
        </div>
      </div>
      <nav className="tabs" aria-label="Layanan presensi">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={active === t.key ? "on" : ""}
            aria-current={active === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
