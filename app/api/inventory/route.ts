import { NextRequest } from "next/server";
import type { StoreInfo } from "@/lib/types";

const DAISO_INVENTORY_URL =
  "https://mapi.daisomall.co.kr/ms/msg/newIntSelStr";

type DaisoStore = {
  strCd: string;
  strNm: string;
  strAddr: string;
  strTno: string;
  opngTime: string;
  clsngTime: string;
  strLttd: number;
  strLitd: number;
  qty: number;
};

async function fetchInventoryPage(
  pdNo: string,
  lat: number,
  lng: number,
  page: number
): Promise<{ stores: DaisoStore[]; total: number }> {
  const res = await fetch(DAISO_INVENTORY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      Referer: "https://prdm.daisomall.co.kr/",
    },
    body: JSON.stringify({
      pdNo,
      curLttd: lat,
      curLitd: lng,
      geolocationAgrYn: "Y",
      pkupYn: "",
      intCd: "",
      pageSize: 30,
      currentPage: page,
    }),
  });

  if (!res.ok) return { stores: [], total: 0 };

  const data = await res.json();
  const stores: DaisoStore[] = data?.data?.msStrVOList ?? [];
  const total: number = data?.data?.intStrCont ?? stores.length;
  return { stores, total };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const pdNos: string[] = body.pdNos ?? [];
  const lat: number = body.lat ?? 37.5665;
  const lng: number = body.lng ?? 126.978;

  if (pdNos.length === 0) {
    return Response.json({ stores: [] });
  }

  // For each product: fetch page 1 to get total, then fetch remaining pages
  const storeMap = new Map<string, StoreInfo>();

  await Promise.all(
    pdNos.map(async (pdNo) => {
      const { stores: firstPage, total } = await fetchInventoryPage(
        pdNo,
        lat,
        lng,
        1
      );

      const allStores = [...firstPage];

      if (total > 30) {
        const totalPages = Math.ceil(total / 30);
        const remainingPages = Array.from(
          { length: totalPages - 1 },
          (_, i) => i + 2
        );
        const rest = await Promise.all(
          remainingPages.map((p) => fetchInventoryPage(pdNo, lat, lng, p))
        );
        for (const { stores } of rest) allStores.push(...stores);
      }

      for (const s of allStores) {
        const lat = Number(s.strLttd);
        const lng = Number(s.strLitd);
        if (!s.strCd || isNaN(lat) || isNaN(lng)) continue;
        if (!storeMap.has(s.strCd)) {
          storeMap.set(s.strCd, {
            strCd: s.strCd,
            strNm: s.strNm,
            strAddr: s.strAddr,
            strTno: s.strTno,
            opngTime: s.opngTime ?? "",
            clsngTime: s.clsngTime ?? "",
            strLttd: lat,
            strLitd: lng,
            inventories: {},
          });
        }
        storeMap.get(s.strCd)!.inventories[pdNo] = Number(s.qty) || 0;
      }
    })
  );

  const stores = Array.from(storeMap.values());
  return Response.json({ stores, count: stores.length });
}
