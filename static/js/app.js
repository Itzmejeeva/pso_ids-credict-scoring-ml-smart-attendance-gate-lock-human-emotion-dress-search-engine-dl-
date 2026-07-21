// Aura Guard - Frontend Controller

document.addEventListener('DOMContentLoaded', () => {
    // State management
    let webcamStream = null;
    let autoVerifyInterval = null;
    let isGateUnlocked = false; // Semaphore to block verification when gate is currently unlocking
    let allLogs = [];
    let currentTab = 'Male';

    // DOM Elements
    const btnStartCamera = document.getElementById('btn-start-camera');
    const btnManualVerify = document.getElementById('btn-manual-verify');
    const toggleAutoVerify = document.getElementById('toggle-auto-verify');
    const tabButtons = document.querySelectorAll('.tab-btn');
    
    // Webcam
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('webcam-canvas');
    const webcamOverlay = document.getElementById('webcam-overlay');
    const videoWrapper = document.querySelector('.video-wrapper');
    const verifyOverlayImg = document.getElementById('verify-overlay-img');

    // Register Form
    const regName = document.getElementById('reg-name');
    const btnRegister = document.getElementById('btn-register');
    const registryUsersList = document.getElementById('registry-users-list');
    const registryEmptyMsg = document.getElementById('registry-empty-msg');

    // Gate dashboard status
    const gateCardStatus = document.getElementById('gate-card-status');
    const gateIcon = document.getElementById('gate-icon');
    const gateTextStatus = document.getElementById('gate-text-status');
    const gateSubtextStatus = document.getElementById('gate-subtext-status');
    
    // Summary Cards
    const matchSummaryBox = document.getElementById('match-summary-box');
    const matchUserName = document.getElementById('match-user-name');
    const matchScoreVal = document.getElementById('match-score-val');
    const intruderSummaryBox = document.getElementById('intruder-summary-box');

    // Logs & Registry
    const logsTableBody = document.getElementById('logs-table-body');
    const logsEmptyMsg = document.getElementById('logs-empty-msg');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    const unlockChime = document.getElementById('unlock-chime');

    // Initialize lists
    refreshLogs();
    refreshRegistry();

    // Tab buttons event listeners
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.getAttribute('data-tab');
            renderLogsTable();
        });
    });

    // ----------------------------------------------------
    // Webcam Handler
    // ----------------------------------------------------
    btnStartCamera.addEventListener('click', startWebcam);
    btnManualVerify.addEventListener('click', () => captureAndVerify(false));
    
    // Auto-verify toggle handler
    toggleAutoVerify.addEventListener('change', () => {
        if (toggleAutoVerify.checked) {
            showToast('Auto Check-In enabled.', 'success');
            // Poll every 250ms for instant gender detection
            autoVerifyInterval = setInterval(() => {
                if (!isGateUnlocked) {
                    captureAndVerify(true);
                }
            }, 250);
        } else {
            showToast('Auto Check-In disabled.', 'info');
            if (autoVerifyInterval) {
                clearInterval(autoVerifyInterval);
                autoVerifyInterval = null;
            }
        }
    });

    async function startWebcam() {
        try {
            showToast('Requesting camera access...', 'info');
            webcamStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
                audio: false
            });
            video.srcObject = webcamStream;
            await video.play().catch(e => console.error("Video play error:", e));
            
            // Hide camera placeholder overlay
            webcamOverlay.style.display = 'none';
            
            // Enable controls
            btnManualVerify.classList.remove('disabled');
            btnManualVerify.removeAttribute('disabled');
            toggleAutoVerify.removeAttribute('disabled');
            regName.removeAttribute('disabled');
            btnRegister.classList.remove('disabled');
            btnRegister.removeAttribute('disabled');
            
            // Manual mode by default: wait for user to toggle Hands-Free Auto Check-in
            toggleAutoVerify.checked = false;
            if (autoVerifyInterval) clearInterval(autoVerifyInterval);
            
            showToast('Camera active. Ready for manual scan.', 'success');
        } catch (err) {
            console.error('Webcam Access Error:', err);
            showToast(`Camera Error: ${err.name || err.message}`, 'error');
            document.getElementById('gate-text-status').innerText = `Camera Error: ${err.name || err.message}`;
        }
    }

    // ----------------------------------------------------
    // Verification & Gate Control Logic
    // ----------------------------------------------------
    async function captureAndVerify(isAuto = false) {
        if (!webcamStream || isGateUnlocked) return;
        
        // Enforce Liveness (Blink Detection) if in Auto mode
        if (isAuto && !window.livenessPassed) {
            return;
        }
        
        // Draw frame to canvas
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Flip canvas to match mirrored video display
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const base64Data = canvas.toDataURL('image/jpeg', 0.85);

        // Add scan line indicator
        if (!isAuto) {
            videoWrapper.classList.add('scanning');
        }

        try {
            const response = await fetch('/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Data })
            });

            const data = await response.json();
            videoWrapper.classList.remove('scanning');

            if (!response.ok) {
                if (!isAuto) showToast(data.error || 'Verification error.', 'error');
                return;
            }

            if (data.faces_count === 0) {
                if (!isAuto) showToast('No faces detected in view.', 'warning');
                // Hide summary cards
                matchSummaryBox.style.display = 'none';
                intruderSummaryBox.style.display = 'none';
                verifyOverlayImg.style.display = 'none';
                return;
            }

            // Render face bounding boxes overlay image
            verifyOverlayImg.src = data.annotated_image;
            verifyOverlayImg.style.display = 'block';

            // Refresh logs table
            refreshLogs();

            // Handle Gate Unlocking on Authorized Match
            if (data.gate_unlocked) {
                triggerGateUnlock(data.unlock_name, data.unlock_gender, data.results[0].score);
            } else {
                // Intruder Alert
                triggerGateLockDenied();
            }

        } catch (err) {
            console.error('Verification connection error:', err);
            videoWrapper.classList.remove('scanning');
        }
    }

    function triggerGateUnlock(name, gender, score) {
        isGateUnlocked = true;
        
        // Play Unlock sound chime
        try {
            unlockChime.currentTime = 0;
            unlockChime.play();
        } catch (e) {
            console.log("Audio play blocked by browser autoplay settings.");
        }

        // Change Gate Status card styles
        gateCardStatus.className = 'gate-status-card unlocked';
        gateIcon.className = 'fa-solid fa-lock-open';
        gateTextStatus.textContent = 'ACCESS GRANTED';
        gateSubtextStatus.textContent = `Welcome back, ${name} (${gender})!`;

        // Update match summary box
        matchUserName.textContent = name;
        matchScoreVal.textContent = score.toFixed(3);
        matchSummaryBox.style.display = 'block';
        intruderSummaryBox.style.display = 'none';

        showToast(`Access granted: ${name} (${gender})! Gate unlocked.`, 'success');

        if (gender === 'Female' || gender === 'Girl') {
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1500);
        } else {
            // Automatically secure gate again after 4 seconds
            setTimeout(() => {
                secureGate();
            }, 4000);
        }
    }

    function triggerGateLockDenied() {
        // Keeps lock state, show intruder warning card
        gateCardStatus.className = 'gate-status-card locked';
        gateIcon.className = 'fa-solid fa-lock';
        gateTextStatus.textContent = 'ACCESS DENIED';
        gateSubtextStatus.textContent = 'Intruder Alert: Unknown face detected';

        matchSummaryBox.style.display = 'none';
        intruderSummaryBox.style.display = 'block';
        
        // Update intruder card text
        const bodyText = intruderSummaryBox.querySelector('.match-card-body p');
        if (bodyText) {
            bodyText.innerHTML = 'No registered facial profile found. Gate lock remains secured.';
        }
        
        showToast('Unauthorized face detected. Access Denied.', 'error');
    }

    function secureGate() {
        gateCardStatus.className = 'gate-status-card locked';
        gateIcon.className = 'fa-solid fa-lock';
        gateTextStatus.textContent = 'GATE SECURED';
        gateSubtextStatus.textContent = 'Biometric verification required to unlock';

        matchSummaryBox.style.display = 'none';
        intruderSummaryBox.style.display = 'none';
        verifyOverlayImg.style.display = 'none';
        isGateUnlocked = false; // Release semaphore
    }

    // ----------------------------------------------------
    // User Registration Handler
    // ----------------------------------------------------
    btnRegister.addEventListener('click', () => {
        const name = regName.value.trim();
        if (!name) {
            showToast('Please enter a name first.', 'warning');
            return;
        }

        const genderRadio = document.querySelector('input[name="reg-gender"]:checked');
        const gender = genderRadio ? genderRadio.value : 'Boy';

        if (!webcamStream) return;

        showToast('Capturing credentials...', 'info');
        
        // Draw frame
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const base64Data = canvas.toDataURL('image/jpeg', 0.85);

        fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64Data, name: name, gender: gender })
        })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(({ status, body }) => {
            if (status !== 200) {
                showToast(body.error || 'Failed to register face.', 'error');
                return;
            }
            showToast(body.message, 'success');
            regName.value = '';
            refreshRegistry();
        })
        .catch(err => {
            console.error('Register API Error:', err);
            showToast('Unable to connect to server.', 'error');
        });
    });

    // ----------------------------------------------------
    // Logs & Registry UI Syncing
    // ----------------------------------------------------
    function refreshRegistry() {
        fetch('/users')
            .then(res => res.json())
            .then(users => {
                if (users.length === 0) {
                    registryEmptyMsg.style.display = 'block';
                    registryUsersList.style.display = 'none';
                    registryUsersList.innerHTML = '';
                    return;
                }

                registryEmptyMsg.style.display = 'none';
                registryUsersList.style.display = 'grid'; // Grid display!
                registryUsersList.innerHTML = '';

                users.forEach(user => {
                    const card = document.createElement('div');
                    card.className = 'registry-card glass-card';
                    card.style.cssText = `
                        position: relative;
                        padding: 0.75rem;
                        border-radius: var(--radius-md);
                        border: 1px solid rgba(255,255,255,0.05);
                        background: rgba(255,255,255,0.01);
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                        gap: 0.5rem;
                        transition: var(--transition);
                    `;
                    
                    // Hover glow effect
                    card.addEventListener('mouseenter', () => {
                        card.style.borderColor = user.gender === 'Male' ? 'var(--primary)' : 'var(--secondary)';
                        card.style.boxShadow = user.gender === 'Male' ? '0 0 15px rgba(0, 242, 254, 0.15)' : '0 0 15px rgba(168, 85, 247, 0.15)';
                    });
                    card.addEventListener('mouseleave', () => {
                        card.style.borderColor = 'rgba(255,255,255,0.05)';
                        card.style.boxShadow = 'none';
                    });

                    const genderIcon = user.gender === 'Male' ? '<i class="fa-solid fa-mars" style="color: var(--primary);"></i>' : '<i class="fa-solid fa-venus" style="color: var(--secondary);"></i>';
                    const photoSrc = user.photo || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'; // fallback avatar placeholder
                    
                    card.innerHTML = `
                        <div class="user-avatar" style="width: 54px; height: 54px; border-radius: 50%; overflow: hidden; border: 2px solid ${user.gender === 'Male' ? 'var(--primary)' : 'var(--secondary)'}; background: #111;">
                            <img src="${photoSrc}" style="width: 100%; height: 100%; object-fit: cover;">
                        </div>
                        <div class="user-info">
                            <h5 style="font-size: 0.85rem; font-weight: 700; margin-bottom: 0.1rem; color: var(--text-primary); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 90px;">${user.name}</h5>
                            <span style="font-size: 0.7rem; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; gap: 0.25rem;">
                                ${genderIcon} ${user.gender}
                            </span>
                        </div>
                        <button class="delete-user-btn" title="Delete credentials profile" style="position: absolute; top: 0.35rem; right: 0.35rem; background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.8rem; transition: var(--transition);">
                            <i class="fa-solid fa-user-xmark" style="transition: var(--transition);"></i>
                        </button>
                    `;
                    
                    // Delete button style transitions
                    const delBtn = card.querySelector('.delete-user-btn');
                    delBtn.addEventListener('mouseenter', () => delBtn.style.color = 'var(--danger)');
                    delBtn.addEventListener('mouseleave', () => delBtn.style.color = 'var(--text-muted)');
                    
                    // Wire delete user button
                    delBtn.addEventListener('click', () => {
                        if (confirm(`Delete registered credentials profile for "${user.name}"?`)) {
                            deleteUser(user.name);
                        }
                    });

                    registryUsersList.appendChild(card);
                });
            })
            .catch(err => console.error('Error fetching registered users:', err));
    }

    function deleteUser(name) {
        fetch(`/users/${name}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                showToast(data.message, 'success');
                refreshRegistry();
            })
            .catch(err => console.error('Error deleting user:', err));
    }

    function refreshLogs() {
        fetch('/logs')
            .then(res => res.json())
            .then(logs => {
                allLogs = logs;
                renderLogsTable();
                updateStatsCounters(); // Update real-time stats count row
            })
            .catch(err => console.error('Error fetching check-in logs:', err));
    }

    function renderLogsTable() {
        // Filter logs based on currentTab ('Boy', 'Girl', 'Unknown')
        const filteredLogs = allLogs.filter(log => log.gender === currentTab);

        if (filteredLogs.length === 0) {
            logsEmptyMsg.style.display = 'block';
            logsTableBody.innerHTML = '';
            return;
        }

        logsEmptyMsg.style.display = 'none';
        logsTableBody.innerHTML = '';

        filteredLogs.forEach(log => {
            const statusClass = log.status === 'Authorized' ? 'status-auth' : 'status-denied';
            const iconClass = log.status === 'Authorized' ? 'fa-circle-check' : 'fa-circle-xmark';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="log-thumb">
                        <img src="${log.photo}" alt="Capture">
                    </div>
                </td>
                <td>
                    <span class="log-name">${log.name}</span>
                </td>
                <td>
                    <span>${log.timestamp}</span>
                </td>
                <td>
                    <span class="log-status ${statusClass}">
                        <i class="fa-solid ${iconClass}"></i> ${log.status}
                    </span>
                </td>
            `;
            logsTableBody.appendChild(tr);
        });
    }

    const btnDownloadPdf = document.getElementById('btn-download-pdf');
    if (btnDownloadPdf) {
        btnDownloadPdf.addEventListener('click', () => {
            window.location.href = '/export_pdf';
        });
    }

    btnClearLogs.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the check-in logs?')) {
            fetch('/clear_logs', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    showToast(data.message, 'success');
                    refreshLogs();
                })
                .catch(err => console.error('Error clearing logs:', err));
        }
    });

    // ----------------------------------------------------
    // Toast Notification System
    // ----------------------------------------------------
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let iconClass = 'fa-circle-info';
        if (type === 'success') iconClass = 'fa-circle-check';
        else if (type === 'error') iconClass = 'fa-triangle-exclamation';
        else if (type === 'warning') iconClass = 'fa-circle-exclamation';

        toast.innerHTML = `
            <i class="fa-solid ${iconClass}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);

        // Slide out and remove toast
        setTimeout(() => {
            toast.classList.add('fade-out');
            toast.addEventListener('transitionend', () => {
                toast.remove();
            });
        }, 3500);
    }

    function updateStatsCounters() {
        const statBoys = document.getElementById('stat-boys');
        const statGirls = document.getElementById('stat-girls');
        const statIntruders = document.getElementById('stat-intruders');
        
        if (statBoys && statGirls && statIntruders) {
            const boysCount = allLogs.filter(log => log.gender === 'Male' && log.status === 'Authorized').length;
            const girlsCount = allLogs.filter(log => log.gender === 'Female' && log.status === 'Authorized').length;
            const intrudersCount = allLogs.filter(log => log.status === 'Access Denied').length;
            
            animateCounter(statBoys, boysCount);
            animateCounter(statGirls, girlsCount);
            animateCounter(statIntruders, intrudersCount);
        }
    }
    
    function animateCounter(element, targetValue) {
        const currentValue = parseInt(element.textContent) || 0;
        if (currentValue === targetValue) return;
        
        let start = currentValue;
        const duration = 400; // ms
        const stepTime = Math.abs(Math.floor(duration / (targetValue - currentValue + 1))) || 25;
        
        const timer = setInterval(() => {
            if (start < targetValue) {
                start++;
            } else if (start > targetValue) {
                start--;
            }
            element.textContent = start;
            if (start === targetValue) {
                clearInterval(timer);
            }
        }, Math.max(stepTime, 25));
    }
});
