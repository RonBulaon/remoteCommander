# Remote Commander — User Guide

How to do common things in the app — one page, scannable. For installation, see the per-OS
guides: **[Windows](install-windows.md)** · **[macOS](install-macos.md)** · **[Linux](install-linux.md)**.
For the architecture or build process, see **[ARCHITECTURE.md](../ARCHITECTURE.md)** and
**[BUILD.md](../BUILD.md)**.

---

## Concepts at a glance

- Your servers live as **profiles** in the sidebar; double-click one to open a tab.
- Tabs live in **panes**, and panes can be **split** any number of times (tmux-style).
- **Workspaces** snapshot your tabs + layout for one-click restore (and can auto-restore on launch).
- Credentials are **encrypted at rest**. Each profile can have an associated **VPN** that
  auto-connects before the session opens.

---

## Your first 5 minutes

1. **Open the app.** With no tabs open, the pane shows the Welcome placeholder.
2. **Add a profile.** In the sidebar, create a new profile — pick **SSH**, fill in host + username,
   choose key or password auth, save.
3. **Connect.** Double-click the profile → a terminal tab opens.
4. **Split the view.** Click the **split-right** button on the tab bar to put a second pane next to
   the terminal; double-click another profile to fill it (or hit the **+** button for a local shell).
5. *(Optional)* **Save the layout.** Sidebar → **Workspaces** → **Save Current** → toggle **Default**.
   The app will restore your layout on next launch.

---

## Profiles & groups

### Create / edit / delete

- Use the sidebar's add control to create a **New Profile**, pick the protocol
  (SSH, SFTP, RDP, VNC, Web), fill in host, port, and auth, and save.
- **Edit:** double-click the row's name (or right-click → **Edit**).
- **Delete or rename:** right-click a profile or group for the menu.

### Organize & search

- Drag profiles between groups; collapse a group with the chevron.
- The **search box** at the top of the sidebar filters by name, host, protocol, and tag.
- Add **tags** in the profile editor to filter by role/environment.

### Per-protocol settings

- **SSH:** password or key auth, optional **jump host / bastion**, optional VPN dependency.
- **RDP:** resolution / color depth / domain / cert mode (warn · auto-accept · reject).
- **VNC:** display number, port, encoding (tight / zrle / hextile / raw).
- **Web:** start URL, **per-profile proxy** (SOCKS/HTTP), **bookmarks**, "Ignore TLS cert errors" toggle.

### Encrypted import / export

- **File menu → Export Profiles…** — choose a password → get a `.rcprofiles` file (AES-256-GCM),
  credentials included.
- **File menu → Import Profiles…** — paste the same password to bring them back.

---

## Connections

### SSH terminal

- Double-click an SSH profile (or right-click an SSH row for **Open SFTP Tab**).
- **Search inside the terminal:** the search icon on the toolbar.
- **Copy / paste:** select text → `Ctrl+Shift+C` *or* right-click. Paste: `Ctrl+Shift+V` *or*
  right-click on empty space.
- **Reconnect** is automatic with backoff if the connection drops.
- **Jump host** is configured on the profile itself; the tunnel is set up behind the scenes.

### SFTP file manager

- Opens with two panes: **local** on the left, **remote** on the right.
- **Drag files** between panes to upload/download. The **transfer queue** at the bottom shows
  speed, ETA, and a cancel button per transfer.
- **Right-click a file** for **Copy path**, **Rename**, **Delete**, **Properties** (visual chmod).
- **Reuses an open SSH connection** when one is available, so no second login.
- **Double-click a file** to open it in the **editor** (5 MB / text-only).

### Remote file editor

- Triggered by double-clicking any file in an SFTP pane (remote *or* local).
- Edits with **CodeMirror** syntax highlighting; unsaved changes show a `•` in the tab title.
- **Save:** `Ctrl+S` — writes straight back over SFTP (or to disk for local files).
- Closing a dirty editor tab prompts for confirmation.

### RDP (remote desktop in a tab)

- Renders **inside the app** when **guacd** is reachable on `127.0.0.1:4822`. Falls back to an
  **external FreeRDP window** automatically when guacd isn't available.
- Per-profile: resolution (1024×768 → 1920×1080 → custom → auto), color depth, domain, cert mode.

### VNC

- Built-in **noVNC** over a local WebSocket↔TCP bridge — no separate `websockify` needed.
- Password prompt on first connect; saved to your OS keychain after.

### Web console

- Open device or cloud management UIs (iDRAC/iLO/BMC, ESXi/Proxmox, switches, firewalls, cloud
  consoles) in a tab, via a **sandboxed embedded browser**.
- **Address bar**, back/forward/reload/stop, **bookmarks dropdown**, and a **per-profile proxy**
  (e.g. `socks5://127.0.0.1:1080` for an SSH tunnel to a bastion).
- **Self-signed / invalid cert?** A browser-style **"Your connection is not private"** prompt
  appears with cert details. Choose **Back to safety** or **Proceed anyway** — the latter trusts
  the origin for **this session only**. For permanent per-profile trust, toggle
  **Ignore TLS certificate errors** in the profile editor.
- **Built-in document viewer:** PDFs render via Chromium's PDFium; **JSON** and **Markdown** files
  are formatted in a script-disabled sandbox iframe.

### Local terminal

- The **terminal `+` button** on any pane's tab bar opens a real local shell (PTY).
- Click it again to open another independent shell.

---

## Layout, tabs, and splits

### Tabs

- **Drag** to reorder within a pane.
- **Drag onto another pane** to move the tab there — works at any nesting depth.
- **Double-click** the title to rename inline.
- **Right-click** for the context menu: Rename, Pin, **Move to Split Right/Down**, Close.

### Splitting panes (tmux-style)

Each pane's tab bar has three layout buttons:

| Button | What it does |
|---|---|
| **▥ Split right** | Splits the pane horizontally; the new (empty) pane becomes active. |
| **▤ Split down** | Splits the pane vertically. |
| **✕ Close pane** | Drops the pane's non-pinned tabs and collapses it into its sibling. |

- Splits **nest arbitrarily** — split a pane that's already inside a split, and again, …
- **Resize** by dragging any divider; each divider is independent.
- An empty pane shows the Welcome placeholder. Closing the **last tab** of a pane auto-collapses it.

### Workspaces

- **Sidebar → Workspaces** view lists saved layouts.
- **Save Current** snapshots the current tabs and pane tree as a workspace.
- **Restore** replaces your current tabs with the workspace's.
- Mark one as the **Default** (star) — it restores automatically when the app launches.

---

## VPN

- Open the **VPN tab** from the sidebar's VPN section (or the VPN status badge in the title bar).
- Add an **OpenVPN** `.ovpn` or **WireGuard** `.conf`; save your username **and** password for
  OpenVPN if needed.
- **Auto-connect before session:** in a profile, pick a VPN and turn on auto-connect — the app
  brings the VPN up before opening the connection (or prompts you if it's down).
- The status badge shows assigned IP, current state, and the active VPN profile name.

> The app shells out to system tools (`openvpn`, `wg-quick`) and uses **passwordless `sudo -n`** —
> see the per-OS install guides for setup.

---

## Connection history (audit log)

- **File / View menu → Connection History** opens the audit tab.
- **Filter** by protocol, host, server name (profile), or a date range.
- **CSV export** for sharing or longer-term tracking.
- Every connect / disconnect is logged to a local **SQLite** database — separate from the sidebar's
  in-memory "History" view.

---

## Clipboard everywhere

| Where | How to copy / paste |
|---|---|
| Inputs (profile editor, search boxes, address bar) | `Ctrl/Cmd+C` / `V` / `X` / `A`, or **right-click** for the menu |
| Plain text (sidebar labels, status bar, document viewer) | Select with mouse → **right-click → Copy** |
| Web console pages | **Right-click** — Cut / Copy / Paste / Select-All / **Copy Link** for hyperlinks |
| SSH and local terminal | `Ctrl+Shift+C` / `Ctrl+Shift+V`, or **right-click** (selection → copy, none → paste) |
| SFTP file rows | Right-click → **Copy path** |

---

## Keyboard shortcuts (quick reference)

| Action | Shortcut |
|---|---|
| Copy / Paste / Cut / Select All (inputs) | `Ctrl/Cmd+C / V / X / A` |
| Terminal copy / paste | `Ctrl+Shift+C` / `Ctrl+Shift+V` |
| Find in terminal | `Ctrl+F` |
| Save (editor) | `Ctrl+S` |
| New local terminal | The **+** button on a pane's tab bar |

---

## Where your data lives

| What | Location |
|---|---|
| Profiles, workspaces, history DB | Windows: `%APPDATA%\remotecommander\` · macOS: `~/Library/Application Support/remotecommander/` · Linux: `~/.config/remotecommander/` |
| Credentials | OS keychain (keytar) → Electron `safeStorage`-encrypted file fallback |
| Connection-history audit log | SQLite database inside the folder above |

Updating the app **preserves all of this** — see the **Updating** section in each install guide.

---

## Troubleshooting

- **Terminal feels slow under `npm run dev`?** Use the production build —
  `npm run build && RC_ENABLE_GPU=1 npm start` (see [BUILD.md](../BUILD.md)).
- **Web tab won't load a self-signed cert?** See the "**Self-signed / invalid cert**" note under
  *Web console* above — proceed via the on-screen interstitial, or toggle
  **Ignore TLS certificate errors** in the profile for permanent per-origin trust.
- **VPN won't connect from the app?** The app uses `sudo -n` — set up passwordless `sudo` for
  `openvpn` / `wg-quick` per the install guide for your OS.
- **RDP shows the FreeRDP window instead of the in-tab view?** That's the fallback — the app
  couldn't reach **guacd** on `127.0.0.1:4822`. Install guacd (Docker is easiest) and reconnect.
- **Lost everything after reinstalling?** You shouldn't — installers update in place and your
  data is in the user-data folder above. If it really is gone, restore from an exported
  `.rcprofiles` backup.

---

## Where to go next

- **Install / update:** [Windows](install-windows.md) · [macOS](install-macos.md) · [Linux](install-linux.md)
- **Architecture & extension recipes:** [ARCHITECTURE.md](../ARCHITECTURE.md)
- **Building from source & releasing:** [BUILD.md](../BUILD.md)
- **What changed in each release:** [CHANGELOG.md](../CHANGELOG.md)
