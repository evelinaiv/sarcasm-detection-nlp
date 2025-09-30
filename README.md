# An Investigation of Deep Learning Approaches in Natural Language Processing (NLP)  for Sarcasm Detection in Web-Based Text: Toward the Development of a Real-Time Browser Extension
##  Project Overview

This project investigates a range of deep learning approaches in **Natural Language Processing (NLP)** for the task of sarcasm detection in web-based text, with the ultimate goal of developing a **real-time browser extension** capable of identifying sarcastic content.

###  Key Highlights
- Built a **large, balanced multi-domain dataset** (~950,000 cleaned examples) by combining Reddit, Twitter, and news headlines.  
- Implemented and compared models:
  - **Classical baselines**: Logistic Regression, Support Vector Machines  
  - **Deep learning**: BiLSTM with GloVe embeddings, CNNs, Attention mechanisms  
  - **Transformers**: BERT, RoBERTa, DistilRoBERTa  
- Conducted extensive benchmarking of performance, calibration, and efficiency.  
- Selected **DistilRoBERTa** as the final model for its trade-off between accuracy (~0.77 F1), inference speed, and model size.  
- Deployed the model via a **FastAPI backend** and integrated it into a Chrome extension called **SarcQuest**.  
- Extension features include:  
  - Page scanning and real-time sarcasm detection  
  - Threshold-based highlighting of sarcastic sentences  
  - User feedback collection (thumbs up/down)  
  - Continuous improvement loop for retraining the model  

###  Repository Contents
- **Data preprocessing and cleaning scripts**  
- **Model training and evaluation pipelines**  
- **Results and comparison tables** across classical ML, deep learning, and transformer models  
- **Deployment code** for the FastAPI backend  
- **Chrome extension files** (HTML, CSS, JavaScript)  

---

This project demonstrates the complete **end-to-end pipeline**: from dataset creation and model development to **practical deployment** in a user-facing application.

