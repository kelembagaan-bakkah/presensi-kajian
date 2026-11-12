export const fmtJam = (j) => String(j).replace(":", ".");

export function formatJamTotal(menit) {
  const j = menit / 60;
  return `${Number.isInteger(j) ? j : j.toFixed(1).replace(".", ",")} jam`;
}

/**
 * Sesi yang bisa dipresensi sekarang. Aturan sama dengan server:
 * sesi terbuka = dari (mulai - buka) sampai selesai; pilih sesi terbuka paling awal yang belum dipresensi.
 */
export function sesiTerbuka(jadwal, nowMin, buka, sudah) {
  let terbuka = false;
  for (const s of jadwal) {
    if (nowMin >= s.startMin - buka && nowMin < s.endMin) {
      terbuka = true;
      if (!sudah[s.key]) return { state: "aktif", sesi: s };
    }
  }
  if (terbuka) return { state: "sudah" };
  const next = jadwal.find((s) => s.startMin - buka > nowMin);
  return next ? { state: "nanti", sesi: next } : { state: "selesai" };
}
