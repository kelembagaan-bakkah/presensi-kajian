import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAS_URL = process.env.GAS_URL;
const API_KEY = process.env.API_KEY;

const toMin = (j) => {
  if (!j) return null;
  const [h, m] = j.split(":").map(Number);
  return h * 60 + m;
};

function durasi(mulai, selesai) {
  const a = toMin(mulai);
  const b = toMin(selesai);
  if (a === null || b === null || b < a) return "-";
  const d = b - a;
  return d >= 60 ? `${Math.floor(d / 60)} j ${d % 60} m` : `${d} m`;
}

function fail(message, status) {
  return Response.json({ ok: false, error: message }, { status });
}

/** GET /api/presensi/export?tanggal=yyyy-mm-dd -> file .xlsx riwayat presensi tanggal tersebut */
export async function GET(request) {
  if (!GAS_URL || !API_KEY) return fail("Server belum dikonfigurasi (GAS_URL / API_KEY).", 500);

  const tanggal = new URL(request.url).searchParams.get("tanggal") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return fail("Tanggal tidak valid.", 400);

  let data;
  try {
    const url = `${GAS_URL}?action=riwayat&tanggal=${tanggal}&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url, { cache: "no-store", redirect: "follow" });
    data = JSON.parse(await res.text());
  } catch {
    return fail("Tidak dapat mengambil data dari spreadsheet.", 502);
  }
  if (!data.ok) return fail(data.error || "Riwayat belum bisa dimuat.", 502);

  const label = new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${tanggal}T00:00:00Z`));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Presensi Kajian Pegawai";
  const ws = wb.addWorksheet("Riwayat", { views: [{ state: "frozen", ySplit: 4 }] });

  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = "Riwayat presensi kajian pegawai";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF052E1B" } };
  ws.mergeCells("A2:G2");
  ws.getCell("A2").value = `${label} (WITA)`;
  ws.getCell("A2").font = { color: { argb: "FF46604F" } };

  const head = ws.getRow(4);
  head.values = ["No", "Nama", "Jabatan", "Mulai", "Selesai", "Durasi", "Status"];
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00803E" } };
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
  head.height = 22;

  data.rows.forEach((r, i) => {
    const row = ws.addRow([
      i + 1,
      r.nama,
      r.jabatan || "-",
      r.mulai || "-",
      r.selesai || "-",
      durasi(r.mulai, r.selesai),
      r.selesai ? "Selesai" : "Belum selesai",
    ]);
    row.eachCell((c, col) => {
      c.border = { bottom: { style: "thin", color: { argb: "FFC8E2D2" } } };
      if (col !== 2 && col !== 3) c.alignment = { horizontal: "center" };
    });
  });

  [6, 30, 22, 10, 10, 12, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="riwayat-presensi-${tanggal}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
