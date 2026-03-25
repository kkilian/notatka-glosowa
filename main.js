const { app, BrowserWindow, ipcMain, systemPreferences, safeStorage } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const OpenAI = require('openai');
const ffmpegPath = require('ffmpeg-static');

const API_KEY_FILE = path.join(app.getPath('userData'), 'api-key.enc');
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB — Whisper API limit
const ALLOWED_EXTENSIONS = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];

let mainWindow;
let client = null;

// --- API Key management ---
function loadApiKey() {
  try {
    if (fs.existsSync(API_KEY_FILE) && safeStorage.isEncryptionAvailable()) {
      const encrypted = fs.readFileSync(API_KEY_FILE);
      return safeStorage.decryptString(encrypted);
    }
  } catch (err) {
    console.error('Failed to load API key:', err.message);
  }
  return null;
}

function saveApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Szyfrowanie nie jest dostępne na tym urządzeniu');
  }
  const encrypted = safeStorage.encryptString(key);
  fs.writeFileSync(API_KEY_FILE, encrypted);
}

function initClient(apiKey) {
  client = new OpenAI({
    apiKey,
    timeout: 5 * 60 * 1000,
  });
}

// --- Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 340,
    minHeight: 400,
    alwaysOnTop: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('api-key-status', client !== null);
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone');
    }
  }

  const existingKey = loadApiKey();
  if (existingKey) {
    initClient(existingKey);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// --- IPC: Save API key ---
ipcMain.handle('save-api-key', async (_event, key) => {
  try {
    const testClient = new OpenAI({ apiKey: key, timeout: 15000 });
    await testClient.models.list();

    saveApiKey(key);
    initClient(key);
    return { success: true };
  } catch (err) {
    if (err.status === 401) {
      return { success: false, error: 'Nieprawidłowy klucz API' };
    }
    if (err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      saveApiKey(key);
      initClient(key);
      return { success: true };
    }
    return { success: false, error: err.message || 'Nie udało się zweryfikować klucza' };
  }
});

// --- IPC: Toggle always-on-top ---
ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWindow) return false;
  const newState = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(newState, 'floating');
  return newState;
});

ipcMain.handle('get-always-on-top', () => {
  if (!mainWindow) return false;
  return mainWindow.isAlwaysOnTop();
});

// --- Helpers ---
function formatTranscriptionError(err) {
  if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
    return 'Przekroczono czas oczekiwania — spróbuj krótszego nagrania';
  }
  if (err.status === 413) {
    return 'Plik jest za duży dla API (maks. 25 MB)';
  }
  if (err.status === 429) {
    return 'Zbyt wiele zapytań — poczekaj chwilę i spróbuj ponownie';
  }
  return err.message || 'Nieznany błąd transkrypcji';
}

function convertToMp3(inputPath) {
  const outputPath = inputPath.replace(/\.webm$/, '.mp3');
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-i', inputPath,
      '-codec:a', 'libmp3lame',
      '-qscale:a', '2',
      '-y',
      outputPath,
    ], (err) => {
      if (err) reject(new Error(`Konwersja audio nie powiodła się: ${err.message}`));
      else resolve(outputPath);
    });
  });
}

// --- IPC: Transcribe audio from recording ---
ipcMain.handle('transcribe', async (_event, audioBuffer, language) => {
  if (!client) return { success: false, error: 'Brak klucza API' };

  const tmpWebm = path.join(os.tmpdir(), `notatka-${Date.now()}.webm`);
  let tmpMp3 = null;

  try {
    fs.writeFileSync(tmpWebm, Buffer.from(audioBuffer));
    const fileSize = fs.statSync(tmpWebm).size;
    if (fileSize === 0) return { success: false, error: 'Nagranie jest puste' };

    tmpMp3 = await convertToMp3(tmpWebm);
    const mp3Size = fs.statSync(tmpMp3).size;
    if (mp3Size > MAX_FILE_SIZE) {
      return { success: false, error: `Plik jest za duży (${(mp3Size / 1024 / 1024).toFixed(1)} MB). Maks. 25 MB.` };
    }

    const transcription = await client.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe',
      file: fs.createReadStream(tmpMp3),
      language: language || 'pl',
      response_format: 'text',
    });

    return { success: true, text: transcription };
  } catch (err) {
    console.error('Transcription error:', err.message);
    return { success: false, error: formatTranscriptionError(err) };
  } finally {
    try { fs.unlinkSync(tmpWebm); } catch {}
    if (tmpMp3) try { fs.unlinkSync(tmpMp3); } catch {}
  }
});

// --- IPC: Transcribe audio file from disk (drag & drop) ---
ipcMain.handle('transcribe-file', async (_event, filePath, language) => {
  if (!client) return { success: false, error: 'Brak klucza API' };

  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'Plik nie istnieje' };

    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return { success: false, error: `Nieobsługiwany format (${ext}). Obsługiwane: ${ALLOWED_EXTENSIONS.join(', ')}` };
    }

    const fileSize = fs.statSync(filePath).size;
    if (fileSize === 0) return { success: false, error: 'Plik jest pusty' };
    if (fileSize > MAX_FILE_SIZE) {
      return { success: false, error: `Plik jest za duży (${(fileSize / 1024 / 1024).toFixed(1)} MB). Maks. 25 MB.` };
    }

    const transcription = await client.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe',
      file: fs.createReadStream(filePath),
      language: language || 'pl',
      response_format: 'text',
    });

    return { success: true, text: transcription };
  } catch (err) {
    console.error('File transcription error:', err.message);
    return { success: false, error: formatTranscriptionError(err) };
  }
});
