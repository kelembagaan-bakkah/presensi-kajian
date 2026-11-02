import writeExcelFile from "write-excel-file/node";

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

  const border = { bottomBorderStyle: "thin", bottomBorderColor: "#C8E2D2" };
  const cell = (value, left = false) => ({
    value: String(value),
    ...border,
    align: left ? "left" : "center",
  });

  const head = ["No", "Nama", "Jabatan", "Mulai", "Selesai", "Durasi", "Status"].map((value) => ({
    value,
    fontWeight: "bold",
    textColor: "#FFFFFF",
    backgroundColor: "#00803E",
    align: "center",
    alignVertical: "center",
    height: 22,
  }));

  const sheetData = [
    [{ value: "Riwayat presensi kajian pegawai", fontWeight: "bold", fontSize: 14, textColor: "#052E1B", columnSpan: 7 }, null, null, null, null, null, null],
    [{ value: `${label} (WITA)`, textColor: "#46604F", columnSpan: 7 }, null, null, null, null, null, null],
    [],
    head,
    ...data.rows.map((r, i) => [
      { value: i + 1, ...border, align: "center" },
      cell(r.nama, true),
      cell(r.jabatan || "-", true),
      cell(r.mulai || "-"),
      cell(r.selesai || "-"),
      cell(durasi(r.mulai, r.selesai)),
      cell(r.selesai ? "Selesai" : "Belum selesai"),
    ]),
  ];

  const buffer = await writeExcelFile(sheetData, {
    sheet: "Riwayat",
    stickyRowsCount: 4,
    columns: [6, 30, 22, 10, 10, 12, 16].map((width) => ({ width })),
  }).toBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="riwayat-presensi-${tanggal}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
