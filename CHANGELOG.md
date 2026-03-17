# Changelog

All notable changes to Claude Usage will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/your-username/claude-usage-app/releases/tag/v1.0.0
