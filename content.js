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

  let inboundPollTimer = null;
  let inboundInitialized = false;
  const INBOUND_KEY = "rolimonsSeenInboundTrades";

  async function pollInboundTrades() {
    try {
      const settings = await browser.storage.local.get("rolimonsTradeNotifications");
      const cfg = settings.rolimonsTradeNotifications || {};
      if (!cfg.inboundEnabled) return;

      const response = await fetch("https://trades.roblox.com/v1/trades/inbound?sortOrder=Desc&limit=10", {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = await response.json();
      const trades = Array.isArray(data?.data) ? data.data : [];
      const ids = trades.map(t => String(t.id)).filter(Boolean);
      if (!ids.length) return;

      const stored = await browser.storage.local.get(INBOUND_KEY);
      const seen = new Set(Array.isArray(stored[INBOUND_KEY]) ? stored[INBOUND_KEY].map(String) : []);

      if (!inboundInitialized) {
        ids.forEach(id => seen.add(id));
        inboundInitialized = true;
        await browser.storage.local.set({ [INBOUND_KEY]: [...seen].slice(-50) });
        return;
      }

      const fresh = trades.filter(t => t?.id != null && !seen.has(String(t.id)));
      for (const trade of fresh.reverse()) {
        const id = String(trade.id);
        seen.add(id);
        await browser.runtime.sendMessage({
          type: "rolimonsInboundTrade",
          tradeId: id,
          message: "You received a new inbound trade."
        });
        if (cfg.inboundSound) playInboundSound();
      }
      await browser.storage.local.set({ [INBOUND_KEY]: [...seen].slice(-50) });
    } catch (e) {
      // Polling is optional; do not interfere with the trade UI if the endpoint is unavailable.
      console.debug("[Rolimon's] inbound poll skipped", e);
    }
  }

  function playInboundSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
      osc.addEventListener("ended", () => ctx.close());
    } catch (_) {}
  }

  function startInboundPolling() {
    clearInterval(inboundPollTimer);
    pollInboundTrades();
    inboundPollTimer = setInterval(pollInboundTrades, 30000);
  }

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
      projected: flagText(d[7]), hyped: flagText(d[8]), rare: flagText(d[9])
    };
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
    const stats = [["RAP",fmt(info.rap)],["Value",fmt(info.value)],["Demand",info.demand],["Trend",info.trend],["Projected",info.projected],["Hyped",info.hyped],["Rare",info.rare]];
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
    return { value: info.value, rap: info.rap };
  }

  function renderTotals(root) {
    // Remove only our previous total rows; never touch Roblox's own rows.
    root.querySelectorAll(`.${TOTAL_CLASS}`).forEach((el) => el.remove());

    const links = [...root.querySelectorAll('a[href*="/catalog/"]')]
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
        if (Math.abs(itemCenterX - centerX) > 260) continue;
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

  startInboundPolling();

  if (!IS_TRADE_PAGE) return;

  ensureStyle();
  loadColors();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.rolimonsColors) return;
    colors = { ...DEFAULT_COLORS, ...(changes.rolimonsColors.newValue || {}) };
    applyColorVariables();
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
