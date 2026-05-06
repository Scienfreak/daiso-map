const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3001;

const DAISO_PAGE_URL =
  "https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?tab=tab2";
const INVENTORY_URL =
  "https://mapi.daisomall.co.kr/ms/msg/newIntSelStr";

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

// Only one browser at a time (Render.com free tier: 512MB)
let browserBusy = false;
const browserWaiters = [];

function acquireBrowser() {
  if (!browserBusy) {
    browserBusy = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => browserWaiters.push(resolve));
}

function releaseBrowser() {
  if (browserWaiters.length > 0) {
    browserWaiters.shift()();
  } else {
    browserBusy = false;
  }
}

// Deduplicate in-flight fetches for the same pdNo
const inFlight = new Map();

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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "ko-KR",
    });
    const page = await context.newPage();

    // Visit Daiso page to establish Cloudflare session + cookies
    await page.goto(DAISO_PAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for Cloudflare challenge to complete and cookies to be set
    await page.waitForTimeout(5000);
    console.log("[proxy] Page loaded, cookies established");

    // Use browser's fetch: Chrome TLS fingerprint + Cloudflare cookies included automatically
    async function browserFetch(currentPage) {
      return page.evaluate(
        async ({ url, body }) => {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(body),
            });
            const data = await res.json();
            return { ok: res.ok, status: res.status, data };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        },
        {
          url,
          body: {
            keyword: "",
            pdNo,
            curLttd: lat,
            curLitd: lng,
            geolocationAgrYn: "Y",
            pkupYn: "",
            intCd: "",
            pageSize: 30,
            currentPage,
          },
        }
      );
    }

    const first = await browserFetch(1);
    console.log(`[proxy] page 1 status=${first.status}, ok=${first.ok}`);

    if (!first.ok) {
      throw new Error(`Daiso API returned ${first.status ?? first.error}`);
    }

    const stores = first.data?.data?.msStrVOList ?? [];
    const total = first.data?.data?.intStrCont ?? stores.length;
    console.log(`[proxy] total=${total}, page1 stores=${stores.length}`);

    const allStores = [...stores];

    if (total > 30) {
      const totalPages = Math.ceil(total / 30);
      for (let p = 2; p <= totalPages; p++) {
        const r = await browserFetch(p);
        allStores.push(...(r?.data?.data?.msStrVOList ?? []));
      }
    }

    return allStores;
  } finally {
    await browser.close();
    releaseBrowser();
    console.log("[proxy] Browser closed");
  }
}

function normalizeStores(rawStores) {
  return rawStores
    .filter(
      (s) => s.strCd && !isNaN(Number(s.strLttd)) && !isNaN(Number(s.strLitd))
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

app.get("/inventory", async (req, res) => {
  const pdNo = req.query.pdNo;
  const lat = parseFloat(req.query.lat) || 37.5665;
  const lng = parseFloat(req.query.lng) || 126.978;

  if (!pdNo) return res.status(400).json({ error: "pdNo is required" });

  const cached = cache.get(pdNo);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[proxy] Cache hit for pdNo=${pdNo}`);
    return res.json({ stores: cached.stores, count: cached.stores.length });
  }

  // Deduplicate: if already fetching this pdNo, wait for that result
  if (inFlight.has(pdNo)) {
    console.log(`[proxy] Joining in-flight request for pdNo=${pdNo}`);
    try {
      const stores = await inFlight.get(pdNo);
      return res.json({ stores, count: stores.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const fetchPromise = (async () => {
    await acquireBrowser();
    const rawStores = await fetchInventoryWithBrowser(pdNo, lat, lng);
    const stores = normalizeStores(rawStores);
    cache.set(pdNo, { stores, expiresAt: Date.now() + CACHE_TTL });
    return stores;
  })().finally(() => inFlight.delete(pdNo));

  inFlight.set(pdNo, fetchPromise);

  try {
    const stores = await fetchPromise;
    res.json({ stores, count: stores.length });
  } catch (err) {
    console.error("[proxy] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`[proxy] Listening on port ${PORT}`));
