import { NextRequest } from "next/server";
import type { StoreInfo } from "@/lib/types";

const DAISO_INVENTORY_URL = "https://mapi.daisomall.co.kr/ms/msg/newIntSelStr";
const DAISO_WEB_URL = "https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?tab=tab2";

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

// Cache session cookie so we don't fetch the page on every request
let cachedCookie = "";
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getSessionCookie(): Promise<string> {
  if (cachedCookie && Date.now() - cookieFetchedAt < COOKIE_TTL_MS) {
    return cachedCookie;
  }
  try {
    const res = await fetch(DAISO_WEB_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
    });
    const raw = res.headers.get("set-cookie") ?? "";
    // Extract cookie name=value pairs, strip directives
    cachedCookie = raw
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    cookieFetchedAt = Date.now();
  } catch {
    cachedCookie = "";
  }
  return cachedCookie;
}

async function fetchInventoryPage(
  pdNo: string,
  lat: number,
  lng: number,
  page: number,
  cookie: string
): Promise<{ stores: DaisoStore[]; total: number }> {
  const res = await fetch(DAISO_INVENTORY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      Origin: "https://prdm.daisomall.co.kr",
      Referer: "https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?tab=tab2",
      ...(cookie ? { Cookie: cookie } : {}),
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

  const cookie = await getSessionCookie();
  const storeMap = new Map<string, StoreInfo>();

  await Promise.all(
    pdNos.map(async (pdNo) => {
      const { stores: firstPage, total } = await fetchInventoryPage(pdNo, lat, lng, 1, cookie);
      const allStores = [...firstPage];

      if (total > 30) {
        const totalPages = Math.ceil(total / 30);
        const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        const rest = await Promise.all(
          remainingPages.map((p) => fetchInventoryPage(pdNo, lat, lng, p, cookie))
        );
        for (const { stores } of rest) allStores.push(...stores);
      }

      for (const s of allStores) {
        const storeLat = Number(s.strLttd);
        const storeLng = Number(s.strLitd);
        if (!s.strCd || isNaN(storeLat) || isNaN(storeLng)) continue;
        if (!storeMap.has(s.strCd)) {
          storeMap.set(s.strCd, {
            strCd: s.strCd,
            strNm: s.strNm,
            strAddr: s.strAddr,
            strTno: s.strTno,
            opngTime: s.opngTime ?? "",
            clsngTime: s.clsngTime ?? "",
            strLttd: storeLat,
            strLitd: storeLng,
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
