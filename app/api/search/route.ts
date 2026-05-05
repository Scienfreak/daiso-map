import { NextRequest } from "next/server";

const DAISO_SEARCH_URL =
  "https://prdm.daisomall.co.kr/ssn/search/FindStoreGoods";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return Response.json({ items: [] });
  }

  const url = new URL(DAISO_SEARCH_URL);
  url.searchParams.set("searchTerm", q.trim());
  url.searchParams.set("cntPerPage", "10");
  url.searchParams.set("pageNum", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      Referer: "https://prdm.daisomall.co.kr/",
    },
  });

  if (!res.ok) {
    return Response.json(
      { error: "Daiso API error", status: res.status },
      { status: 502 }
    );
  }

  const data = await res.json();

  // Extract product list from nested response
  const documents: Record<string, unknown>[] =
    data?.resultSet?.result?.[0]?.resultDocuments ?? [];

  const CDN = "https://cdn.daisomall.co.kr";
  const items = documents.slice(0, 10).map((d) => {
    const rawUrl = String(d["ATCH_FILE_URL"] ?? "");
    const imageUrl = rawUrl ? (rawUrl.startsWith("http") ? rawUrl : `${CDN}${rawUrl}`) : "";
    return {
      pdNo: String(d["PD_NO"] ?? ""),
      pdNm: String(d["PDNM"] ?? ""),
      pdPrc: Number(d["PD_PRC"] ?? 0),
      imageUrl,
    };
  });

  return Response.json({ items });
}
