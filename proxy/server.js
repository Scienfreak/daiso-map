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
    // Grant geolocation so the page can auto-trigger location-based mapi calls
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      locale: "ko-KR",
      geolocation: { latitude: lat, longitude: lng },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();

    // Capture any successful mapi response the page makes
    let capturedData = null;
    page.on("response", async (response) => {
      if (
        response.url().includes("mapi.daisomall.co.kr/ms/msg/newIntSelStr") &&
        response.status() === 200
      ) {
        try {
          capturedData = await response.json();
          console.log("[proxy] Intercepted mapi response from page");
        } catch {}
      }
    });

    await page.goto(DAISO_PAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for page to make any successful API call (indicates auth/init complete)
    try {
      await page.waitForResponse(
        (r) => r.url().includes("daisomall.co.kr") && r.status() === 200,
        { timeout: 25000 }
      );
      console.log("[proxy] Page initialized");
    } catch {
      console.log("[proxy] No init response detected, continuing");
    }

    // Log all requests the page makes to understand auth mechanism
    const pageRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("daisomall.co.kr")) {
        pageRequests.push(req.url().split("?")[0].replace("https://", ""));
      }
      if (req.url().includes("mapi.daisomall.co.kr")) {
        console.log("[proxy] PAGE->MAPI:", req.url().split("?")[0]);
        console.log("[proxy] mapi req header keys:", JSON.stringify(Object.keys(req.headers())));
      }
    });

    // Give the page time to fire follow-up calls (mapi may auto-trigger with geolocation)
    await page.waitForTimeout(5000);

    // Dump auth state to understand what tokens the page uses
    const authState = await page.evaluate(() => {
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        ls[k] = (localStorage.getItem(k) || "").slice(0, 200);
      }
      const ss = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        ss[k] = (sessionStorage.getItem(k) || "").slice(0, 200);
      }
      return {
        hasAxios: typeof window.axios !== "undefined",
        cookie: document.cookie.slice(0, 300),
        ls,
        ss,
      };
    });
    console.log("[proxy] authState:", JSON.stringify(authState));
    console.log("[proxy] pageRequests:", pageRequests.slice(0, 10).join(" | "));

    if (!capturedData) {
      const inputSelectors = [
        'input[type="text"]',
        'input[type="search"]',
        'input[placeholder*="상품"]',
        'input[placeholder*="검색"]',
        'input[placeholder*="product"]',
        "input:visible",
        "input",
      ];

      let triggered = false;
      for (const selector of inputSelectors) {
        try {
          const el = await page.$(selector);
          if (!el) continue;
          const visible = await el.isVisible();
          if (!visible) continue;

          await el.click();
          await el.fill(pdNo);
          await el.press("Enter");
          console.log(`[proxy] Submitted search via selector: ${selector}`);
          triggered = true;
          break;
        } catch {}
      }

      if (!triggered) {
        try {
          await page.click('button[type="submit"], button:has-text("검색")', {
            timeout: 3000,
          });
        } catch {}
      }

      // Wait for intercepted response (up to 20 seconds after submit)
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(1000);
        if (capturedData) break;
      }
    }

    if (capturedData) {
      const stores = capturedData?.data?.msStrVOList ?? [];
      const total = capturedData?.data?.intStrCont ?? stores.length;
      console.log(`[proxy] Intercepted ${stores.length} stores, total=${total}`);

      // Fetch additional pages using page.evaluate (auth is now established)
      const allStores = [...stores];
      if (total > 30) {
        const totalPages = Math.ceil(total / 30);
        for (let p = 2; p <= totalPages; p++) {
          const result = await page.evaluate(
            async ({ url, body }) => {
              const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
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
      return allStores;
    }

    // Fallback: page.evaluate — try axios first, then fetch with all available auth
    console.log("[proxy] No intercepted response, falling back to page.evaluate");

    const result = await page.evaluate(
      async ({ url, body }) => {
        // Collect auth tokens from localStorage
        const apiV2 = localStorage.getItem("api_v2") || "";
        const extraHeaders = {};
        if (apiV2) extraHeaders["Authorization"] = `Bearer ${apiV2}`;
        console.log("[page] api_v2:", apiV2.slice(0, 80));

        try {
          // Try axios first — if the page uses axios interceptors for auth tokens, this works
          if (typeof window.axios !== "undefined") {
            const res = await window.axios.post(url, body);
            return { ok: true, status: 200, data: res.data };
          }
        } catch (e) {
          console.log("axios failed:", String(e));
        }
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...extraHeaders },
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

    if (!result.ok) {
      throw new Error(`Daiso API returned ${result.status ?? result.error}`);
    }

    const stores = result.data?.data?.msStrVOList ?? [];
    const total = result.data?.data?.intStrCont ?? stores.length;
    const allStores = [...stores];

    if (total > 30) {
      const totalPages = Math.ceil(total / 30);
      for (let p = 2; p <= totalPages; p++) {
        const r = await page.evaluate(
          async ({ url, body }) => {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
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
        allStores.push(...(r?.data?.msStrVOList ?? []));
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
