"""
app.py - Flask app for the Deep Learning Emotion Recognition model.

Needs these 4 files (produced by train_and_export.py) in the same folder:
    emotion_model.h5
    tokenizer.pkl
    label_encoder.pkl
    max_len.pkl

Run with:
    python app.py
Then open http://127.0.0.1:5000 in your browser.
"""

import pickle
from pathlib import Path

import numpy as np
from flask import Flask, render_template, request
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

EMOTION_EMOJI = {
    "anger": "😠",
    "fear": "😨",
    "joy": "😄",
    "love": "❤️",
    "sadness": "😢",
    "surprise": "😲",
}


@app.route("/", methods=["GET", "POST"])
def index():
    result = None
    submitted_text = ""

    if request.method == "POST":
        submitted_text = request.form.get("text", "").strip()

        if submitted_text:
            seq = tokenizer.texts_to_sequences([submitted_text])
            padded = pad_sequences(seq, maxlen=max_len, padding="post")

            probs = model.predict(padded, verbose=0)[0]
            pred_idx = int(np.argmax(probs))
            pred_label = label_encoder.inverse_transform([pred_idx])[0]

            ranked = sorted(
                zip(label_encoder.classes_, probs), key=lambda x: x[1], reverse=True
            )

            result = {
                "emotion": pred_label,
                "emoji": EMOTION_EMOJI.get(pred_label, "🤔"),
                "confidence": round(float(probs[pred_idx]) * 100, 2),
                "ranked": [(label, round(float(p) * 100, 2)) for label, p in ranked],
            }

    return render_template("index.html", result=result, submitted_text=submitted_text)


if __name__ == "__main__":
    app.run(debug=True)
