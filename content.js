(() => {
  "use strict";

  // Only run where Roblox actually has trading UI.
  const TRADE_PATH = /^\/(trades|users\/\d+\/trade)(?:\/|$)/i;
  if (!TRADE_PATH.test(location.pathname)) return;

  const VALUE_CLASS = "rolimons-inline-value";
  const TOTAL_CLASS = "rolimons-total-value";
  const STATUS_ID = "rolimons-status";

  let itemData = null;
  let renderTimer = null;
  let rendering = false;

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

  function applyColorVariables() {
    const root = document.documentElement;
    root.style.setProperty("--roli-value-text", colors.valueText);
    root.style.setProperty("--roli-value-bg", colors.valueBackground);
    root.style.setProperty("--roli-value-border", colors.valueBorder);
    root.style.setProperty("--roli-total-text", colors.totalText);
    root.style.setProperty("--roli-total-bg", colors.totalBackground);
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
        border-radius: 6px !important;
        background: var(--roli-value-bg) !important;
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
        flex: 1 1 auto !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        color: var(--roli-value-text) !important;
        font-size: 13px !important;
        line-height: 14px !important;
        font-weight: 800 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .${VALUE_CLASS} .roli-link {
        flex: 0 0 auto !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 18px !important;
        height: 18px !important;
        margin: 0 !important;
        padding: 0 !important;
        border-radius: 4px !important;
        color: inherit !important;
        opacity: .55 !important;
        font-size: 12px !important;
        line-height: 18px !important;
        text-decoration: none !important;
      }
      .${VALUE_CLASS} .roli-link:hover { opacity: 1 !important; }

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
        border-radius: 7px !important;
        background: var(--roli-total-bg) !important;
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
        min-width: 0 !important;
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

  function getItemInfo(id) {
    const d = itemData?.items?.[id];
    if (!Array.isArray(d)) return null;

    // Current Rolimon's item tuple:
    // [name, acronym, RAP, Value, DefaultValue, Demand, Trend, Projected, Hyped, Rare, ...]
    const rap = Number(d[2]) > 0 ? Number(d[2]) : 0;
    const value = Number(d[3]) > 0
      ? Number(d[3])
      : (Number(d[4]) > 0 ? Number(d[4]) : rap);

    return {
      name: d[0] || `Item ${id}`,
      rap,
      value
    };
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
      const target =
        card.querySelector(".item-card-caption") ||
        card.querySelector(".item-card-name") ||
        card;

      const row = document.createElement("div");
      row.className = VALUE_CLASS;
      row.title = `Rolimon's value: ${fmt(info.value)}`;

      const main = document.createElement("div");
      main.className = "roli-main";

      const label = document.createElement("span");
      label.className = "roli-label";
      label.textContent = "Value";

      const number = document.createElement("span");
      number.className = "roli-number";
      number.textContent = fmt(info.value);

      const link = document.createElement("a");
      link.className = "roli-link";
      link.href = `https://www.rolimons.com/item/${id}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "↗";
      link.title = "Open on Rolimon's";

      main.append(label, number, link);
      row.append(main);
      target.appendChild(row);
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

      renderTotals(root);
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
