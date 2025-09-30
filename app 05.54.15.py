from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from transformers import pipeline

# Load your Hugging Face model
MODEL_ID = "evelinaivanova/sarcasm-extension-model"
clf = pipeline("text-classification", model=MODEL_ID, tokenizer=MODEL_ID, truncation=True)

# FastAPI app
app = FastAPI(title="Sarcasm Detection API")

# CORS so the Chrome extension can call it
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Map raw labels to friendly names
LABEL_MAP = {
    "LABEL_0": "NOT_SARCASM",
    "LABEL_1": "SARCASM",
    "0": "NOT_SARCASM",
    "1": "SARCASM",
    "sarcastic": "SARCASM",
    "non-sarcastic": "NOT_SARCASM",
}

class PredictIn(BaseModel):
    texts: List[str]

class PredictOut(BaseModel):
    labels: List[str]
    scores: List[float]

@app.get("/")
def home():
    return {"ok": True, "message": "Sarcasm Detection API running."}

@app.post("/predict", response_model=PredictOut)
def predict(payload: PredictIn):
    outs = clf(payload.texts)
    labels, scores = [], []
    for o in outs:
        raw = str(o["label"])
        score = float(o["score"])
        mapped = LABEL_MAP.get(raw, raw)
        labels.append(mapped)
        scores.append(score)
    return PredictOut(labels=labels, scores=scores)

