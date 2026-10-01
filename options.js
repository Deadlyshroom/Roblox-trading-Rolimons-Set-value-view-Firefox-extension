const NOTIFY_DEFAULTS = { inboundEnabled: false, inboundSound: false };

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
  const stored = await browser.storage.local.get(["rolimonsColors", "rolimonsTradeNotifications"]);
  const colors = { ...DEFAULTS, ...(stored.rolimonsColors || {}) };
  ids.forEach(id => document.getElementById(id).value = colors[id]);
  updatePreview(colors);
  const notify = { ...NOTIFY_DEFAULTS, ...(stored.rolimonsTradeNotifications || {}) };
  document.getElementById("inboundEnabled").checked = !!notify.inboundEnabled;
  document.getElementById("inboundSound").checked = !!notify.inboundSound;
}

function read() {
  return Object.fromEntries(ids.map(id => [id, document.getElementById(id).value]));
}

function updatePreview(c) {
  const root = document.documentElement;
  root.style.setProperty("--preview-text", c.valueText);
  root.style.setProperty("--preview-bg", hexToRgba(c.valueText, .08));
  root.style.setProperty("--preview-border", hexToRgba(c.valueText, .24));
  document.querySelector(".preview-total").style.setProperty("--preview-text", c.totalText);
  document.querySelector(".preview-total").style.setProperty("--preview-bg", hexToRgba(c.totalText, .09));
  document.querySelector(".preview-total").style.setProperty("--preview-border", hexToRgba(c.totalText, .26));
}

async function save() {
  const colors = read();
  const notifications = {
    inboundEnabled: document.getElementById("inboundEnabled").checked,
    inboundSound: document.getElementById("inboundSound").checked
  };
  await browser.storage.local.set({ rolimonsColors: colors, rolimonsTradeNotifications: notifications });
  updatePreview(colors);
  document.getElementById("saved").textContent = "Saved";
  clearTimeout(save.timer);
  save.timer = setTimeout(() => document.getElementById("saved").textContent = "Saved automatically", 1000);
}

ids.forEach(id => document.getElementById(id).addEventListener("input", save));
document.getElementById("inboundEnabled").addEventListener("change", save);
document.getElementById("inboundSound").addEventListener("change", save);
document.getElementById("reset").addEventListener("click", async () => {
  ids.forEach(id => document.getElementById(id).value = DEFAULTS[id]);
  await save();
});

load();
