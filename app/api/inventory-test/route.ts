import { NextRequest } from "next/server";

const DAISO_WEB_URL = "https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?tab=tab2";

// GET /api/inventory-test?pdNo=1034604
export async function GET(request: NextRequest) {
  const pdNo = request.nextUrl.searchParams.get("pdNo") ?? "1034604";

  // Step 1: get session cookie
  let cookie = "";
  let cookieDebug = "";
  try {
    const webRes = await fetch(DAISO_WEB_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
    });
    const raw = webRes.headers.get("set-cookie") ?? "";
    cookie = raw
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    cookieDebug = cookie ? cookie.slice(0, 60) + "..." : "(없음)";
  } catch (e) {
    cookieDebug = `쿠키 오류: ${e}`;
  }

  // Step 2: call inventory API with cookie
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
      ...(cookie ? { Cookie: cookie } : {}),
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

  return Response.json({ cookieDebug, status, raw: parsed ?? text });
}
