# Multi-Provider Support Design

**Date:** 2026-04-15  
**Status:** Approved  
**Topic:** Adding Codex, Gemini, Cursor and extensible provider system to ClaudeUsageApp

---

## Overview

Extend ClaudeUsageApp from a Claude-only dashboard to a multi-provider AI usage tracker supporting Claude, OpenAI Codex, Gemini, and Cursor — with an extensible plugin system for future providers.

**Goals:**
- Track both quota/utilization AND detailed token/cost analysis for all providers
- Hybrid data strategy: local files first, API key as fallback
- Extensible architecture: adding a new provider = adding a new folder under `providers/`
- Unified dashboard + per-provider tabs in the UI

---

## Architecture

### Directory Structure

```
ClaudeUsageApp/
├── providers/
│   ├── base.js              ← BaseProvider interface
│   ├── registry.js          ← Provider registration and factory
│   ├── claude/
│   │   ├── index.js         ← OAuth + quota logic (moved from main.js)
│   │   └── scanner.js       ← JSONL scanner (moved from scanner.js)
│   ├── codex/
│   │   ├── index.js         ← OpenAI Codex quota (CLI + API key fallback)
│   │   └── scanner.js       ← ~/.codex/ JSONL scanner
│   ├── gemini/
│   │   ├── index.js         ← Gemini CLI quota + API fallback
│   │   └── scanner.js       ← ~/.gemini/ log scanner
│   └── cursor/
│       ├── index.js         ← Cursor quota
│       └── scanner.js       ← %APPDATA%\Cursor\ data scanner
├── main.js                  ← IPC + provider orchestration only (stays thin)
├── scanner.js               ← Shim → providers/claude/scanner.js (backwards compat)
└── ...existing files
```

### BaseProvider Interface

```javascript
class BaseProvider {
  get id()     { }  // 'claude', 'codex', 'gemini', 'cursor'
  get name()   { }  // 'Claude', 'OpenAI Codex', 'Gemini', 'Cursor'
  get icon()   { }  // emoji or icon identifier
  get color()  { }  // brand color for UI

  async isAvailable()   { }  // checks CLI presence / local files
  async fetchQuota()    { }  // returns QuotaResult
  async scanLocal(db)   { }  // writes to SQLite with provider column
  getPricing()          { }  // { modelName: { input, output, cacheRead, cacheWrite } }
}
```

### Provider Registry

```javascript
// providers/registry.js
const providers = [ClaudeProvider, CodexProvider, GeminiProvider, CursorProvider];

registry.getActive()       // enabled providers only
registry.getById(id)       // single provider
registry.fetchAllQuotas()  // parallel quota fetch from all active providers
```

---

## Data Layer

### SQLite Schema Changes

```sql
-- Migrations applied on startup
ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude';
ALTER TABLE turns    ADD COLUMN provider TEXT DEFAULT 'claude';

-- New table for provider config
CREATE TABLE IF NOT EXISTS providers (
  id           TEXT PRIMARY KEY,
  enabled      INTEGER DEFAULT 1,
  api_key      TEXT,        -- stored encrypted
  last_synced  TEXT,
  settings     TEXT         -- JSON blob for provider-specific config
);
```

### Quota Response Format (unified across all providers)

```javascript
{
  provider: 'codex',
  name: 'OpenAI Codex',
  available: true,
  quota: {
    session:  { utilization: 45, resetsAt: '2026-04-15T18:00:00Z' },
    weekly:   { utilization: 20, resetsAt: '2026-04-22T00:00:00Z' },
    models:   [{ name: 'gpt-4o', utilization: 30 }]
  },
  error: null  // or error message string if fetch failed
}
```

### New IPC Channels

| Channel | Description |
|---|---|
| `fetch-all-providers-quota` | Returns quota for all active providers |
| `scan-provider-local` | Triggers local file scan for a specific provider |
| `get-providers-list` | Lists registered providers with status/availability |
| `save-provider-settings` | Saves API key, enabled flag, custom settings |
| `get-detailed-stats` | Existing channel, extended with `provider` filter param |

---

## UI Design

### Main Screen Layout

```
┌─────────────────────────────────────────┐
│  [Birleşik Özet]                        │
│  Toplam maliyet: $12.40  |  4 provider  │
│  ████████░░ Claude 60%  Codex 20%  ...  │
├─────────────────────────────────────────┤
│  [Claude] [Codex] [Gemini] [Cursor]     │  ← Provider tabs
├─────────────────────────────────────────┤
│  Selected provider gauges               │
│  5h ████░░  7d ██░░░░                   │
└─────────────────────────────────────────┘
```

### Detailed Tab Changes
- Existing filters + new **Provider dropdown** (default: "All Providers")
- "All Providers" view: merged token/cost data with provider color coding
- Model distribution chart: color-coded by provider

### Provider Settings Panel (new)
```
┌─────────────────────────────────────────┐
│  Provider Settings                      │
│  ✅ Claude     [Connected via OAuth]    │
│  ✅ Codex      [API Key: ••••••]  [✎]  │
│  ✅ Gemini     [CLI found: ✓]           │
│  ✅ Cursor     [Auto-detected]          │
└─────────────────────────────────────────┘
```

### Provider Color Coding
| Provider | Color |
|---|---|
| Claude | existing purple/orange |
| Codex | green (`#10a37f`) |
| Gemini | blue (`#4285f4`) |
| Cursor | light blue (`#7c83fd`) |

---

## Provider Data Sources

| Provider | Quota Source | Local Data |
|---|---|---|
| Claude | Anthropic OAuth API | `~/.claude/projects/**/*.jsonl` |
| Codex | `codex` CLI → API key fallback | `~/.codex/**/*.jsonl` |
| Gemini | `gemini` CLI → API key fallback | `~/.gemini/` logs |
| Cursor | `%APPDATA%\Cursor\User\globalStorage\` | Usage DB files |

---

## Implementation Phases

### Phase 1 — Provider abstraction (refactor)
- Create `providers/base.js` and `providers/registry.js`
- Move Claude OAuth + scanner into `providers/claude/`
- Add `provider` column migration to SQLite
- Update `main.js` IPC to use registry

### Phase 2 — Codex + Gemini providers
- Implement `providers/codex/` (CLI detection + scanner)
- Implement `providers/gemini/` (CLI detection + scanner)
- Add pricing tables for GPT-4o, Gemini models

### Phase 3 — Cursor provider
- Implement `providers/cursor/` (local DB/file reading)
- No CLI dependency — purely file-based

### Phase 4 — UI updates
- Unified summary bar at top of main screen
- Provider tabs on main screen
- Provider filter in Detaylı tab
- Provider Settings panel

---

## Constraints & Decisions

- **No breaking changes** to existing Claude flow — current OAuth + scanner continues working unchanged during refactor
- **Backwards compat shim**: `scanner.js` root file stays as re-export to `providers/claude/scanner.js`
- **API keys stored encrypted** using Electron's `safeStorage` API
- **Provider availability is lazy-checked** — if CLI not found and no API key set, provider shows as "unavailable" but doesn't crash
- **YAGNI**: no plugin marketplace, no remote provider configs — just the 4 providers listed
