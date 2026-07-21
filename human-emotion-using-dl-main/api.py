"""
api.py - Flask JSON API for the emotion recognition model.

This is a backend-only service (no HTML pages) meant to be called by the
Streamlit frontend (streamlit_app.py) or any other client.

Needs these 4 files (produced by train_and_export.py) in the same folder:
    emotion_model.h5
    tokenizer.pkl
    label_encoder.pkl
    max_len.pkl

Run with:
    python api.py
It listens on http://127.0.0.1:5000
"""

import pickle
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.sequence import pad_sequences

app = Flask(__name__)

REQUIRED_FILES = ["emotion_model.h5", "tokenizer.pkl", "label_encoder.pkl", "max_len.pkl"]
missing = [f for f in REQUIRED_FILES if not Path(f).exists()]
if missing:
    raise FileNotFoundError(
        f"Missing file(s): {missing}. Run `python train_and_export.py` first "
        f"(with your dataset saved as 'emotion_data.pkl') to generate them."
    )

model = load_model("emotion_model.h5")
with open("tokenizer.pkl", "rb") as f:
    tokenizer = pickle.load(f)
with open("label_encoder.pkl", "rb") as f:
    label_encoder = pickle.load(f)
with open("max_len.pkl", "rb") as f:
    max_len = pickle.load(f)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "classes": list(label_encoder.classes_)})


@app.route("/predict", methods=["POST"])
def predict():
    payload = request.get_json(silent=True) or {}
    text = (payload.get("text") or "").strip()

    if not text:
        return jsonify({"error": "Field 'text' is required and cannot be empty."}), 400

    seq = tokenizer.texts_to_sequences([text])
    padded = pad_sequences(seq, maxlen=max_len, padding="post")

    probs = model.predict(padded, verbose=0)[0]
    pred_idx = int(np.argmax(probs))
    pred_label = label_encoder.inverse_transform([pred_idx])[0]

    ranked = sorted(
        zip(label_encoder.classes_, probs.tolist()), key=lambda x: x[1], reverse=True
    )

    return jsonify({
        "text": text,
        "emotion": pred_label,
        "confidence": round(float(probs[pred_idx]) * 100, 2),
        "probabilities": [{"label": label, "percent": round(p * 100, 2)} for label, p in ranked],
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
