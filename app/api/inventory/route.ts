import { NextRequest } from "next/server";
import type { StoreInfo } from "@/lib/types";

const MAPI_URL = "https://mapi.daisomall.co.kr/ms/msg/newIntSelStr";
const MAPI_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/html, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Content-Type": "application/json",
};

async function fetchPage(
  pdNo: string,
  lat: number,
  lng: number,
  page: number
) {
  const res = await fetch(MAPI_URL, {
    method: "POST",
    headers: MAPI_HEADERS,
    body: JSON.stringify({
      keyword: "",
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
  if (!res.ok) throw new Error(`mapi ${res.status}`);
  return res.json();
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const pdNos: string[] = body.pdNos ?? [];
  const lat: number = body.lat ?? 37.5665;
  const lng: number = body.lng ?? 126.978;

  if (pdNos.length === 0) return Response.json({ stores: [] });

  const storeMap = new Map<string, StoreInfo>();

  await Promise.all(
    pdNos.map(async (pdNo) => {
      let firstData;
      try {
        firstData = await fetchPage(pdNo, lat, lng, 1);
      } catch (e) {
        console.error(`[inventory] pdNo=${pdNo} page 1 failed:`, String(e));
        return;
      }

      const firstStores: RawStore[] = firstData?.data?.msStrVOList ?? [];
      const total: number = firstData?.data?.intStrCont ?? firstStores.length;

      const allStores = [...firstStores];

      if (total > 30) {
        const totalPages = Math.ceil(total / 30);
        const rest = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) =>
            fetchPage(pdNo, lat, lng, i + 2).catch(() => null)
          )
        );
        for (const d of rest) {
          if (d) allStores.push(...(d?.data?.msStrVOList ?? []));
        }
      }

      for (const s of allStores) {
        if (!s.strCd || isNaN(Number(s.strLttd)) || isNaN(Number(s.strLitd)))
          continue;
        if (!storeMap.has(s.strCd)) {
          storeMap.set(s.strCd, {
            strCd: s.strCd,
            strNm: s.strNm,
            strAddr: s.strAddr,
            strTno: s.strTno,
            opngTime: s.opngTime ?? "",
            clsngTime: s.clsngTime ?? "",
            strLttd: Number(s.strLttd),
            strLitd: Number(s.strLitd),
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

type RawStore = {
  strCd: string;
  strNm: string;
  strAddr: string;
  strTno: string;
  opngTime?: string;
  clsngTime?: string;
  strLttd: string | number;
  strLitd: string | number;
  qty: string | number;
};
