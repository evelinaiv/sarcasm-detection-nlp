# An Investigation of Deep Learning Approaches in NLP for Sarcasm Detection  
**Toward the Development of a Real-Time Browser Extension**

## Project Overview  
This project explores a range of **deep learning approaches in Natural Language Processing (NLP)** for sarcasm detection in web-based text.  
A large **multi-domain dataset (~950,000 cleaned samples)** was created by combining Reddit, Twitter, and news headlines.  

The project benchmarks classical ML models, deep learning architectures, and transformer-based approaches, evaluating not only accuracy but also calibration, latency, and model size to ensure suitability for real-time use.  

The best-performing model (**DistilRoBERTa**) was deployed via a **FastAPI backend** and integrated into a Chrome extension called **SarcQuest**, enabling real-time sarcasm detection on webpages.  

---

## Approaches Implemented  
- **Classical baselines**: Logistic Regression, Support Vector Machines  
- **Deep learning (pre-transformer)**:  
  - BiLSTM with GloVe embeddings  
  - CNN with GloVe embeddings  
  - BiLSTM with Attention  
- **Transformers**:  
  - BERT  
  - RoBERTa  
  - DistilRoBERTa  
  - DistilRoBERTa + emotion embeddings  

---

## Repository Structure  

```

sarcasm-detection-nlp/
├── Dissertation/        # Full dissertation PDF
├── notebooks/           # Data cleaning, EDA, baseline & deep learning models
├── Google_Colab/        # Transformer training (BERT, RoBERTa, DistilRoBERTa)
├── api/                 # FastAPI backend for model deployment
├── extension/           # Chrome extension (HTML, CSS, JS, icons, zip for testing)
├── data/                # Not included - see Dataset section
└── README.md

```

### Folder Details  
- **Dissertation/**: Contains the final written dissertation.  
- **notebooks/**: Jupyter notebooks for preprocessing, exploratory data analysis, and classical/deep learning model training.  
- **Google_Colab/**: Transformer experiments requiring GPU resources (BERT, RoBERTa, DistilRoBERTa).  
- **api/**: FastAPI backend (`app.py`, `train.py`) for serving the sarcasm detection model.  
- **extension/**: Chrome extension files with a pre-packaged zip for testing.  
- **data/**: Placeholder with instructions for obtaining datasets (raw data not uploaded).  

---

## Dataset  
Three public datasets were combined:  
- Reddit: Self-Annotated Reddit Corpus (Danofer 2017)  
- Twitter: iSarcasmEval (2020), Nikesh66 (2021)  
- News Headlines: Misra & Arora (2019)  

**Instructions:**  
1. Download datasets from the original sources.  
2. Place them in notebooks
3. Run the preprocessing notebooks to generate the cleaned dataset (`df_filtered.csv`), which is used for transformer training.  

---

## Results  

| Model                 | F1   | Accuracy | Latency (ms/sample) | Size (MB) |
|-----------------------|------|----------|----------------------|-----------|
| Logistic Regression   | 0.65 | 0.70     | 2.1                  | 5         |
| BiLSTM + GloVe        | 0.72 | 0.74     | 6.5                  | 120       |
| CNN + GloVe           | 0.71 | 0.73     | 5.8                  | 118       |
| RoBERTa               | 0.78 | 0.80     | 9.2                  | 480       |
| **DistilRoBERTa**     | 0.77 | 0.79     | 4.1                  | 318       |

---

## Deployment  

### FastAPI Backend  
The `api/` folder provides a FastAPI service to serve predictions.  
Run locally:  
```bash
uvicorn api.app:app --reload
````

### Chrome Extension (SarcQuest)

1. Open Chrome → Extensions → Manage Extensions
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Use the SarcQuest popup to scan any webpage

---

## Screenshots

SarcQuest popup UI: <img width="373" height="420" alt="Screenshot 2025-09-30 at 14 15 27" src="https://github.com/user-attachments/assets/01ba169e-f9fd-4b9f-81d8-47b4ba314a48" />

Example webpage with sarcasm highlights: <img width="813" height="471" alt="Screenshot 2025-09-30 at 14 17 05" src="https://github.com/user-attachments/assets/40c0b2bc-99d2-4b69-8521-9706482a2bac" />

---

## Future Work

* Extend to multilingual sarcasm detection
* Add interpretability features (attention heatmaps)
* Optimize extension for mobile browsers

---

## Acknowledgements

* Hugging Face Transformers
* PyTorch
* scikit-learn
* Dataset authors (Danofer 2017, Misra & Arora 2019, iSarcasmEval 2020, Nikesh66 2021)

```

---

✅ This version is clean, academic + applied, and matches GitHub’s professional repo style.  

👉 Do you want me to also **write the one-sentence tagline (max 150 chars)** for the GitHub “Description” box that sits right under your repo title?
```
