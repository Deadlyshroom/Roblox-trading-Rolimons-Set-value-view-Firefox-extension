const API_URL = "https://api.rolimons.com/items/v2/itemdetails";
const CACHE_KEY = "rolimonsItemDetails";
const CACHE_TTL = 60 * 1000;
const NOTIFY_SETTINGS_KEY = "rolimonsTradeNotifications";
const SEEN_KEY = "rolimonsSeenInboundTrades";
const INIT_KEY = "rolimonsInboundInitialized";
const ALARM_NAME = "rolimons-inbound-check";

let memoryCache = null;
let memoryFetchedAt = 0;
let inFlight = null;

async function fetchItems() {
  if (memoryCache && Date.now() - memoryFetchedAt < CACHE_TTL) return memoryCache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) response = await fetch("https://api.rolimons.com/items/v1/itemdetails", { cache: "no-store" });
    if (!response.ok) throw new Error(`Rolimon's API returned HTTP ${response.status}`);
    const json = await response.json();
    if (!json || typeof json.items !== "object") throw new Error("Rolimon's API returned an invalid item table");
    memoryCache = json.items;
    memoryFetchedAt = Date.now();
    await browser.storage.local.set({ [CACHE_KEY]: { fetchedAt: memoryFetchedAt, items: memoryCache } });
    return memoryCache;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

async function getItems() {
  if (memoryCache) return memoryCache;
  try {
    const stored = await browser.storage.local.get(CACHE_KEY);
    const cached = stored[CACHE_KEY];
    if (cached?.items && cached?.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL) {
      memoryCache = cached.items; memoryFetchedAt = cached.fetchedAt; return memoryCache;
    }
  } catch (e) { console.warn("[Rolimon's] cache read failed", e); }
  return fetchItems();
}


const ROUTILITY_CACHE_KEY = "routilityValueCache";
const ROUTILITY_CACHE_TTL = 5 * 60 * 1000;

function parseRoutilityValue(html) {
  if (typeof html !== "string" || !html) return null;
  const candidates = [];
  const add = (v) => {
    const n = Number(String(v).replace(/[$,\s]/g, "").trim());
    if (Number.isFinite(n) && n >= 0) candidates.push(n);
  };

  // RoUtility's real-money price/value. Deliberately do NOT parse the
  // Roblox/RoUtility item "Value" field here.
  const patterns = [
    /(?:"|')?(?:usd|usdValue|usd_price|usdPrice|cashValue|cash_value|realMoneyValue)(?:"|')?\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /(?:og:price:amount|product:price:amount|price:amount)(?:"|')?\s*(?:content=)?["']\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /\b(?:USD|US\s*Dollars?)\s*[:·|\-]?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /\$\s*([0-9]+(?:\.[0-9]{1,2})?)/g
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) add(m[1]);
  }

  // Retry against human-readable page text after removing markup/scripts.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
  for (const re of [
    /\b(?:USD|US\s*Dollars?)\s*[:·|\-]?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /\$\s*([0-9]+(?:\.[0-9]{1,2})?)/g
  ]) {
    for (const m of text.matchAll(re)) add(m[1]);
  }

  return candidates.length ? candidates[candidates.length - 1] : null;
}

async function fetchRoutilityValue(id) {
  const key = String(id);
  try {
    const stored = await browser.storage.local.get(ROUTILITY_CACHE_KEY);
    const cached = stored[ROUTILITY_CACHE_KEY]?.[key];
    if (cached && Date.now() - cached.at < ROUTILITY_CACHE_TTL) return cached.value;
  } catch (_) {}

  const response = await fetch(`https://routility.io/catalog/${encodeURIComponent(key)}`, {
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) throw new Error(`RoUtility HTTP ${response.status}`);
  const html = await response.text();
  const value = parseRoutilityValue(html);
  if (value == null) return null;

  try {
    const stored = await browser.storage.local.get(ROUTILITY_CACHE_KEY);
    const cache = stored[ROUTILITY_CACHE_KEY] || {};
    cache[key] = { value, at: Date.now() };
    await browser.storage.local.set({ [ROUTILITY_CACHE_KEY]: cache });
  } catch (_) {}
  return value;
}

async function getNotificationSettings() {
  const stored = await browser.storage.local.get(NOTIFY_SETTINGS_KEY);
  return { inboundEnabled: false, inboundSound: false, ...(stored[NOTIFY_SETTINGS_KEY] || {}) };
}

async function seedInboundBaseline() {
  try {
    const response = await fetch("https://trades.roblox.com/v1/trades/inbound?sortOrder=Desc&limit=10", { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`Inbound trades HTTP ${response.status}`);
    const data = await response.json();
    const trades = Array.isArray(data?.data) ? data.data : [];
    const ids = trades.map(t => String(t?.id ?? "")).filter(Boolean);
    await browser.storage.local.set({ [SEEN_KEY]: ids.slice(-100), [INIT_KEY]: true });
  } catch (e) {
    // Leave INIT_KEY false so the next successful poll seeds instead of notifying old trades.
    console.debug("[Rolimon's] inbound baseline seed failed", e);
  }
}

async function ensureAlarm() {
  const cfg = await getNotificationSettings();
  const existing = await browser.alarms.get(ALARM_NAME);
  if (cfg.inboundEnabled) {
    if (!existing) await browser.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
    const state = await browser.storage.local.get(INIT_KEY);
    if (!state[INIT_KEY]) {
      await seedInboundBaseline();
    }
    await pollInboundTrades();
  } else if (existing) {
    await browser.alarms.clear(ALARM_NAME);
  }
}

async function pollInboundTrades() {
  const cfg = await getNotificationSettings();
  if (!cfg.inboundEnabled) return;
  try {
    const response = await fetch("https://trades.roblox.com/v1/trades/inbound?sortOrder=Desc&limit=10", { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`Inbound trades HTTP ${response.status}`);
    const data = await response.json();
    const trades = Array.isArray(data?.data) ? data.data : [];
    const ids = trades.map(t => String(t?.id ?? "")).filter(Boolean);
    if (!ids.length) return;

    const stored = await browser.storage.local.get([SEEN_KEY, INIT_KEY]);
    const seen = new Set(Array.isArray(stored[SEEN_KEY]) ? stored[SEEN_KEY].map(String) : []);
    if (!stored[INIT_KEY]) {
      ids.forEach(id => seen.add(id));
      await browser.storage.local.set({ [SEEN_KEY]: [...seen].slice(-100), [INIT_KEY]: true });
      return;
    }

    const fresh = trades.filter(t => t?.id != null && !seen.has(String(t.id))).reverse();
    for (const trade of fresh) {
      const id = String(trade.id);
      seen.add(id);
      await browser.notifications.create(`rolimons-inbound-${id}`, {
        type: "basic",
        title: "New Roblox inbound trade",
        message: "You received a new inbound trade.",
        iconUrl: browser.runtime.getURL("icon.png")
      });
    }
    await browser.storage.local.set({ [SEEN_KEY]: [...seen].slice(-100) });
  } catch (e) {
    console.debug("[Rolimon's] inbound notification check failed", e);
  }
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) pollInboundTrades();
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes[NOTIFY_SETTINGS_KEY]) return;
  const oldCfg = changes[NOTIFY_SETTINGS_KEY].oldValue || {};
  const newCfg = changes[NOTIFY_SETTINGS_KEY].newValue || {};
  if (!oldCfg.inboundEnabled && newCfg.inboundEnabled) {
    // A fresh enable always starts clean. Seed the currently visible inbound trades
    // before starting normal polling so old trades can never trigger a notification.
    await browser.storage.local.set({ [INIT_KEY]: false, [SEEN_KEY]: [] });
  }
  await ensureAlarm();
});

browser.notifications.onClicked.addListener(async () => {
  try {
    await browser.tabs.create({ url: "https://www.roblox.com/trades" });
  } catch (_) {}
});

browser.runtime.onStartup?.addListener(ensureAlarm);
browser.runtime.onInstalled?.addListener(ensureAlarm);
ensureAlarm();

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "getRolimonsItems") {
    return getItems().then(items => ({ ok: true, items })).catch(error => ({ ok: false, error: error.message }));
  }
  if (message?.type === "getRoutilityValue" && message.id != null) {
    return fetchRoutilityValue(message.id)
      .then(value => ({ ok: value != null, value }))
      .catch(error => ({ ok: false, value: null, error: error.message }));
  }
  if (message?.type === "refreshInboundNotifications") {
    return ensureAlarm().then(() => ({ ok: true }));
  }
  return undefined;
});
