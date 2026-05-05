import { NextRequest } from "next/server";

// GET /api/inventory-test?pdNo=1234567
// 브라우저에서 직접 호출해서 다이소 재고 API 응답을 확인할 수 있는 테스트 엔드포인트
export async function GET(request: NextRequest) {
  const pdNo = request.nextUrl.searchParams.get("pdNo") ?? "1034604";

  const res = await fetch("https://mapi.daisomall.co.kr/ms/msg/newIntSelStr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      Origin: "https://prdm.daisomall.co.kr",
      Referer: "https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?tab=tab2",
    },
    body: JSON.stringify({
      pdNo,
      curLttd: 37.5665,
      curLitd: 126.978,
      geolocationAgrYn: "Y",
      pkupYn: "",
      intCd: "",
      pageSize: 5,
      currentPage: 1,
    }),
  });

  const status = res.status;
  const text = await res.text();

  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* not json */ }

  return Response.json({ status, raw: parsed ?? text });
}
