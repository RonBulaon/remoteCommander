# Changelog

All notable changes to **Remote Commander** are documented here. The format adapts
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

— nothing yet —

## [0.1.0] — 2026-05-27

Initial public release.

### Connectivity

- **SSH terminal** (xterm.js): 256-color, search, web-links, copy/paste
  (`Ctrl+Shift+C/V` + right-click), **jump-host / bastion** support, automatic reconnect with backoff.
- **SFTP** dual-pane file manager: drag-and-drop transfers, live **transfer queue**
  (speed / ETA / cancel), breadcrumbs, rename / mkdir / delete, visual **chmod** editor.
  Reuses an open SSH connection when one is available.
- **RDP in a tab** via Guacamole (`guacd`); external **FreeRDP** window as automatic fallback when
  guacd isn't reachable.
- **VNC** in-app via noVNC over a built-in local WebSocket↔TCP proxy.
- **Web console**: sandboxed embedded browser with per-profile isolated sessions, browser-style
  **"your connection is not private" interstitial** for self-signed / invalid certs
  (proceed-once-per-session, or opt a profile in permanently), **per-profile proxy** (SOCKS/HTTP),
  **bookmarks**, and a **document viewer** (inline PDF; formatted JSON / Markdown in a
  script-disabled sandbox iframe).
- **Remote file editor** (CodeMirror): edit any SFTP file (remote *or* local), syntax highlighting,
  save in place, dirty indicator, unsaved-close guard, 5 MB / text-only safety limits.
- **Local terminal** (PTY) via the **+** button on any pane's tab bar.

### Profiles & workspaces

- **Profiles & groups**: collapsible groups, tags, search by name / host / protocol / tag.
- Per-protocol settings — RDP resolution / color-depth / domain / cert mode; VNC display / port /
  encoding.
- **Encrypted import / export** (`.rcprofiles`, AES-256-GCM, credentials included).
- **Workspaces**: save the current tab set + pane layout, mark one **default** to auto-restore on
  launch.

### VPN integration

- **OpenVPN** and **WireGuard** profile management (saved username **and** password).
- Assigned-IP display; **auto-connect** a profile's VPN before opening the session (with an
  in-app prompt if it's down).

### Layout & UI

- VS Code–styled tab strip with **drag-reorder**, pinning, inline rename.
- **tmux-style nested pane splitting** — split any pane right or down, drag tabs onto any pane
  to move them there, resize each divider independently.
- **Universal copy / paste**: standard `Ctrl/Cmd+C/V`, **right-click Cut/Copy/Paste/Select-All**
  everywhere (including inside web-console `<webview>` guests), terminal `Ctrl+Shift+C/V` +
  right-click (selection → copy, none → paste).
- Frameless, dark, **VS Code Dark Modern** theme throughout — including scrollbars and a custom
  title bar with File / View / Help menus.

### Security & data

- Renderer **sandboxed from Node**; preload bridge allow-lists every IPC channel.
- **Credentials encrypted at rest** via OS keychain (keytar), with Electron `safeStorage`-encrypted
  file as fallback. VPN passwords are encrypted in the profile and never sent to the UI.
- **VNC / RDP WebSocket bridges** bind to `127.0.0.1`.
- TLS validation stays on for web-console guests; relaxation is **per-origin** and explicit.
- **Connection history** logged to a local SQLite DB; filter by protocol / host / server / date
  with **CSV export**.

### Platforms

- Windows (NSIS one-click installer), macOS (`.dmg`, x64 **and** arm64), Linux (AppImage + `.deb`).

[Unreleased]: https://github.com/RonBulaon/remoteCommander/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/RonBulaon/remoteCommander/releases/tag/v0.1.0
