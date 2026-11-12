import { NextResponse } from "next/server";
import { configured, gasGet, gasPost } from "../../../lib/gas";

export const dynamic = "force-dynamic";

const notConfigured = () =>
  NextResponse.json({ ok: false, error: "Server belum dikonfigurasi (GAS_URL / API_KEY)." }, { status: 500 });

/** GET /api/marbot                                    -> lokasi, daftar marbot, jadwal sesi
 *  GET /api/marbot?action=riwayat&tanggal=yyyy-mm-dd  -> riwayat presensi marbot per tanggal */
export async function GET(request) {
  if (!configured()) return notConfigured();
  try {
    const sp = new URL(request.url).searchParams;
    const isRiwayat = sp.get("action") === "riwayat";
    const params = { action: isRiwayat ? "marbot_riwayat" : "marbot_init" };
    const tanggal = sp.get("tanggal") || "";
    if (isRiwayat && /^\d{4}-\d{2}-\d{2}$/.test(tanggal)) params.tanggal = tanggal;
    const data = await gasGet(params);
    return NextResponse.json(data, { status: data.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false, error: "Tidak dapat terhubung ke spreadsheet." }, { status: 502 });
  }
}

export async function POST(request) {
  if (!configured()) return notConfigured();
  try {
    const b = await request.json();
    const data = await gasPost({
      action: "marbot_presensi",
      id: b.id,
      pin: b.pin,
      lat: b.lat,
      lng: b.lng,
      akurasi: b.akurasi,
    });
    return NextResponse.json(data, { status: data.ok ? 200 : 400 });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Presensi gagal dikirim. Periksa koneksi lalu coba lagi." },
      { status: 502 }
    );
  }
}
