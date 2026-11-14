import { NextResponse } from "next/server";
import { configured, gasPost } from "../../../../lib/gas";

export const dynamic = "force-dynamic";

/** POST /api/presensi/cari { pin } -> { ok, pegawai: [{ id, nama, jabatan }] }
 *  Hanya pegawai dengan PIN yang cocok yang dikembalikan. PIN dikirim lewat body (bukan URL). */
export async function POST(request) {
  if (!configured()) {
    return NextResponse.json({ ok: false, error: "Server belum dikonfigurasi (GAS_URL / API_KEY)." }, { status: 500 });
  }
  try {
    const b = await request.json();
    const client =
      request.headers.get("x-real-ip") ||
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "anon";
    const data = await gasPost({ action: "cari_pegawai", pin: b.pin, client });
    return NextResponse.json(data, { status: data.ok ? 200 : 400 });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Nama belum bisa dicari. Periksa koneksi lalu coba lagi." },
      { status: 502 }
    );
  }
}
