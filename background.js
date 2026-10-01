const API_URL = "https://api.rolimons.com/items/v2/itemdetails";
const CACHE_KEY = "rolimonsItemDetails";
const CACHE_TTL = 60 * 1000;

let memoryCache = null;
let memoryFetchedAt = 0;
let inFlight = null;

async function fetchItems() {
  if (memoryCache && Date.now() - memoryFetchedAt < CACHE_TTL) {
    return memoryCache;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    // The preferred current endpoint is v2; v1 is retained as a fallback
    // because Rolimon's API is unofficial and can change.
    let response = await fetch(API_URL, { cache: "no-store" });

    if (!response.ok) {
      response = await fetch("https://api.rolimons.com/items/v1/itemdetails", {
        cache: "no-store"
      });
    }

    if (!response.ok) {
      throw new Error(`Rolimon's API returned HTTP ${response.status}`);
    }

    const json = await response.json();

    if (!json || typeof json.items !== "object") {
      throw new Error("Rolimon's API returned an invalid item table");
    }

    memoryCache = json.items;
    memoryFetchedAt = Date.now();

    // Keep a short-lived persistent cache so opening a new Roblox tab does
    // not immediately hammer the API.
    await browser.storage.local.set({
      [CACHE_KEY]: {
        fetchedAt: memoryFetchedAt,
        items: memoryCache
      }
    });

    return memoryCache;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function getItems() {
  if (memoryCache) return memoryCache;

  try {
    const stored = await browser.storage.local.get(CACHE_KEY);
    const cached = stored[CACHE_KEY];

    if (cached?.items && cached?.fetchedAt &&
        Date.now() - cached.fetchedAt < CACHE_TTL) {
      memoryCache = cached.items;
      memoryFetchedAt = cached.fetchedAt;
      return memoryCache;
    }
  } catch (e) {
    console.warn("[Rolimon's] cache read failed", e);
  }

  return fetchItems();
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== "getRolimonsItems") return undefined;

  return getItems()
    .then((items) => ({ ok: true, items }))
    .catch((error) => {
      console.error("[Rolimon's]", error);
      return { ok: false, error: error.message };
    });
});


const NOTIFY_DEFAULTS = {
  inboundEnabled: false,
  inboundSound: false
};

async function getNotificationSettings() {
  const stored = await browser.storage.local.get("rolimonsTradeNotifications");
  return { ...NOTIFY_DEFAULTS, ...(stored.rolimonsTradeNotifications || {}) };
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== "rolimonsInboundTrade") return undefined;

  return (async () => {
    const settings = await getNotificationSettings();
    if (!settings.inboundEnabled) return { ok: true, notified: false };

    await browser.notifications.create(`rolimons-inbound-${message.tradeId || Date.now()}`, {
      type: "basic",
      title: "New Roblox inbound trade",
      message: message.message || "You received a new inbound trade.",
      iconUrl: browser.runtime.getURL("icon.png")
    });
    return { ok: true, notified: true, sound: !!settings.inboundSound };
  })().catch((error) => {
    console.error("[Rolimon's] notification failed", error);
    return { ok: false, error: error.message };
  });
});
