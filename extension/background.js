// background.js — MV3 service worker for SarcQuest
// Single source of truth: probability + threshold decision happens here only.

const API_BASE = "https://evelinaivanova-api-sarcasum.hf.space";
const PREDICT_URL = `${API_BASE}/predict`;
const FEEDBACK_URL = `${API_BASE}/feedback`;

// decision knobs (server may differ; feel free to mirror its value)
const THRESHOLD = 0.65;

const BATCH_SIZE = 20;
const MAX_TEXT_LEN = 800;
const REQ_TIMEOUT_MS = 15000;

const activeScans = new Set();

/* ----------------------------- utils ----------------------------- */

function isHttpPage(url) {
  return /^https?:\/\//i.test(url || "");
}

function normalizeBatch(texts) {
  return texts
    .map(t => (t ?? "").toString().replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map(t => (t.length > MAX_TEXT_LEN ? t.slice(0, MAX_TEXT_LEN) : t));
}

async function ensureContentInjected(tabId) {
  // Ping first; inject only if not present
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (pong && pong.ok) return;
  } catch (_) {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

function safeSendMessage(tabId, msg) {
  try { chrome.tabs.sendMessage(tabId, msg, () => void chrome.runtime.lastError); }
  catch {}
}

// NEW: guard runtime broadcasts so they don’t reject when no listener is open
function safeRuntimeSend(msg) {
  try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); }
  catch {}
}

/* ---------------- ML response normalization ---------------- */

function normalizeResponse(data) {
  const normLabel = (l) => {
    const s = String(l ?? "").toUpperCase().trim();
    if (s === "SARCASM") return "SARCASM";
    if (s === "NOT_SARCASM") return "NOT_SARCASM";
    if (s === "LABEL_1" || s === "1") return "SARCASM";
    if (s === "LABEL_0" || s === "0") return "NOT_SARCASM";
    return "NOT_SARCASM";
  };

  const out = { labels: [], scores: [], prob_sarcasm: [] };

  if (data && Array.isArray(data.labels) && Array.isArray(data.scores)) {
    out.labels = data.labels.map(normLabel);
    out.scores = data.scores.map(Number);
    out.prob_sarcasm = out.labels.map((lbl, i) => (lbl === "SARCASM" ? Number(out.scores[i] ?? 0) : 0));
    if (Array.isArray(data.prob_sarcasm)) out.prob_sarcasm = data.prob_sarcasm.map(Number);
    return out;
  }

  if (Array.isArray(data)) {
    out.labels = data.map(x => normLabel(x.label ?? x.prediction ?? x.class));
    out.scores = data.map(x => Number(x.score ?? x.prob ?? x.confidence ?? 0));
    out.prob_sarcasm = data.map((x, i) =>
      typeof x.prob_sarcasm === "number"
        ? Number(x.prob_sarcasm)
        : (out.labels[i] === "SARCASM" ? out.scores[i] : 0)
    );
    return out;
  }

  if (data && Array.isArray(data.predictions)) {
    out.labels = data.predictions.map(x => normLabel(x.label));
    out.scores = data.predictions.map(x => Number(x.score ?? x.prob ?? x.confidence ?? 0));
    out.prob_sarcasm = data.predictions.map((x, i) =>
      typeof x.prob_sarcasm === "number"
        ? Number(x.prob_sarcasm)
        : (out.labels[i] === "SARCASM" ? out.scores[i] : 0)
    );
    return out;
  }

  throw new Error("Bad response shape from /predict");
}

async function doFetch(body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(PREDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: ac.signal
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} — ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(t); }
}

async function predictBatch(cleanTexts) {
  if (!cleanTexts.length) return { labels: [], scores: [], prob_sarcasm: [] };

  const bodies = [
    JSON.stringify({ texts: cleanTexts }),
    JSON.stringify({ inputs: cleanTexts }),
    JSON.stringify({ sentences: cleanTexts }),
    JSON.stringify(cleanTexts),
  ];

  let lastErr;
  for (const b of bodies) {
    try { return normalizeResponse(await doFetch(b)); }
    catch (e) { lastErr = e; console.warn("[predictBatch] fallback:", e.message); }
  }
  throw lastErr || new Error("predictBatch failed");
}

async function predict(texts) {
  const clean = normalizeBatch(texts);
  try {
    return await predictBatch(clean);
  } catch (err) {
    console.warn("[predict] batch failed, per-item fallback:", err?.message);
    const labels = [], scores = [], prob_sarcasm = [];
    for (const t of clean) {
      try {
        const r = await predictBatch([t]);
        labels.push(r.labels[0]);
        scores.push(Number(r.scores[0] ?? 0));
        prob_sarcasm.push(Number(r.prob_sarcasm?.[0] ?? (r.labels[0] === "SARCASM" ? r.scores[0] : 0)));
      } catch (e) {
        labels.push("NOT_SARCASM"); scores.push(0); prob_sarcasm.push(0);
      }
    }
    return { labels, scores, prob_sarcasm };
  }
}

/* ------------------------ context menu ------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({ id: "check-sarcasm", title: "Check sarcasm", contexts: ["selection", "page"] });
  } catch {}
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "check-sarcasm") return;
  if (!tab || !isHttpPage(tab.url)) return;

  try {
    await ensureContentInjected(tab.id);

    // Selection → classify → send only if sarcastic
    const selectedText = info.selectionText?.trim();
    if (selectedText) {
      const { labels, prob_sarcasm } = await predict([selectedText]);
      const p = Number(prob_sarcasm?.[0] ?? 0);
      if (labels?.[0] === "SARCASM" && p >= THRESHOLD) {
        safeSendMessage(tab.id, { type: "HIGHLIGHT_SELECTION", text: selectedText, score: p });
      }
      return;
    }

    // Full page scan
    chrome.tabs.sendMessage(tab.id, { type: "GET_SENTENCES" }, async (jobs) => {
      if (chrome.runtime.lastError || !jobs?.length) return;

      for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const slice = jobs.slice(i, i + BATCH_SIZE);
        const { labels, prob_sarcasm } = await predict(slice.map(j => j.text));

        // keep only decided positives
        const decided = slice
          .map((j, idx) => ({
            containerIndex: j.containerIndex,
            sentence: j.text,
            score: Number(prob_sarcasm?.[idx] ?? 0),
            label: labels[idx]
          }))
          .filter(x => x.label === "SARCASM" && x.score >= THRESHOLD)
          .map(({ containerIndex, sentence, score }) => ({ containerIndex, sentence, score }));

        if (decided.length) {
          safeSendMessage(tab.id, { type: "HIGHLIGHT_SENTENCES", results: decided });
        }
      }
    });
  } catch (e) {
    console.error("[context] failed:", e);
  }
});

/* --------------------- popup <-> background --------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "keep-alive") { sendResponse({ ok: true }); return; }

  if (msg.relay === "START_SCAN") {
    (async () => {
      const tabId = msg.tabId;
      if (!tabId) return;
      if (activeScans.has(tabId)) { safeRuntimeSend({ type: "SCAN_PROGRESS", done: 0, total: 0, note: "already_scanning" }); return; }
      activeScans.add(tabId);

      try {
        const tab = await chrome.tabs.get(tabId);
        if (!isHttpPage(tab.url)) { safeRuntimeSend({ type: "SCAN_ERROR", reason: "Unsupported page" }); return; }
        await ensureContentInjected(tabId);

        chrome.tabs.sendMessage(tabId, { type: "GET_SENTENCES" }, async (jobs) => {
          if (chrome.runtime.lastError) { safeRuntimeSend({ type: "SCAN_ERROR", reason: chrome.runtime.lastError.message }); return; }
          if (!jobs?.length) { safeRuntimeSend({ type: "SCAN_DONE" }); return; }

          safeRuntimeSend({ type: "SCAN_PROGRESS", done: 0, total: jobs.length });
          let done = 0;

          for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
            const slice = jobs.slice(i, i + BATCH_SIZE);
            const { labels, prob_sarcasm } = await predict(slice.map(j => j.text));

            const decided = slice
              .map((j, idx) => ({
                containerIndex: j.containerIndex,
                sentence: j.text,
                score: Number(prob_sarcasm?.[idx] ?? 0),
                label: labels[idx]
              }))
              .filter(x => x.label === "SARCASM" && x.score >= THRESHOLD)
              .map(({ containerIndex, sentence, score }) => ({ containerIndex, sentence, score }));

            if (decided.length) safeSendMessage(tabId, { type: "HIGHLIGHT_SENTENCES", results: decided });

            done += slice.length;
            safeRuntimeSend({ type: "SCAN_PROGRESS", done, total: jobs.length });
          }

          safeRuntimeSend({ type: "SCAN_DONE" });
        });
      } catch (err) {
        safeRuntimeSend({ type: "SCAN_ERROR", reason: String(err?.message || err) });
      } finally {
        activeScans.delete(tabId);
      }
    })();
    return; // keep listener
  }

  if (msg.type === "FEEDBACK") {
    (async () => {
      try {
        await fetch(FEEDBACK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: msg.url,
            text: msg.text,
            predicted_label: msg.predictedLabel,
            score: msg.score,
            user_label: msg.userLabel
          })
        });
      } catch (e) { console.error("[feedback] failed:", e); }
    })();
    return;
  }
});

/* --------------------- Toolbar icon click → scan --------------------- */
/* Since the manifest has no default_popup, clicking the icon should start a scan. */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab?.id || !isHttpPage(tab.url)) {
      safeRuntimeSend({ type: "SCAN_ERROR", reason: "Unsupported page" });
      return;
    }
    if (activeScans.has(tab.id)) {
      safeRuntimeSend({ type: "SCAN_PROGRESS", done: 0, total: 0, note: "already_scanning" });
      return;
    }
    activeScans.add(tab.id);

    await ensureContentInjected(tab.id);

    chrome.tabs.sendMessage(tab.id, { type: "GET_SENTENCES" }, async (jobs) => {
      if (chrome.runtime.lastError) {
        safeRuntimeSend({ type: "SCAN_ERROR", reason: chrome.runtime.lastError.message });
        activeScans.delete(tab.id);
        return;
      }
      if (!jobs?.length) {
        safeRuntimeSend({ type: "SCAN_DONE" });
        activeScans.delete(tab.id);
        return;
      }

      safeRuntimeSend({ type: "SCAN_PROGRESS", done: 0, total: jobs.length });
      let done = 0;

      for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const slice = jobs.slice(i, i + BATCH_SIZE);
        const { labels, prob_sarcasm } = await predict(slice.map(j => j.text));

        const decided = slice
          .map((j, idx) => ({
            containerIndex: j.containerIndex,
            sentence: j.text,
            score: Number(prob_sarcasm?.[idx] ?? 0),
            label: labels[idx]
          }))
          .filter(x => x.label === "SARCASM" && x.score >= THRESHOLD)
          .map(({ containerIndex, sentence, score }) => ({ containerIndex, sentence, score }));

        if (decided.length) {
          safeSendMessage(tab.id, { type: "HIGHLIGHT_SENTENCES", results: decided });
        }

        done += slice.length;
        safeRuntimeSend({ type: "SCAN_PROGRESS", done, total: jobs.length });
      }

      safeRuntimeSend({ type: "SCAN_DONE" });
      activeScans.delete(tab.id);
    });
  } catch (err) {
    safeRuntimeSend({ type: "SCAN_ERROR", reason: String(err?.message || err) });
    if (tab?.id) activeScans.delete(tab.id);
  }
});
