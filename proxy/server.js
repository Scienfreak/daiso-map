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

async function fetchInventoryWithBrowser(pdNo, lat, lng, intCd = "") {
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
            intCd,
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
  const intCd = req.query.intCd || "";

  if (!pdNo) return res.status(400).json({ error: "pdNo is required" });

  const cacheKey = `${pdNo}:${intCd}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[proxy] Cache hit for pdNo=${pdNo}`);
    return res.json({ stores: cached.stores, count: cached.stores.length });
  }

  // Deduplicate: if already fetching this cacheKey, wait for that result
  if (inFlight.has(cacheKey)) {
    console.log(`[proxy] Joining in-flight request for ${cacheKey}`);
    try {
      const stores = await inFlight.get(cacheKey);
      return res.json({ stores, count: stores.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const fetchPromise = (async () => {
    await acquireBrowser();
    const rawStores = await fetchInventoryWithBrowser(pdNo, lat, lng, intCd);
    const stores = normalizeStores(rawStores);
    cache.set(cacheKey, { stores, expiresAt: Date.now() + CACHE_TTL });
    return stores;
  })().finally(() => inFlight.delete(cacheKey));

  inFlight.set(cacheKey, fetchPromise);

  try {
    const stores = await fetchPromise;
    res.json({ stores, count: stores.length });
  } catch (err) {
    console.error("[proxy] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint: capture all API calls the Daiso page makes + extract district options
app.get("/inspect", async (req, res) => {
  const pdNo = req.query.pdNo || "1045002";
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
  });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "ko-KR",
    });
    const page = await context.newPage();

    // Capture all API calls
    const apiCalls = [];
    page.on("request", (req) => {
      if (req.url().includes("daisomall.co.kr") && !req.url().includes(".js") && !req.url().includes(".css")) {
        apiCalls.push({ method: req.method(), url: req.url() });
      }
    });
    const apiResponses = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("daisomall.co.kr") && !url.includes(".js") && !url.includes(".css") && !url.includes(".png") && !url.includes(".jpg")) {
        try {
          const body = await response.text();
          if (body.length < 5000) apiResponses.push({ url: url.replace("https://", ""), status: response.status(), body });
        } catch {}
      }
    });

    await page.goto(`https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?selectedPd=${pdNo}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    // Click on tab2 (store search tab)
    try {
      await page.click('[id="tab-tab2"], #tab-tab2, [aria-controls="tab2"]', { timeout: 3000 });
      await page.waitForTimeout(3000);
    } catch { console.log("[inspect] tab2 click failed"); }

    // Try to find and click the 시도 select (서울특별시)
    let selectOptions = [];
    try {
      // Find all select elements and their options
      selectOptions = await page.evaluate(() => {
        const selects = document.querySelectorAll("select");
        return Array.from(selects).map(sel => ({
          name: sel.name || sel.id || sel.className,
          options: Array.from(sel.options).map(o => ({ value: o.value, text: o.text }))
        }));
      });
    } catch {}

    // Also look for Vue select/dropdown components
    let vueSelects = [];
    try {
      vueSelects = await page.evaluate(() => {
        // Look for elements with 구 names in text content
        const allText = document.body.innerText;
        const guPattern = /[가-힣]+구/g;
        const matches = allText.match(guPattern) || [];
        return [...new Set(matches)];
      });
    } catch {}

    res.json({
      apiCalls: apiCalls.slice(0, 30),
      apiResponses,
      selectOptions,
      vueSelects,
    });
  } finally {
    await browser.close();
  }
});

// Test: does page.evaluate fetch to mapi work at all?
app.get("/test-mapi", async (req, res) => {
  const pdNo = req.query.pdNo || "1045002";
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
  });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "ko-KR",
    });
    const page = await context.newPage();
    await page.goto(DAISO_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    const result = await page.evaluate(
      async ({ url, body }) => {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          const data = await res.json();
          return { ok: res.ok, status: res.status, storeCount: data?.data?.msStrVOList?.length ?? 0, total: data?.data?.intStrCont ?? 0, firstStore: data?.data?.msStrVOList?.[0] ?? null, raw: data?.success === false ? data : undefined };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      },
      {
        url: INVENTORY_URL,
        body: { keyword: "", pdNo, curLttd: 37.5665, curLitd: 126.978, geolocationAgrYn: "Y", pkupYn: "", intCd: "", pageSize: 30, currentPage: 1 },
      }
    );

    res.json(result);
  } finally {
    await browser.close();
  }
});


app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`[proxy] Listening on port ${PORT}`));
