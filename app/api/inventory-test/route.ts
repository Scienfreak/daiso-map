import { NextRequest } from "next/server";

// GET /api/inventory-test?pdNo=1034604
export async function GET(request: NextRequest) {
  const pdNo = request.nextUrl.searchParams.get("pdNo") ?? "1034604";
  const proxyBase = process.env.INVENTORY_PROXY_URL;

  if (!proxyBase) {
    return Response.json({ error: "INVENTORY_PROXY_URL not set in .env.local" });
  }

  const url = `${proxyBase}/inventory?pdNo=${encodeURIComponent(pdNo)}&lat=37.5665&lng=126.978`;

  let status = 0;
  let raw: unknown = null;
  try {
    const res = await fetch(url);
    status = res.status;
    raw = await res.json();
  } catch (e) {
    raw = String(e);
  }

  return Response.json({ proxyUrl: url, status, raw });
}
