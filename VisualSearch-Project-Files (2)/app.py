import os
import json
import base64
import urllib.request
import numpy as np
import cv2
import onnxruntime as ort
from flask import Flask, request, jsonify, render_template

# Initialize Flask app
app = Flask(__name__)

# Constants
MODEL_DIR = os.path.join(os.path.dirname(__file__), 'model')
MODEL_PATH = os.path.join(MODEL_DIR, 'resnet50.onnx')
MODEL_URL = 'https://huggingface.co/Qdrant/resnet50-onnx/resolve/main/model.onnx'
PRODUCTS_JSON_PATH = os.path.join(os.path.dirname(__file__), 'products.json')
PRODUCTS_DIR = os.path.join(os.path.dirname(__file__), 'static', 'products')

# In-memory database
database_products = []
database_embeddings = {}
ort_session = None
input_name = None
output_name = None
is_channels_first = True

def download_model_if_needed():
    if not os.path.exists(MODEL_DIR):
        os.makedirs(MODEL_DIR)
        
    if not os.path.exists(MODEL_PATH):
        print(f"Model not found. Downloading ResNet50 ONNX model from {MODEL_URL}...")
        try:
            import requests
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
            r = requests.get(MODEL_URL, headers=headers, stream=True)
            r.raise_for_status()
            total_size = int(r.headers.get('content-length', 0))
            downloaded = 0
            with open(MODEL_PATH, 'wb') as f:
                for chunk in r.iter_content(chunk_size=1024 * 64):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        percent = min(100, (downloaded * 100) / total_size) if total_size > 0 else 0
                        print(f"\rDownloading ResNet50 model: {percent:.1f}% ({downloaded / (1024*1024):.1f} MB / {total_size / (1024*1024):.1f} MB)", end="")
            print("\nDownload complete.")
        except Exception as e:
            print(f"\nFailed to download model: {e}")
            raise RuntimeError(f"Could not download the ResNet50 ONNX model. Error: {e}")

# Preprocess image for ResNet50
def preprocess_image(img):
    # 1. Resize to 224x224
    img_resized = cv2.resize(img, (224, 224))
    
    # 2. Convert BGR to RGB
    img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)
    
    # 3. Scale to 0-1 and Normalize with ImageNet stats
    img_float = img_rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    img_normalized = (img_float - mean) / std
    
    # 4. Handle channels-first vs channels-last dynamically
    if is_channels_first:
        # Transpose from (224, 224, 3) to (3, 224, 224)
        tensor = np.transpose(img_normalized, (2, 0, 1))
        tensor = np.expand_dims(tensor, axis=0) # Shape (1, 3, 224, 224)
    else:
        tensor = np.expand_dims(img_normalized, axis=0) # Shape (1, 224, 224, 3)
        
    return tensor

def get_embedding(img):
    if ort_session is None:
        return None
    
    tensor = preprocess_image(img)
    outputs = ort_session.run([output_name], {input_name: tensor})
    # Flatten the outputs to a 1D vector
    embedding = outputs[0][0].flatten()
    return embedding

def cosine_similarity(a, b):
    dot_product = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot_product / (norm_a * norm_b))

def initialize_system():
    global ort_session, input_name, output_name, is_channels_first, database_products, database_embeddings
    
    # 1. Download model
    download_model_if_needed()
    
    # 2. Load model
    print("Loading ResNet50 ONNX model...")
    try:
        ort_session = ort.InferenceSession(MODEL_PATH)
        input_meta = ort_session.get_inputs()[0]
        input_name = input_meta.name
        output_name = ort_session.get_outputs()[0].name
        
        # Check layout: channels-first or channels-last
        shape = input_meta.shape
        if len(shape) == 4 and shape[1] == 3:
            is_channels_first = True
        elif len(shape) == 4 and shape[3] == 3:
            is_channels_first = False
        print(f"ResNet50 model loaded. Input shape: {shape}, Channels-First: {is_channels_first}")
    except Exception as e:
        print(f"Error loading ONNX session: {e}")
        return
        
    # 3. Load product database metadata
    if os.path.exists(PRODUCTS_JSON_PATH):
        with open(PRODUCTS_JSON_PATH, 'r') as f:
            database_products = json.load(f)
    else:
        print(f"WARNING: products.json not found at {PRODUCTS_JSON_PATH}")
        database_products = []

    # 4. Generate embeddings index for all static products
    print("Indexing product database images...")
    for product in database_products:
        filename = product['filename']
        img_path = os.path.join(PRODUCTS_DIR, filename)
        if os.path.exists(img_path):
            img = cv2.imread(img_path)
            if img is not None:
                emb = get_embedding(img)
                if emb is not None:
                    database_embeddings[filename] = emb
                    print(f"Successfully indexed: {filename}")
                else:
                    print(f"Error extracting embedding for {filename}")
            else:
                print(f"Failed to read image at {img_path}")
        else:
            print(f"Product image file not found: {img_path}")
    print(f"Indexing complete. Total products indexed: {len(database_embeddings)}")

# Start indexing
initialize_system()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/search', methods=['POST'])
def search():
    if ort_session is None:
        return jsonify({'error': 'ResNet50 model is not loaded correctly on server.'}), 500
        
    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({'error': 'No query image data provided.'}), 400

    try:
        # Base64 image decoding
        image_data = data['image']
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        
        image_bytes = base64.b64decode(image_data)
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        
        if img is None:
            return jsonify({'error': 'Failed to decode image.'}), 400

        # Extract query embedding
        query_embedding = get_embedding(img)
        if query_embedding is None:
            return jsonify({'error': 'Failed to process query image features.'}), 500

        # Calculate cosine similarities
        matches = []
        for product in database_products:
            filename = product['filename']
            if filename in database_embeddings:
                prod_embedding = database_embeddings[filename]
                sim = cosine_similarity(query_embedding, prod_embedding)
                
                # ResNet50 cosine similarities typically range from ~0.15 (unrelated) to ~0.99 (identical).
                # We map a raw similarity of 0.50 to 0% and 0.95 to 100% for a realistic display score.
                if sim < 0.50:
                    match_percentage = 0.0
                else:
                    match_percentage = (sim - 0.50) / (0.95 - 0.50)
                    match_percentage = min(1.0, max(0.0, match_percentage))
                
                matches.append({
                    'filename': product['filename'],
                    'name': product['name'],
                    'price': product['price'],
                    'category': product['category'],
                    'description': product['description'],
                    'match_score': match_percentage
                })

        # Sort matches by similarity score in descending order
        matches.sort(key=lambda x: x['match_score'], reverse=True)

        return jsonify({
            'success': True,
            'query_image': data['image'],
            'results': matches
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Server processing error: {str(e)}'}), 500

@app.route('/products', methods=['GET'])
def get_products():
    return jsonify(database_products)

if __name__ == '__main__':
    # Run the server on localhost port 5000
    app.run(host='127.0.0.1', port=5000, debug=True)
