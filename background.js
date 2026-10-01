const API_URL = "https://api.rolimons.com/items/v2/itemdetails";
const CACHE_KEY = "rolimonsItemDetails";
const CACHE_TTL = 60 * 1000;
const NOTIFY_SETTINGS_KEY = "rolimonsTradeNotifications";
const NOTIFY_STATE_KEY = "rolimonsTradeNotificationState";
const ALARM_NAME = "rolimons-trade-check";

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
  const add = (v) => { const n = Number(String(v).replace(/[$,\s]/g, "").trim()); if (Number.isFinite(n) && n >= 0) candidates.push(n); };
  const patterns = [
    /(?:"|')?(?:usd|usdValue|usd_price|usdPrice|cashValue|cash_value|realMoneyValue)(?:"|')?\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /(?:og:price:amount|product:price:amount|price:amount)(?:"|')?\s*(?:content=)?["']\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /\b(?:USD|US\s*Dollars?)\s*[:·|\-]?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    /\$\s*([0-9]+(?:\.[0-9]{1,2})?)/g
  ];
  for (const re of patterns) for (const m of html.matchAll(re)) add(m[1]);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ");
  for (const re of [/\b(?:USD|US\s*Dollars?)\s*[:·|\-]?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/gi, /\$\s*([0-9]+(?:\.[0-9]{1,2})?)/g]) for (const m of text.matchAll(re)) add(m[1]);
  return candidates.length ? candidates[candidates.length - 1] : null;
}

async function fetchRoutilityValue(id) {
  const key = String(id);
  try {
    const stored = await browser.storage.local.get(ROUTILITY_CACHE_KEY);
    const cached = stored[ROUTILITY_CACHE_KEY]?.[key];
    if (cached && Date.now() - cached.at < ROUTILITY_CACHE_TTL) return cached.value;
  } catch (_) {}
  const response = await fetch(`https://routility.io/catalog/${encodeURIComponent(key)}`, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`RoUtility HTTP ${response.status}`);
  const value = parseRoutilityValue(await response.text());
  if (value == null) return null;
  try {
    const stored = await browser.storage.local.get(ROUTILITY_CACHE_KEY);
    const cache = stored[ROUTILITY_CACHE_KEY] || {};
    cache[key] = { value, at: Date.now() };
    await browser.storage.local.set({ [ROUTILITY_CACHE_KEY]: cache });
  } catch (_) {}
  return value;
}

const THUMBNAIL_CACHE_KEY = "robloxThumbnailCache";
const THUMBNAIL_CACHE_TTL = 30 * 60 * 1000;

async function fetchRobloxThumbnail(id) {
  const key = String(id);
  try {
    const stored = await browser.storage.local.get(THUMBNAIL_CACHE_KEY);
    const cached = stored[THUMBNAIL_CACHE_KEY]?.[key];
    if (cached && Date.now() - cached.at < THUMBNAIL_CACHE_TTL && cached.url) return cached.url;
  } catch (_) {}

  const endpoints = [
    `https://thumbnails.roblox.com/v1/assets?assetIds=${encodeURIComponent(key)}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`,
    `https://www.roblox.com/asset-thumbnail/image?assetId=${encodeURIComponent(key)}&width=150&height=150&format=png`
  ];
  let url = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { credentials: "omit", cache: "no-store" });
      if (!response.ok) continue;
      const json = await response.json().catch(() => null);
      if (json?.data?.[0]?.imageUrl) {
        url = json.data[0].imageUrl;
        break;
      }
      // Legacy thumbnail endpoint returns image bytes instead of JSON; use its URL directly.
      if (!endpoint.includes("thumbnails.roblox.com")) {
        url = endpoint;
        break;
      }
    } catch (_) {}
  }
  if (url) {
    try {
      const stored = await browser.storage.local.get(THUMBNAIL_CACHE_KEY);
      const cache = stored[THUMBNAIL_CACHE_KEY] || {};
      cache[key] = { url, at: Date.now() };
      await browser.storage.local.set({ [THUMBNAIL_CACHE_KEY]: cache });
    } catch (_) {}
  }
  return url;
}

async function getNotificationSettings() {
  const stored = await browser.storage.local.get(NOTIFY_SETTINGS_KEY);
  return {
    inboundEnabled: false,
    declinedEnabled: false,
    completedEnabled: false,
    inboundSound: false,
    inboundTitle: "New Roblox inbound trade",
    inboundMessage: "You received a new inbound trade.",
    declinedTitle: "Roblox trade declined",
    declinedMessage: "A Roblox trade was declined.",
    completedTitle: "Roblox trade completed",
    completedMessage: "A Roblox trade was completed.",
    ...(stored[NOTIFY_SETTINGS_KEY] || {})
  };
}

const FEEDS = {
  inbound: {
    paths: ["/v1/trades/inbound"],
    enabledKey: "inboundEnabled",
    titleKey: "inboundTitle",
    messageKey: "inboundMessage",
    defaultTitle: "New Roblox inbound trade",
    defaultMessage: "You received a new inbound trade."
  },
  declined: {
    paths: ["/v1/trades/declined", "/v1/trades/inactive"],
    enabledKey: "declinedEnabled",
    titleKey: "declinedTitle",
    messageKey: "declinedMessage",
    defaultTitle: "Roblox trade declined",
    defaultMessage: "A Roblox trade was declined."
  },
  completed: {
    paths: ["/v1/trades/completed"],
    enabledKey: "completedEnabled",
    titleKey: "completedTitle",
    messageKey: "completedMessage",
    defaultTitle: "Roblox trade completed",
    defaultMessage: "A Roblox trade was completed."
  }
};

async function fetchFeed(type) {
  const feed = FEEDS[type];
  let lastError = null;
  for (const path of feed.paths) {
    try {
      const response = await fetch(`https://trades.roblox.com${path}?sortOrder=Desc&limit=20`, {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) {
        lastError = new Error(`${type} trades HTTP ${response.status} (${path})`);
        continue;
      }
      const data = await response.json();
      const trades = Array.isArray(data?.data) ? data.data : [];
      if (type === "declined" && path.endsWith("/inactive")) {
        const filtered = trades.filter(t => {
          const status = String(t?.status ?? t?.state ?? t?.tradeStatus ?? "").toLowerCase();
          return status.includes("declin") || status === "declined";
        });
        return filtered;
      }
      return trades;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error(`${type} trades feed unavailable`);
}

function interpolate(text, trade) {
  const id = String(trade?.id ?? "");
  return String(text || "").replaceAll("{id}", id);
}

async function seedFeed(type, trades, state) {
  state[type] = {
    initialized: true,
    ids: trades.map(t => String(t?.id ?? "")).filter(Boolean).slice(-100)
  };
}

async function createTradeNotification(type, trade, cfg) {
  const feed = FEEDS[type];
  const id = String(trade?.id ?? "");
  const title = interpolate(cfg[feed.titleKey] || feed.defaultTitle, trade);
  const message = interpolate(cfg[feed.messageKey] || feed.defaultMessage, trade);
  return browser.notifications.create(`rolimons-${type}-${id}`, {
    type: "basic",
    title,
    message,
    iconUrl: browser.runtime.getURL("icon.png")
  });
}

async function pollTradeFeeds() {
  const cfg = await getNotificationSettings();
  const enabled = Object.keys(FEEDS).filter(type => cfg[FEEDS[type].enabledKey]);
  if (!enabled.length) return;
  const stored = await browser.storage.local.get(NOTIFY_STATE_KEY);
  const state = stored[NOTIFY_STATE_KEY] || {};
  let changed = false;

  for (const type of enabled) {
    try {
      const trades = await fetchFeed(type);
      if (!state[type]?.initialized) {
        await seedFeed(type, trades, state);
        changed = true;
        continue;
      }
      const seen = new Set(Array.isArray(state[type].ids) ? state[type].ids.map(String) : []);
      const fresh = trades.filter(t => t?.id != null && !seen.has(String(t.id))).reverse();
      for (const trade of fresh) {
        const id = String(trade.id);
        seen.add(id);
        try { await createTradeNotification(type, trade, cfg); } catch (e) { console.debug(`[Rolimon's] notification create failed`, e); }
      }
      state[type] = { initialized: true, ids: [...seen].slice(-100) };
      changed = true;
    } catch (e) {
      console.debug(`[Rolimon's] ${type} notification check failed`, e);
    }
  }
  if (changed) await browser.storage.local.set({ [NOTIFY_STATE_KEY]: state });
}

async function ensureAlarm() {
  const cfg = await getNotificationSettings();
  const enabled = cfg.inboundEnabled || cfg.declinedEnabled || cfg.completedEnabled;
  const existing = await browser.alarms.get(ALARM_NAME);
  if (enabled) {
    if (!existing) await browser.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
    await pollTradeFeeds();
  } else if (existing) {
    await browser.alarms.clear(ALARM_NAME);
  }
}

browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM_NAME) pollTradeFeeds(); });

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes[NOTIFY_SETTINGS_KEY]) return;
  const oldCfg = changes[NOTIFY_SETTINGS_KEY].oldValue || {};
  const newCfg = changes[NOTIFY_SETTINGS_KEY].newValue || {};
  const state = await browser.storage.local.get(NOTIFY_STATE_KEY);
  const current = state[NOTIFY_STATE_KEY] || {};
  for (const type of Object.keys(FEEDS)) {
    if (!oldCfg[`${type}Enabled`] && newCfg[`${type}Enabled`]) delete current[type];
    if (oldCfg[`${type}Enabled`] && !newCfg[`${type}Enabled`]) delete current[type];
  }
  await browser.storage.local.set({ [NOTIFY_STATE_KEY]: current });
  await ensureAlarm();
});

browser.notifications.onClicked.addListener(async (notificationId) => {
  try {
    const m = String(notificationId || "").match(/^rolimons-(?:inbound|declined|completed)-(\d+)$/);
    const url = m ? `https://www.roblox.com/trades/${m[1]}` : "https://www.roblox.com/trades";
    await browser.tabs.create({ url });
  } catch (_) {}
});

browser.runtime.onStartup?.addListener(ensureAlarm);
browser.runtime.onInstalled?.addListener(ensureAlarm);
ensureAlarm();

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "getRolimonsItems") return getItems().then(items => ({ ok: true, items })).catch(error => ({ ok: false, error: error.message }));
  if (message?.type === "getRoutilityValue" && message.id != null) return fetchRoutilityValue(message.id).then(value => ({ ok: value != null, value })).catch(error => ({ ok: false, value: null, error: error.message }));
  if (message?.type === "getRobloxThumbnail" && message.id != null) return fetchRobloxThumbnail(message.id).then(url => ({ ok: !!url, url })).catch(error => ({ ok: false, url: null, error: error.message }));
  if (message?.type === "testTradeNotification") {
    return browser.notifications.create("rolimons-test", { type: "basic", title: "Rolimon's Trade Notification", message: "Desktop notifications are working.", iconUrl: browser.runtime.getURL("icon.png") }).then(() => ({ ok: true })).catch(error => ({ ok: false, error: error.message }));
  }
  if (message?.type === "refreshInboundNotifications") return ensureAlarm().then(() => ({ ok: true }));
  return undefined;
});
