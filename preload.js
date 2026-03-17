const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startOAuth: () => ipcRenderer.invoke('start-oauth'),
  submitOAuthCode: (code) => ipcRenderer.invoke('submit-oauth-code', code),
  checkAuth: () => ipcRenderer.invoke('check-auth'),
  fetchUsage: () => ipcRenderer.invoke('fetch-usage'),
  fetchProfile: () => ipcRenderer.invoke('fetch-profile'),
  signOut: () => ipcRenderer.invoke('sign-out'),
  loadHistory: () => ipcRenderer.invoke('load-history'),
  saveDataPoint: (point) => ipcRenderer.invoke('save-data-point', point),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('set-launch-at-login', enabled),
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_event, isDark) => callback(isDark)),
  quit: () => ipcRenderer.invoke('quit-app')
});
