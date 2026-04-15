# Detailed Stats Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Detaylı" tab to the existing Electron tray app that reads local Claude Code JSONL files and shows session-level statistics (projects, costs, token breakdown, charts).

**Architecture:** Hybrid approach — existing OAuth API gauges remain untouched. A new `scanner.js` module in the main process reads `~/.claude/projects/**/*.jsonl` files, stores data in SQLite (`~/.claude/usage.db`), and exposes it via new IPC handlers. A new `detailedStats.js` renderer file drives the Detaylı tab UI using Chart.js (CDN).

**Tech Stack:** Electron 41.0.2, Node.js (main process), `better-sqlite3` (SQLite), Chart.js 4.x (CDN), Vanilla JS/HTML/CSS

---

## Prerequisites

Before starting, understand the existing file structure:
- `main.js` (390 lines) — Electron main process, all IPC handlers live here
- `preload.js` (18 lines) — exposes `window.electronAPI` via contextBridge
- `index.html` (127 lines) — two screens: `#login-screen` and `#dashboard-screen`
- `renderer.js` — existing dashboard logic (DO NOT MODIFY)
- `styles.css` — dark/light theme with CSS variables
- Window size: 380×680px, `resizable: false`, `skipTaskbar: true`

---

### Task 1: Install better-sqlite3 and electron-rebuild

`better-sqlite3` needs to be compiled against the exact Electron version (41.0.2). This task installs it correctly.

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

```bash
cd "D:/Development/Cursor Apps/ClaudeUsageApp"
npm install better-sqlite3 --save
npm install electron-rebuild --save-dev
```

**Step 2: Rebuild for Electron**

```bash
npx electron-rebuild -f -w better-sqlite3
```

Expected output: `✔ Rebuild Complete`

If rebuild fails with Python/MSVC errors, install Visual Studio Build Tools (C++ workload) and run again.

**Step 3: Verify install**

```bash
node -e "const db = require('better-sqlite3')(':memory:'); console.log('OK', db.pragma('journal_mode = WAL'));"
```

Expected: `OK [ { journal_mode: 'wal' } ]`

**Step 4: Update package.json build files list**

Add `scanner.js` and `detailedStats.js` to the `build.files` array:

```json
"files": [
  "main.js",
  "preload.js",
  "renderer.js",
  "detailedStats.js",
  "scanner.js",
  "chart.js",
  "gauge.js",
  "index.html",
  "styles.css",
  "icon.ico"
]
```

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install better-sqlite3 for local JSONL scanning"
```

---

### Task 2: Create scanner.js

This module handles all SQLite initialization, JSONL file scanning, and data upsert. It runs in the main process.

**Files:**
- Create: `scanner.js`

**Step 1: Create the file with this exact content**

```js
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const DB_PATH = path.join(os.homedir(), '.claude', 'usage.db');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Token pricing per million tokens (USD)
const PRICING = {
  'claude-opus-4-6':    { input: 15,   output: 75,  cacheRead: 1.5,   cacheWrite: 18.75 },
  'claude-opus-4-5':    { input: 15,   output: 75,  cacheRead: 1.5,   cacheWrite: 18.75 },
  'claude-sonnet-4-6':  { input: 3,    output: 15,  cacheRead: 0.3,   cacheWrite: 3.75  },
  'claude-sonnet-4-5':  { input: 3,    output: 15,  cacheRead: 0.3,   cacheWrite: 3.75  },
  'claude-haiku-4-5':   { input: 0.8,  output: 4,   cacheRead: 0.08,  cacheWrite: 1.0   },
};
const DEFAULT_PRICING = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

function calcCost(model, inputTokens, outputTokens, cacheRead, cacheWrite) {
  const p = PRICING[model] || DEFAULT_PRICING;
  return (
    (inputTokens  / 1e6) * p.input +
    (outputTokens / 1e6) * p.output +
    (cacheRead    / 1e6) * p.cacheRead +
    (cacheWrite   / 1e6) * p.cacheWrite
  );
}

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project_name TEXT,
      first_timestamp TEXT,
      last_timestamp TEXT,
      model TEXT,
      turn_count INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read INTEGER DEFAULT 0,
      total_cache_creation INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      timestamp TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_first ON sessions(first_timestamp);
    CREATE TABLE IF NOT EXISTS processed_files (
      path TEXT PRIMARY KEY,
      mtime INTEGER,
      lines INTEGER
    );
  `);
  return db;
}

function projectNameFromPath(filePath) {
  // ~/.claude/projects/-home-user-myproject/session.jsonl
  // Extract the last path segment before the filename
  const parts = filePath.split(path.sep);
  const projectDir = parts[parts.length - 2] || 'unknown';
  // Convert encoded path back to readable name
  return projectDir.replace(/^-/, '').replace(/-/g, '/').split('/').pop() || projectDir;
}

function sessionIdFromPath(filePath) {
  const base = path.basename(filePath, '.jsonl');
  return base;
}

function scanFile(db, filePath) {
  const stat = fs.statSync(filePath);
  const mtime = Math.floor(stat.mtimeMs);

  const existing = db.prepare('SELECT mtime, lines FROM processed_files WHERE path = ?').get(filePath);
  if (existing && existing.mtime === mtime) return; // unchanged

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  const sessionId = sessionIdFromPath(filePath);
  const projectName = projectNameFromPath(filePath);

  let firstTimestamp = null;
  let lastTimestamp = null;
  let model = null;
  let turnCount = 0;
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;

  const insertTurn = db.prepare(`
    INSERT OR IGNORE INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch (e) { continue; }

    if (record.type !== 'assistant') continue;
    const usage = record.message?.usage;
    if (!usage) continue;

    const ts = record.timestamp || record.message?.timestamp || null;
    const m  = record.message?.model || null;
    const input     = usage.input_tokens || 0;
    const output    = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite= usage.cache_creation_input_tokens || 0;

    if (ts) {
      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
      if (!lastTimestamp  || ts > lastTimestamp)  lastTimestamp  = ts;
    }
    if (m) model = m;

    totalInput     += input;
    totalOutput    += output;
    totalCacheRead += cacheRead;
    totalCacheWrite+= cacheWrite;
    turnCount++;

    if (ts) {
      insertTurn.run(sessionId, ts, m, input, output, cacheRead, cacheWrite);
    }
  }

  if (turnCount === 0) {
    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)').run(filePath, mtime, lines.length);
    return;
  }

  db.prepare(`
    INSERT OR REPLACE INTO sessions
      (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
       total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, projectName, firstTimestamp, lastTimestamp, model, turnCount,
         totalInput, totalOutput, totalCacheRead, totalCacheWrite);

  db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)').run(filePath, mtime, lines.length);
}

function scan() {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return { scanned: 0, error: null };

  const db = openDb();
  let scanned = 0;

  try {
    const pattern = path.join(CLAUDE_PROJECTS_DIR, '**', '*.jsonl');
    const files = getAllJsonlFiles(CLAUDE_PROJECTS_DIR);

    for (const file of files) {
      try {
        scanFile(db, file);
        scanned++;
      } catch (e) {
        // Skip unreadable files
      }
    }
  } finally {
    db.close();
  }

  return { scanned, error: null };
}

function getAllJsonlFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

function queryStats(filters = {}) {
  const db = openDb();
  try {
    const { model, days } = filters;
    let whereSession = '1=1';
    const params = [];

    if (days) {
      const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
      whereSession += ' AND first_timestamp >= ?';
      params.push(cutoff);
    }
    if (model && model !== 'all') {
      whereSession += ' AND model LIKE ?';
      params.push(`%${model}%`);
    }

    // KPI summary
    const summary = db.prepare(`
      SELECT COUNT(*) as sessionCount,
             SUM(turn_count) as totalTurns,
             SUM(total_input_tokens) as totalInput,
             SUM(total_output_tokens) as totalOutput,
             SUM(total_cache_read) as totalCacheRead,
             SUM(total_cache_creation) as totalCacheWrite
      FROM sessions WHERE ${whereSession}
    `).get(...params);

    // Calculate total cost
    const sessions = db.prepare(`SELECT * FROM sessions WHERE ${whereSession}`).all(...params);
    let totalCost = 0;
    for (const s of sessions) {
      totalCost += calcCost(s.model, s.total_input_tokens, s.total_output_tokens, s.total_cache_read, s.total_cache_creation);
    }

    // Daily tokens (last N days)
    const dailyRows = db.prepare(`
      SELECT DATE(first_timestamp) as day,
             SUM(total_input_tokens) as input,
             SUM(total_output_tokens) as output,
             SUM(total_cache_read) as cacheRead
      FROM sessions WHERE ${whereSession}
      GROUP BY day ORDER BY day ASC
    `).all(...params);

    // Project breakdown
    const projectRows = db.prepare(`
      SELECT project_name,
             SUM(total_input_tokens + total_output_tokens) as totalTokens,
             COUNT(*) as sessionCount
      FROM sessions WHERE ${whereSession}
      GROUP BY project_name ORDER BY totalTokens DESC LIMIT 10
    `).all(...params);

    // Model cost breakdown
    const modelRows = db.prepare(`
      SELECT model,
             COUNT(*) as sessionCount,
             SUM(turn_count) as turns,
             SUM(total_input_tokens) as input,
             SUM(total_output_tokens) as output,
             SUM(total_cache_read) as cacheRead,
             SUM(total_cache_creation) as cacheWrite
      FROM sessions WHERE ${whereSession}
      GROUP BY model ORDER BY input DESC
    `).all(...params);

    const modelRowsWithCost = modelRows.map(r => ({
      ...r,
      cost: calcCost(r.model, r.input, r.output, r.cacheRead, r.cacheWrite)
    }));

    // Recent sessions
    const recentSessions = db.prepare(`
      SELECT session_id, project_name, first_timestamp, last_timestamp, model,
             turn_count, total_input_tokens, total_output_tokens,
             total_cache_read, total_cache_creation
      FROM sessions WHERE ${whereSession}
      ORDER BY last_timestamp DESC LIMIT 50
    `).all(...params).map(s => ({
      ...s,
      cost: calcCost(s.model, s.total_input_tokens, s.total_output_tokens, s.total_cache_read, s.total_cache_creation),
      durationMinutes: s.first_timestamp && s.last_timestamp
        ? Math.round((new Date(s.last_timestamp) - new Date(s.first_timestamp)) / 60000)
        : 0
    }));

    return { summary: { ...summary, totalCost }, dailyRows, projectRows, modelRows: modelRowsWithCost, recentSessions };
  } finally {
    db.close();
  }
}

function getAvailableModels() {
  const db = openDb();
  try {
    return db.prepare('SELECT DISTINCT model FROM sessions WHERE model IS NOT NULL ORDER BY model').all().map(r => r.model);
  } finally {
    db.close();
  }
}

module.exports = { scan, queryStats, getAvailableModels, PRICING, calcCost };
```

**Step 2: Verify syntax**

```bash
node -e "const s = require('./scanner.js'); console.log('scanner loaded OK');"
```

Expected: `scanner loaded OK`

**Step 3: Commit**

```bash
git add scanner.js
git commit -m "feat: add JSONL scanner with SQLite storage"
```

---

### Task 3: Add IPC handlers to main.js

Add 3 new handlers at the end of `main.js` (after line 385, before `app.on('window-all-closed')`), plus auto-scan setup.

**Files:**
- Modify: `main.js:1` (add require at top), `main.js:134` (add scan on startup), `main.js:385` (add IPC handlers)

**Step 1: Add scanner require at top of main.js**

After line 4 (`const crypto = require('crypto');`), add:

```js
const scanner = require('./scanner');
```

**Step 2: Add auto-scan on app ready**

In `app.whenReady().then(...)` (line 134), after `app.dock?.hide?.();`, add:

```js
  // Scan local JSONL files on startup
  scanner.scan();
  // Re-scan every 5 minutes
  setInterval(() => scanner.scan(), 5 * 60 * 1000);
```

**Step 3: Add IPC handlers before `app.on('window-all-closed')`**

After line 385 (`ipcMain.handle('quit-app', () => app.quit());`), add:

```js
// IPC: Local JSONL stats
ipcMain.handle('scan-local-usage', () => scanner.scan());

ipcMain.handle('get-detailed-stats', (_, filters) => {
  try {
    return { success: true, data: scanner.queryStats(filters) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-available-models', () => {
  try {
    return scanner.getAvailableModels();
  } catch (e) {
    return [];
  }
});
```

**Step 4: Verify app still starts**

```bash
npm start
```

Check: tray icon appears, no console errors about scanner.

**Step 5: Commit**

```bash
git add main.js
git commit -m "feat: add local JSONL scan IPC handlers with auto-scan every 5min"
```

---

### Task 4: Update preload.js

Add the 3 new IPC methods to the contextBridge.

**Files:**
- Modify: `preload.js`

**Step 1: Add new methods**

The current `preload.js` ends at line 17. Replace the closing `});` (line 17) with:

```js
  scanLocalUsage: () => ipcRenderer.invoke('scan-local-usage'),
  getDetailedStats: (filters) => ipcRenderer.invoke('get-detailed-stats', filters),
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
});
```

(Remove the old `});` on line 17 and replace with the block above.)

**Step 2: Verify**

```bash
npm start
```

Open DevTools (add `mainWindow.webContents.openDevTools()` temporarily to main.js), run in console:
```js
await window.electronAPI.getAvailableModels()
```
Expected: `[]` (empty array if no JSONL files) or array of model strings.

**Step 3: Commit**

```bash
git add preload.js
git commit -m "feat: expose local stats IPC methods via preload bridge"
```

---

### Task 5: Add tab bar and Detaylı screen to index.html

**Files:**
- Modify: `index.html`

**Step 1: Add Chart.js CDN script**

Before the closing `</body>` tag (line 126), before existing `<script>` tags, add:

```html
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

**Step 2: Wrap dashboard content in tabs**

Replace the entire `#dashboard-screen` div (lines 34–112) with this new structure:

```html
    <!-- Dashboard Screen -->
    <div id="dashboard-screen" class="screen" style="display:none;">

      <!-- Tab Bar -->
      <div class="tab-bar">
        <button class="tab-btn active" id="tab-ozet" data-tab="ozet">Özet</button>
        <button class="tab-btn" id="tab-detayli" data-tab="detayli">Detaylı</button>
      </div>

      <!-- ===== ÖZET TAB ===== -->
      <div id="tab-content-ozet" class="tab-content">
        <div class="header">
          <h1>Claude Usage</h1>
          <span class="user-email" id="user-email"></span>
        </div>

        <!-- Gauge Charts -->
        <div class="gauge-row">
          <div class="gauge-card">
            <div class="gauge-title">5-Hour Window</div>
            <canvas id="gauge-5h"></canvas>
            <div class="gauge-reset" id="reset-5h">Resets --</div>
          </div>
          <div class="gauge-card">
            <div class="gauge-title">7-Day Window</div>
            <canvas id="gauge-7d"></canvas>
            <div class="gauge-reset" id="reset-7d">Resets --</div>
          </div>
        </div>

        <!-- Extra Usage (if enabled) -->
        <div class="usage-section" id="extra-section" style="display:none;">
          <div class="usage-header">
            <span class="usage-label">Extra Usage</span>
            <span class="usage-value" id="extra-value">$0.00</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill purple" id="bar-extra" style="width: 0%"></div>
          </div>
          <div class="usage-detail" id="extra-detail"></div>
        </div>

        <!-- Per-Model Breakdown (7 day) -->
        <div id="model-section" class="model-section" style="display:none;">
          <div class="section-title">Per-Model (7 day)</div>
          <div id="model-breakdown"></div>
        </div>

        <!-- 7-Day Chart -->
        <div class="chart-section">
          <div class="section-title">Last 7 Days</div>
          <div class="chart-container">
            <canvas id="usage-chart"></canvas>
          </div>
          <div class="chart-legend" id="chart-legend"></div>
        </div>

        <!-- Footer -->
        <div class="footer">
          <div class="update-info" id="update-info">Updated just now</div>
          <div class="footer-bottom">
            <button class="refresh-icon-btn" id="refresh-btn" title="Refresh">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M13.65 2.35A7.96 7.96 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 8 14 6 6 0 1 1 8 2c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z" fill="currentColor"/>
              </svg>
            </button>
            <div class="launch-toggle">
              <span>Launch at Login</span>
              <label class="switch">
                <input type="checkbox" id="launch-toggle">
                <span class="slider"></span>
              </label>
            </div>
            <div class="hamburger-menu">
              <button class="hamburger-btn" id="hamburger-btn" title="Menu">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="2" y="3" width="14" height="2" rx="1" fill="currentColor"/>
                  <rect x="2" y="8" width="14" height="2" rx="1" fill="currentColor"/>
                  <rect x="2" y="13" width="14" height="2" rx="1" fill="currentColor"/>
                </svg>
              </button>
              <div class="hamburger-dropdown" id="hamburger-dropdown">
                <button class="dropdown-item" id="signout-btn">Sign Out</button>
                <button class="dropdown-item danger" id="quit-btn">Quit</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== DETAYLI TAB ===== -->
      <div id="tab-content-detayli" class="tab-content" style="display:none;">
        <!-- Filter Bar -->
        <div class="detail-filter-bar">
          <select id="detail-model-filter" class="detail-select">
            <option value="all">Tüm Modeller</option>
          </select>
          <select id="detail-days-filter" class="detail-select">
            <option value="7">Son 7 gün</option>
            <option value="30" selected>Son 30 gün</option>
            <option value="90">Son 90 gün</option>
            <option value="0">Tümü</option>
          </select>
          <button id="detail-refresh-btn" class="detail-refresh-btn" title="Yenile">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M13.65 2.35A7.96 7.96 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 8 14 6 6 0 1 1 8 2c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z" fill="currentColor"/>
            </svg>
          </button>
        </div>

        <!-- KPI Cards -->
        <div class="detail-kpi-row">
          <div class="detail-kpi-card">
            <div class="detail-kpi-value" id="kpi-sessions">—</div>
            <div class="detail-kpi-label">Sessions</div>
          </div>
          <div class="detail-kpi-card">
            <div class="detail-kpi-value" id="kpi-cost">—</div>
            <div class="detail-kpi-label">Maliyet</div>
          </div>
          <div class="detail-kpi-card">
            <div class="detail-kpi-value" id="kpi-turns">—</div>
            <div class="detail-kpi-label">Turns</div>
          </div>
        </div>

        <div class="detail-scroll">
          <!-- Daily Token Chart -->
          <div class="detail-card">
            <div class="detail-card-title">Günlük Token Kullanımı</div>
            <canvas id="daily-tokens-chart" height="120"></canvas>
          </div>

          <!-- Two small charts -->
          <div class="detail-two-col">
            <div class="detail-card">
              <div class="detail-card-title">Model Dağılımı</div>
              <canvas id="model-dist-chart" height="120"></canvas>
            </div>
            <div class="detail-card">
              <div class="detail-card-title">Top Projeler</div>
              <canvas id="project-chart" height="120"></canvas>
            </div>
          </div>

          <!-- Recent Sessions Table -->
          <div class="detail-card">
            <div class="detail-card-title">Son Oturumlar</div>
            <div class="detail-table-wrap">
              <table class="detail-table" id="sessions-table">
                <thead>
                  <tr>
                    <th>Proje</th>
                    <th>Model</th>
                    <th>Süre</th>
                    <th>Turns</th>
                    <th>Maliyet</th>
                  </tr>
                </thead>
                <tbody id="sessions-tbody"></tbody>
              </table>
            </div>
          </div>

          <!-- Cost by Model Table -->
          <div class="detail-card">
            <div class="detail-card-title">Model Bazlı Maliyet</div>
            <div class="detail-table-wrap">
              <table class="detail-table" id="model-cost-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Turns</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Maliyet</th>
                  </tr>
                </thead>
                <tbody id="model-cost-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

    </div>
```

**Step 3: Add detailedStats.js script**

Before `</body>`, after existing scripts, add:

```html
  <script src="detailedStats.js"></script>
```

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add tab bar and Detaylı screen markup to index.html"
```

---

### Task 6: Add CSS for tabs and Detaylı components

**Files:**
- Modify: `styles.css` (append at end)

**Step 1: Append to styles.css**

```css
/* ===== TAB BAR ===== */
.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.1));
  margin-bottom: 0;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 0;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary, rgba(255,255,255,0.5));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.tab-btn.active {
  color: var(--text-primary, #fff);
  border-bottom-color: #D97734;
}

.tab-btn:hover:not(.active) {
  color: var(--text-primary, #fff);
}

.tab-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

/* ===== DETAYLI TAB ===== */
.detail-filter-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 6px;
  flex-shrink: 0;
}

.detail-select {
  flex: 1;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color, rgba(255,255,255,0.15));
  background: var(--card-bg, rgba(255,255,255,0.05));
  color: var(--text-primary, #fff);
  font-size: 12px;
  cursor: pointer;
}

.detail-refresh-btn {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color, rgba(255,255,255,0.15));
  background: var(--card-bg, rgba(255,255,255,0.05));
  color: var(--text-primary, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-refresh-btn:hover { opacity: 0.7; }

.detail-kpi-row {
  display: flex;
  gap: 8px;
  padding: 4px 12px 8px;
  flex-shrink: 0;
}

.detail-kpi-card {
  flex: 1;
  background: var(--card-bg, rgba(255,255,255,0.05));
  border-radius: 8px;
  padding: 8px 6px;
  text-align: center;
}

.detail-kpi-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.detail-kpi-label {
  font-size: 10px;
  color: var(--text-secondary, rgba(255,255,255,0.5));
  margin-top: 2px;
}

.detail-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 12px 12px;
}

.detail-scroll::-webkit-scrollbar { width: 4px; }
.detail-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }

.detail-card {
  background: var(--card-bg, rgba(255,255,255,0.05));
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 8px;
}

.detail-card-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, rgba(255,255,255,0.6));
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.detail-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

.detail-two-col .detail-card {
  margin-bottom: 0;
}

.detail-table-wrap {
  overflow-x: auto;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.detail-table th {
  text-align: left;
  padding: 4px 6px;
  color: var(--text-secondary, rgba(255,255,255,0.5));
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.1));
  white-space: nowrap;
}

.detail-table td {
  padding: 5px 6px;
  color: var(--text-primary, #fff);
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.05));
  white-space: nowrap;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-table tr:last-child td { border-bottom: none; }

/* Light theme overrides */
body.light .tab-btn { color: rgba(0,0,0,0.4); }
body.light .tab-btn.active { color: #000; }
body.light .detail-select { color: #000; background: rgba(0,0,0,0.05); border-color: rgba(0,0,0,0.15); }
body.light .detail-refresh-btn { color: #000; background: rgba(0,0,0,0.05); border-color: rgba(0,0,0,0.15); }
body.light .detail-kpi-value { color: #000; }
body.light .detail-kpi-label { color: rgba(0,0,0,0.5); }
body.light .detail-table td { color: #000; }
body.light .detail-table th { color: rgba(0,0,0,0.5); }
body.light .detail-card-title { color: rgba(0,0,0,0.5); }
```

**Step 2: Commit**

```bash
git add styles.css
git commit -m "feat: add CSS for tab bar and Detaylı components"
```

---

### Task 7: Create detailedStats.js

This file handles all logic for the Detaylı tab: tab switching, data loading, chart rendering, table population.

**Files:**
- Create: `detailedStats.js`

**Step 1: Create the file**

```js
// detailedStats.js — Detaylı Tab Logic
// Loaded after renderer.js. Assumes window.electronAPI is available.

(function () {
  // ─── State ───────────────────────────────────────────────────────────────
  let chartDaily = null;
  let chartModel = null;
  let chartProject = null;
  let currentFilters = { model: 'all', days: 30 };

  // ─── Tab switching ────────────────────────────────────────────────────────
  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
        document.getElementById(`tab-content-${tab}`).style.display = 'flex';

        if (tab === 'detayli') {
          loadDetailedStats();
        }
      });
    });
  }

  // ─── Filters ─────────────────────────────────────────────────────────────
  function initFilters() {
    const modelFilter = document.getElementById('detail-model-filter');
    const daysFilter  = document.getElementById('detail-days-filter');
    const refreshBtn  = document.getElementById('detail-refresh-btn');

    if (modelFilter) {
      modelFilter.addEventListener('change', () => {
        currentFilters.model = modelFilter.value;
        loadDetailedStats();
      });
    }

    if (daysFilter) {
      daysFilter.addEventListener('change', () => {
        currentFilters.days = parseInt(daysFilter.value) || 0;
        loadDetailedStats();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.style.opacity = '0.4';
        await window.electronAPI.scanLocalUsage();
        await loadDetailedStats();
        refreshBtn.style.opacity = '1';
      });
    }
  }

  async function populateModelFilter() {
    const select = document.getElementById('detail-model-filter');
    if (!select) return;
    try {
      const models = await window.electronAPI.getAvailableModels();
      // Keep "Tüm Modeller" option, add model options
      select.innerHTML = '<option value="all">Tüm Modeller</option>';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = shortModelName(m);
        select.appendChild(opt);
      }
    } catch (e) {}
  }

  function shortModelName(model) {
    if (!model) return 'Unknown';
    if (model.includes('opus'))   return 'Opus ' + (model.match(/\d[-\d]*/)?.[0] || '');
    if (model.includes('sonnet')) return 'Sonnet ' + (model.match(/\d[-\d]*/)?.[0] || '');
    if (model.includes('haiku'))  return 'Haiku ' + (model.match(/\d[-\d]*/)?.[0] || '');
    return model.split('-').slice(-2).join('-');
  }

  // ─── Data Loading ─────────────────────────────────────────────────────────
  async function loadDetailedStats() {
    try {
      const result = await window.electronAPI.getDetailedStats(currentFilters);
      if (!result.success) { console.error('Stats error:', result.error); return; }
      const { summary, dailyRows, projectRows, modelRows, recentSessions } = result.data;

      updateKPIs(summary);
      renderDailyChart(dailyRows);
      renderModelChart(modelRows);
      renderProjectChart(projectRows);
      renderSessionsTable(recentSessions);
      renderModelCostTable(modelRows);
    } catch (e) {
      console.error('loadDetailedStats error:', e);
    }
  }

  // ─── KPI Cards ────────────────────────────────────────────────────────────
  function updateKPIs(summary) {
    const sessions = document.getElementById('kpi-sessions');
    const cost     = document.getElementById('kpi-cost');
    const turns    = document.getElementById('kpi-turns');
    if (sessions) sessions.textContent = formatNumber(summary.sessionCount || 0);
    if (cost)     cost.textContent     = '$' + (summary.totalCost || 0).toFixed(2);
    if (turns)    turns.textContent    = formatNumber(summary.totalTurns || 0);
  }

  function formatNumber(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  // ─── Chart helpers ────────────────────────────────────────────────────────
  function isDark() {
    return document.body.classList.contains('dark') || !document.body.classList.contains('light');
  }

  function chartDefaults() {
    const textColor = isDark() ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
    return {
      plugins: { legend: { labels: { color: textColor, font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: textColor, font: { size: 9 }, maxRotation: 0 }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    };
  }

  // ─── Daily Tokens Chart (stacked bar) ────────────────────────────────────
  function renderDailyChart(dailyRows) {
    const canvas = document.getElementById('daily-tokens-chart');
    if (!canvas || !window.Chart) return;

    const labels = dailyRows.map(r => r.day ? r.day.slice(5) : ''); // MM-DD
    const inputData  = dailyRows.map(r => Math.round((r.input || 0) / 1000));
    const outputData = dailyRows.map(r => Math.round((r.output || 0) / 1000));
    const cacheData  = dailyRows.map(r => Math.round((r.cacheRead || 0) / 1000));

    if (chartDaily) chartDaily.destroy();
    chartDaily = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Input (K)', data: inputData,  backgroundColor: 'rgba(59,130,246,0.7)',  stack: 'tokens' },
          { label: 'Output (K)',data: outputData, backgroundColor: 'rgba(34,197,94,0.7)',   stack: 'tokens' },
          { label: 'Cache (K)', data: cacheData,  backgroundColor: 'rgba(168,85,247,0.7)', stack: 'tokens' }
        ]
      },
      options: {
        ...chartDefaults(),
        responsive: true,
        plugins: { ...chartDefaults().plugins, legend: { ...chartDefaults().plugins.legend, position: 'bottom' } }
      }
    });
  }

  // ─── Model Distribution Chart (doughnut) ─────────────────────────────────
  function renderModelChart(modelRows) {
    const canvas = document.getElementById('model-dist-chart');
    if (!canvas || !window.Chart) return;

    const labels = modelRows.map(r => shortModelName(r.model));
    const data   = modelRows.map(r => r.input + r.output);
    const colors = ['rgba(59,130,246,0.8)', 'rgba(34,197,94,0.8)', 'rgba(168,85,247,0.8)', 'rgba(251,146,60,0.8)'];

    if (chartModel) chartModel.destroy();
    const textColor = isDark() ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
    chartModel = new window.Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor, font: { size: 9 }, boxWidth: 10 } }
        }
      }
    });
  }

  // ─── Top Projects Chart (horizontal bar) ─────────────────────────────────
  function renderProjectChart(projectRows) {
    const canvas = document.getElementById('project-chart');
    if (!canvas || !window.Chart) return;

    const top5 = projectRows.slice(0, 5);
    const labels = top5.map(r => r.project_name || 'unknown');
    const data   = top5.map(r => Math.round((r.totalTokens || 0) / 1000));

    if (chartProject) chartProject.destroy();
    const textColor = isDark() ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
    const gridColor = isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    chartProject = new window.Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: 'rgba(251,146,60,0.7)', borderRadius: 4 }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font: { size: 9 }, callback: v => v.length > 8 ? v.slice(0,8)+'…' : v } }
        }
      }
    });
  }

  // ─── Recent Sessions Table ────────────────────────────────────────────────
  function renderSessionsTable(sessions) {
    const tbody = document.getElementById('sessions-tbody');
    if (!tbody) return;
    tbody.innerHTML = sessions.map(s => `
      <tr>
        <td title="${s.project_name || ''}">${s.project_name || '—'}</td>
        <td>${shortModelName(s.model)}</td>
        <td>${s.durationMinutes > 0 ? s.durationMinutes + 'm' : '—'}</td>
        <td>${s.turn_count || 0}</td>
        <td>$${(s.cost || 0).toFixed(3)}</td>
      </tr>
    `).join('');
  }

  // ─── Model Cost Table ─────────────────────────────────────────────────────
  function renderModelCostTable(modelRows) {
    const tbody = document.getElementById('model-cost-tbody');
    if (!tbody) return;
    tbody.innerHTML = modelRows.map(r => `
      <tr>
        <td>${shortModelName(r.model)}</td>
        <td>${r.turns || 0}</td>
        <td>${formatNumber(r.input || 0)}</td>
        <td>${formatNumber(r.output || 0)}</td>
        <td>$${(r.cost || 0).toFixed(3)}</td>
      </tr>
    `).join('');
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    initTabs();
    initFilters();
    // Populate model filter when dashboard is shown (after login)
    const observer = new MutationObserver(() => {
      const ds = document.getElementById('dashboard-screen');
      if (ds && ds.style.display !== 'none') {
        populateModelFilter();
        observer.disconnect();
      }
    });
    const ds = document.getElementById('dashboard-screen');
    if (ds) observer.observe(ds, { attributes: true, attributeFilter: ['style'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

**Step 2: Verify app starts without errors**

```bash
npm start
```

- Tray icon appears
- Click tray → dashboard opens
- "Özet" and "Detaylı" tabs visible
- Clicking "Detaylı" loads data (may be empty if no JSONL files)

**Step 3: Commit**

```bash
git add detailedStats.js
git commit -m "feat: add Detaylı tab renderer with charts, tables, and filters"
```

---

### Task 8: Update package.json build files list

`scanner.js` and `detailedStats.js` need to be included in the Electron build package. This was noted in Task 1 Step 4 — verify it was done. If not, do it now.

**Files:**
- Modify: `package.json` (if not already done in Task 1)

Ensure `build.files` contains both new files:
```json
"files": [
  "main.js", "preload.js", "renderer.js",
  "detailedStats.js", "scanner.js",
  "chart.js", "gauge.js",
  "index.html", "styles.css", "icon.ico"
]
```

**Commit if changed:**

```bash
git add package.json
git commit -m "chore: include scanner.js and detailedStats.js in build"
```

---

### Task 9: End-to-end smoke test

**Step 1: Start the app**

```bash
npm start
```

**Step 2: Verify Özet tab still works**
- Click tray icon → dashboard opens on Özet tab
- Gauges render (or login screen if not authenticated)
- No console errors

**Step 3: Verify Detaylı tab**
- Click "Detaylı" tab
- If `~/.claude/projects/` has JSONL files: KPI cards show data, charts render
- If no JSONL files: KPI cards show 0/—, empty charts (no crash)
- Model filter populates with available models
- Days filter changes data when changed
- "Yenile" button triggers rescan

**Step 4: Verify auto-scan**

Check that scanner ran on startup (add temporary `console.log` to `scanner.scan()` if needed):

```js
// In main.js app.whenReady
scanner.scan().then ? scanner.scan() : scanner.scan(); // already sync, check no error
```

**Step 5: Final commit if any fixes applied**

```bash
git add -A
git commit -m "fix: smoke test corrections"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `package.json` | Install better-sqlite3, electron-rebuild |
| 2 | `scanner.js` (new) | JSONL scanner + SQLite storage + cost calc |
| 3 | `main.js` | Add IPC handlers + auto-scan on startup |
| 4 | `preload.js` | Expose 3 new IPC methods |
| 5 | `index.html` | Tab bar + Detaylı screen markup |
| 6 | `styles.css` | Tab bar + Detaylı component styles |
| 7 | `detailedStats.js` (new) | Renderer logic: tabs, charts, tables, filters |
| 8 | `package.json` | Verify build file list |
| 9 | — | End-to-end smoke test |
