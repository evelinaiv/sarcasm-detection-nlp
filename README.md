# An Investigation of Deep Learning Approaches in Natural Language Processing (NLP)  for Sarcasm Detection in Web-Based Text: Toward the Development of a Real-Time Browser Extension
This project investigates a range of deep learning approaches in Natural Language Processing (NLP) for the task of sarcasm detection in web-based text, with the ultimate goal of developing a real-time browser extension capable of identifying sarcastic content.

The work begins with the construction of a large, balanced multi-domain dataset (~950,000 cleaned examples) by combining sources from Reddit, Twitter, and news headlines. A variety of models are implemented and compared, starting with classical baselines (Logistic Regression, Support Vector Machines) and progressing to deep learning architectures such as BiLSTM with GloVe embeddings, CNNs, and attention mechanisms. Transformer-based models (BERT, RoBERTa, DistilRoBERTa) are then evaluated for their performance, calibration, and efficiency.

After extensive benchmarking, DistilRoBERTa is selected as the optimal trade-off between accuracy, speed, and model size, achieving an F1-score of ~0.77 with inference speeds suitable for real-time use. The model is deployed via a FastAPI backend and integrated into a Chrome extension called SarcQuest, which provides interactive features such as page scanning, threshold-based highlighting, user feedback collection, and a continuous improvement loop for retraining the model.

The repository includes:

Data preprocessing and cleaning scripts

Model training and evaluation pipelines

Results and comparison tables across classical ML, deep learning, and transformer models

Deployment code for the FastAPI service

The full Chrome extension (HTML, CSS, JavaScript)

This project demonstrates not only the application of deep learning for NLP but also the end-to-end process of taking a research problem from dataset creation and model development to practical deployment in a user-facing application.
