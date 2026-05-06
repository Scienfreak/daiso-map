import { NextRequest } from "next/server";
import type { StoreInfo } from "@/lib/types";

type ProxyStore = {
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

export async function POST(request: NextRequest) {
  const body = await request.json();
  const pdNos: string[] = body.pdNos ?? [];
  const lat: number = body.lat ?? 37.5665;
  const lng: number = body.lng ?? 126.978;

  const proxyBase = process.env.INVENTORY_PROXY_URL;

  if (pdNos.length === 0) {
    return Response.json({ stores: [] });
  }

  if (!proxyBase) {
    return Response.json(
      { error: "INVENTORY_PROXY_URL is not set" },
      { status: 503 }
    );
  }

  // Fetch inventory for each product from the proxy, in parallel
  const storeMap = new Map<string, StoreInfo>();

  await Promise.all(
    pdNos.map(async (pdNo) => {
      const url = `${proxyBase}/inventory?pdNo=${encodeURIComponent(pdNo)}&lat=${lat}&lng=${lng}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      const stores: ProxyStore[] = data.stores ?? [];

      for (const s of stores) {
        if (!storeMap.has(s.strCd)) {
          storeMap.set(s.strCd, {
            strCd: s.strCd,
            strNm: s.strNm,
            strAddr: s.strAddr,
            strTno: s.strTno,
            opngTime: s.opngTime,
            clsngTime: s.clsngTime,
            strLttd: s.strLttd,
            strLitd: s.strLitd,
            inventories: {},
          });
        }
        storeMap.get(s.strCd)!.inventories[pdNo] = s.qty;
      }
    })
  );

  const stores = Array.from(storeMap.values());
  return Response.json({ stores, count: stores.length });
}
