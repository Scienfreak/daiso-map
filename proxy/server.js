const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3001;

const DAISO_PAGE_URL =
  "https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?tab=tab2";
const INVENTORY_URL =
  "https://mapi.daisomall.co.kr/ms/msg/newIntSelStr";

// Cache store results per product to avoid launching browser on every request
const cache = new Map(); // pdNo -> { stores, expiresAt }
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchInventoryWithBrowser(pdNo, lat, lng) {
  console.log(`[proxy] Launching browser for pdNo=${pdNo}`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      locale: "ko-KR",
    });
    const page = await context.newPage();

    // Navigate to Daiso site — the browser gets proper auth context here
    await page.goto(DAISO_PAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    // Call the inventory API from WITHIN the browser (uses browser's auth context)
    const firstResult = await page.evaluate(
      async ({ url, body }) => {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          return { ok: res.ok, status: res.status, data };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      },
      {
        url: INVENTORY_URL,
        body: {
          pdNo,
          curLttd: lat,
          curLitd: lng,
          geolocationAgrYn: "Y",
          pkupYn: "",
          intCd: "",
          pageSize: 30,
          currentPage: 1,
        },
      }
    );

    if (!firstResult.ok) {
      throw new Error(
        `Daiso API returned ${firstResult.status ?? firstResult.error}`
      );
    }

    const firstStores = firstResult.data?.data?.msStrVOList ?? [];
    const total = firstResult.data?.data?.intStrCont ?? firstStores.length;
    const allStores = [...firstStores];

    // Fetch remaining pages if needed
    if (total > 30) {
      const totalPages = Math.ceil(total / 30);
      for (let p = 2; p <= totalPages; p++) {
        const result = await page.evaluate(
          async ({ url, body }) => {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            return res.json();
          },
          {
            url: INVENTORY_URL,
            body: {
              pdNo,
              curLttd: lat,
              curLitd: lng,
              geolocationAgrYn: "Y",
              pkupYn: "",
              intCd: "",
              pageSize: 30,
              currentPage: p,
            },
          }
        );
        allStores.push(...(result?.data?.msStrVOList ?? []));
      }
    }

    console.log(`[proxy] Got ${allStores.length} stores (total=${total})`);
    return allStores;
  } finally {
    await browser.close();
    console.log("[proxy] Browser closed");
  }
}

function normalizeStores(rawStores) {
  return rawStores
    .filter(
      (s) =>
        s.strCd && !isNaN(Number(s.strLttd)) && !isNaN(Number(s.strLitd))
    )
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
}

// GET /inventory?pdNo=xxx&lat=37.5&lng=126.9
app.get("/inventory", async (req, res) => {
  const pdNo = req.query.pdNo;
  const lat = parseFloat(req.query.lat) || 37.5665;
  const lng = parseFloat(req.query.lng) || 126.978;

  if (!pdNo) {
    return res.status(400).json({ error: "pdNo is required" });
  }

  const cached = cache.get(pdNo);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[proxy] Cache hit for pdNo=${pdNo}`);
    return res.json({ stores: cached.stores, count: cached.stores.length });
  }

  try {
    const rawStores = await fetchInventoryWithBrowser(pdNo, lat, lng);
    const stores = normalizeStores(rawStores);
    cache.set(pdNo, { stores, expiresAt: Date.now() + CACHE_TTL });
    res.json({ stores, count: stores.length });
  } catch (err) {
    console.error("[proxy] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[proxy] Listening on port ${PORT}`);
});
