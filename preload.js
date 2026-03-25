const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  transcribe: (audioBuffer, language) =>
    ipcRenderer.invoke('transcribe', audioBuffer, language),
  transcribeFile: (filePath, language) =>
    ipcRenderer.invoke('transcribe-file', filePath, language),
  getFilePath: (file) => webUtils.getPathForFile(file),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  onApiKeyStatus: (callback) => ipcRenderer.on('api-key-status', (_e, hasKey) => callback(hasKey)),
});
