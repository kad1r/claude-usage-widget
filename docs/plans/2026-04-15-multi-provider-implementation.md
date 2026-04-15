# Multi-Provider Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend ClaudeUsageApp from Claude-only to a multi-provider AI usage tracker supporting Claude, Codex, Gemini, and Cursor with an extensible plugin architecture.

**Architecture:** A `providers/` directory holds one folder per provider, each implementing a `BaseProvider` interface (`isAvailable`, `fetchQuota`, `scanLocal`, `getPricing`). A central `registry.js` manages all providers. `main.js` is refactored to delegate to the registry instead of directly calling Claude APIs.

**Tech Stack:** Electron, better-sqlite3, Node.js (child_process for CLI detection), JavaScript ES6+

**Design doc:** `docs/plans/2026-04-15-multi-provider-design.md`

---

## Phase 1 — Provider Abstraction (Refactor)

### Task 1: Create BaseProvider and registry scaffold

**Files:**
- Create: `providers/base.js`
- Create: `providers/registry.js`

**Step 1: Create `providers/base.js`**

```javascript
// providers/base.js
class BaseProvider {
  /** Unique machine-readable ID, e.g. 'claude' */
  get id()    { throw new Error(`${this.constructor.name} must implement id`); }
  /** Human-readable name, e.g. 'Claude' */
  get name()  { throw new Error(`${this.constructor.name} must implement name`); }
  /** Emoji or short string used in UI */
  get icon()  { return '🤖'; }
  /** CSS hex color for charts/UI */
  get color() { return '#888888'; }

  /**
   * Returns true if this provider can be used (CLI found, files exist, etc.)
   * @returns {Promise<boolean>}
   */
  async isAvailable() { return false; }

  /**
   * Fetches current quota/utilization data.
   * @returns {Promise<QuotaResult>}
   *
   * QuotaResult shape:
   * {
   *   provider: string,
   *   name: string,
   *   available: boolean,
   *   quota: {
   *     session:  { utilization: number, resetsAt: string|null } | null,
   *     weekly:   { utilization: number, resetsAt: string|null } | null,
   *     models:   [{ name: string, utilization: number }]
   *   },
   *   error: string|null
   * }
   */
  async fetchQuota() {
    return {
      provider: this.id,
      name: this.name,
      available: false,
      quota: { session: null, weekly: null, models: [] },
      error: 'fetchQuota not implemented'
    };
  }

  /**
   * Scans local files and writes sessions/turns into the shared SQLite db.
   * @param {import('better-sqlite3').Database} db
   * @returns {Promise<{ newSessions: number, newTurns: number }>}
   */
  async scanLocal(db) {
    return { newSessions: 0, newTurns: 0 };
  }

  /**
   * Returns pricing table per model (USD per million tokens).
   * @returns {Object} { modelName: { input, output, cacheRead, cacheWrite } }
   */
  getPricing() { return {}; }
}

module.exports = BaseProvider;
```

**Step 2: Create `providers/registry.js`**

```javascript
// providers/registry.js
class ProviderRegistry {
  constructor() {
    this._providers = [];
  }

  register(provider) {
    this._providers.push(provider);
  }

  getAll() {
    return this._providers;
  }

  getById(id) {
    return this._providers.find(p => p.id === id) || null;
  }

  async getActive() {
    const results = await Promise.all(
      this._providers.map(async p => ({ p, available: await p.isAvailable() }))
    );
    return results.filter(r => r.available).map(r => r.p);
  }

  async fetchAllQuotas() {
    return Promise.all(this._providers.map(p => p.fetchQuota().catch(err => ({
      provider: p.id,
      name: p.name,
      available: false,
      quota: { session: null, weekly: null, models: [] },
      error: err.message
    }))));
  }
}

const registry = new ProviderRegistry();
module.exports = registry;
```

**Step 3: Create providers directory structure**

```bash
mkdir -p providers/claude providers/codex providers/gemini providers/cursor
```

**Step 4: Commit**

```bash
git add providers/base.js providers/registry.js
git commit -m "feat: add BaseProvider interface and ProviderRegistry"
```

---

### Task 2: Migrate Claude into providers/claude/

**Files:**
- Create: `providers/claude/index.js`
- Create: `providers/claude/scanner.js`
- Modify: `scanner.js` (root) — make it a shim
- Modify: `main.js` — import claude provider

**Step 1: Create `providers/claude/scanner.js`**

Copy the entire contents of the root `scanner.js` into `providers/claude/scanner.js`. Then modify `openDb()` to add `provider` column migration (done in Task 3). No other changes yet.

```bash
cp scanner.js providers/claude/scanner.js
```

**Step 2: Create `providers/claude/index.js`**

```javascript
// providers/claude/index.js
const BaseProvider = require('../base');
const scanner = require('./scanner');

class ClaudeProvider extends BaseProvider {
  constructor(credentialsPath, historyPath) {
    super();
    this.credentialsPath = credentialsPath;
    this.historyPath = historyPath;
    this._credentials = null;
  }

  get id()    { return 'claude'; }
  get name()  { return 'Claude'; }
  get icon()  { return '🟣'; }
  get color() { return '#d97706'; }

  async isAvailable() {
    const fs = require('fs');
    return fs.existsSync(this.credentialsPath);
  }

  setCredentials(creds) { this._credentials = creds; }
  getCredentials()      { return this._credentials; }

  getPricing() {
    return scanner.PRICING;
  }

  async scanLocal(db) {
    return scanner.scanAndStore(db);
  }

  async fetchQuota(authorizedFetch) {
    // authorizedFetch injected from main.js (has token refresh logic)
    const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
    const data = await authorizedFetch(USAGE_URL);

    return {
      provider: this.id,
      name: this.name,
      available: true,
      quota: {
        session: data.five_hour
          ? { utilization: data.five_hour.utilization, resetsAt: data.five_hour.resets_at }
          : null,
        weekly: data.seven_day
          ? { utilization: data.seven_day.utilization, resetsAt: data.seven_day.resets_at }
          : null,
        models: [
          data.seven_day_opus   ? { name: 'claude-opus',   utilization: data.seven_day_opus.utilization }   : null,
          data.seven_day_sonnet ? { name: 'claude-sonnet', utilization: data.seven_day_sonnet.utilization } : null,
        ].filter(Boolean),
        raw: data  // keep raw for existing renderer compatibility
      },
      error: null
    };
  }
}

module.exports = ClaudeProvider;
```

**Step 3: Export PRICING from `providers/claude/scanner.js`**

Add at the end of `providers/claude/scanner.js`:
```javascript
module.exports.PRICING = PRICING;
```
(The existing `module.exports` at end of file — add PRICING to it.)

**Step 4: Update root `scanner.js` as backwards-compat shim**

Replace entire root `scanner.js` contents with:
```javascript
// Backwards-compatibility shim — actual implementation in providers/claude/scanner.js
module.exports = require('./providers/claude/scanner');
```

**Step 5: Commit**

```bash
git add providers/claude/ scanner.js
git commit -m "refactor: move Claude scanner into providers/claude/"
```

---

### Task 3: Add provider column to SQLite schema

**Files:**
- Modify: `providers/claude/scanner.js` — add migration in `openDb()`

**Step 1: Update `openDb()` in `providers/claude/scanner.js`**

After the existing `db.exec(...)` block in `openDb()`, add these migration statements:

```javascript
// Migration: add provider column if not exists
const cols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
if (!cols.includes('provider')) {
  db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude'");
}
const turnCols = db.prepare("PRAGMA table_info(turns)").all().map(c => c.name);
if (!turnCols.includes('provider')) {
  db.exec("ALTER TABLE turns ADD COLUMN provider TEXT DEFAULT 'claude'");
}

// Provider settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS providers (
    id          TEXT PRIMARY KEY,
    enabled     INTEGER DEFAULT 1,
    api_key     TEXT,
    last_synced TEXT,
    settings    TEXT
  );
`);
```

**Step 2: Update `upsertSession` and `insertTurn` in `providers/claude/scanner.js` to write provider**

Find the INSERT for sessions and add `provider` column with value `'claude'`. Find the INSERT for turns and do the same. Example pattern to find and update:

In `upsertSession`, find:
```javascript
INSERT OR REPLACE INTO sessions (session_id, ...
```
Add `provider` to column list and `'claude'` to values.

In `insertTurn`, same pattern.

**Step 3: Update `getDetailedStats` filter query** (in `providers/claude/scanner.js`)

Find the WHERE clause in `getDetailedStats` and add optional provider filter:
```javascript
// Add to function signature: function getDetailedStats(db, { days = 30, model = null, provider = null } = {})
if (provider) conditions.push(`s.provider = '${provider}'`);
```

**Step 4: Commit**

```bash
git add providers/claude/scanner.js
git commit -m "feat: add provider column to sessions/turns tables with migration"
```

---

### Task 4: Update main.js IPC to use registry

**Files:**
- Modify: `main.js`

**Step 1: Add provider registration at top of `main.js`**

After existing imports, add:
```javascript
const registry = require('./providers/registry');
const ClaudeProvider = require('./providers/claude');

// Register providers
const claudeProvider = new ClaudeProvider(CREDENTIALS_PATH, HISTORY_PATH);
registry.register(claudeProvider);
// Codex/Gemini/Cursor will be added in later tasks
```

**Step 2: Add new IPC handler `fetch-all-providers-quota`**

```javascript
ipcMain.handle('fetch-all-providers-quota', async () => {
  return registry.fetchAllQuotas();
});
```

**Step 3: Add new IPC handler `get-providers-list`**

```javascript
ipcMain.handle('get-providers-list', async () => {
  return Promise.all(registry.getAll().map(async p => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    color: p.color,
    available: await p.isAvailable()
  })));
});
```

**Step 4: Add new IPC handler `save-provider-settings`**

```javascript
ipcMain.handle('save-provider-settings', async (event, { providerId, apiKey, enabled }) => {
  const scanner = require('./providers/claude/scanner');
  const db = scanner.openDb();
  db.prepare(`
    INSERT OR REPLACE INTO providers (id, enabled, api_key)
    VALUES (?, ?, ?)
  `).run(providerId, enabled ? 1 : 0, apiKey || null);
  db.close();
  return { ok: true };
});
```

**Step 5: Add `scan-provider-local` IPC handler**

```javascript
ipcMain.handle('scan-provider-local', async (event, { providerId }) => {
  const provider = registry.getById(providerId);
  if (!provider) return { error: 'Provider not found' };
  const scannerModule = require('./providers/claude/scanner');
  const db = scannerModule.openDb();
  try {
    const result = await provider.scanLocal(db);
    return result;
  } finally {
    db.close();
  }
});
```

**Step 6: Update `preload.js` to expose new channels**

In `preload.js`, add to the `contextBridge.exposeInMainWorld` invoke list:
```javascript
fetchAllProvidersQuota: () => ipcRenderer.invoke('fetch-all-providers-quota'),
getProvidersList: () => ipcRenderer.invoke('get-providers-list'),
saveProviderSettings: (opts) => ipcRenderer.invoke('save-provider-settings', opts),
scanProviderLocal: (opts) => ipcRenderer.invoke('scan-provider-local', opts),
```

**Step 7: Commit**

```bash
git add main.js preload.js
git commit -m "feat: add registry-based IPC handlers for multi-provider support"
```

---

## Phase 2 — Codex Provider

### Task 5: Implement providers/codex/

**Files:**
- Create: `providers/codex/index.js`
- Create: `providers/codex/scanner.js`
- Modify: `main.js` — register CodexProvider

**Step 1: Create `providers/codex/scanner.js`**

```javascript
// providers/codex/scanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const CODEX_DIR = path.join(os.homedir(), '.codex');

// Token pricing per million tokens (USD) — OpenAI models
const PRICING = {
  'gpt-4o':           { input: 2.5,  output: 10,   cacheRead: 1.25, cacheWrite: 0 },
  'gpt-4o-mini':      { input: 0.15, output: 0.6,  cacheRead: 0.075, cacheWrite: 0 },
  'o1':               { input: 15,   output: 60,   cacheRead: 7.5,  cacheWrite: 0 },
  'o3-mini':          { input: 1.1,  output: 4.4,  cacheRead: 0.55, cacheWrite: 0 },
};
const DEFAULT_PRICING = { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 };

function calcCost(model, inputTokens, outputTokens, cacheRead) {
  const p = PRICING[model] || DEFAULT_PRICING;
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output + (cacheRead / 1e6) * p.cacheRead;
}

function findJsonlFiles() {
  if (!fs.existsSync(CODEX_DIR)) return [];
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) results.push(full);
    }
  }
  walk(CODEX_DIR);
  return results;
}

function scanAndStore(db) {
  const files = findJsonlFiles();
  let newSessions = 0, newTurns = 0;

  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    const existing = db.prepare('SELECT mtime, lines FROM processed_files WHERE path = ?').get(filePath);
    if (existing && existing.mtime === stat.mtimeMs) continue;

    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const sessionId = 'codex:' + path.basename(filePath, '.jsonl');
    let sessionData = { model: 'gpt-4o', turns: 0, inputT: 0, outputT: 0, cacheRead: 0, first: null, last: null };

    for (const line of lines) {
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }

      const usage = msg.usage || msg.response?.usage;
      if (!usage) continue;

      const model = msg.model || 'gpt-4o';
      const inputTokens  = usage.input_tokens  || usage.prompt_tokens     || 0;
      const outputTokens = usage.output_tokens || usage.completion_tokens  || 0;
      const cacheRead    = usage.cache_read_input_tokens || 0;
      const ts = msg.created_at || msg.timestamp || new Date().toISOString();

      db.prepare(`
        INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'codex')
      `).run(sessionId, ts, model, inputTokens, outputTokens, cacheRead);
      newTurns++;

      sessionData.turns++;
      sessionData.inputT  += inputTokens;
      sessionData.outputT += outputTokens;
      sessionData.cacheRead += cacheRead;
      sessionData.model = model;
      if (!sessionData.first || ts < sessionData.first) sessionData.first = ts;
      if (!sessionData.last  || ts > sessionData.last)  sessionData.last  = ts;
    }

    if (sessionData.turns > 0) {
      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count, total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'codex')
      `).run(sessionId, 'codex', sessionData.first, sessionData.last, sessionData.model,
             sessionData.turns, sessionData.inputT, sessionData.outputT, sessionData.cacheRead);
      newSessions++;
    }

    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)')
      .run(filePath, stat.mtimeMs, lines.length);
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, PRICING, CODEX_DIR };
```

**Step 2: Create `providers/codex/index.js`**

```javascript
// providers/codex/index.js
const BaseProvider = require('../base');
const scanner = require('./scanner');
const { execSync } = require('child_process');
const fs = require('fs');

class CodexProvider extends BaseProvider {
  get id()    { return 'codex'; }
  get name()  { return 'OpenAI Codex'; }
  get icon()  { return '🟢'; }
  get color() { return '#10a37f'; }

  async isAvailable() {
    // Check CLI or local files
    try {
      execSync('codex --version', { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      return fs.existsSync(scanner.CODEX_DIR);
    }
  }

  getPricing() { return scanner.PRICING; }

  async fetchQuota() {
    // Try CLI first
    try {
      const out = execSync('codex usage --json', { timeout: 5000 }).toString();
      const data = JSON.parse(out);
      return {
        provider: this.id, name: this.name, available: true,
        quota: {
          session: data.session ? { utilization: data.session.pct, resetsAt: data.session.reset } : null,
          weekly:  data.weekly  ? { utilization: data.weekly.pct,  resetsAt: data.weekly.reset  } : null,
          models:  []
        },
        error: null
      };
    } catch {
      // CLI not available or doesn't support usage command
      return {
        provider: this.id, name: this.name, available: true,
        quota: { session: null, weekly: null, models: [] },
        error: 'Quota data not available — local scan only'
      };
    }
  }

  async scanLocal(db) {
    return scanner.scanAndStore(db);
  }
}

module.exports = CodexProvider;
```

**Step 3: Register in `main.js`**

After the Claude registration block, add:
```javascript
const CodexProvider = require('./providers/codex');
registry.register(new CodexProvider());
```

**Step 4: Commit**

```bash
git add providers/codex/ main.js
git commit -m "feat: add Codex provider with local JSONL scanner"
```

---

## Phase 3 — Gemini Provider

### Task 6: Implement providers/gemini/

**Files:**
- Create: `providers/gemini/index.js`
- Create: `providers/gemini/scanner.js`
- Modify: `main.js` — register GeminiProvider

**Step 1: Create `providers/gemini/scanner.js`**

```javascript
// providers/gemini/scanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const GEMINI_DIR = path.join(os.homedir(), '.gemini');

const PRICING = {
  'gemini-2.5-pro':   { input: 1.25, output: 10,   cacheRead: 0.31, cacheWrite: 0 },
  'gemini-2.0-flash': { input: 0.1,  output: 0.4,  cacheRead: 0.025, cacheWrite: 0 },
  'gemini-1.5-pro':   { input: 1.25, output: 5,    cacheRead: 0.31, cacheWrite: 0 },
};
const DEFAULT_PRICING = { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 0 };

function findLogFiles() {
  if (!fs.existsSync(GEMINI_DIR)) return [];
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json')) results.push(full);
    }
  }
  walk(GEMINI_DIR);
  return results;
}

function scanAndStore(db) {
  const files = findLogFiles();
  let newSessions = 0, newTurns = 0;

  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    const existing = db.prepare('SELECT mtime FROM processed_files WHERE path = ?').get(filePath);
    if (existing && existing.mtime === stat.mtimeMs) continue;

    let rawLines;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      rawLines = filePath.endsWith('.jsonl')
        ? content.split('\n').filter(Boolean)
        : [content];
    } catch { continue; }

    const sessionId = 'gemini:' + path.basename(filePath, path.extname(filePath));
    let sessionData = { model: 'gemini-2.5-pro', turns: 0, inputT: 0, outputT: 0, first: null, last: null };

    for (const line of rawLines) {
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }

      // Gemini API response format
      const usage = msg.usageMetadata || msg.usage;
      if (!usage) continue;

      const model = msg.modelVersion || msg.model || 'gemini-2.5-pro';
      const inputTokens  = usage.promptTokenCount     || usage.input_tokens  || 0;
      const outputTokens = usage.candidatesTokenCount || usage.output_tokens || 0;
      const ts = msg.timestamp || new Date().toISOString();

      db.prepare(`
        INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
        VALUES (?, ?, ?, ?, ?, 0, 0, 'gemini')
      `).run(sessionId, ts, model, inputTokens, outputTokens);
      newTurns++;

      sessionData.turns++;
      sessionData.inputT  += inputTokens;
      sessionData.outputT += outputTokens;
      sessionData.model = model;
      if (!sessionData.first || ts < sessionData.first) sessionData.first = ts;
      if (!sessionData.last  || ts > sessionData.last)  sessionData.last  = ts;
    }

    if (sessionData.turns > 0) {
      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count, total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'gemini')
      `).run(sessionId, 'gemini', sessionData.first, sessionData.last, sessionData.model,
             sessionData.turns, sessionData.inputT, sessionData.outputT);
      newSessions++;
    }

    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)')
      .run(filePath, stat.mtimeMs, rawLines.length);
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, PRICING, GEMINI_DIR };
```

**Step 2: Create `providers/gemini/index.js`**

```javascript
// providers/gemini/index.js
const BaseProvider = require('../base');
const scanner = require('./scanner');
const { execSync } = require('child_process');
const fs = require('fs');

class GeminiProvider extends BaseProvider {
  get id()    { return 'gemini'; }
  get name()  { return 'Gemini'; }
  get icon()  { return '🔵'; }
  get color() { return '#4285f4'; }

  async isAvailable() {
    try {
      execSync('gemini --version', { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      return fs.existsSync(scanner.GEMINI_DIR);
    }
  }

  getPricing() { return scanner.PRICING; }

  async fetchQuota() {
    try {
      const out = execSync('gemini usage --json 2>/dev/null', { timeout: 5000 }).toString();
      const data = JSON.parse(out);
      return {
        provider: this.id, name: this.name, available: true,
        quota: {
          session: data.session ? { utilization: data.session.pct, resetsAt: data.session.reset } : null,
          weekly:  data.weekly  ? { utilization: data.weekly.pct,  resetsAt: data.weekly.reset  } : null,
          models: []
        },
        error: null
      };
    } catch {
      return {
        provider: this.id, name: this.name, available: true,
        quota: { session: null, weekly: null, models: [] },
        error: 'Quota data not available — local scan only'
      };
    }
  }

  async scanLocal(db) {
    return scanner.scanAndStore(db);
  }
}

module.exports = GeminiProvider;
```

**Step 3: Register in `main.js`**

```javascript
const GeminiProvider = require('./providers/gemini');
registry.register(new GeminiProvider());
```

**Step 4: Commit**

```bash
git add providers/gemini/ main.js
git commit -m "feat: add Gemini provider with local log scanner"
```

---

## Phase 4 — Cursor Provider

### Task 7: Implement providers/cursor/

**Files:**
- Create: `providers/cursor/index.js`
- Create: `providers/cursor/scanner.js`
- Modify: `main.js` — register CursorProvider

**Step 1: Create `providers/cursor/scanner.js`**

```javascript
// providers/cursor/scanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');

// Cursor stores data in Electron userData
const CURSOR_DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Cursor', 'User', 'globalStorage'
);

const PRICING = {
  'claude-3.5-sonnet': { input: 3,  output: 15,  cacheRead: 0.3,  cacheWrite: 3.75 },
  'gpt-4o':            { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  'cursor-small':      { input: 0,  output: 0,   cacheRead: 0,    cacheWrite: 0 },  // free model
};
const DEFAULT_PRICING = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

function findUsageFiles() {
  if (!fs.existsSync(CURSOR_DATA_DIR)) return [];
  const results = [];
  function walk(dir) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.includes('usage') || entry.name.endsWith('.json')) {
          results.push(full);
        }
      }
    } catch {}
  }
  walk(CURSOR_DATA_DIR);
  return results;
}

function scanAndStore(db) {
  const files = findUsageFiles();
  let newSessions = 0, newTurns = 0;

  for (const filePath of files) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const existing = db.prepare('SELECT mtime FROM processed_files WHERE path = ?').get(filePath);
    if (existing && existing.mtime === stat.mtimeMs) continue;

    let data;
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { continue; }

    // Cursor usage data structure varies — handle common formats
    const usageEntries = Array.isArray(data) ? data : (data.usage || data.conversations || []);
    if (!usageEntries.length) continue;

    const sessionId = 'cursor:' + path.basename(filePath, '.json');
    let sessionData = { model: 'gpt-4o', turns: 0, inputT: 0, outputT: 0, first: null, last: null };

    for (const entry of usageEntries) {
      const inputTokens  = entry.inputTokens  || entry.promptTokens    || entry.input_tokens  || 0;
      const outputTokens = entry.outputTokens || entry.responseTokens  || entry.output_tokens || 0;
      const model = entry.model || 'gpt-4o';
      const ts = entry.timestamp || entry.createdAt || new Date().toISOString();

      if (!inputTokens && !outputTokens) continue;

      db.prepare(`
        INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
        VALUES (?, ?, ?, ?, ?, 0, 0, 'cursor')
      `).run(sessionId, ts, model, inputTokens, outputTokens);
      newTurns++;

      sessionData.turns++;
      sessionData.inputT  += inputTokens;
      sessionData.outputT += outputTokens;
      sessionData.model = model;
      if (!sessionData.first || ts < sessionData.first) sessionData.first = ts;
      if (!sessionData.last  || ts > sessionData.last)  sessionData.last  = ts;
    }

    if (sessionData.turns > 0) {
      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
         total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'cursor')
      `).run(sessionId, 'cursor', sessionData.first, sessionData.last, sessionData.model,
             sessionData.turns, sessionData.inputT, sessionData.outputT);
      newSessions++;
    }

    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)')
      .run(filePath, stat.mtimeMs, usageEntries.length);
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, PRICING, CURSOR_DATA_DIR };
```

**Step 2: Create `providers/cursor/index.js`**

```javascript
// providers/cursor/index.js
const BaseProvider = require('../base');
const scanner = require('./scanner');
const fs = require('fs');

class CursorProvider extends BaseProvider {
  get id()    { return 'cursor'; }
  get name()  { return 'Cursor'; }
  get icon()  { return '🔷'; }
  get color() { return '#7c83fd'; }

  async isAvailable() {
    return fs.existsSync(scanner.CURSOR_DATA_DIR);
  }

  getPricing() { return scanner.PRICING; }

  async fetchQuota() {
    // Cursor doesn't expose quota via CLI — file-based only
    return {
      provider: this.id, name: this.name, available: true,
      quota: { session: null, weekly: null, models: [] },
      error: 'Quota data not available for Cursor — local scan only'
    };
  }

  async scanLocal(db) {
    return scanner.scanAndStore(db);
  }
}

module.exports = CursorProvider;
```

**Step 3: Register in `main.js`**

```javascript
const CursorProvider = require('./providers/cursor');
registry.register(new CursorProvider());
```

**Step 4: Commit**

```bash
git add providers/cursor/ main.js
git commit -m "feat: add Cursor provider with local file scanner"
```

---

## Phase 5 — UI Updates

### Task 8: Add unified summary bar and provider tabs to main screen

**Files:**
- Modify: `index.html` — add summary bar + provider tabs HTML
- Modify: `styles.css` — add styles for new elements
- Modify: `renderer.js` — add provider tab switching + summary rendering

**Step 1: Add HTML structure to `index.html`**

Inside `#dashboard`, before the existing gauge section, add:

```html
<!-- Unified provider summary bar -->
<div id="provider-summary-bar" style="display:none">
  <div class="summary-title">All Providers</div>
  <div id="provider-summary-items"></div>
</div>

<!-- Provider tabs -->
<div id="provider-tabs" style="display:none">
  <button class="provider-tab active" data-provider="claude">🟣 Claude</button>
  <!-- Other tabs injected by JS when providers are available -->
</div>
```

**Step 2: Add CSS for summary bar and tabs to `styles.css`**

```css
#provider-summary-bar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.summary-title { font-weight: 600; margin-bottom: 4px; color: var(--text-muted); }
#provider-summary-items { display: flex; gap: 12px; flex-wrap: wrap; }
.provider-summary-item { display: flex; align-items: center; gap: 4px; }
.provider-summary-dot { width: 8px; height: 8px; border-radius: 50%; }

#provider-tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
.provider-tab {
  padding: 4px 10px; border-radius: 12px; border: 1px solid var(--border);
  background: transparent; color: var(--text); font-size: 11px; cursor: pointer;
}
.provider-tab.active { background: var(--accent); color: white; border-color: var(--accent); }
```

**Step 3: Add provider tab logic to `renderer.js`**

Add function `renderProviderTabs(providers)` that:
1. Shows `#provider-tabs` and `#provider-summary-bar`
2. Creates a tab button for each available provider (beyond Claude)
3. On tab click: hides/shows the appropriate gauge sections
4. On load: calls `window.api.getProvidersList()` and `window.api.fetchAllProvidersQuota()`

```javascript
async function initProviderTabs() {
  const providers = await window.api.getProvidersList();
  const available = providers.filter(p => p.available);
  if (available.length <= 1) return; // only Claude, no tabs needed

  const tabsEl = document.getElementById('provider-tabs');
  const summaryEl = document.getElementById('provider-summary-bar');
  tabsEl.style.display = 'flex';
  summaryEl.style.display = 'block';

  // Add tabs for non-Claude providers
  for (const p of available) {
    if (p.id === 'claude') continue;
    const btn = document.createElement('button');
    btn.className = 'provider-tab';
    btn.dataset.provider = p.id;
    btn.textContent = `${p.icon} ${p.name}`;
    btn.style.setProperty('--accent', p.color);
    btn.addEventListener('click', () => switchProvider(p.id));
    tabsEl.appendChild(btn);
  }
}

function switchProvider(providerId) {
  document.querySelectorAll('.provider-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === providerId);
  });
  // Show/hide gauge sections based on active provider
  // (Claude gauges visible for 'claude', others show placeholder or their own gauges)
}
```

Call `initProviderTabs()` inside the existing `initDashboard()` function.

**Step 5: Commit**

```bash
git add index.html styles.css renderer.js
git commit -m "feat: add provider tabs and summary bar to main screen"
```

---

### Task 9: Add provider filter to Detaylı tab

**Files:**
- Modify: `detailedStats.js` — add provider dropdown
- Modify: `index.html` — add provider filter dropdown HTML

**Step 1: Add provider dropdown to filter row in `index.html`**

Find the existing filter controls in the Detaylı tab and add:
```html
<select id="filter-provider">
  <option value="">Tüm Provider'lar</option>
  <option value="claude">Claude</option>
  <option value="codex">Codex</option>
  <option value="gemini">Gemini</option>
  <option value="cursor">Cursor</option>
</select>
```

**Step 2: Update `detailedStats.js` to read + pass provider filter**

Find the `loadStats()` function and add `provider` to the options object:
```javascript
const provider = document.getElementById('filter-provider')?.value || '';
const stats = await window.api.getDetailedStats({ days, model, provider: provider || null });
```

Add change listener for the new dropdown alongside existing filter listeners.

**Step 3: Commit**

```bash
git add detailedStats.js index.html
git commit -m "feat: add provider filter to detailed stats tab"
```

---

### Task 10: Add Provider Settings panel

**Files:**
- Modify: `index.html` — add settings panel HTML
- Modify: `styles.css` — add settings panel styles
- Modify: `renderer.js` — add settings panel logic

**Step 1: Add settings panel HTML to `index.html`**

Add a settings gear button to the header, and a settings panel overlay:

```html
<!-- Settings toggle button (add to header) -->
<button id="settings-btn" title="Provider Settings">⚙️</button>

<!-- Provider Settings panel -->
<div id="provider-settings-panel" style="display:none">
  <div class="settings-header">
    <span>Provider Settings</span>
    <button id="settings-close">✕</button>
  </div>
  <div id="provider-settings-list"></div>
</div>
```

**Step 2: Add CSS to `styles.css`**

```css
#provider-settings-panel {
  position: absolute; inset: 0; background: var(--bg);
  z-index: 100; padding: 12px; overflow-y: auto;
}
.settings-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-weight: 600; }
.provider-setting-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
.provider-setting-row .status-badge { font-size: 10px; padding: 2px 6px; border-radius: 8px; background: var(--border); }
.provider-setting-row input[type="text"] { flex: 1; font-size: 11px; padding: 3px 6px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; color: var(--text); }
```

**Step 3: Add settings logic to `renderer.js`**

```javascript
async function renderProviderSettings() {
  const providers = await window.api.getProvidersList();
  const list = document.getElementById('provider-settings-list');
  list.innerHTML = '';
  for (const p of providers) {
    const row = document.createElement('div');
    row.className = 'provider-setting-row';
    row.innerHTML = `
      <span>${p.icon} ${p.name}</span>
      <span class="status-badge">${p.available ? 'Aktif' : 'Bulunamadı'}</span>
      <input type="text" placeholder="API Key (isteğe bağlı)" data-provider="${p.id}" />
      <button data-save="${p.id}">Kaydet</button>
    `;
    row.querySelector(`[data-save="${p.id}"]`).addEventListener('click', async () => {
      const apiKey = row.querySelector(`[data-provider="${p.id}"]`).value;
      await window.api.saveProviderSettings({ providerId: p.id, apiKey, enabled: true });
    });
    list.appendChild(row);
  }
}

document.getElementById('settings-btn')?.addEventListener('click', () => {
  document.getElementById('provider-settings-panel').style.display = 'block';
  renderProviderSettings();
});
document.getElementById('settings-close')?.addEventListener('click', () => {
  document.getElementById('provider-settings-panel').style.display = 'none';
});
```

**Step 4: Commit**

```bash
git add index.html styles.css renderer.js
git commit -m "feat: add Provider Settings panel"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] App starts without errors
- [ ] Claude gauges still work exactly as before
- [ ] `get-providers-list` IPC returns all 4 providers
- [ ] If `~/.codex` exists, Codex shows as available
- [ ] If `~/.gemini` exists, Gemini shows as available
- [ ] If `%APPDATA%\Cursor` exists, Cursor shows as available
- [ ] `scan-provider-local` correctly writes rows with `provider` column set
- [ ] Detaylı tab provider filter correctly filters sessions
- [ ] Provider tabs appear only when 2+ providers available
- [ ] Settings panel saves API keys without crashing
- [ ] No regressions in existing Claude flow
