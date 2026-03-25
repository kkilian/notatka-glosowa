// --- State ---
let mediaRecorder = null;
let audioChunks = [];
let startTime = 0;
let timerInterval = null;
let selectedLang = 'pl';
let isTranscribing = false;
let dragCounter = 0;
let audioContext = null;
let analyser = null;
let animationFrameId = null;

const ALLOWED_EXTENSIONS = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];

// --- Elements ---
const setupScreen = document.getElementById('setupScreen');
const mainApp = document.getElementById('mainApp');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const setupError = document.getElementById('setupError');
const recordBtn = document.getElementById('recordBtn');
const recordIcon = document.getElementById('recordIcon');
const recordLabel = document.getElementById('recordLabel');
const status = document.getElementById('status');
const timer = document.getElementById('timer');
const result = document.getElementById('result');
const transcription = document.getElementById('transcription');
const stats = document.getElementById('stats');
const copyBtn = document.getElementById('copyBtn');
const dropOverlay = document.getElementById('dropOverlay');
const waveformCanvas = document.getElementById('waveform');
const waveformCtx = waveformCanvas.getContext('2d');
const pinBtn = document.getElementById('pinBtn');
const transcriptionLoader = document.getElementById('transcriptionLoader');

// --- Init loader SVG path length ---
const loaderPath = document.querySelector('.loader-svg path');
if (loaderPath) {
  const pathLength = loaderPath.getTotalLength();
  loaderPath.style.setProperty('--path-length', pathLength);
}

// --- API Key status from main process ---
window.api.onApiKeyStatus((hasKey) => {
  if (hasKey) {
    setupScreen.classList.add('hidden');
    mainApp.style.display = '';
  } else {
    setupScreen.classList.remove('hidden');
    mainApp.style.display = 'none';
  }
});

// --- Save API key ---
saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setupError.textContent = 'Wklej klucz API';
    return;
  }

  saveKeyBtn.disabled = true;
  saveKeyBtn.textContent = 'Sprawdzanie...';
  setupError.textContent = '';

  const result = await window.api.saveApiKey(key);

  if (result.success) {
    setupScreen.classList.add('hidden');
    mainApp.style.display = '';
  } else {
    setupError.textContent = result.error;
    saveKeyBtn.disabled = false;
    saveKeyBtn.textContent = 'Zapisz klucz';
  }
});

apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveKeyBtn.click();
});

// --- Pin (always-on-top) toggle ---
pinBtn.addEventListener('click', async () => {
  const isOnTop = await window.api.toggleAlwaysOnTop();
  pinBtn.classList.toggle('pinned', isOnTop);
  pinBtn.title = isOnTop ? 'Zawsze na wierzchu (wł.)' : 'Zawsze na wierzchu (wył.)';
});

window.api.getAlwaysOnTop().then(isOnTop => {
  pinBtn.classList.toggle('pinned', isOnTop);
  pinBtn.title = isOnTop ? 'Zawsze na wierzchu (wł.)' : 'Zawsze na wierzchu (wył.)';
});

// --- Language toggle ---
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLang = btn.dataset.lang;
  });
});

// --- Record button ---
recordBtn.addEventListener('click', () => {
  if (recordBtn.classList.contains('disabled')) return;

  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    startRecording();
  } else {
    stopRecording();
  }
});

// --- Copy button ---
copyBtn.addEventListener('click', () => {
  const text = transcription.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = 'Skopiowano!';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = 'Kopiuj wszystko';
      copyBtn.classList.remove('copied');
    }, 2000);
  });
});

// --- Recording ---
async function startRecording() {
  if (isTranscribing) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      await transcribeAudio(audioBlob);
    };

    mediaRecorder.start();
    startTime = Date.now();
    startWaveform(stream);

    // UI updates
    status.textContent = 'Nagrywanie...';
    status.className = 'status recording';
    recordBtn.classList.add('recording');
    recordLabel.textContent = 'Stop';
    result.classList.remove('visible');

    timerInterval = setInterval(updateTimer, 100);
  } catch (err) {
    status.textContent = 'Brak dostępu do mikrofonu';
    status.className = 'status';
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    stopWaveform();

    // Freeze timer at final recording time
    const elapsed = Date.now() - startTime;
    const min = Math.floor(elapsed / 60000);
    const sec = Math.floor((elapsed % 60000) / 1000);
    timer.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    status.textContent = '';
    status.className = 'status';
    transcriptionLoader.classList.add('visible');
    recordBtn.classList.remove('recording');
    recordBtn.classList.add('disabled');
    recordLabel.textContent = '';
  }
}

function updateTimer() {
  const elapsed = Date.now() - startTime;
  const min = Math.floor(elapsed / 60000);
  const sec = Math.floor((elapsed % 60000) / 1000);
  timer.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

  if (min >= 30) {
    stopRecording();
  }
}

// --- Transcription from recording ---
async function transcribeAudio(audioBlob) {
  isTranscribing = true;
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const result_data = await window.api.transcribe(arrayBuffer, selectedLang);
    showTranscriptionResult(result_data);
  } catch (err) {
    status.textContent = 'Błąd połączenia z API';
    status.className = 'status';
  }

  transcriptionLoader.classList.remove('visible');
  isTranscribing = false;
  recordBtn.classList.remove('recording', 'disabled');
  recordLabel.textContent = 'Nagrywaj';
  timer.textContent = '00:00';
}

// --- Transcription from file (drag & drop) ---
async function transcribeFile(filePath, fileName) {
  isTranscribing = true;
  recordBtn.classList.add('disabled');
  recordLabel.textContent = '';

  status.textContent = '';
  status.className = 'status';
  transcriptionLoader.classList.add('visible');
  result.classList.remove('visible');

  try {
    const result_data = await window.api.transcribeFile(filePath, selectedLang);
    showTranscriptionResult(result_data);
  } catch (err) {
    status.textContent = 'Błąd połączenia z API';
    status.className = 'status';
  }

  transcriptionLoader.classList.remove('visible');
  isTranscribing = false;
  recordBtn.classList.remove('disabled');
  recordLabel.textContent = 'Nagrywaj';
  timer.textContent = '00:00';
}

// --- Show result ---
function showTranscriptionResult(result_data) {
  if (result_data.success) {
    const text = result_data.text;
    const wordCount = text.trim().split(/\s+/).length;
    const charCount = text.length;

    transcription.textContent = text;
    stats.textContent = `${charCount} znaków \u00b7 ${wordCount} słów`;
    result.classList.add('visible');

    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Skopiowano!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Kopiuj wszystko';
        copyBtn.classList.remove('copied');
      }, 3000);
    });

    status.textContent = 'Gotowe · skopiowano do schowka';
    status.className = 'status done';
  } else {
    status.textContent = `Błąd: ${result_data.error}`;
    status.className = 'status';
  }
}

// --- Radial pulse visualization ---
let smoothedEnergy = 0;

function startWaveform(stream) {
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.5;

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  waveformCanvas.classList.add('active');

  const dpr = window.devicePixelRatio || 2;
  const S = 300;
  waveformCanvas.width = S * dpr;
  waveformCanvas.height = S * dpr;
  waveformCtx.scale(dpr, dpr);

  const cx = S / 2, cy = S / 2;
  const bufferLength = analyser.fftSize;
  const dataArray = new Float32Array(bufferLength);
  let t = 0;
  smoothedEnergy = 0;

  function draw() {
    animationFrameId = requestAnimationFrame(draw);
    analyser.getFloatTimeDomainData(dataArray);
    t += 0.035;

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / bufferLength);
    const energy = Math.min(1, rms * 10);
    const rate = energy > smoothedEnergy ? 0.3 : 0.08;
    smoothedEnergy += (energy - smoothedEnergy) * rate;

    waveformCtx.clearRect(0, 0, S, S);

    const ringCount = 5;
    for (let i = ringCount - 1; i >= 0; i--) {
      const baseRadius = 40 + i * 13;
      const pulseAmount = smoothedEnergy * 22 * (1 + i * 0.4);
      const radius = baseRadius + Math.sin(t * 2.2 + i * 0.9) * pulseAmount;
      const alpha = (0.06 + smoothedEnergy * 0.14) * (1 - i * 0.17);

      waveformCtx.beginPath();
      for (let a = 0; a <= Math.PI * 2; a += 0.05) {
        const wobble = Math.sin(a * 3 + t * 2.8 + i) * smoothedEnergy * 8
                     + Math.sin(a * 5 - t * 1.8 + i * 2) * smoothedEnergy * 4
                     + Math.sin(a * 7 + t * 3.2 + i * 0.5) * smoothedEnergy * 2;
        const r = radius + wobble;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (a === 0) waveformCtx.moveTo(x, y);
        else waveformCtx.lineTo(x, y);
      }
      waveformCtx.closePath();

      const grad = waveformCtx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius);
      grad.addColorStop(0, `rgba(255, 59, 48, ${alpha * 0.2})`);
      grad.addColorStop(1, `rgba(255, 59, 48, ${alpha})`);
      waveformCtx.fillStyle = grad;
      waveformCtx.fill();

      waveformCtx.strokeStyle = `rgba(255, 59, 48, ${alpha * 1.8})`;
      waveformCtx.lineWidth = 1.5;
      waveformCtx.stroke();
    }
  }

  draw();
}

function stopWaveform() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  waveformCanvas.classList.remove('active');
  waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}

// --- Drag & Drop ---
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1 && !isTranscribing && !(mediaRecorder && mediaRecorder.state === 'recording')) {
    dropOverlay.classList.add('visible');
  }
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.classList.remove('visible');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('visible');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    status.textContent = 'Zatrzymaj nagrywanie przed wrzuceniem pliku';
    status.className = 'status';
    return;
  }

  if (isTranscribing) {
    status.textContent = 'Poczekaj na zakończenie transkrypcji';
    status.className = 'status';
    return;
  }

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  const filePath = window.api.getFilePath(file);
  const fileName = file.name;

  if (!filePath) {
    status.textContent = 'Nie można odczytać ścieżki pliku';
    status.className = 'status';
    return;
  }

  const ext = '.' + fileName.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    status.textContent = `Nieobsługiwany format (${ext}). Użyj: ${ALLOWED_EXTENSIONS.join(', ')}`;
    status.className = 'status';
    return;
  }

  transcribeFile(filePath, fileName);
});
