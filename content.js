(() => {
  "use strict";

  // Only run where Roblox actually has trading UI.
  const TRADE_PATH = /^\/(trades|users\/\d+\/trade)(?:\/|$)/i;
  const IS_TRADE_PAGE = TRADE_PATH.test(location.pathname);

  const VALUE_CLASS = "rolimons-inline-value";
  const TOTAL_CLASS = "rolimons-total-value";
  const POPUP_ID = "rolimons-item-popup";
  const STATUS_ID = "rolimons-status";

  let itemData = null;
  let renderTimer = null;
  let rendering = false;
  const tradeInfoCache = new Map();
  const routilityCache = new Map();
  const ROUTILITY_CACHE_TTL = 5 * 60 * 1000;
  let routilityEnabled = false;
  let authenticatedUserId = null;

  const DEFAULT_COLORS = {
    valueText: "#00a2ff",
    valueBackground: "rgba(0, 162, 255, 0.08)",
    valueBorder: "rgba(0, 162, 255, 0.24)",
    totalText: "#00a2ff",
    totalBackground: "rgba(0, 162, 255, 0.09)",
    totalBorder: "rgba(0, 162, 255, 0.26)"
  };
  let colors = { ...DEFAULT_COLORS };

  const fmt = (n) => Number(n || 0).toLocaleString();

  function colorWithAlpha(color, alpha) {
    if (typeof color !== "string") return color;
    const m = color.trim().match(/^#([0-9a-f]{6})$/i);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyColorVariables() {
    const root = document.documentElement;
    root.style.setProperty("--roli-value-text", colors.valueText);
    root.style.setProperty("--roli-value-bg", colorWithAlpha(colors.valueBackground, 0.08));
    root.style.setProperty("--roli-value-border", colors.valueBorder);
    root.style.setProperty("--roli-total-text", colors.totalText);
    root.style.setProperty("--roli-total-bg", colorWithAlpha(colors.totalBackground, 0.09));
    root.style.setProperty("--roli-total-border", colors.totalBorder);
  }

  async function loadColors() {
    try {
      const stored = await browser.storage.local.get("rolimonsColors");
      if (stored.rolimonsColors && typeof stored.rolimonsColors === "object") {
        colors = { ...DEFAULT_COLORS, ...stored.rolimonsColors };
      }
    } catch (e) {
      console.warn("[Rolimon's] color settings read failed", e);
    }
    applyColorVariables();
  }

  function ensureStyle() {
    if (document.getElementById("rolimons-style")) {
      applyColorVariables();
      return;
    }
    const style = document.createElement("style");
    style.id = "rolimons-style";
    style.textContent = `
      .${VALUE_CLASS} {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
        box-sizing: border-box !important;
        width: calc(100% - 10px) !important;
        min-width: 0 !important;
        margin: 7px 5px 3px !important;
        padding: 5px 8px !important;
        border: 1px solid var(--roli-value-border) !important;
        background-color: var(--roli-value-bg) !important;
        border-radius: 6px !important;
        color: inherit !important;
        font-family: Arial, Helvetica, sans-serif !important;
        line-height: 1 !important;
        text-align: left !important;
        overflow: hidden !important;
        clear: both !important;
        position: relative !important;
        z-index: 2 !important;
      }
      .${VALUE_CLASS} .roli-main {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
        width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .${VALUE_CLASS} .roli-label {
        flex: 0 0 auto !important;
        margin: 0 !important;
        padding: 0 !important;
        opacity: .68 !important;
        font-size: 9px !important;
        line-height: 14px !important;
        font-weight: 700 !important;
        letter-spacing: .5px !important;
        text-transform: uppercase !important;
        white-space: nowrap !important;
      }
      .${VALUE_CLASS} .roli-number {
        flex: 0 0 auto !important;
        min-width: max-content !important;
        margin: 0 !important;
        padding: 0 !important;
        color: var(--roli-value-text) !important;
        font-size: 13px !important;
        line-height: 14px !important;
        font-weight: 800 !important;
        white-space: nowrap !important;
        overflow: visible !important;
        text-overflow: clip !important;
      }
      .${VALUE_CLASS} { cursor: pointer !important; }
      .${VALUE_CLASS}:hover { filter: brightness(1.05) !important; }
      .roli-routility-value {
        box-sizing: border-box !important;
        width: calc(100% - 10px) !important;
        margin: -1px 5px 5px !important;
        padding: 3px 8px !important;
        color: #8f98a5 !important;
        font: 700 9px/13px Arial, Helvetica, sans-serif !important;
        letter-spacing: .3px !important;
        white-space: nowrap !important;
        overflow: visible !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
        text-align: left !important;
      }
      .roli-routility-value .roli-routility-label {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: clip !important;
      }
      .roli-routility-value .roli-routility-number {
        flex: 0 0 auto !important;
        min-width: max-content !important;
        white-space: nowrap !important;
        overflow: visible !important;
        text-overflow: clip !important;
        font-weight: 800 !important;
      }

      .${TOTAL_CLASS} {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 12px !important;
        box-sizing: border-box !important;
        width: 100% !important;
        min-width: 0 !important;
        min-height: 42px !important;
        margin: 7px 0 !important;
        padding: 7px 10px !important;
        border: 1px solid var(--roli-total-border) !important;
        background-color: var(--roli-total-bg) !important;
        border-radius: 7px !important;
        color: inherit !important;
        font-family: Arial, Helvetica, sans-serif !important;
        line-height: 1 !important;
        overflow: hidden !important;
        clear: both !important;
        position: relative !important;
        z-index: 2 !important;
      }
      .${TOTAL_CLASS} .roli-total-label {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        opacity: .72 !important;
        font-size: 10px !important;
        line-height: 14px !important;
        font-weight: 700 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .${TOTAL_CLASS} .roli-value {
        flex: 0 0 auto !important;
        min-width: max-content !important;
        margin: 0 !important;
        padding: 0 !important;
        color: var(--roli-total-text) !important;
        font-size: 15px !important;
        line-height: 18px !important;
        font-weight: 800 !important;
        text-align: right !important;
        white-space: nowrap !important;
      }
      @media (max-width: 480px) {
        .${VALUE_CLASS} { width: calc(100% - 8px) !important; margin-left: 4px !important; margin-right: 4px !important; padding-left: 7px !important; padding-right: 7px !important; }
        .${TOTAL_CLASS} { gap: 8px !important; padding-left: 8px !important; padding-right: 8px !important; }
        .${TOTAL_CLASS} .roli-value { font-size: 14px !important; }
      }

      .roli-trade-readout { display:inline-flex !important; align-items:center !important; gap:5px !important; margin-left:8px !important; padding:3px 7px !important; border-radius:5px !important; font:700 11px/14px Arial,sans-serif !important; white-space:nowrap !important; vertical-align:middle !important; }
      .roli-trade-win { color:#16803a !important; background:rgba(22,128,58,.10) !important; border:1px solid rgba(22,128,58,.24) !important; }
      .roli-trade-loss { color:#b42318 !important; background:rgba(180,35,24,.10) !important; border:1px solid rgba(180,35,24,.24) !important; }
      .roli-trade-even { color:#666 !important; background:rgba(100,100,100,.08) !important; border:1px solid rgba(100,100,100,.18) !important; }
      .roli-bulk-toolbar { display:flex !important; align-items:center !important; gap:8px !important; margin:10px 0 !important; padding:8px 10px !important; border-radius:7px !important; background:rgba(0,0,0,.04) !important; border:1px solid rgba(0,0,0,.12) !important; font:12px/16px Arial,sans-serif !important; }
      .roli-bulk-toolbar button { border:1px solid #aaa !important; border-radius:5px !important; background:#fff !important; color:#222 !important; padding:5px 9px !important; cursor:pointer !important; font:700 12px/16px Arial,sans-serif !important; }
      .roli-bulk-toolbar button:disabled { opacity:.45 !important; cursor:not-allowed !important; }
      .roli-trade-select { margin-right:7px !important; transform:scale(1.05) !important; vertical-align:middle !important; }

      #${POPUP_ID} { position:fixed; inset:0; z-index:2147483646; display:none; }
      #${POPUP_ID}.open { display:block; }
      #${POPUP_ID} .roli-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.48); }
      #${POPUP_ID} .roli-dialog { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(430px,calc(100vw - 28px)); max-height:min(720px,calc(100vh - 28px)); overflow:auto; box-sizing:border-box; padding:18px; border-radius:10px; background:#fff; color:#222; box-shadow:0 12px 40px rgba(0,0,0,.35); font:14px/1.4 Arial,Helvetica,sans-serif; }
      #${POPUP_ID} .roli-close { position:absolute; right:10px; top:8px; border:0; background:transparent; font-size:24px; line-height:24px; cursor:pointer; color:#666; }
      #${POPUP_ID} h2 { margin:0 34px 2px 0; font-size:19px; line-height:24px; }
      #${POPUP_ID} .roli-acronym { opacity:.6; margin-bottom:14px; }
      #${POPUP_ID} .roli-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      #${POPUP_ID} .roli-stat { border:1px solid #ddd; border-radius:7px; padding:9px; }
      #${POPUP_ID} .roli-stat b { display:block; font-size:10px; text-transform:uppercase; opacity:.6; margin-bottom:2px; }
      #${POPUP_ID} .roli-stat span { font-weight:700; }

      #${STATUS_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        max-width: min(320px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 8px 10px;
        border-radius: 7px;
        background: rgba(20,20,20,.94);
        color: #fff;
        font: 12px/16px Arial, sans-serif;
        box-shadow: 0 3px 14px rgba(0,0,0,.25);
        pointer-events: none;
      }
    `
    document.documentElement.appendChild(style);
  }

  function status(text, hide = false) {
    let el = document.getElementById(STATUS_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = STATUS_ID;
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.display = hide ? "none" : "block";
  }

  function getCatalogId(href) {
    if (!href) return null;
    const m = String(href).match(/\/catalog\/(\d+)/i);
    return m ? m[1] : null;
  }

  function getItemIdFromCard(card) {
    // Roblox trade/inventory cards normally contain a catalog link.
    const link = card.querySelector?.('a[href*="/catalog/"]');
    return getCatalogId(link?.getAttribute("href") || link?.href);
  }

  function rawItem(id) {
    const d = itemData?.items?.[id];
    return Array.isArray(d) ? d : null;
  }

  function enumText(value, labels) {
    const n = Number(value);
    if (n === -1) return "None";
    return Object.prototype.hasOwnProperty.call(labels, n) ? labels[n] : String(value ?? "None");
  }

  function flagText(value) {
    if (value === true || value === 1 || value === "1" || value === "true") return "Yes";
    if (value === false || value === 0 || value === "0" || value === "false" || value == null || value === -1 || value === "None") return "None";
    return String(value);
  }

  function getItemInfo(id) {
    const d = rawItem(id);
    if (!d) return null;
    const rap = Number(d[2]) > 0 ? Number(d[2]) : 0;
    const value = Number(d[3]) > 0 ? Number(d[3]) : (Number(d[4]) > 0 ? Number(d[4]) : rap);
    return {
      id, name: d[0] || `Item ${id}`, acronym: d[1] || "", rap, value,
      demand: enumText(d[5], {0:"Terrible",1:"Low",2:"Normal",3:"High",4:"Amazing"}),
      trend: enumText(d[6], {0:"Lowering",1:"Unstable",2:"Stable",3:"Raising",4:"Fluctuating"}),
      projected: flagText(d[7]), rare: flagText(d[9])
    };
  }

  async function getRoutilityValue(id) {
    if (!routilityEnabled) return null;
    const key = String(id);
    const cached = routilityCache.get(key);
    if (cached && Date.now() - cached.at < ROUTILITY_CACHE_TTL) return cached.value;
    try {
      const result = await browser.runtime.sendMessage({ type: "getRoutilityValue", id: key });
      const value = Number(result?.value);
      if (!result?.ok || !Number.isFinite(value) || value <= 0) return null;
      routilityCache.set(key, { value, at: Date.now() });
      return value;
    } catch (_) {
      return null;
    }
  }

  function getRoutilityLabel(card) {
    return card?.querySelector?.('.roli-routility-value');
  }

  function ensurePopup() {
    let popup = document.getElementById(POPUP_ID);
    if (popup) return popup;
    popup = document.createElement("div"); popup.id = POPUP_ID;
    popup.innerHTML = `<div class="roli-backdrop"></div><div class="roli-dialog" role="dialog" aria-modal="true"><button class="roli-close" type="button" aria-label="Close">×</button><div class="roli-content"></div></div>`;
    document.documentElement.appendChild(popup);
    popup.querySelector(".roli-backdrop").addEventListener("click", () => popup.classList.remove("open"));
    popup.querySelector(".roli-close").addEventListener("click", () => popup.classList.remove("open"));
    return popup;
  }

  function showPopup(id) {
    const info = getItemInfo(id);
    if (!info) return;
    const popup = ensurePopup();
    const c = popup.querySelector(".roli-content");
    c.innerHTML = `<h2></h2><div class="roli-acronym"></div><div class="roli-grid"></div>`;
    c.querySelector("h2").textContent = info.name;
    c.querySelector(".roli-acronym").textContent = info.acronym ? `Acronym: ${info.acronym}` : `Asset ID: ${id}`;
    const stats = [["RAP",fmt(info.rap)],["Value",fmt(info.value)],["Demand",info.demand],["Trend",info.trend],["Projected",info.projected],["Rare",info.rare]];
    const grid = c.querySelector(".roli-grid");
    for (const [k,v] of stats) { const el=document.createElement("div"); el.className="roli-stat"; el.innerHTML=`<b></b><span></span>`; el.querySelector("b").textContent=k; el.querySelector("span").textContent=v; grid.appendChild(el); }
    popup.classList.add("open");
  }

  function findRoot() {
    return (
      document.querySelector('[data-testid="trade-page"]') ||
      document.querySelector("#trade-page") ||
      document.querySelector(".trade-page") ||
      document.querySelector("#container-main") ||
      document.body
    );
  }

  function findTotalRows(root) {
    const rows = [...root.querySelectorAll("div.robux-line")];
    return rows.filter((row) => {
      if (row.classList.contains(TOTAL_CLASS)) return false;
      const text = (row.textContent || "").replace(/\s+/g, " ").trim();
      return text === "Total Value:" || text.includes("Total Value:");
    });
  }

  function rect(el) {
    const r = el?.getBoundingClientRect?.();
    return r && r.width >= 1 && r.height >= 1 ? r : null;
  }

  function addInlineValue(card, id) {
    const info = getItemInfo(id);
    if (!info || !info.value) return { value: 0, rap: 0 };
    if (!card.querySelector(`.${VALUE_CLASS}`)) {
      const target = card.querySelector(".item-card-caption") || card.querySelector(".item-card-name") || card;
      const row = document.createElement("div");
      row.className = VALUE_CLASS; row.dataset.itemId = id;
      const main = document.createElement("div"); main.className="roli-main";
      const label = document.createElement("span"); label.className="roli-label"; label.textContent="Value";
      const number = document.createElement("span"); number.className="roli-number"; number.textContent=fmt(info.value);
      main.append(label,number); row.append(main); target.appendChild(row);
      row.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); showPopup(id); });
    }
    const existing = getRoutilityLabel(card);
    if (routilityEnabled) {
      const valueRow = card.querySelector(`.${VALUE_CLASS}`);
      if (valueRow && !existing) {
        const rrow = document.createElement("div");
        rrow.className = "roli-routility-value";
        rrow.dataset.itemId = id;
        const rlabel = document.createElement("span");
        rlabel.className = "roli-routility-label";
        rlabel.textContent = "RoUtility USD";
        const rnumber = document.createElement("span");
        rnumber.className = "roli-routility-number";
        rnumber.textContent = "Loading…";
        rrow.append(rlabel, rnumber);
        valueRow.insertAdjacentElement("afterend", rrow);
        getRoutilityValue(id).then(v => {
          if (!rrow.isConnected) return;
          rnumber.textContent = v == null ? "N/A" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
        });
      }
    } else if (existing) {
      existing.remove();
    }
    return { value: info.value, rap: info.rap };
  }

  function renderTotals(root) {
    // Remove only our previous total rows; never touch Roblox's own rows.
    root.querySelectorAll(`.${TOTAL_CLASS}`).forEach((el) => el.remove());

    const valueRows = [...root.querySelectorAll(`.${VALUE_CLASS}[data-item-id]`)]
      .map((el) => {
        const id = String(el.dataset.itemId || "");
        const r = rect(el);
        return id && r ? { id, r } : null;
      })
      .filter(Boolean);

    // Prefer our rendered value rows because they remain present even when
    // Roblox changes the catalog-link/card structure (notably for one-item trades).
    // Fall back to catalog links for pages where value rows have not rendered yet.
    const links = valueRows.length ? valueRows : [...root.querySelectorAll('a[href*="/catalog/"]')]
      .map((a) => {
        const id = getCatalogId(a.getAttribute("href") || a.href);
        const r = rect(a);
        return id && r ? { id, r } : null;
      })
      .filter(Boolean);

    const totalRows = findTotalRows(root)
      .map((row) => ({ row, r: rect(row) }))
      .filter((x) => x.r);

    if (!totalRows.length || !links.length) return;

    // On the trade page, the two Total Value rows are on the right half.
    const width = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const rows = totalRows
      .filter((x) => x.r.left + x.r.width / 2 >= width * 0.50)
      .sort((a, b) => a.r.top - b.r.top)
      .slice(0, 2);

    rows.forEach((entry, index) => {
      const current = entry.r;
      const next = rows[index + 1]?.r;
      const yMin = index ? rows[index - 1].r.bottom + 6 : current.top - 1600;
      const yMax = next ? next.top - 6 : current.top + 1600;
      const centerX = current.left + current.width / 2;

      const counts = new Map();
      for (const item of links) {
        const itemCenterX = item.r.left + item.r.width / 2;
        if (item.r.bottom > current.top + 8) continue;
        if (item.r.top < yMin || item.r.top > yMax) continue;
        if (Math.abs(itemCenterX - centerX) > 420) continue;
        counts.set(item.id, (counts.get(item.id) || 0) + 1);
      }

      let valueTotal = 0;
      let count = 0;

      for (const [id, qty] of counts) {
        const info = getItemInfo(id);
        if (!info) continue;
        valueTotal += info.value * qty;
        count += qty;
      }

      if (!count) return;

      const row = document.createElement("div");
      row.className = TOTAL_CLASS;

      const label = document.createElement("span");
      label.className = "roli-total-label";
      label.textContent = `Rolimon's Value · ${count} item${count === 1 ? "" : "s"}`;

      const value = document.createElement("span");
      value.className = "roli-value";
      value.textContent = fmt(valueTotal);

      row.append(label, value);
      entry.row.insertAdjacentElement("afterend", row);
    });
  }

  function tradeIdFromHref(href) {
    const m = String(href || "").match(/\/trades\/(\d+)(?:[/?#]|$)/i);
    return m ? m[1] : null;
  }

  async function getAuthenticatedUserId() {
    if (authenticatedUserId) return authenticatedUserId;
    try {
      const r = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials:"include", cache:"no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      authenticatedUserId = j?.id ? String(j.id) : null;
    } catch (_) {}
    return authenticatedUserId;
  }

  function tradeAssetIds(offer) {
    const assets = Array.isArray(offer?.userAssets) ? offer.userAssets : [];
    return assets.map(a => String(a?.assetId ?? a?.id ?? "")).filter(Boolean);
  }

  async function getTradeInfo(id) {
    if (tradeInfoCache.has(id)) return tradeInfoCache.get(id);
    const promise = (async () => {
      const r = await fetch(`https://trades.roblox.com/v1/trades/${encodeURIComponent(id)}`, { credentials:"include", cache:"no-store" });
      if (!r.ok) throw new Error(`trade ${id}: HTTP ${r.status}`);
      const trade = await r.json();
      const offers = Array.isArray(trade?.offers) ? trade.offers : [];
      if (offers.length < 2) return null;
      const me = await getAuthenticatedUserId();
      let mine = offers.find(o => String(o?.user?.id ?? o?.user?.id) === String(me));
      if (!mine) mine = offers[0];
      const theirs = offers.find(o => o !== mine) || offers[1];
      const valueOf = (offer) => tradeAssetIds(offer).reduce((sum, assetId) => sum + (getItemInfo(assetId)?.value || 0), 0);
      const mineValue = valueOf(mine), theirsValue = valueOf(theirs);
      return { mineValue, theirsValue, delta: theirsValue - mineValue };
    })();
    tradeInfoCache.set(id, promise);
    try { return await promise; } catch (e) { tradeInfoCache.delete(id); throw e; }
  }

  function closestTradeContainer(anchor) {
    let el = anchor;
    for (let i=0; i<6 && el; i++, el=el.parentElement) {
      const tradeLinks = el.querySelectorAll?.('a[href*="/trades/"]')?.length || 0;
      if (tradeLinks === 1 && (el.offsetHeight >= 35 || el.offsetWidth >= 250)) return el;
    }
    return anchor.parentElement || anchor;
  }

  async function addTradeReadout(anchor, id) {
    if (anchor.dataset.roliTradeReadout === id) return;
    anchor.dataset.roliTradeReadout = id;
    try {
      const info = await getTradeInfo(id);
      if (!info) return;
      const host = closestTradeContainer(anchor);
      if (host.querySelector(`.roli-trade-readout[data-trade-id="${id}"]`)) return;
      const el = document.createElement("span");
      el.className = "roli-trade-readout " + (info.delta > 0 ? "roli-trade-win" : info.delta < 0 ? "roli-trade-loss" : "roli-trade-even");
      el.dataset.tradeId = id;
      el.textContent = info.delta > 0 ? `WIN +${fmt(info.delta)}` : info.delta < 0 ? `LOSS ${fmt(info.delta)}` : "EVEN";
      anchor.insertAdjacentElement("afterend", el);
    } catch (_) { delete anchor.dataset.roliTradeReadout; }
  }

  function findTradeAnchors(root) {
    return [...root.querySelectorAll('a[href*="/trades/"]')].filter(a => tradeIdFromHref(a.getAttribute("href") || a.href));
  }

  function ensureBulkToolbar(root) {
    if (!/^\/trades\/outbound(?:\/|$)/i.test(location.pathname)) return;
    if (root.querySelector(".roli-bulk-toolbar")) return;
    const anchors = findTradeAnchors(root);
    if (!anchors.length) return;
    const toolbar = document.createElement("div");
    toolbar.className = "roli-bulk-toolbar";
    toolbar.innerHTML = `<button type="button" data-roli-select> Select all </button><button type="button" data-roli-cancel disabled>Cancel selected</button><span data-roli-count>0 selected</span>`;
    const first = closestTradeContainer(anchors[0]);
    first.parentElement?.insertBefore(toolbar, first);
    const cancel = toolbar.querySelector("[data-roli-cancel]");
    const count = toolbar.querySelector("[data-roli-count]");
    const boxes = () => findTradeAnchors(root).map(a => ({a, id:tradeIdFromHref(a.getAttribute("href") || a.href), box:a.parentElement?.querySelector?.(".roli-trade-select")}));
    const update = () => { const n=boxes().filter(x=>x.box?.checked).length; count.textContent=`${n} selected`; cancel.disabled=!n; };
    toolbar.querySelector("[data-roli-select]").addEventListener("click", () => { boxes().forEach(x=>{if(x.box)x.box.checked=true}); update(); });
    cancel.addEventListener("click", async () => {
      const selected = boxes().filter(x=>x.box?.checked).map(x=>x.id).filter(Boolean);
      if (!selected.length) return;
      if (!confirm(`Cancel ${selected.length} outbound trade${selected.length === 1 ? "" : "s"}?`)) return;
      cancel.disabled=true; status(`Cancelling ${selected.length} trade${selected.length===1?"":"s"}…`);
      let ok=0;
      let csrfToken = null;
      for (const id of selected) {
        try {
          const headers = {"Content-Type":"application/json"};
          if (csrfToken) headers["X-CSRF-TOKEN"] = csrfToken;
          let r = await fetch(`https://trades.roblox.com/v1/trades/${encodeURIComponent(id)}/cancel`, {method:"POST", credentials:"include", headers});
          if (r.status === 403) {
            const token = r.headers.get("x-csrf-token");
            if (token) {
              csrfToken = token;
              headers["X-CSRF-TOKEN"] = csrfToken;
              r = await fetch(`https://trades.roblox.com/v1/trades/${encodeURIComponent(id)}/cancel`, {method:"POST", credentials:"include", headers});
            }
          }
          if (r.ok) ok++;
        } catch (_) {}
      }
      status(`${ok} trade${ok===1?"":"s"} cancelled.`, false);
      setTimeout(()=>location.reload(), 500);
    });
    findTradeAnchors(root).forEach(a => {
      const host=closestTradeContainer(a); if(host.querySelector(".roli-trade-select")) return;
      const box=document.createElement("input"); box.type="checkbox"; box.className="roli-trade-select"; box.title="Select trade"; box.addEventListener("change",update); a.insertAdjacentElement("beforebegin",box);
    });
    update();
  }

  function renderTradeReadouts(root) {
    if (!/^\/trades(?:\/|$)/i.test(location.pathname)) return;
    findTradeAnchors(root).forEach(a => addTradeReadout(a, tradeIdFromHref(a.getAttribute("href") || a.href)));
    ensureBulkToolbar(root);
  }

  function render() {
    if (rendering || !itemData) return;
    rendering = true;

    try {
      const root = findRoot();

      // Roblox frequently replaces trade cards without a full page navigation.
      root.querySelectorAll(
        '.item-card-container, .list-item, [class*="item-card-container"], [class*="item-card"]'
      ).forEach((card) => {
        const id = getItemIdFromCard(card);
        if (id) addInlineValue(card, id);
      });

      renderTotals(findRoot());
      renderTradeReadouts(root);
      status("", true);
    } finally {
      rendering = false;
    }
  }

  function scheduleRender(delay = 150) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  async function loadValues() {
    status("Loading Rolimon's values…");
    try {
      const setting = await browser.storage.local.get("routilityEnabled");
      routilityEnabled = !!setting.routilityEnabled;
      const result = await browser.runtime.sendMessage({ type: "getRolimonsItems" });
      if (!result?.ok || !result.items) {
        throw new Error(result?.error || "No item data returned");
      }

      itemData = { items: result.items };
      render();
    } catch (err) {
      console.error("[Rolimon's]", err);
      status("Rolimon's values could not be loaded. Check the extension permissions.");
    }
  }

  if (!IS_TRADE_PAGE) return;

  ensureStyle();
  loadColors();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.rolimonsColors) {
      colors = { ...DEFAULT_COLORS, ...(changes.rolimonsColors.newValue || {}) };
      applyColorVariables();
    }
    if (changes.routilityEnabled) {
      routilityEnabled = !!changes.routilityEnabled.newValue;
      routilityCache.clear();
      scheduleRender(50);
    }
  });

  // Roblox is a SPA. Watch for trade cards being added/replaced.
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.addedNodes.length || m.removedNodes.length || m.type === "characterData")) {
      scheduleRender();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  window.addEventListener("popstate", () => scheduleRender(300));
  window.addEventListener("hashchange", () => scheduleRender(300));

  loadValues();
})();
