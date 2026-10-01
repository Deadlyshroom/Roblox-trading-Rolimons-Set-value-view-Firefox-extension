const NOTIFY_DEFAULTS = {
  inboundEnabled: false,
  declinedEnabled: false,
  completedEnabled: false,
  inboundSound: false,
  inboundTitle: "New Roblox inbound trade",
  inboundMessage: "You received a new inbound trade.",
  declinedTitle: "Roblox trade declined",
  declinedMessage: "A Roblox trade was declined.",
  completedTitle: "Roblox trade completed",
  completedMessage: "A Roblox trade was completed."
};

const DEFAULTS = {
  valueText: "#00a2ff",
  valueBackground: "#ebf7ff",
  valueBorder: "#b8ddf2",
  totalText: "#00a2ff",
  totalBackground: "#e9f7ff",
  totalBorder: "#b4d9ef"
};

const ids = Object.keys(DEFAULTS);

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

async function load() {
  const stored = await browser.storage.local.get(["rolimonsColors", "routilityEnabled", "rolimonsTradeNotifications"]);
  const colors = { ...DEFAULTS, ...(stored.rolimonsColors || {}) };
  ids.forEach(id => document.getElementById(id).value = colors[id]);
  updatePreview(colors);
  document.getElementById("routilityEnabled").checked = !!stored.routilityEnabled;
  const notify = { ...NOTIFY_DEFAULTS, ...(stored.rolimonsTradeNotifications || {}) };
  document.getElementById("inboundEnabled").checked = !!notify.inboundEnabled;
  document.getElementById("declinedEnabled").checked = !!notify.declinedEnabled;
  document.getElementById("completedEnabled").checked = !!notify.completedEnabled;
  document.getElementById("inboundSound").checked = !!notify.inboundSound;
  ["inboundTitle","inboundMessage","declinedTitle","declinedMessage","completedTitle","completedMessage"].forEach(id => {
    document.getElementById(id).value = notify[id] || NOTIFY_DEFAULTS[id];
  });
}

function read() {
  return Object.fromEntries(ids.map(id => [id, document.getElementById(id).value]));
}

function updatePreview(c) {
  const root = document.documentElement;
  root.style.setProperty("--preview-text", c.valueText);
  root.style.setProperty("--preview-bg", hexToRgba(c.valueBackground, 0.08));
  root.style.setProperty("--preview-border", c.valueBorder);
  document.querySelector(".preview-total").style.setProperty("--preview-text", c.totalText);
  document.querySelector(".preview-total").style.setProperty("--preview-bg", hexToRgba(c.totalBackground, 0.09));
  document.querySelector(".preview-total").style.setProperty("--preview-border", c.totalBorder);
}

async function save() {
  const colors = read();
  const notifications = {
    inboundEnabled: document.getElementById("inboundEnabled").checked,
    declinedEnabled: document.getElementById("declinedEnabled").checked,
    completedEnabled: document.getElementById("completedEnabled").checked,
    inboundSound: document.getElementById("inboundSound").checked,
    inboundTitle: document.getElementById("inboundTitle").value.trim(),
    inboundMessage: document.getElementById("inboundMessage").value.trim(),
    declinedTitle: document.getElementById("declinedTitle").value.trim(),
    declinedMessage: document.getElementById("declinedMessage").value.trim(),
    completedTitle: document.getElementById("completedTitle").value.trim(),
    completedMessage: document.getElementById("completedMessage").value.trim()
  };
  await browser.storage.local.set({
    rolimonsColors: colors,
    routilityEnabled: document.getElementById("routilityEnabled").checked,
    rolimonsTradeNotifications: notifications
  });
  updatePreview(colors);
  document.getElementById("saved").textContent = "Saved";
  clearTimeout(save.timer);
  save.timer = setTimeout(() => document.getElementById("saved").textContent = "Saved automatically", 1000);
}

ids.forEach(id => document.getElementById(id).addEventListener("input", save));
document.getElementById("routilityEnabled").addEventListener("change", save);
document.getElementById("inboundEnabled").addEventListener("change", save);
document.getElementById("declinedEnabled").addEventListener("change", save);
document.getElementById("completedEnabled").addEventListener("change", save);
document.getElementById("inboundSound").addEventListener("change", save);
["inboundTitle","inboundMessage","declinedTitle","declinedMessage","completedTitle","completedMessage"].forEach(id => document.getElementById(id).addEventListener("input", save));
document.getElementById("testNotification").addEventListener("click", async () => {
  const result = await browser.runtime.sendMessage({ type: "testTradeNotification" });
  document.getElementById("notifyTestStatus").textContent = result?.ok ? "Test notification sent" : "Could not send test notification";
  clearTimeout(window.__roliTestTimer);
  window.__roliTestTimer = setTimeout(() => document.getElementById("notifyTestStatus").textContent = "", 1800);
});
document.getElementById("reset").addEventListener("click", async () => {
  ids.forEach(id => document.getElementById(id).value = DEFAULTS[id]);
  await save();
});

load();
