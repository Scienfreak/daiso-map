import { NextRequest } from "next/server";

// GET /api/inventory-test?pdNo=1034604
export async function GET(request: NextRequest) {
  const pdNo = request.nextUrl.searchParams.get("pdNo") ?? "1034604";

  const url = `https://mcp.aka.page/api/actions/query?action=daisoCheckInventory&productId=${pdNo}&lat=37.5665&lng=126.978`;

  let status = 0;
  let raw: unknown = null;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    status = res.status;
    const text = await res.text();
    try { raw = JSON.parse(text); } catch { raw = text; }
  } catch (e) {
    raw = String(e);
  }

  return Response.json({ source: "mcp.aka.page", status, raw });
}
