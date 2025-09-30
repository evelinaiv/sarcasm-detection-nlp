// popup.js — minimal, working, with beep + scanning UI

// ---- DOM ----
const muteBtn  = document.getElementById("muteBtn");
const scanBtn  = document.getElementById("scanBtn");
const doneBtn  = document.getElementById("doneBtn");
const pctEl    = document.getElementById("progressPct");
const barFill  = document.getElementById("barFill");

// ---- State ----
const STORAGE_KEY_MUTED = "sq_muted";
let isMuted = false;
let isScanning = false;

// ---- Helpers (the ones that went missing) ----
function setProgress(p) {
  if (!pctEl || !barFill) return;
  const pct = Math.max(0, Math.min(100, Math.round(p)));
  pctEl.textContent = pct + "%";
  barFill.style.width = pct + "%";
}

function setScanning(on) {
  isScanning = !!on;

  // start/stop the horse animation
  const horse = document.querySelector(".horse");
  if (horse) {
    horse.classList.toggle("horse--running", isScanning);
    horse.style.willChange = isScanning ? "transform" : ""; // micro perf hint
  }

  // existing UI updates
  const label = (scanBtn && (scanBtn.querySelector("span") || scanBtn)) || null;
  if (label) label.textContent = isScanning ? "Scanning …" : "Scan page";
  if (scanBtn) scanBtn.disabled = isScanning;
}


// ---- Beep ----
function beep(freq = 1000, duration = 0.40) {
  if (isMuted) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "triangle";            // louder than sine
    osc.frequency.value = freq;

    const now = ac.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.04); // volume
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch {}
}

// ---- Mute storage ----
async function loadMuted() {
  const obj = await chrome.storage.local.get({ [STORAGE_KEY_MUTED]: false });
  isMuted = !!obj[STORAGE_KEY_MUTED];
  if (muteBtn) muteBtn.textContent = isMuted ? "🔇" : "🔊";
}
async function saveMuted(v) {
  isMuted = !!v;
  await chrome.storage.local.set({ [STORAGE_KEY_MUTED]: isMuted });
  if (muteBtn) muteBtn.textContent = isMuted ? "🔇" : "🔊";
}

// ---- Init ----
document.addEventListener("DOMContentLoaded", async () => {
  await loadMuted();
  chrome.runtime.sendMessage({ type: "keep-alive" }, () => void chrome.runtime.lastError);
  setScanning(false);
  setProgress(0);
});

// ---- Events ----
muteBtn?.addEventListener("click", () => saveMuted(!isMuted));

scanBtn?.addEventListener("click", async () => {
  if (isScanning) return;
  setProgress(0);
  setScanning(true);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { setScanning(false); return; }
  chrome.runtime.sendMessage({ relay: "START_SCAN", tabId: tab.id }, () => void chrome.runtime.lastError);
});

doneBtn?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "CLEAR_ALL" }, () => void chrome.runtime.lastError);
  setScanning(false);
  setProgress(0);
});

// ---- Background -> Popup bridge ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SCAN_PROGRESS") {
    const pct = msg.total ? Math.round((msg.done / msg.total) * 100) : 0;
    setScanning(true);
    setProgress(pct);
  }
  if (msg.type === "SCAN_DONE") {
    setScanning(false);
    setProgress(100);
    beep(1000, 0.40);
  }
  if (msg.type === "SCAN_ERROR") {
    setScanning(false);
    setProgress(0);
    try { barFill?.animate([{transform:"translateX(0)"},{transform:"translateX(6px)"},{transform:"translateX(0)"}],{duration:250}); } catch {}
    beep(330, 0.25);
  }
  if (msg.type === "SCAN_CANCELED") {
    setScanning(false);
    setProgress(0);
    beep(500, 0.15);
  }
});
