# train.py — fine-tune from collected feedback for the Sarcasm Detector
# Run inside your venv:  python train.py

from __future__ import annotations
import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"   # avoid fork warning
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"  # if MPS sneaks in, fall back
os.environ["CUDA_VISIBLE_DEVICES"] = ""          # ensure no CUDA selection

from pathlib import Path
import json, random, time
from typing import List, Dict, Tuple

import numpy as np
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
)
from sklearn.metrics import precision_recall_fscore_support
import torch
try:
    # Force CPU default device (PyTorch 2.0+)
    torch.set_default_device("cpu")
except Exception:
    pass

# ========= Paths & constants =========

BASE_DIR = Path(__file__).parent
FEEDBACK = BASE_DIR / "data" / "feedback.jsonl"

# Start from your current live model so each run improves it.
# Use the same base as api.py
CURRENT_MODEL = "evelinaivanova/sarcasm-extension-model"

# Where to save the newly trained checkpoint (timestamped)
OUT_DIR = BASE_DIR / "models" / f"sarcasm-v{int(time.time())}"

# Label mapping
label2id = {"NOT_SARCASM": 0, "SARCASM": 1}
id2label = {v: k for k, v in label2id.items()}

# Up-weighting to learn faster from mistakes/uncertainty
DISAGREE_DUP = 3              # duplicate rows where model != user
UNCERT_BAND = (0.45, 0.65)    # also up-weight uncertain agreements
UNCERT_DUP = 2

# Reproducibility
SEED = 31415
random.seed(SEED)
np.random.seed(SEED)

# ========= Helpers =========

def read_feedback(path: Path) -> List[Dict]:
    """Read feedback.jsonl -> list of dicts with text, user label, model label, score."""
    if not path.exists():
        raise SystemExit(f"No feedback yet at {path}. Click 👍/👎 in the extension first.")
    rows: List[Dict] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            rows.append({
                "text": r["text"],
                "user": r["user_label"],            # ground truth
                "pred": r["predicted_label"],       # what the model said back then
                "score": float(r["score"]),         # model score for its predicted class
            })
    if not rows:
        raise SystemExit("feedback.jsonl is empty.")
    return rows

def p_sarcasm_from_row(r: Dict) -> float:
    """Convert stored score (for predicted class) to P(SARCASM)."""
    return r["score"] if r["pred"] == "SARCASM" else (1.0 - r["score"])

def build_training_rows(rows: List[Dict]) -> List[Dict]:
    """Up-weight disagreements and uncertain agreements."""
    out: List[Dict] = []
    for r in rows:
        y = label2id[r["user"]]
        out.append({"text": r["text"], "label": y})
        if r["user"] != r["pred"]:
            out.extend([{"text": r["text"], "label": y}] * (DISAGREE_DUP - 1))
        else:
            p = p_sarcasm_from_row(r)
            if UNCERT_BAND[0] <= p <= UNCERT_BAND[1]:
                out.extend([{"text": r["text"], "label": y}] * (UNCERT_DUP - 1))
    return out

def load_tokenizer() -> "AutoTokenizer":
    """Robust tokenizer loader; falls back to base if the local folder has issues."""
    tries = [
        dict(pretrained_model_name_or_path=CURRENT_MODEL, use_fast=True,  local_files_only=True),
        dict(pretrained_model_name_or_path=CURRENT_MODEL, use_fast=False, local_files_only=True),
        dict(pretrained_model_name_or_path="distilroberta-base", use_fast=True),
        dict(pretrained_model_name_or_path="distilroberta-base", use_fast=False),
    ]
    last_err = None
    for kw in tries:
        try:
            print("Tokenizer: trying", kw)
            return AutoTokenizer.from_pretrained(**kw)
        except Exception as e:
            print("  failed ->", e)
            last_err = e
    raise RuntimeError(f"Could not load any tokenizer. Last error: {last_err}")

def to_dataset(rows: List[Dict], tok) -> Dataset:
    enc = tok([r["text"] for r in rows], truncation=True, padding=True, max_length=256)
    enc["labels"] = [int(r["label"]) for r in rows]
    return Dataset.from_dict(enc)

def compute_metrics(eval_pred: Tuple[np.ndarray, np.ndarray]) -> Dict[str, float]:
    logits, labels = eval_pred
    preds = logits.argmax(-1)
    p, r, f1, _ = precision_recall_fscore_support(labels, preds, average="binary", zero_division=0)
    acc = (preds == labels).mean() if len(labels) else 0.0
    return {"precision": float(p), "recall": float(r), "f1": float(f1), "accuracy": float(acc)}

# ========= Main =========

def main():
    # 1) Load feedback
    raw = read_feedback(FEEDBACK)
    print(f"Loaded {len(raw)} raw feedback rows.")
    if len(raw) < 10:
        print(f"WARNING: Only {len(raw)} rows; training will overfit. It's okay for a smoke test.")

    # 2) Build (up-weighted) training rows and split
    train_rows = build_training_rows(raw)
    random.shuffle(train_rows)
    n = len(train_rows)
    n_val = max(1, int(0.1 * n))
    val_rows = train_rows[:n_val]
    tr_rows  = train_rows[n_val:]
    print(f"Train rows (after up-weighting): {len(tr_rows)} | Val rows: {len(val_rows)}")

    # 3) Load tokenizer & datasets
    tok = load_tokenizer()
    train_ds = to_dataset(tr_rows, tok)
    val_ds   = to_dataset(val_rows, tok)

    # 4) Load base model and pin to CPU
    model = AutoModelForSequenceClassification.from_pretrained(
        CURRENT_MODEL,
        num_labels=2,
        id2label=id2label,
        label2id=label2id,
    )
    model.to("cpu")

    # 5) Training configuration (force CPU; avoid forking workers)
    num_epochs = 4 if len(tr_rows) < 100 else 3
    bs_train = 8 if len(tr_rows) < 64 else 16
    bs_eval  = 32

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    args = TrainingArguments(
        output_dir=str(OUT_DIR),
        learning_rate=5e-5,
        per_device_train_batch_size=bs_train,
        per_device_eval_batch_size=bs_eval,
        num_train_epochs=num_epochs,
        weight_decay=0.01,
        eval_strategy="epoch",          # (new name; replaces evaluation_strategy)
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_steps=max(1, len(tr_rows) // 10),
        seed=SEED,
        report_to=[],                   # no wandb/tensorboard by default
        no_cuda=True,                   # <-- FORCE CPU
        use_mps_device=False,           # <-- DO NOT use Apple MPS
        dataloader_num_workers=0,       # <-- avoid forking workers
        fp16=False, bf16=False,         # <-- full precision on CPU
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        tokenizer=tok,
        compute_metrics=compute_metrics,
    )

    # 6) Train & save
    trainer.train()
    trainer.model.save_pretrained(OUT_DIR)
    tok.save_pretrained(OUT_DIR)
    print("\nSaved new model to:", OUT_DIR.resolve())

    # 7) Print a quick tip to promote the model
    print("\nNext steps:")
    print("A) Overwrite your live folder and hot-reload:")
    print(f'   rm -rf "{CURRENT_MODEL}" && cp -r "{OUT_DIR}" "{CURRENT_MODEL}"')
    print('   curl -sS -X POST http://127.0.0.1:8000/reload')
    print("OR")
    print("B) Switch API to this new folder without copying:")
    print(f'   curl -sS -X POST http://127.0.0.1:8000/reload -H "Content-Type: application/json" -d \'{{"model_path": "{str(OUT_DIR)}"}}\'')

if __name__ == "__main__":
    main()

