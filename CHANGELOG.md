# Changelog

All notable changes to Claude Usage will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-04-15

### Added

#### Multi-Provider Support
- **Provider plugin architecture** — `BaseProvider` abstract class + `ProviderRegistry` singleton for clean extensibility
- **Codex provider** — Scans OpenAI Codex CLI session logs from `~/.codex/`
- **Gemini provider** — Scans Google Gemini CLI chat sessions from `~/.gemini/tmp/<project>/chats/session-*.json`
- **Cursor provider** — Scans Cursor AI session data from `~/.cursor/`
- Provider switcher bar on the Özet tab — click any provider to see its stats and token chart
- Per-provider local stats: session count, turn count, and estimated cost
- Per-provider 7-day token chart (input vs output tokens)
- Provider Settings panel (⚙️ button) — enable/disable providers and enter optional API keys

#### Detailed Stats Tab ("Detaylı")
- New tab with full session history filterable by provider, model, and time range
- KPI cards: sessions, cost, turns for the selected period
- Daily token usage stacked bar chart
- Model distribution pie chart
- Top projects bar chart
- Recent sessions table (project, model, duration, turns, cost)
- Cost-by-model breakdown table

#### Local Scanning
- `scanner.js` — SQLite database (`better-sqlite3`) for storing and querying parsed session data
- `scan-local-usage` IPC handler triggers a full re-scan of all providers
- `get-detailed-stats` IPC handler returns filtered stats for the Detaylı tab
- `get-available-models` IPC handler returns distinct models seen in scan data
- Automatic scan on startup and every 5 minutes

#### Security
- OAuth credentials now encrypted at rest using `safeStorage` (Windows DPAPI / macOS Keychain)
- Automatic migration of existing plain-text credentials to encrypted format
- `safeOpenExternal()` — `shell.openExternal` restricted to an allowlist of trusted origins (`claude.ai`, `platform.claude.com`)
- Content Security Policy meta tag added to `index.html`
- `updateModelBreakdown` rewritten with DOM API to eliminate innerHTML with API data (XSS prevention)

### Changed

- Footer bar moved outside the scrollable content area — always visible regardless of scroll position
- `#app` height uses `calc(100vh / 1.08)` to compensate for any body zoom on high-DPI displays
- `package.json` version bumped to `1.1.0`
- `providers/**/*` added to electron-builder `files` list
- `asarUnpack` configured for `better-sqlite3` native module
- Gemini scanner completely rewritten to match actual CLI session format (`messages[]` with `tokens: {input, output, cached}`)

### Fixed

- Footer controls (Refresh, Launch at Login, Settings, Menu) no longer hidden when content overflows
- Chart height on two-column cards — added `maintainAspectRatio: false` and explicit CSS height
- CSS grid blowout on two-column cards — added `min-width: 0` to prevent overflow
- Light theme CSS selectors corrected for provider and stats UI elements
- Null guard added for missing usage data fields

---

## [1.0.0] - 2026-03-17

### Initial Release

The first public release of Claude Usage — a Windows system tray app for tracking your Claude AI usage in real time.

### Added

#### Authentication
- OAuth 2.0 sign-in with PKCE flow (no client secret stored)
- Automatic token refresh when credentials expire
- Secure credential storage in local JSON files
- Sign out support via hamburger menu

#### Dashboard
- **5-Hour usage gauge** — real-time utilization with animated gauge chart
- **7-Day usage gauge** — weekly utilization with animated gauge chart
- **Per-model breakdown** — individual Opus and Sonnet usage with color-coded progress bars
- **Extra usage tracking** — credit consumption against monthly limit (shown when enabled)
- **7-Day trend chart** — interactive line chart plotting all metrics over the past week
- **Reset timers** — countdown showing when each usage window resets

#### System Tray
- Runs as a lightweight system tray application
- Left-click tray icon to toggle the usage panel
- Right-click tray icon for context menu (Show / Quit)
- Auto-hide when clicking outside the panel

#### UI/UX
- Clean, modern interface with rounded cards and smooth animations
- **Dark/light theme** — automatically follows Windows system theme
- Color-coded usage levels (green → yellow → orange → red → pulsing red)
- Hamburger menu for Sign Out and Quit actions
- Refresh icon button for manual data refresh
- Launch at Login toggle for auto-start with Windows

#### Data & Performance
- Auto-refresh every 5 minutes
- Usage history stored locally (last 30 days)
- Chart legend with per-series color indicators
- Relative timestamps ("Updated 2 min, 30 sec ago")

#### Build & Distribution
- One-click NSIS installer for Windows (no admin rights required)
- Installs to user profile directory
- Electron 41 with context isolation and secure IPC

---

[1.1.0]: https://github.com/your-username/claude-usage-app/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/your-username/claude-usage-app/releases/tag/v1.0.0
