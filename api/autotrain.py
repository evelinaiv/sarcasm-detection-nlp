# autotrain.py — retrain from feedback and hot‑reload the API; prune old models

from __future__ import annotations
import json, os, re, shutil, subprocess, requests
from pathlib import Path
from datetime import datetime, timedelta

# ---- paths for YOUR machine ----
BASE = Path("/Users/evelinaivanova/sarcasm-api")
VENV_PY = BASE / ".venv" / "bin" / "python"
TRAIN_PY = BASE / "train.py"
FEEDBACK = BASE / "data" / "feedback.jsonl"
STATE = BASE / "data" / "train_state.json"
MODELS_DIR = BASE / "models"
API_RELOAD = "http://127.0.0.1:8000/reload"   # FastAPI must expose POST /reload

# ---- policy knobs (tweak to taste) ----
MIN_TOTAL = 30                         # don’t train until we have at least this many total votes
MIN_NEW   = 10                         # and at least this many NEW votes since last train
COOLDOWN  = timedelta(hours=24)        # not more than once every 24h
KEEP_LAST = 5                          # keep last N trained model folders; prune older ones

# One‑time force for smoke tests: AUTOTRAIN_FORCE=1
if os.getenv("AUTOTRAIN_FORCE") == "1":
    MIN_TOTAL = 1
    MIN_NEW   = 0
    COOLDOWN  = timedelta(seconds=0)

def read_count(p: Path) -> int:
    if not p.exists():
        return 0
    # count non‑empty lines
    return sum(1 for l in p.read_text().splitlines() if l.strip())

def load_state() -> dict:
    if STATE.exists():
        try:
            return json.loads(STATE.read_text())
        except Exception:
            pass
    return {"last_count": 0, "last_time": "1970-01-01T00:00:00", "last_model": ""}

def save_state(s: dict):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(s, indent=2))

def should_train(total: int, state: dict) -> bool:
    last_count = int(state.get("last_count", 0))
    last_time = datetime.fromisoformat(state.get("last_time", "1970-01-01T00:00:00"))

    # need enough overall data
    if total < MIN_TOTAL:
        return False

    # need enough new data OR cooldown expired
    new_since = total - last_count
    time_since = datetime.utcnow() - last_time
    if new_since < MIN_NEW and time_since < COOLDOWN:
        return False

    return True

def run_train() -> str:
    """Run train.py and return the saved model path parsed from its stdout."""
    proc = subprocess.run(
        [str(VENV_PY), str(TRAIN_PY)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(BASE),
    )
    out = proc.stdout
    print(out)  # keep logs visible in cron

    m = re.search(r"Saved new model to:\s*(.+)", out)
    if not m:
        raise RuntimeError("Could not find 'Saved new model to:' line in train output.")
    return m.group(1).strip()

def reload_api(model_path: str):
    """Tell the FastAPI server to load the new model."""
    try:
        r = requests.post(API_RELOAD, json={"model_path": model_path}, timeout=30)
        r.raise_for_status()
        print("Reload OK:", r.json())
    except Exception as e:
        # Don’t crash the job if API is temporarily down; log and continue.
        print(f"[autotrain] WARNING: reload failed: {e}")

def prune_old_models(keep: int = KEEP_LAST):
    """Keep only newest N model folders inside MODELS_DIR."""
    if not MODELS_DIR.exists():
        return
    folders = [p for p in MODELS_DIR.iterdir() if p.is_dir()]
    folders.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for p in folders[keep:]:
        try:
            shutil.rmtree(p)
            print("Pruned:", p)
        except Exception as e:
            print("Failed to prune", p, e)

def main():
    total = read_count(FEEDBACK)
    state = load_state()
    print(f"[autotrain] total={total}, last_count={state['last_count']}, last_time={state['last_time']}")

    if not should_train(total, state):
        print("[autotrain] criteria not met — skipping.")
        return

    # 1) train
    model_path = run_train()

    # 2) hot‑reload API
    reload_api(model_path)

    # 3) prune older models to save disk
    prune_old_models(KEEP_LAST)

    # 4) update state
    state.update(
        {
            "last_count": total,
            "last_time": datetime.utcnow().isoformat(),
            "last_model": model_path,
        }
    )
    save_state(state)
    print(f"[autotrain] promoted: {model_path}")

if __name__ == "__main__":
    main()

