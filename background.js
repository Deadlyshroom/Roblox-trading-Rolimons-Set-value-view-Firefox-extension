const API_URL = "https://api.rolimons.com/items/v2/itemdetails";
const CACHE_KEY = "rolimonsItemDetails";
const CACHE_TTL = 60 * 1000;
const NOTIFY_SETTINGS_KEY = "rolimonsTradeNotifications";
const ALARM_NAME = "rolimons-trade-check";

const TRADE_TYPES = {
  inbound: {
    seenKey: "rolimonsSeenInboundTrades",
    initKey: "rolimonsInboundInitialized",
    path: "inbound",
    title: "New Roblox inbound trade",
    message: "You received a new inbound trade."
  },
  declined: {
    seenKey: "rolimonsSeenDeclinedTrades",
    initKey: "rolimonsDeclinedInitialized",
    path: "declined",
    title: "Roblox trade declined",
    message: "A Roblox trade was declined."
  },
  completed: {
    seenKey: "rolimonsSeenCompletedTrades",
    initKey: "rolimonsCompletedInitialized",
    path: "completed",
    title: "Roblox trade completed",
    message: "A Roblox trade was completed."
  }
};

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
      memoryCache = cached.items;
      memoryFetchedAt = cached.fetchedAt;
      return memoryCache;
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

  const patterns = [
    /(?:"|')?(?:usd|usdValue|usd_price|usdPrice|cashValue|cash_value|realMoneyValue)(?:"|')?\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /(?:og:price:amount|product:price:amount|price:amount)(?:"|')?\s*(?:content=)?["']\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /\b(?:USD|US\s*Dollars?)\s*[:·|\-]?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /\$\s*([0-9]+(?:\.[0-9]{1,2})?)/g
  ];
  for (const re of patterns) for (const m of html.matchAll(re)) add(m[1]);

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
  ]) for (const m of text.matchAll(re)) add(m[1]);

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
  return {
    inboundEnabled: false,
    declinedEnabled: false,
    completedEnabled: false,
    inboundSound: false,
    ...(stored[NOTIFY_SETTINGS_KEY] || {})
  };
}

async function fetchTradeList(type) {
  const cfg = TRADE_TYPES[type];
  const response = await fetch(
    `https://trades.roblox.com/v1/trades/${cfg.path}?sortOrder=Desc&limit=25`,
    { credentials: "include", cache: "no-store" }
  );
  if (!response.ok) throw new Error(`${cfg.path} trades HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

async function seedTradeBaseline(type) {
  const cfg = TRADE_TYPES[type];
  try {
    const trades = await fetchTradeList(type);
    const ids = trades.map(t => String(t?.id ?? "")).filter(Boolean);
    await browser.storage.local.set({
      [cfg.seenKey]: ids.slice(-200),
      [cfg.initKey]: true
    });
    return true;
  } catch (e) {
    console.debug(`[Rolimon's] ${type} baseline seed failed`, e);
    return false;
  }
}

async function pollTradeType(type) {
  const cfg = TRADE_TYPES[type];
  try {
    const trades = await fetchTradeList(type);
    const ids = trades.map(t => String(t?.id ?? "")).filter(Boolean);
    if (!ids.length) return;

    const stored = await browser.storage.local.get([cfg.seenKey, cfg.initKey]);
    const seen = new Set(Array.isArray(stored[cfg.seenKey]) ? stored[cfg.seenKey].map(String) : []);

    if (!stored[cfg.initKey]) {
      ids.forEach(id => seen.add(id));
      await browser.storage.local.set({
        [cfg.seenKey]: [...seen].slice(-200),
        [cfg.initKey]: true
      });
      return;
    }

    const fresh = trades
      .filter(t => t?.id != null && !seen.has(String(t.id)))
      .reverse();

    for (const trade of fresh) {
      const id = String(trade.id);
      seen.add(id);
      await browser.notifications.create(`rolimons-${type}-${id}`, {
        type: "basic",
        title: cfg.title,
        message: cfg.message,
        iconUrl: browser.runtime.getURL("icon.png")
      });
    }

    await browser.storage.local.set({ [cfg.seenKey]: [...seen].slice(-200) });
  } catch (e) {
    console.debug(`[Rolimon's] ${type} notification check failed`, e);
  }
}

async function ensureAlarm() {
  const cfg = await getNotificationSettings();
  const enabledTypes = Object.keys(TRADE_TYPES).filter(type => {
    return !!cfg[`${type}Enabled`];
  });
  const existing = await browser.alarms.get(ALARM_NAME);

  if (!enabledTypes.length) {
    if (existing) await browser.alarms.clear(ALARM_NAME);
    return;
  }

  if (!existing) await browser.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });

  for (const type of enabledTypes) {
    const state = await browser.storage.local.get(TRADE_TYPES[type].initKey);
    if (!state[TRADE_TYPES[type].initKey]) await seedTradeBaseline(type);
  }

  for (const type of enabledTypes) await pollTradeType(type);
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM_NAME) return;
  getNotificationSettings()
    .then(cfg => Promise.all(
      Object.keys(TRADE_TYPES)
        .filter(type => cfg[`${type}Enabled`])
        .map(type => pollTradeType(type))
    ))
    .catch(() => {});
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes[NOTIFY_SETTINGS_KEY]) return;
  const oldCfg = changes[NOTIFY_SETTINGS_KEY].oldValue || {};
  const newCfg = changes[NOTIFY_SETTINGS_KEY].newValue || {};

  for (const type of Object.keys(TRADE_TYPES)) {
    const key = `${type}Enabled`;
    if (!oldCfg[key] && newCfg[key]) {
      const def = TRADE_TYPES[type];
      await browser.storage.local.set({ [def.initKey]: false, [def.seenKey]: [] });
    }
  }
  await ensureAlarm();
});

browser.notifications.onClicked.addListener(async (notificationId) => {
  const m = String(notificationId || "").match(/^rolimons-(?:inbound|declined|completed)-(\d+)$/);
  const url = m ? `https://www.roblox.com/trades/${m[1]}` : "https://www.roblox.com/trades";
  try { await browser.tabs.create({ url }); } catch (_) {}
});

browser.runtime.onStartup?.addListener(ensureAlarm);
browser.runtime.onInstalled?.addListener(ensureAlarm);
ensureAlarm();

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "getRolimonsItems") {
    return getItems()
      .then(items => ({ ok: true, items }))
      .catch(error => ({ ok: false, error: error.message }));
  }
  if (message?.type === "getRoutilityValue" && message.id != null) {
    return fetchRoutilityValue(message.id)
      .then(value => ({ ok: value != null, value }))
      .catch(error => ({ ok: false, value: null, error: error.message }));
  }
  if (message?.type === "refreshTradeNotifications") {
    return ensureAlarm().then(() => ({ ok: true }));
  }
  return undefined;
});
