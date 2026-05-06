const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3001;

const DAISO_PAGE_URL =
  "https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?tab=tab2";
const DAISO_INVENTORY_URL =
  "https://mapi.daisomall.co.kr/ms/msg/newIntSelStr";

// Cached session headers extracted from a real browser visit
let sessionCache = {
  headers: null,
  expiresAt: 0,
};
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getSessionHeaders() {
  if (sessionCache.headers && Date.now() < sessionCache.expiresAt) {
    return sessionCache.headers;
  }

  console.log("[proxy] Launching browser to extract session...");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
  });

  let capturedHeaders = null;

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      locale: "ko-KR",
    });
    const page = await context.newPage();

    // Intercept any request to mapi to capture real headers
    page.on("request", (req) => {
      if (req.url().includes("mapi.daisomall.co.kr")) {
        capturedHeaders = req.headers();
        console.log("[proxy] Captured mapi request headers");
      }
    });

    await page.goto(DAISO_PAGE_URL, { waitUntil: "networkidle", timeout: 30000 });

    // If no mapi request triggered automatically, extract cookies manually
    if (!capturedHeaders) {
      const cookies = await context.cookies();
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      capturedHeaders = {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        accept: "application/json, text/plain, */*",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        origin: "https://prdm.daisomall.co.kr",
        referer: "https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?tab=tab2",
        ...(cookieStr ? { cookie: cookieStr } : {}),
      };
      console.log("[proxy] No mapi request intercepted, using page cookies");
    }
  } finally {
    await browser.close();
    console.log("[proxy] Browser closed");
  }

  sessionCache.headers = capturedHeaders;
  sessionCache.expiresAt = Date.now() + SESSION_TTL_MS;
  return capturedHeaders;
}

async function fetchInventoryPage(pdNo, lat, lng, page, headers) {
  const res = await fetch(DAISO_INVENTORY_URL, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
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

  if (!res.ok) {
    console.error(`[proxy] mapi returned ${res.status}`);
    return { stores: [], total: 0, httpStatus: res.status };
  }

  const data = await res.json();
  const stores = data?.data?.msStrVOList ?? [];
  const total = data?.data?.intStrCont ?? stores.length;
  return { stores, total, httpStatus: 200 };
}

// GET /inventory?pdNo=xxx&lat=37.5&lng=126.9&page=1
// Returns all pages merged by default; pass page= for a single page
app.get("/inventory", async (req, res) => {
  const pdNo = req.query.pdNo;
  const lat = parseFloat(req.query.lat) || 37.5665;
  const lng = parseFloat(req.query.lng) || 126.978;

  if (!pdNo) {
    return res.status(400).json({ error: "pdNo is required" });
  }

  try {
    const headers = await getSessionHeaders();

    const { stores: firstPage, total, httpStatus } = await fetchInventoryPage(
      pdNo, lat, lng, 1, headers
    );

    if (httpStatus !== 200) {
      // Session might be stale — invalidate and retry once
      sessionCache.headers = null;
      sessionCache.expiresAt = 0;
      const freshHeaders = await getSessionHeaders();
      const retry = await fetchInventoryPage(pdNo, lat, lng, 1, freshHeaders);
      if (retry.httpStatus !== 200) {
        return res.status(502).json({ error: "Daiso API unavailable", httpStatus: retry.httpStatus });
      }
      return sendStores(res, pdNo, lat, lng, retry.stores, retry.total, freshHeaders);
    }

    return sendStores(res, pdNo, lat, lng, firstPage, total, headers);
  } catch (err) {
    console.error("[proxy] Error:", err);
    res.status(500).json({ error: String(err) });
  }
});

async function sendStores(res, pdNo, lat, lng, firstPage, total, headers) {
  const allStores = [...firstPage];

  if (total > 30) {
    const totalPages = Math.ceil(total / 30);
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        fetchInventoryPage(pdNo, lat, lng, i + 2, headers)
      )
    );
    for (const { stores } of rest) allStores.push(...stores);
  }

  const normalized = allStores
    .filter((s) => s.strCd && !isNaN(Number(s.strLttd)) && !isNaN(Number(s.strLitd)))
    .map((s) => ({
      strCd: s.strCd,
      strNm: s.strNm,
      strAddr: s.strAddr,
      strTno: s.strTno,
      opngTime: s.opngTime ?? "",
      clsngTime: s.clsngTime ?? "",
      strLttd: Number(s.strLttd),
      strLitd: Number(s.strLitd),
      qty: Number(s.qty) || 0,
    }));

  res.json({ stores: normalized, count: normalized.length });
}

// Health check
app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[proxy] Listening on port ${PORT}`);
});
