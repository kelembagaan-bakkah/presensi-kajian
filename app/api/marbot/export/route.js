import ExcelJS from "exceljs";
import { configured, gasGet } from "../../../../lib/gas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (message, status) => Response.json({ ok: false, error: message }, { status });
const jam = (j) => String(j).replace(":", ".");

function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00803E" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 28;
}

function title(ws, cols, text, sub) {
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = text;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF052E1B" } };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = sub;
  ws.getCell(2, 1).font = { color: { argb: "FF46604F" } };
}

/** GET /api/marbot/export?tanggal=yyyy-mm-dd -> .xlsx dengan sheet Ringkasan dan Detail */
export async function GET(request) {
  if (!configured()) return fail("Server belum dikonfigurasi (GAS_URL / API_KEY).", 500);
  const tanggal = new URL(request.url).searchParams.get("tanggal") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return fail("Tanggal tidak valid.", 400);

  let data;
  try {
    data = await gasGet({ action: "marbot_riwayat", tanggal });
  } catch {
    return fail("Tidak dapat mengambil data dari spreadsheet.", 502);
  }
  if (!data.ok) return fail(data.error || "Riwayat belum bisa dimuat.", 502);

  const label = new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${tanggal}T00:00:00Z`));
  const sub = `${label} (WITA)`;
  const { jadwal, rows, totalMenit } = data;
  const byKey = Object.fromEntries(jadwal.map((s) => [s.key, s]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Presensi Kajian Pegawai";

  /* Sheet 1: ringkasan per marbot */
  const rs = wb.addWorksheet("Ringkasan", { views: [{ state: "frozen", ySplit: 4 }] });
  title(rs, 8, "Presensi marbot masjid", sub);
  const h1 = rs.getRow(4);
  h1.values = ["No", "Nama", "Sesi hadir", "Tepat waktu", "Terlambat", "Menit dikreditkan", "Target menit", "Persentase"];
  styleHeader(h1);
  rows.forEach((r, i) => {
    const telat = r.sesi.filter((x) => x.status === "Terlambat").length;
    const row = rs.addRow([
      i + 1, r.nama, `${r.sesi.length} dari ${jadwal.length}`,
      r.sesi.length - telat, telat, r.menit, totalMenit, totalMenit ? r.menit / totalMenit : 0,
    ]);
    row.getCell(8).numFmt = "0%";
    row.eachCell((c, col) => {
      c.border = { bottom: { style: "thin", color: { argb: "FFC8E2D2" } } };
      if (col !== 2) c.alignment = { horizontal: "center" };
    });
  });
  [6, 30, 14, 13, 12, 18, 14, 13].forEach((w, i) => (rs.getColumn(i + 1).width = w));

  /* Sheet 2: detail per sesi */
  const ds = wb.addWorksheet("Detail", { views: [{ state: "frozen", ySplit: 4 }] });
  title(ds, 8, "Detail presensi marbot per sesi", sub);
  const h2 = ds.getRow(4);
  h2.values = ["No", "Nama", "Shift", "Kegiatan", "Jadwal sesi", "Jam hadir", "Status", "Menit dikreditkan"];
  styleHeader(h2);
  let n = 0;
  rows.forEach((r) => {
    [...r.sesi]
      .sort((a, b) => (byKey[a.key]?.startMin ?? 0) - (byKey[b.key]?.startMin ?? 0))
      .forEach((x) => {
        const s = byKey[x.key];
        const row = ds.addRow([
          ++n, r.nama, s?.shift ? Number(s.shift) || s.shift : "-", s?.kegiatan || "-",
          s ? `${jam(s.mulai)} - ${jam(s.selesai)}` : jam(x.key),
          jam(x.jam), x.status, x.menit,
        ]);
        row.eachCell((c, col) => {
          c.border = { bottom: { style: "thin", color: { argb: "FFC8E2D2" } } };
          if (col !== 2 && col !== 4) c.alignment = { horizontal: "center" };
        });
      });
  });
  [6, 30, 8, 22, 16, 11, 13, 18].forEach((w, i) => (ds.getColumn(i + 1).width = w));

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="presensi-marbot-${tanggal}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
