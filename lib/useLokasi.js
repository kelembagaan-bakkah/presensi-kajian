"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { haversine, offsetMeters } from "./geo";

const SAMPLE_WINDOW_MS = 15000; // pembacaan GPS yang digabung

function geoMessage(err) {
  if (err.code === 1)
    return "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser, lalu cari lokasi lagi.";
  if (err.code === 2) return "Lokasi tidak tersedia. Pastikan GPS perangkat menyala.";
  return "Pencarian lokasi terlalu lama. Coba lagi di area terbuka.";
}

export function formatDistance(m) {
  return m < 10 ? m.toFixed(1).replace(".", ",") : String(Math.round(m));
}

export function accLabel(acc, max) {
  if (acc <= 20) return "baik";
  if (acc <= max) return "cukup";
  return "lemah";
}

/**
 * Gabungkan pembacaan GPS terbaru: rata-rata berbobot 1/akurasi², sehingga pembacaan kasar
 * (Wi-Fi/jaringan) hampir tidak berpengaruh. Akurasi yang dilaporkan = akurasi terbaik (konservatif).
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

/** Hook lokasi dipakai bersama oleh presensi kajian dan presensi marbot. */
export default function useLokasi(cfg, bootError = false) {
  const [geo, setGeo] = useState({ state: "loading", pos: null, error: "" });
  const watchRef = useRef(null);
  const samplesRef = useRef([]);

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
    if (bootError) return { tone: "bad", text: "Data presensi belum termuat." };
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
    if (inRange) return { tone: "ok", text: "Anda berada di dalam area masjid." };
    return {
      tone: "warn",
      text: `Mendekatlah sekitar ${Math.ceil(metrics.dist - limit)} m lagi ke titik masjid.`,
    };
  })();

  const radarLabel = metrics
    ? `Posisi Anda ${Math.round(metrics.dist)} meter dari titik masjid, batas ${limit} meter.`
    : "Menunggu posisi Anda.";

  return { geo, startWatch, metrics, limit, inRange, accOk, status, radarLabel };
}
