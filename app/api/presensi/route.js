import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GAS_URL = process.env.GAS_URL;
const API_KEY = process.env.API_KEY;

function misconfigured() {
  return NextResponse.json(
    { ok: false, error: "Server belum dikonfigurasi (GAS_URL / API_KEY)." },
    { status: 500 }
  );
}

async function readGas(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "Respons Apps Script tidak valid. Periksa deployment Web App." };
  }
}

export async function GET() {
  if (!GAS_URL || !API_KEY) return misconfigured();
  try {
    const url = `${GAS_URL}?action=init&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url, { cache: "no-store", redirect: "follow" });
    const data = await readGas(res);
    return NextResponse.json(data, { status: data.ok ? 200 : 502 });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Tidak dapat terhubung ke spreadsheet." },
      { status: 502 }
    );
  }
}

export async function POST(request) {
  if (!GAS_URL || !API_KEY) return misconfigured();
  try {
    const body = await request.json();
    const payload = {
      action: "presensi",
      key: API_KEY,
      id: body.id,
      pin: body.pin,
      jenis: body.jenis,
      lat: body.lat,
      lng: body.lng,
      akurasi: body.akurasi,
    };
    const res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "follow",
    });
    const data = await readGas(res);
    return NextResponse.json(data, { status: data.ok ? 200 : 400 });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Presensi gagal dikirim. Periksa koneksi lalu coba lagi." },
      { status: 502 }
    );
  }
}
