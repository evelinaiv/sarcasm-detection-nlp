// content.js — SarcQuest underline UI (render-only, safe for reinjection)

// content.js — SarcQuest underline UI (render-only, safe for reinjection)

if (!window.SarcQuestContentLoaded) {
  window.SarcQuestContentLoaded = true;

  console.info("[SarcQuest content] loaded");


  /* ---------------------- config ---------------------- */
  const HOVER_HINT = "Click to leave feedback and see the prediction confidence.";

  const SKIP_SELECTORS = [
    "header","nav","footer","aside",
    "h1","h2","h3","h4","h5","h6",
    "button","a","input","textarea","select","label",
    "script","style","svg","img","video","audio","canvas"
  ].join(",");

  const BLOCK_SELECTORS = [
    "article p","article li","main p","main li",
    "p","li","blockquote","section p","div[role='article'] p"
  ].join(",");

  /* ---- NEW: score → colour bands ---- */
  // 65–78%: yellow, 78–90%: orange, 90–100%: red
  const COLORS = [
    { min: 0.65, max: 0.78, color: "#FFD400" }, // yellow
    { min: 0.78, max: 0.90, color: "#FF8C42" }, // orange
    { min: 0.90, max: 1.01, color: "#FF2E2E" }  // red
  ];
  function colorForScore(score){
    for (const c of COLORS) {
      if (score >= c.min && score < c.max) return c.color;
    }
    // default fallbacks (below 0.65 = no underline normally, but keep yellow)
    return "#FFD400";
  }

  /* ------------------- style (inject once) ------------------- */
  (function injectStylesOnce() {
    if (document.getElementById("sarcasm-style")) return;
    const css = `
      .sarcasm-wrap { position:relative; display:inline; }
      .sarcasm-underline{
        text-decoration-line: underline !important;
        text-decoration-style: solid !important;
        text-decoration-thickness: 5px !important;
        text-underline-offset: 6px !important;
        text-decoration-skip-ink: none !important;
        text-decoration-color: var(--sarc-color, #FFDD00) !important;
        cursor: pointer;
      }
      .sarcasm-underline *{ text-decoration: inherit !important; }
      .sarcasm-controls { display:none; align-items:center; gap:8px; }
      .sarcasm-wrap[data-open="1"] .sarcasm-controls { display:inline-flex; }
      .sar-btn { background:#fff; border:1px solid rgba(0,0,0,.15); border-radius:6px; padding:2px 6px; cursor:pointer; font-size:13px; line-height:1.2; }
      .sar-btn:hover { background:#f3f3f3; }
      .sar-btn:active { transform: translateY(1px); }
      .sar-info-wrap { position:relative; display:inline-flex; align-items:center; }
      .sar-info { width:16px; height:16px; border-radius:50%; background:#eee; color:#333; font-weight:700; font-size:11px; display:inline-flex; align-items:center; justify-content:center; line-height:16px; }
      .sar-badge { display:none; position:absolute; top:18px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,.85); color:#fff; border-radius:6px; padding:2px 6px; font-size:10px; white-space:nowrap; z-index:2147483647; }
      .sarcasm-wrap[data-open="1"] .sar-badge { display:block; }
      .sar-hint { position:absolute; bottom:100%; left:0; transform:translateY(-4px); background:rgba(0,0,0,.85); color:#fff; border-radius:6px; padding:4px 6px; font-size:10px; line-height:1.3; max-width:280px; white-space:normal; opacity:0; pointer-events:none; transition:opacity .12s ease; z-index:2147483647; }
      .sar-hint.show { opacity:1; }
    `;
    const style = document.createElement("style");
    style.id = "sarcasm-style";
    style.textContent = css;
    document.documentElement.appendChild(style);
  })();

  /* ---------------------- helpers ---------------------- */

  function splitIntoSentences(text) {
    const norm = (text || "").replace(/\s+/g, " ").trim();
    return norm.split(/(?<=[.!?]["'”’)]*)\s+(?=[A-Z0-9“"'])|[\n\r]+/g).map(s => s.trim()).filter(Boolean);
  }

  function coreLength(s) {
    return (s || "").replace(/[\s'"“”.,!?—–\-:;()[\]]/g, "").length;
  }

  function hasSarcKeyword(text = "") {
    return text.toLowerCase().includes("sarcas");
  }

  function alreadyHighlighted(container, sentence) {
    const s = sentence.trim();
    return Array.from(container.querySelectorAll(".sarcasm-underline"))
      .some(el => el.innerText.trim() === s);
  }

  function closeAllPanels(exceptWrap = null) {
    document.querySelectorAll(".sarcasm-wrap[data-open='1']").forEach(w => { if (w !== exceptWrap) w.dataset.open = "0"; });
  }

  /* -------------------- renderer -------------------- */

  function underlineSentence(containerEl, sentence, score) {
    if (!containerEl || !sentence) return;
    if (alreadyHighlighted(containerEl, sentence)) return;

    const full = containerEl.textContent;
    const start = full.indexOf(sentence);
    if (start === -1) return;
    const end = start + sentence.length;

    const walker = document.createTreeWalker(
      containerEl,
      NodeFilter.SHOW_TEXT,
      { acceptNode(n){ return (n.nodeValue && n.nodeValue.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } }
    );

    let pos = 0, startNode=null, startOffset=0, endNode=null, endOffset=0;
    while (walker.nextNode()) {
      const n = walker.currentNode, len = n.nodeValue.length;
      if (!startNode && start >= pos && start <= pos + len) { startNode = n; startOffset = start - pos; }
      if (end > pos && end <= pos + len) { endNode = n; endOffset = end - pos; break; }
      pos += len;
    }
    if (!startNode || !endNode) return;

    const range = document.createRange();
    try { range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset); } catch { return; }

    const contents = range.extractContents();

    const wrap = document.createElement("span");
    wrap.className = "sarcasm-wrap";
    wrap.dataset.open = "0";

    const underline = document.createElement("span");
    underline.className = "sarcasm-underline";

    // style (colour depends on score)
    const chosenColor = colorForScore(Number(score) || 0);
    underline.style.setProperty("text-decoration-line", "underline", "important");
    underline.style.setProperty("text-decoration-style", "solid", "important");
    underline.style.setProperty("text-decoration-thickness", "3px", "important");
    underline.style.setProperty("text-underline-offset", "6px", "important");
    underline.style.setProperty("text-decoration-skip-ink", "none", "important");
    underline.style.setProperty("text-decoration-color", chosenColor, "important");

    // border-bottom fallback
    const cs = getComputedStyle(underline);
    const applied = cs.textDecorationThickness || cs.getPropertyValue("text-decoration-thickness");
    if (!applied || /auto|from-font/i.test(applied)) {
      underline.style.setProperty("border-bottom", `3px solid ${chosenColor}`, "important");
      underline.style.setProperty("padding-bottom", "2px", "important");
    }

    underline.dataset.sentence  = sentence;
    underline.dataset.score     = String(score);
    underline.dataset.predicted = "SARCASM";
    underline.appendChild(contents);

    const controls = document.createElement("span");
    controls.className = "sarcasm-controls";

    const infoWrap = document.createElement("span");
    infoWrap.className = "sar-info-wrap";
    const info = document.createElement("span");
    info.className = "sar-info";
    info.textContent = "i";
    const badge = document.createElement("span");
    badge.className = "sar-badge";
    badge.textContent = `${(score * 100).toFixed(1)}% sure it's sarcasm`;
    infoWrap.appendChild(info); infoWrap.appendChild(badge);

    const yes = document.createElement("button");
    yes.className = "sar-btn"; yes.type = "button"; yes.textContent = "👍"; yes.title = "Mark as sarcastic";
    yes.onclick = (e) => { e.stopPropagation(); sendFeedback(underline, "SARCASM"); };

    const no = document.createElement("button");
    no.className = "sar-btn"; no.type = "button"; no.textContent = "👎"; no.title = "Mark as NOT sarcastic";
    no.onclick = (e) => { e.stopPropagation(); sendFeedback(underline, "NOT_SARCASM"); };

    controls.appendChild(infoWrap); controls.appendChild(yes); controls.appendChild(no);

    underline.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = wrap.dataset.open === "1";
      closeAllPanels(wrap);
      wrap.dataset.open = open ? "0" : "1";
    });

    const hint = document.createElement("span");
    hint.className = "sar-hint";
    hint.textContent = HOVER_HINT;

    wrap.appendChild(underline);
    wrap.appendChild(controls);
    wrap.appendChild(hint);

    range.insertNode(wrap);
  }

  /* -------------------- feedback -------------------- */
  function sendFeedback(underlineEl, userLabel) {
    chrome.runtime.sendMessage({
      type: "FEEDBACK",
      url: location.href,
      text: underlineEl.dataset.sentence,
      predictedLabel: underlineEl.dataset.predicted || "SARCASM",
      score: Number(underlineEl.dataset.score),
      userLabel
    }, () => void chrome.runtime.lastError);
  }

  /* -------------------- collect sentences -------------------- */
  function collectSentenceJobs() {
    const roots = Array.from(document.querySelectorAll(BLOCK_SELECTORS))
      .filter(el => !el.closest(SKIP_SELECTORS) && el.offsetParent !== null);

    const jobs = [];
    roots.forEach((el, i) => {
      const sentences = splitIntoSentences(el.innerText);
      sentences.forEach((s) => {
        if (coreLength(s) < 6) return;
        if (hasSarcKeyword(s)) return;
        jobs.push({ containerIndex: i, text: s });
      });
    });
    return { roots, jobs };
  }

  /* -------------------- messaging -------------------- */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PING") { sendResponse({ ok: true }); return; }

    if (msg.type === "GET_SENTENCES") {
      const { jobs } = collectSentenceJobs();
      sendResponse(jobs);
      return;
    }

    if (msg.type === "HIGHLIGHT_SENTENCES") {
      const roots = Array.from(document.querySelectorAll(BLOCK_SELECTORS))
        .filter(el => !el.closest(SKIP_SELECTORS) && el.offsetParent !== null);

      // Background already filtered decisions -> just render
      for (const { containerIndex, sentence, score } of msg.results || []) {
        const el = roots[containerIndex];
        if (el) underlineSentence(el, sentence, score);
      }
      return;
    }

    if (msg.type === "HIGHLIGHT_SELECTION") {
      // Background already decided; just render the selected snippet
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (coreLength(text) < 6) return;

      let node = sel.getRangeAt(0).commonAncestorContainer;
      if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      const container = node ? node.closest(BLOCK_SELECTORS) : null;
      if (!container) return;

      underlineSentence(container, text, Number(msg.score ?? 0));
      return;
    }

    if (msg.type === "CLEAR_ALL") {
      document.querySelectorAll(".sarcasm-wrap").forEach(wrap => {
        const underline = wrap.querySelector(".sarcasm-underline");
        if (!underline) { wrap.remove(); return; }
        const parent = wrap.parentNode;
        const frag = document.createDocumentFragment();
        while (underline.firstChild) frag.appendChild(underline.firstChild);
        parent.replaceChild(frag, wrap);
      });
      return;
    }
  });

} // <-- end reinjection guard
