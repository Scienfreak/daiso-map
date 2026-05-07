const express = require("express");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

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
  console.log(`[proxy] Launching browser for pdNo=${pdNo} intCd=${intCd}`);
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

    // Strategy 1: visit mapi domain first to acquire its own cf_clearance cookie.
    // Previously only prdm was visited; mapi is a separate Cloudflare zone.
    console.log("[proxy] Pre-visiting mapi domain for cf_clearance");
    await page.goto("https://mapi.daisomall.co.kr/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }).catch((e) => console.log("[proxy] mapi pre-visit:", e.message.split("\n")[0]));
    await page.waitForTimeout(3000);

    // Strategy 2: intercept the page's own mapi responses rather than making a
    // separate fetch — the page's XHR already has the correct auth context.
    const capturedStores = [];
    page.on("response", async (response) => {
      if (response.url().includes("newIntSelStr")) {
        try {
          const json = await response.json();
          const stores = json?.data?.msStrVOList ?? [];
          capturedStores.push(...stores);
          console.log(`[proxy] Intercepted mapi: ${stores.length} stores (running total: ${capturedStores.length})`);
        } catch {}
      }
    });

    // Navigate to Daiso page with the product pre-selected to skip product search step
    await page.goto(
      `https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?selectedPd=${pdNo}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await page.waitForTimeout(4000);
    console.log("[proxy] Daiso page loaded");

    // Click tab2 (매장재고 탭)
    try {
      await page.click('[id="tab-tab2"], #tab-tab2, [aria-controls="tab2"]', { timeout: 3000 });
      console.log("[proxy] tab2 clicked");
      await page.waitForTimeout(2000);
    } catch { console.log("[proxy] tab2 click failed"); }

    // Select district in the dropdown if intCd provided
    if (intCd) {
      try {
        const selected = await page.evaluate((code) => {
          for (const sel of document.querySelectorAll("select")) {
            if ([...sel.options].some((o) => o.value === code)) {
              sel.value = code;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
          return false;
        }, intCd);
        console.log(`[proxy] District select ${selected ? "ok" : "no match"}: ${intCd}`);
        if (selected) await page.waitForTimeout(1000);
      } catch (e) {
        console.log("[proxy] District select error:", e.message);
      }
    }

    // Click the search button to trigger the mapi call
    try {
      await page.click(
        'button:has-text("검색"), button:has-text("찾기"), [class*="search"] button, .btn-search',
        { timeout: 3000 }
      );
      console.log("[proxy] Search button clicked");
    } catch { console.log("[proxy] Search button click failed"); }

    // Wait for the intercepted mapi response
    await page.waitForTimeout(6000);
    console.log(`[proxy] Interception result: ${capturedStores.length} stores`);

    // page.evaluate fetch helper — now has both prdm + mapi cf_clearance cookies
    const browserFetch = async (currentPage) =>
      page.evaluate(
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
          url: INVENTORY_URL,
          body: { keyword: "", pdNo, curLttd: lat, curLitd: lng, geolocationAgrYn: "Y", pkupYn: "", intCd, pageSize: 30, currentPage },
        }
      );

    if (capturedStores.length === 0) {
      // Interception yielded nothing; fall back to page.evaluate fetch.
      // We now have mapi's own cf_clearance, so this may succeed where it didn't before.
      console.log("[proxy] Falling back to page.evaluate fetch");
      const first = await browserFetch(1);
      console.log(`[proxy] Fallback page 1 status=${first.status}, ok=${first.ok}`);
      if (!first.ok) {
        throw new Error(`Daiso API returned ${first.status ?? first.error}`);
      }
      const stores = first.data?.data?.msStrVOList ?? [];
      const total = first.data?.data?.intStrCont ?? stores.length;
      console.log(`[proxy] Fallback total=${total}, page1=${stores.length}`);
      const allStores = [...stores];
      if (total > 30) {
        const totalPages = Math.ceil(total / 30);
        for (let p = 2; p <= totalPages; p++) {
          const r = await browserFetch(p);
          allStores.push(...(r?.data?.data?.msStrVOList ?? []));
        }
      }
      return allStores;
    }

    // Interception succeeded (page 1). Fetch remaining pages via page.evaluate
    // if the total exceeds what the page initially loaded.
    // We don't know the total from interception alone, so try page 2+ via browserFetch.
    if (capturedStores.length === 30) {
      console.log("[proxy] Captured exactly 30, checking for more pages via fetch");
      try {
        for (let p = 2; p <= 10; p++) {
          const r = await browserFetch(p);
          const more = r?.data?.data?.msStrVOList ?? [];
          if (more.length === 0) break;
          capturedStores.push(...more);
          if (more.length < 30) break;
        }
      } catch (e) {
        console.log("[proxy] Additional pages fetch failed:", e.message);
      }
    }

    return capturedStores;
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


// Inspect Daiso page Vue/Nuxt internals to find the mapi auth mechanism
app.get("/analyze-auth", async (req, res) => {
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

    // Intercept the actual mapi request the page makes to capture its headers
    let capturedMapiRequest = null;
    await page.route("**/newIntSelStr", async (route) => {
      const request = route.request();
      capturedMapiRequest = {
        headers: request.headers(),
        postData: request.postData(),
      };
      console.log("[analyze-auth] Intercepted mapi request headers:", JSON.stringify(request.headers()));
      await route.continue();
    });

    await page.goto(
      `https://prdm.daisomall.co.kr/ms/msb/SCR_MSB_0011?selectedPd=${pdNo}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await page.waitForTimeout(5000);

    // Extract Vue/Nuxt app internals: axios config, interceptors, session state, storage
    const vueInfo = await page.evaluate(() => {
      try {
        const nuxt = window.__nuxt__ || window.$nuxt;
        if (!nuxt) return { error: "no __nuxt__ on window" };

        const vm = nuxt._vm || nuxt;
        const store = vm?.$store;
        const axios = vm?.$axios;

        const interceptors = (axios?.interceptors?.request?.handlers ?? [])
          .filter(Boolean)
          .map((h) => String(h.fulfilled).slice(0, 1000));

        const authStorage = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (/token|auth|key|session|secret/i.test(k)) authStorage[k] = localStorage.getItem(k);
          }
        } catch {}

        const authCookies = document.cookie
          .split(";")
          .map((c) => c.trim())
          .filter((c) => /token|auth|cf_|session/i.test(c));

        return {
          hasNuxt: true,
          hasAxios: !!axios,
          axiosBaseURL: axios?.defaults?.baseURL,
          axiosCommonHeaders: axios?.defaults?.headers?.common,
          requestInterceptors: interceptors,
          sessionState: store?.state?.session,
          nuxtStateKeys: Object.keys(window.__NUXT__?.state ?? {}),
          authStorage,
          authCookies,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    // Run the axios interceptors in browser context to find what baseURL Li.f() actually returns
    const actualBaseURL = await page.evaluate(() => {
      try {
        const nuxt = window.__nuxt__ || window.$nuxt;
        const vm = nuxt._vm || nuxt;
        const axios = vm?.$axios;
        const handlers = axios?.interceptors?.request?.handlers ?? [];
        const config = {
          baseURL: axios?.defaults?.baseURL ?? "",
          url: "/ms/msg/newIntSelStr",
          method: "post",
        };
        for (const h of handlers.filter(Boolean)) {
          try { h.fulfilled?.(config); } catch {}
        }
        return config.baseURL;
      } catch (e) {
        return "error: " + e.message;
      }
    });
    console.log("[analyze-auth] actualBaseURL:", actualBaseURL);

    // Click tab2 using force to bypass sticky header overlay
    try {
      await page.locator("#tab-tab2").scrollIntoViewIfNeeded();
      await page.locator("#tab-tab2").click({ force: true, timeout: 3000 });
      console.log("[analyze-auth] tab2 clicked (force)");
    } catch {
      await page.evaluate(() => {
        const el = document.getElementById("tab-tab2");
        el?.click();
        el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      console.log("[analyze-auth] tab2 clicked (evaluate fallback)");
    }
    await page.waitForTimeout(4000);

    // Capture which buttons are now visible after tab2 opens
    const postTabButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((b) => ({
          text: b.textContent?.trim().slice(0, 30),
          className: b.className.slice(0, 60),
          visible: b.offsetParent !== null,
        }))
        .filter((b) => b.visible)
        .slice(0, 15)
    );

    // Click search button in tab2 content
    try {
      await page.locator("button.btn-search").click({ force: true, timeout: 3000 });
      console.log("[analyze-auth] btn-search clicked (force)");
    } catch {
      await page.evaluate(() => { document.querySelector("button.btn-search")?.click(); });
      console.log("[analyze-auth] btn-search clicked (evaluate fallback)");
    }
    await page.waitForTimeout(6000);

    // Dump page structure for diagnosis
    const pageStructure = await page.evaluate(() => ({
      buttons: Array.from(document.querySelectorAll("button")).map((b) => ({
        text: b.textContent?.trim().slice(0, 30),
        id: b.id,
        className: b.className.slice(0, 60),
      })).slice(0, 20),
      selects: Array.from(document.querySelectorAll("select")).map((s) => ({
        id: s.id,
        name: s.name,
        options: Array.from(s.options).map((o) => ({ value: o.value, text: o.text })).slice(0, 5),
      })),
      tabElements: Array.from(document.querySelectorAll('[role="tab"], [id*="tab"], [class*="tab"]')).map((el) => ({
        tag: el.tagName,
        id: el.id,
        text: el.textContent?.trim().slice(0, 30),
        className: el.className.slice(0, 60),
      })).slice(0, 10),
    }));

    res.json({ actualBaseURL, vueInfo, capturedMapiRequest, postTabButtons, pageStructure });
  } finally {
    await browser.close();
  }
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`[proxy] Listening on port ${PORT}`));
