import { NextRequest } from "next/server";
import type { StoreInfo } from "@/lib/types";

const MAPI_URL = "https://mapi.daisomall.co.kr/ms/msg/newIntSelStr";

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

async function fetchPage(
  pdNo: string,
  lat: number,
  lng: number,
  intCd: string,
  page: number
): Promise<{ data?: { msStrVOList?: RawStore[]; intStrCont?: number } }> {
  const res = await fetch(MAPI_URL, {
    method: "POST",
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "ko-KR,ko;q=0.9",
      "content-type": "application/json",
      "origin": "https://prdm.daisomall.co.kr",
      "referer": "https://prdm.daisomall.co.kr/",
      "user-agent":
        "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    },
    body: JSON.stringify({
      keyword: "",
      pdNo,
      curLttd: lat,
      curLitd: lng,
      geolocationAgrYn: "Y",
      pkupYn: "",
      intCd,
      pageSize: 30,
      currentPage: page,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`mapi ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const pdNos: string[] = body.pdNos ?? [];
  const lat: number = body.lat ?? 37.5665;
  const lng: number = body.lng ?? 126.978;
  const districtCode: string = body.districtCode ?? "";

  if (pdNos.length === 0) return Response.json({ stores: [] });

  const storeMap = new Map<string, StoreInfo>();

  await Promise.all(
    pdNos.map(async (pdNo) => {
      const first = await fetchPage(pdNo, lat, lng, districtCode, 1);
      const list: RawStore[] = first?.data?.msStrVOList ?? [];
      const total: number = first?.data?.intStrCont ?? list.length;
      const all = [...list];

      if (total > 30) {
        const pages = Math.ceil(total / 30);
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) =>
            fetchPage(pdNo, lat, lng, districtCode, i + 2)
          )
        );
        for (const r of rest) all.push(...(r?.data?.msStrVOList ?? []));
      }

      for (const s of all) {
        if (!s.strCd || isNaN(Number(s.strLttd)) || isNaN(Number(s.strLitd))) continue;
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
