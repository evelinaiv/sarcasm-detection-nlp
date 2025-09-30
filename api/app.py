# =======================
# app.py — Sarcasm API (with /reload + logging + viewer endpoints + metrics)
# =======================

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Literal
from pathlib import Path
from datetime import datetime
import json, hashlib, time, math
from collections import deque, Counter
import time
import numpy as np
import psutil   # <--- for CPU/memory monitoring

from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline

# ---- live model folder (default) ----
MODEL_PATH = "evelinaivanova/sarcasm-extension-model"

# ---- build / rebuild the HF pipeline ----
def build_pipeline(model_path: str):
    tok = AutoTokenizer.from_pretrained(model_path)
    mdl = AutoModelForSequenceClassification.from_pretrained(model_path)
    return pipeline("text-classification", model=mdl, tokenizer=tok, truncation=True)

clf = build_pipeline(MODEL_PATH)

# ---- FastAPI + CORS ----
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict if needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- storage paths ----
DATA_DIR = Path("data"); DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR  = Path("logs"); LOG_DIR.mkdir(parents=True, exist_ok=True)

FEEDBACK_FILE   = DATA_DIR / "feedback.jsonl"     # user thumbs up/down (persisted)
PREDICTIONS_LOG = LOG_DIR  / "predictions.jsonl"  # per-sentence predictions (for eval)
LATENCY_LOG     = LOG_DIR  / "latency.jsonl"      # <--- NEW for scan time logging
FEEDBACK_FILE.touch(exist_ok=True)
PREDICTIONS_LOG.touch(exist_ok=True)
LATENCY_LOG.touch(exist_ok=True)

# ---- schemas ----
class PredictIn(BaseModel):
    texts: List[str]

class PredictOut(BaseModel):
    labels: List[str]
    scores: List[float]

class FeedbackIn(BaseModel):
    url: Optional[str] = None
    text: str
    predicted_label: Literal["SARCASM", "NOT_SARCASM"]
    score: float
    user_label: Literal["SARCASM", "NOT_SARCASM"]

class ReloadIn(BaseModel):
    model_path: Optional[str] = None  # if omitted, just reload current MODEL_PATH

# ---- label mapping + threshold (optional server-side thresholding) ----
THRESHOLD = 0.50
LABEL_MAP = {
    "LABEL_0": "NOT_SARCASM",
    "LABEL_1": "SARCASM",
    "0": "NOT_SARCASM",
    "1": "SARCASM",
    "sarcastic": "SARCASM",
    "non-sarcastic": "NOT_SARCASM",
}

# ---- metrics state ----
latencies = deque(maxlen=1000)
req_count = 0
start_time = time.time()
confidences = []
threshold_crossings = Counter()
page_metrics = []

# ---- routes ----
@app.get("/")
def root():
    return {"ok": True, "model_path": MODEL_PATH}

@app.post("/predict", response_model=PredictOut)
async def predict(payload: PredictIn, request: Request):
    global req_count
    page_url = request.headers.get("X-Page-URL")

    t0 = time.time()
    outputs = clf(payload.texts)
    api_latency_ms = (time.time() - t0) * 1000.0

    # --- NEW: log latency to file ---
    latency_record = {
        "ts": datetime.utcnow().isoformat(),
        "url": page_url,
        "n_texts": len(payload.texts),
        "latency_ms": api_latency_ms
    }
    with LATENCY_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(latency_record, ensure_ascii=False) + "\n")
    # --------------------------------

    # update latency + request counters
    latencies.append(api_latency_ms)
    req_count += 1

    labels, scores = [], []
    with PREDICTIONS_LOG.open("a", encoding="utf-8") as logf:
        for text, o in zip(payload.texts, outputs):
            raw = str(o["label"])
            score = float(o["score"])
            mapped = LABEL_MAP.get(raw, raw)
            if mapped == "SARCASM" and score < THRESHOLD:
                mapped = "NOT_SARCASM"

            labels.append(mapped)
            scores.append(score)

            # update prediction metrics
            confidences.append(score)
            if mapped == "SARCASM":
                threshold_crossings["sarcasm"] += 1
            else:
                threshold_crossings["non_sarcasm"] += 1

            logf.write(json.dumps({
                "ts": datetime.utcnow().isoformat(),
                "url": page_url,
                "text": (text or "").strip(),
                "pred_label": mapped,
                "score": score,
                "api_latency_ms": api_latency_ms
            }, ensure_ascii=False) + "\n")

    return PredictOut(labels=labels, scores=scores)

@app.post("/feedback")
def feedback(fb: FeedbackIn):
    rid = hashlib.sha1(((fb.url or "") + "||" + fb.text.strip()).encode("utf-8")).hexdigest()
    record = {
        "id": rid,
        "timestamp": datetime.utcnow().isoformat(),
        "url": fb.url,
        "text": fb.text.strip(),
        "predicted_label": fb.predicted_label,
        "score": float(fb.score),
        "user_label": fb.user_label,
    }

    seen = set()
    with FEEDBACK_FILE.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip(): 
                continue
            try:
                seen.add(json.loads(line)["id"])
            except Exception:
                pass

    if rid not in seen:
        with FEEDBACK_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    return {"ok": True}

@app.post("/reload")
def reload_model(req: ReloadIn):
    global clf, MODEL_PATH
    if req.model_path:
        MODEL_PATH = req.model_path
    clf = build_pipeline(MODEL_PATH)
    return {"ok": True, "model_path": MODEL_PATH}


# ---------- viewer utilities ----------
@app.get("/feedback/recent", response_class=PlainTextResponse)
def feedback_recent(n: int = 20):
    if not FEEDBACK_FILE.exists():
        return "No feedback yet."
    lines = FEEDBACK_FILE.read_text(encoding="utf-8").splitlines()
    return "\n".join(lines[-n:]) if lines else "No feedback entries."

@app.get("/feedback_count")
def feedback_count():
    n = sum(1 for line in FEEDBACK_FILE.open("r", encoding="utf-8") if line.strip())
    return {"ok": True, "count": n}

@app.get("/feedback_dump", response_class=PlainTextResponse)
def feedback_dump():
    return FEEDBACK_FILE.read_text(encoding="utf-8")

@app.get("/predictions_count")
def predictions_count():
    n = sum(1 for line in PREDICTIONS_LOG.open("r", encoding="utf-8") if line.strip())
    return {"ok": True, "count": n}

@app.get("/predictions_head", response_class=PlainTextResponse)
def predictions_head(k: int = 50):
    lines = []
    with PREDICTIONS_LOG.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i >= k:
                break
            if line.strip():
                lines.append(line)
    return "".join(lines)

@app.get("/health")
def health():
    return JSONResponse({"ok": True})


# ---------- METRICS ROUTES ----------
@app.get("/metrics")
def system_metrics():
    uptime = time.time() - start_time
    throughput = req_count / uptime if uptime > 0 else 0

    latency_vals = list(latencies)
    avg_latency = float(np.mean(latency_vals)) if latency_vals else 0
    p95 = float(np.percentile(latency_vals, 95)) if latency_vals else 0
    p99 = float(np.percentile(latency_vals, 99)) if latency_vals else 0

    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory().percent

    return {
        "uptime_sec": uptime,
        "requests_total": req_count,
        "throughput_req_per_sec": throughput,
        "avg_latency_ms": avg_latency,
        "p95_latency_ms": p95,
        "p99_latency_ms": p99,
        "cpu_usage_pct": cpu,
        "mem_usage_pct": mem,
    }

@app.get("/prediction-metrics")
def prediction_metrics():
    if not confidences:
        return {"msg": "No predictions yet"}
    probs = np.array(confidences)
    entropy = -np.mean([p*math.log(p+1e-12)+(1-p)*math.log(1-p+1e-12) for p in probs])
    return {
        "total_predictions": len(confidences),
        "avg_confidence": float(np.mean(probs)),
        "distribution": {
            "low_0_3": int(np.sum(probs < 0.3)),
            "mid_03_07": int(np.sum((probs >= 0.3) & (probs < 0.7))),
            "high_07_1": int(np.sum(probs >= 0.7)),
        },
        "threshold_crossing_rate": dict(threshold_crossings),
        "avg_entropy": float(entropy)
    }

@app.post("/quality-metrics")
def quality_metrics(data: dict):
    page_metrics.append(data)
    return {"status": "ok"}

@app.get("/quality-report")
def quality_report():
    if not page_metrics:
        return {"msg": "No pages logged"}
    total_pages = len(page_metrics)
    avg_density = float(np.mean([m["highlighted"]/m["total"] for m in page_metrics if m["total"]>0]))

    by_domain = {}
    for m in page_metrics:
        domain = (m["url"] or "").split("/")[2] if m.get("url") else "unknown"
        by_domain.setdefault(domain, []).append(m["highlighted"]/m["total"] if m["total"] else 0)

    domain_avgs = {k: float(np.mean(v)) for k,v in by_domain.items()}

    return {
        "total_pages": total_pages,
        "avg_highlight_density": avg_density,
        "avg_density_by_domain": domain_avgs
    }
