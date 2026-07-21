"""
train_and_export.py

Modernized TensorFlow 2 / Keras rewrite of the reference notebook's pipeline
(the original used TF1 eager-mode APIs like tf.contrib and tf.train.AdamOptimizer,
which no longer exist in current TensorFlow).

Pipeline:
  1. Load the emotion dataset (a DataFrame with 'text' and 'emotions' columns)
  2. Filter overly long sentences, tokenize, pad sequences
  3. Label-encode the 6 emotion classes (anger, fear, joy, love, sadness, surprise)
  4. Train an Embedding + GRU classifier
  5. Save the model + tokenizer + label encoder + max sequence length for the Flask app

Put your data file in this folder, named 'emotion_data.pkl'
(a pickled pandas DataFrame with columns: text, emotions), then run:
    python train_and_export.py
"""

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from tensorflow.keras.preprocessing.text import Tokenizer
from tensorflow.keras.preprocessing.sequence import pad_sequences
from tensorflow.keras.utils import to_categorical
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Embedding, GRU, Dense, Dropout

DATA_PATH = "emotion_data.pkl"
MAX_TOKENS_PER_SENTENCE = 70   # same filter as the reference notebook
VOCAB_SIZE = 20000
EMBEDDING_DIM = 128
GRU_UNITS = 128
EPOCHS = 10
BATCH_SIZE = 64

# --------------------------------------------------------------------------- #
# 1. Load data
# --------------------------------------------------------------------------- #
if not Path(DATA_PATH).exists():
    raise FileNotFoundError(
        f"Can't find '{DATA_PATH}' in this folder. Save your dataset as a "
        f"pickled pandas DataFrame with 'text' and 'emotions' columns, named "
        f"exactly 'emotion_data.pkl', in the same folder as this script."
    )

data = pd.read_pickle(DATA_PATH)
print("Loaded:", data.shape)

# Keep only reasonably short sentences (mirrors the reference notebook)
data["token_size"] = data["text"].apply(lambda x: len(str(x).split(" ")))
data = data.loc[data["token_size"] < MAX_TOKENS_PER_SENTENCE].copy()
print("After length filter:", data.shape)

# --------------------------------------------------------------------------- #
# 2. Tokenize + pad
# --------------------------------------------------------------------------- #
tokenizer = Tokenizer(num_words=VOCAB_SIZE, oov_token="<OOV>")
tokenizer.fit_on_texts(data["text"].astype(str).tolist())

sequences = tokenizer.texts_to_sequences(data["text"].astype(str).tolist())
max_len = max(len(s) for s in sequences)
X = pad_sequences(sequences, maxlen=max_len, padding="post")
print("Padded input shape:", X.shape, " | max_len:", max_len)

# --------------------------------------------------------------------------- #
# 3. Encode labels
# --------------------------------------------------------------------------- #
label_encoder = LabelEncoder()
y_int = label_encoder.fit_transform(data["emotions"])
num_classes = len(label_encoder.classes_)
y = to_categorical(y_int, num_classes=num_classes)
print("Classes:", list(label_encoder.classes_))

# --------------------------------------------------------------------------- #
# 4. Train / validation / test split (80 / 10 / 10)
# --------------------------------------------------------------------------- #
X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.2, random_state=42)
X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.5, random_state=42)
print("Train:", X_train.shape, " Val:", X_val.shape, " Test:", X_test.shape)

# --------------------------------------------------------------------------- #
# 5. Build + train model
# --------------------------------------------------------------------------- #
vocab_size_actual = min(VOCAB_SIZE, len(tokenizer.word_index) + 1)

model = Sequential([
    Embedding(input_dim=vocab_size_actual, output_dim=EMBEDDING_DIM, input_length=max_len),
    GRU(GRU_UNITS, dropout=0.2, recurrent_dropout=0.2),
    Dropout(0.5),
    Dense(num_classes, activation="softmax"),
])

model.compile(optimizer="adam", loss="categorical_crossentropy", metrics=["accuracy"])
model.summary()

early_stop = tf.keras.callbacks.EarlyStopping(
    monitor="val_loss", patience=2, restore_best_weights=True
)

model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=EPOCHS,
    batch_size=BATCH_SIZE,
    callbacks=[early_stop],
)

test_loss, test_acc = model.evaluate(X_test, y_test)
print(f"\nTest accuracy: {test_acc:.4f}")

# --------------------------------------------------------------------------- #
# 6. Save everything the Flask app needs
# --------------------------------------------------------------------------- #
model.save("emotion_model.h5")
with open("tokenizer.pkl", "wb") as f:
    pickle.dump(tokenizer, f)
with open("label_encoder.pkl", "wb") as f:
    pickle.dump(label_encoder, f)
with open("max_len.pkl", "wb") as f:
    pickle.dump(max_len, f)

print("\nSaved: emotion_model.h5, tokenizer.pkl, label_encoder.pkl, max_len.pkl")
print("Copy these 4 files into the Flask app folder, then run: python app.py")
