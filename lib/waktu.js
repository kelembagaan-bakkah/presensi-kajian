export const TZ = "Asia/Makassar"; // WITA

export const fmtTime = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
export const fmtDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric",
});
export const fmtIso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }); // yyyy-mm-dd

const fmtParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Menit sejak 00.00 WITA (pecahan) untuk sebuah waktu. */
export function menitHariIni(date) {
  const p = Object.fromEntries(fmtParts.formatToParts(date).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
}
