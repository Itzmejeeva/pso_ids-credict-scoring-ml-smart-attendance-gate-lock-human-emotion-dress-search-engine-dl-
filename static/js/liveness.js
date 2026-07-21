// liveness.js - MediaPipe Face Mesh Blink Detection for Aura Guard
let isBlinking = false;
let blinkCount = 0;
let lastBlinkTime = 0;

// Expose a global function to check if liveness passed
window.livenessPassed = false;

// MediaPipe Setup
const videoElement = document.getElementById('webcam-video');
const livenessMsg = document.createElement('div');
livenessMsg.id = 'liveness-overlay';
livenessMsg.style.cssText = 'position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0, 242, 254, 0.9); color: #030712; padding: 8px 20px; border-radius: 20px; font-weight: 800; font-size: 0.9rem; z-index: 10; box-shadow: 0 0 15px rgba(0,242,254,0.5); display: none;';
livenessMsg.innerHTML = '<i class="fa-solid fa-eye"></i> PLEASE BLINK TO VERIFY';
document.querySelector('.video-wrapper').appendChild(livenessMsg);

// Load MediaPipe scripts dynamically to avoid cluttering index.html
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.crossOrigin = 'anonymous';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function initLiveness() {
    await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
    await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js');
    
    const faceMesh = new FaceMesh({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
    }});
    
    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    
    faceMesh.onResults(onResults);
    
    // We hook into the existing video element without starting a new Camera stream!
    async function detectFaceMesh() {
        if (!window.livenessPassed && document.getElementById('toggle-auto-verify')?.checked && videoElement.readyState >= 2) {
            livenessMsg.style.display = 'block';
            await faceMesh.send({image: videoElement});
        } else {
            if(livenessMsg) livenessMsg.style.display = 'none';
        }
        requestAnimationFrame(detectFaceMesh);
    }
    
    // Start detection loop
    detectFaceMesh();
}

function calculateEAR(landmarks, indices) {
    // Calculate Euclidean distances
    const p1 = landmarks[indices[1]];
    const p5 = landmarks[indices[5]];
    const p2 = landmarks[indices[2]];
    const p4 = landmarks[indices[4]];
    const p0 = landmarks[indices[0]];
    const p3 = landmarks[indices[3]];
    
    const vertical1 = Math.hypot(p1.x - p5.x, p1.y - p5.y);
    const vertical2 = Math.hypot(p2.x - p4.x, p2.y - p4.y);
    const horizontal = Math.hypot(p0.x - p3.x, p0.y - p3.y);
    
    return (vertical1 + vertical2) / (2.0 * horizontal);
}

function onResults(results) {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        
        // Right eye indices (MediaPipe specific)
        const rightEye = [33, 160, 158, 133, 153, 144];
        // Left eye indices
        const leftEye = [362, 385, 387, 263, 373, 380];
        
        const rightEAR = calculateEAR(landmarks, rightEye);
        const leftEAR = calculateEAR(landmarks, leftEye);
        const ear = (rightEAR + leftEAR) / 2.0;
        
        // Thresholds for blink
        const BLINK_THRESHOLD = 0.22;
        
        if (ear < BLINK_THRESHOLD) {
            isBlinking = true;
        } else {
            if (isBlinking) {
                // Blink completed!
                isBlinking = false;
                const now = Date.now();
                if (now - lastBlinkTime > 1000) { // Cooldown
                    blinkCount++;
                    lastBlinkTime = now;
                    console.log("BLINK DETECTED!");
                    
                    // Signal success
                    window.livenessPassed = true;
                    livenessMsg.innerHTML = '<i class="fa-solid fa-check-double"></i> LIVENESS CONFIRMED';
                    livenessMsg.style.background = 'rgba(16, 185, 129, 0.9)';
                    
                    // Trigger the existing verify function
                    if(typeof verifyFace === 'function') {
                        verifyFace(); // Instantly verify when blink happens
                    }
                    
                    // Reset liveness after a few seconds so they can check in again later
                    setTimeout(() => {
                        window.livenessPassed = false;
                        livenessMsg.innerHTML = '<i class="fa-solid fa-eye"></i> PLEASE BLINK TO VERIFY';
                        livenessMsg.style.background = 'rgba(0, 242, 254, 0.9)';
                    }, 4000);
                }
            }
        }
    }
}

// Start everything
setTimeout(initLiveness, 1000); // delay to ensure video exists
