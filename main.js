const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let tray = null;
let mainWindow = null;

const DATA_DIR = path.join(app.getPath('userData'), 'claude-usage');
const CREDENTIALS_PATH = path.join(DATA_DIR, 'credentials.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

// OAuth constants (same as claude-usage-bar)
const CLIENT_ID = '';
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USERINFO_URL = 'https://api.anthropic.com/api/oauth/userinfo';
const SCOPES = ['user:profile', 'user:inference'];

// PKCE state
let codeVerifier = null;
let oauthState = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Credentials
function saveCredentials(creds) {
  ensureDataDir();
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
}

function loadCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function deleteCredentials() {
  try { fs.unlinkSync(CREDENTIALS_PATH); } catch (e) {}
}

// History
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    }
  } catch (e) {}
  return { dataPoints: [] };
}

function saveHistory(history) {
  ensureDataDir();
  // Keep only last 30 days
  const cutoff = Date.now() - 30 * 86400 * 1000;
  history.dataPoints = history.dataPoints.filter(p => p.timestamp > cutoff);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history));
}

// PKCE helpers
function base64URLEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generateCodeVerifier() {
  return base64URLEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64URLEncode(hash);
}

function createTrayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 380;
  const windowHeight = 680;

  const x = screenWidth - windowWidth - 10;
  const y = screenHeight - windowHeight - 10;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.dock?.hide?.();

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Claude Usage');

  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      createWindow();
    }
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show', click: () => createWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);
    tray.popUpContextMenu(contextMenu);
  });
});

// IPC: OAuth flow
ipcMain.handle('start-oauth', () => {
  codeVerifier = generateCodeVerifier();
  oauthState = generateCodeVerifier();
  const challenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: oauthState
  });

  const url = `${AUTHORIZE_URL}?${params.toString()}`;
  shell.openExternal(url);
  return true;
});

ipcMain.handle('submit-oauth-code', async (_, rawCode) => {
  const trimmed = rawCode.trim();
  const parts = trimmed.split('#');
  const code = parts[0];

  if (parts.length > 1) {
    const returnedState = parts[1];
    if (returnedState !== oauthState) {
      throw new Error('OAuth state mismatch - please try again');
    }
  }

  if (!codeVerifier) {
    throw new Error('No pending OAuth flow');
  }

  const body = {
    grant_type: 'authorization_code',
    code,
    state: oauthState || '',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier
  };

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: HTTP ${response.status} ${text}`);
  }

  const json = await response.json();
  if (!json.access_token) {
    throw new Error('No access token in response');
  }

  const credentials = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    scopes: json.scope ? json.scope.split(' ') : SCOPES
  };

  saveCredentials(credentials);
  codeVerifier = null;
  oauthState = null;

  return true;
});

// Token refresh
async function refreshAccessToken() {
  const creds = loadCredentials();
  if (!creds || !creds.refreshToken) return false;

  const body = {
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: CLIENT_ID
  };

  if (creds.scopes && creds.scopes.length) {
    body.scope = creds.scopes.join(' ');
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) return false;

    const json = await response.json();
    if (!json.access_token) return false;

    const updated = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || creds.refreshToken,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : creds.expiresAt,
      scopes: json.scope ? json.scope.split(' ') : creds.scopes
    };

    saveCredentials(updated);
    return true;
  } catch (e) {
    return false;
  }
}

async function authorizedFetch(url) {
  let creds = loadCredentials();
  if (!creds) throw new Error('Not signed in');

  // Check if token needs refresh
  if (creds.expiresAt && creds.expiresAt - Date.now() < 60000) {
    await refreshAccessToken();
    creds = loadCredentials();
    if (!creds) throw new Error('Failed to refresh token');
  }

  let response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${creds.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20'
    }
  });

  // If 401, try refresh once
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      deleteCredentials();
      throw new Error('Session expired - please sign in again');
    }
    creds = loadCredentials();
    response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20'
      }
    });
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

// IPC: Fetch usage
ipcMain.handle('fetch-usage', async () => {
  return await authorizedFetch(USAGE_URL);
});

// IPC: Fetch profile
ipcMain.handle('fetch-profile', async () => {
  // Try local .claude.json first
  try {
    const homedir = require('os').homedir();
    const claudeConfig = path.join(homedir, '.claude.json');
    if (fs.existsSync(claudeConfig)) {
      const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
      if (config.oauthAccount?.emailAddress) {
        return { email: config.oauthAccount.emailAddress };
      }
      if (config.oauthAccount?.displayName) {
        return { email: config.oauthAccount.displayName };
      }
    }
  } catch (e) {}

  // Fallback to API
  return await authorizedFetch(USERINFO_URL);
});

// IPC: Check auth
ipcMain.handle('check-auth', () => {
  return loadCredentials() !== null;
});

// IPC: Sign out
ipcMain.handle('sign-out', () => {
  deleteCredentials();
  return true;
});

// IPC: History
ipcMain.handle('load-history', () => loadHistory());

ipcMain.handle('save-data-point', (_, point) => {
  const history = loadHistory();
  history.dataPoints.push({ ...point, timestamp: Date.now() });
  saveHistory(history);
  return true;
});

// IPC: Launch at login
ipcMain.handle('set-launch-at-login', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
});

ipcMain.handle('get-launch-at-login', () => {
  return app.getLoginItemSettings().openAtLogin;
});

// IPC: Theme
ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors);

nativeTheme.on('updated', () => {
  const isDark = nativeTheme.shouldUseDarkColors;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme-changed', isDark);
  }
});

// IPC: Quit
ipcMain.handle('quit-app', () => app.quit());

app.on('window-all-closed', () => {
  // Keep running in tray
});
