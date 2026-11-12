/** Pembantu server untuk memanggil Web App Google Apps Script. */
const GAS_URL = process.env.GAS_URL;
const API_KEY = process.env.API_KEY;

export const configured = () => Boolean(GAS_URL && API_KEY);

async function parse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "Respons Apps Script tidak valid. Periksa deployment Web App." };
  }
}

export async function gasGet(params) {
  const q = new URLSearchParams({ ...params, key: API_KEY });
  const res = await fetch(`${GAS_URL}?${q}`, { cache: "no-store", redirect: "follow" });
  return parse(res);
}

export async function gasPost(body) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...body, key: API_KEY }),
    cache: "no-store",
    redirect: "follow",
  });
  return parse(res);
}
