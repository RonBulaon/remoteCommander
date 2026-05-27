# Remote Commander — Build & Packaging Guide

How to (1) stand up the dev environment on a new machine, and (2) produce installable
binaries for Windows, macOS, and Linux.

> **Related docs:** [README.md](README.md) (features / overview) ·
> [ARCHITECTURE.md](ARCHITECTURE.md) (exhaustive code reference). This guide is the
> dev-setup + packaging companion to those two.

> **Repo layout (important):** the Git repo root contains the planning docs and a
> nested **`remoteCommander/`** subfolder which is the actual Electron app.
> **All `npm` commands below run inside that subfolder**, not the repo root.
>
> ```
> remoteCommander/            ← git repo root (docs live here)
> └── remoteCommander/        ← the app  ← cd here to run npm
>     ├── package.json
>     ├── electron-builder.yml
>     ├── src/{main,preload,renderer}
>     └── build/              ← icons + mac entitlements
> ```

---

## Part 1 — Rebuild the dev environment

### 1.1 Prerequisites

**Supported operating systems:** Windows 10/11 (x64), macOS 11+ (Intel **or** Apple Silicon),
and a modern 64-bit Linux (e.g. Ubuntu 20.04+/Debian 11+/Fedora 36+). Also builds and runs
under **WSL2** with the caveats in §1.6. ~2 GB free disk for `node_modules` + Electron.

| Tool | Version | Notes |
|---|---|---|
| **Git** | any | to clone the repo |
| **Node.js** | `^20.19` or `>=22.12` | electron-vite 5 requires this. **Node 22 LTS** recommended. Use `nvm`/`fnm`/`volta` to manage versions. |
| **npm** | 10+ | ships with Node |
| **C/C++ build toolchain** | — | only needed if the native modules (`keytar`, `better-sqlite3`) can't use prebuilt binaries (see 1.4) |

Native build toolchain per OS (install only if a native rebuild compiles from source):
- **Linux (Debian/Ubuntu):** `sudo apt install build-essential python3 libsecret-1-dev`
- **macOS:** `xcode-select --install`
- **Windows:** Visual Studio Build Tools with the *Desktop development with C++* workload, plus Python 3.

### 1.2 Get the code
```bash
git clone https://github.com/RonBulaon/remoteCommander.git
cd remoteCommander/remoteCommander      # into the nested app folder
```

### 1.3 Download source (`.npmrc`)
Electron and electron-builder binaries download from their **official GitHub release sources**
— GitHub serves them through a global CDN with edge nodes worldwide, so this is fast and
reliable. The committed `.npmrc` configures **no registry/mirror override**, so nothing extra
is needed; `npm install` just works.

### 1.4 Install dependencies
```bash
npm install
```
`postinstall` automatically runs `electron-builder install-app-deps`, which rebuilds the
native modules (`keytar`, `better-sqlite3`) against Electron's ABI. These normally pull
**prebuilt binaries** (no compiler needed); the toolchain in 1.1 is only a fallback.

> Reproducible installs: use `npm ci` instead of `npm install` (honors `package-lock.json` exactly).

### 1.5 Run it
```bash
npm run dev        # launches the app with hot-reload (dev mode — unminified, slower)
npm run build && RC_ENABLE_GPU=1 npm start   # production build + GPU — use this to gauge real performance
```

> The renderer dev server listens on `0.0.0.0:5173` (see `electron.vite.config.ts`), so the
> UI is reachable from another machine on your LAN while developing (handy on a WSL2 host).
> The Electron window itself still runs locally.

Other useful scripts:
```bash
npm run typecheck  # tsc on main + renderer, no emit
npm run build      # typecheck + bundle to out/  (no installer)
npm run start      # preview the built bundle from out/
npm run lint       # eslint
```

### 1.6 Platform notes
- **WSL2:** the app runs via WSLg, but there's no OS keyring, so `keytar` fails at runtime
  and credentials fall back to an **encrypted file** (`<userData>/credentials.json`). This is
  expected. `<userData>` is `~/.config/remotecommander/` on Linux.
- **Verifying without a GUI:** `npm run build` (or `npm run typecheck`) validates everything
  compiles even where the app can't launch.

---

## Part 2 — Runtime requirements for full functionality

The app itself bundles the SSH/SFTP/VNC clients (pure JS). **RDP and VPN shell out to
external system tools**, which are *not* bundled in the installer — they must be present on
the machine **running** the app. Without them, those features show a clear error (and RDP
offers an external-window fallback).

| Feature | Needs | Install |
|---|---|---|
| **SSH / SFTP** | nothing extra | — |
| **Local terminal** | `node-pty` (optional native module; needs a C/C++ toolchain to build) | Linux: `sudo apt install build-essential` then `npm install node-pty` · macOS: Xcode CLT + `npm install node-pty` · Windows: VS Build Tools + `npm install node-pty`. Without it, the Local Terminal tab shows an install message. |
| **VNC** | a VNC server on the target host | — (client side is built in) |
| **RDP — in-tab** | `guacd` (Guacamole daemon) reachable at `127.0.0.1:4822` | Linux: `sudo apt install guacd` · macOS/Windows: Docker → `docker run -d -p 4822:4822 guacamole/guacd` |
| **RDP — fallback window** | FreeRDP CLI | Linux: `sudo apt install freerdp2-x11` · macOS: `brew install freerdp` · Windows: `winget install FreeRDP.FreeRDP` |
| **VPN — OpenVPN** | `openvpn` + passwordless sudo | Linux: `sudo apt install openvpn` · macOS: `brew install openvpn` · Windows: OpenVPN community client |
| **VPN — WireGuard** | `wg-quick` (wireguard-tools) + passwordless sudo | Linux: `sudo apt install wireguard-tools` · macOS: `brew install wireguard-tools` |

**VPN privilege note (Linux/macOS):** in-app Connect runs `sudo -n openvpn …` / `sudo -n wg-quick …`,
so add a passwordless-sudo rule or Connect fails fast with *"sudo: a password is required"*:
```bash
sudo visudo -f /etc/sudoers.d/remote-commander
# add (adjust user + binary paths from `which openvpn wg-quick pkill`):
youruser ALL=(root) NOPASSWD: /usr/sbin/openvpn, /usr/bin/wg-quick, /usr/bin/pkill
```

**Linux keychain (optional):** install `libsecret-1-0` so `keytar` can use the system keyring;
otherwise credentials use the encrypted-file fallback described in 1.6.

---

## Part 3 — Build installable binaries

There are **two ways** to produce installers, and you choose based on which OSes you have:

- **Option A — Build locally** (§3.3): run the build on each target OS yourself. Best when you
  own a Windows box, a Mac, and a Linux box (or VMs).
- **Option B — Build in GitHub Actions** (§3.4): push a tag and let GitHub's hosted
  Windows + macOS + Linux runners build all three for you. Best when you *don't* have all three
  machines (e.g. you only have Windows + WSL2 and no Mac).

### 3.1 Golden rule: build each OS's installer **on that OS**
Native modules (`keytar`, `better-sqlite3`, `node-pty`) and code-signing are platform-specific.
Build the Windows installer **on Windows**, the macOS `.dmg` **on macOS**, and the Linux packages
**on Linux**. macOS in particular **cannot** be built anywhere but macOS. Cross-building is fragile
and not recommended — if you lack a machine for a platform, use CI (§3.4) instead.

### 3.2 What gets produced
Configured in `electron-builder.yml`; artifacts land in **`remoteCommander/dist/`**:

| Platform | Target | Arch | Artifact |
|---|---|---|---|
| Windows | NSIS installer | x64 | `Remote Commander-<version>-setup.exe` |
| macOS | DMG | x64 + arm64 | `Remote Commander-<version>.dmg` |
| Linux | AppImage + deb | x64 | `Remote Commander-<version>.AppImage`, `.deb` |

> All `npm` commands below run **inside the nested `remoteCommander/remoteCommander/` app folder**
> (see the repo-layout note at the top of this guide), not the repo root.

---

### 3.3 Option A — Build locally, one OS at a time

Each walkthrough is **install dependencies → build → ship**. Do the matching one on each OS.

#### 3.3.1 🐧 Linux  →  AppImage + `.deb`
```bash
# 1. System dependencies (Debian/Ubuntu; native-rebuild toolchain + keychain lib)
sudo apt update
sudo apt install -y build-essential python3 libsecret-1-dev

# 2. Project dependencies (also rebuilds native modules for Electron's ABI via postinstall)
cd remoteCommander/remoteCommander
npm ci                      # or: npm install

# 3. Build the installers
npm run build:linux         # type-check → bundle → electron-builder --linux

# 4. Ship — artifacts are in dist/
ls dist/                    # Remote Commander-<version>.AppImage  +  ...deb
```
- The **AppImage** needs **FUSE** on the *end-user* machine: `sudo apt install libfuse2`. The
  `.deb` does not. Install the `.deb` with `sudo apt install ./Remote\ Commander-*.deb`.
- Building Linux artifacts from **WSL2 works** (you don't need a real Linux desktop to *build*).

#### 3.3.2 🪟 Windows  →  NSIS `setup.exe`
```powershell
# 1. System dependencies (only needed if a native module compiles from source)
#    Install "Visual Studio Build Tools" with the "Desktop development with C++" workload,
#    plus Python 3. Most builds use prebuilt binaries and skip this.

# 2. Project dependencies
cd remoteCommander\remoteCommander
npm ci

# 3. Build the installer
npm run build:win           # type-check → bundle → electron-builder --win

# 4. Ship — artifact is in dist\
dir dist                    # Remote Commander-<version>-setup.exe
```
- Unsigned installers trigger **SmartScreen** ("unknown publisher"). For trusted distribution,
  sign with a code-signing certificate: set `CSC_LINK` (path/URL to your `.pfx`) and
  `CSC_KEY_PASSWORD` in the environment **before** `npm run build:win`.

#### 3.3.3 🍎 macOS  →  `.dmg`  *(must be built on a Mac)*
```bash
# 1. System dependencies
xcode-select --install      # Xcode Command Line Tools

# 2. Project dependencies
cd remoteCommander/remoteCommander
npm ci

# 3. Build the disk image (universal: x64 + arm64)
npm run build:mac           # type-check → bundle → electron-builder --mac

# 4. Ship — artifact is in dist/
ls dist/                    # Remote Commander-<version>.dmg
```
- Unsigned `.dmg` apps are blocked by **Gatekeeper**. For personal use: right-click → Open, or
  `xattr -dr com.apple.quarantine "/Applications/Remote Commander.app"`.
- For public distribution you need an **Apple Developer ID** certificate + **notarization**.
  `electron-builder.yml` ships `notarize: false`; flip it on and provide `APPLE_ID` /
  `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` env vars.

#### Quick-test build (any OS, no installer)
```bash
npm run build:unpack        # produces dist/<platform>-unpacked/ — runnable app dir, no packaging
```

---

### 3.4 Option B — Build all three in GitHub Actions (no Mac required)

A ready-to-use workflow lives at **[`.github/workflows/release.yml`](.github/workflows/release.yml)**.
It runs a **matrix** on GitHub's hosted `ubuntu-latest`, `windows-latest`, and `macos-latest`
runners, so each installer is built on its native OS — including the macOS `.dmg` you can't build
locally on Windows/Linux.

**What it does:** checks out the repo → installs Node 22 → `npm ci` in the nested app folder →
runs the right `build:<os>` script per runner → uploads the `dist/` artifacts. When triggered by a
version **tag**, it also attaches the artifacts to a **GitHub Release**.

**How to trigger it:**

1. Push the repo to GitHub (the workflow file must be on your default branch).
2. **Recommended first: a dry run.** GitHub → **Actions** tab → *Release* workflow → **Run workflow**.
   This `workflow_dispatch` build produces all three installers as downloadable **Artifacts** only —
   **no Release** — so you can confirm every OS job is green before publishing.
3. **Then cut the release by pushing a tag** whose version matches `version` in
   `remoteCommander/remoteCommander/package.json` (the installer filenames come from there):
   ```bash
   # First release: package.json is already 0.1.0 → tag it as-is.
   git tag v0.1.0
   git push origin v0.1.0

   # Later releases: bump "version" in package.json (e.g. 0.1.0 → 0.2.0), commit, then:
   git tag v0.2.0 && git push origin v0.2.0
   ```
4. When the tag build finishes, the installers (`.exe`, both `.dmg`s, `.AppImage`, `.deb`) are
   attached to an **auto-created GitHub Release**. (Manual "Run workflow" builds never create a
   Release — they only leave Artifacts on the run page.)

> **Publish it as a normal release — not a pre-release or draft.** The README and the per-OS install
> guides link to `…/releases/latest`, and the download one-liners hit the `/releases/latest` API,
> which **ignores** pre-releases and drafts — a pre-release would leave those links pointing at
> nothing. Keep the tag and the `package.json` version in sync.

> **No secrets needed** for unsigned builds. To code-sign in CI, add `CSC_LINK` /
> `CSC_KEY_PASSWORD` (Windows) and the `APPLE_*` vars (macOS) as **GitHub Actions secrets** and
> reference them in the workflow `env:`.

> **Download / Node note:** CI downloads Electron and electron-builder binaries from the
> **official** GitHub sources (no registry/mirror override — see §1.3), so the hosted runners
> reliably fetch every binary including the macOS `dmgbuild` bundle. The workflow also opts all
> actions into Node 24 (`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`) to silence the Node-20 deprecation.

### 3.5 Auto-update (optional, not yet wired)
`electron-updater` is a dependency and `electron-builder.yml` has a **placeholder** publish URL
(`https://example.com/auto-updates`). Auto-update does nothing until you point `publish` at a
real provider (GitHub Releases, S3, generic server) and wire `autoUpdater` in the main process.
Ignore this for manual distribution.

---

## Part 4 — Application data, first run & resetting state

The app writes all of its data to Electron's per-user **`userData`** directory (not the repo).
Knowing where it lives helps with debugging, clean re-tests, and migrating to a new machine.

| OS | `userData` directory |
|---|---|
| **Linux** | `~/.config/remotecommander/` |
| **macOS** | `~/Library/Application Support/remotecommander/` |
| **Windows** | `%APPDATA%\remotecommander\` |

Files created there:

| File | Contents | Sensitive? |
|---|---|---|
| `profiles.json` | server profiles + groups | host/user only |
| `vpn-profiles.json` | VPN profiles (password encrypted in-file) | yes |
| `workspaces.json` | saved tab layouts | no |
| `credentials.json` | encrypted secrets — **only created when the OS keychain (keytar) is unavailable**, e.g. WSL2 | yes |
| `audit.db` (+ `-wal`, `-shm`) | SQLite connection history | host/user only |

**First run / no data:** with no `profiles.json` present, the UI shows a few **seed demo
profiles** (defined in `src/renderer/src/store/profileStore.ts`). They disappear as soon as
you add/save your own profiles.

**Reset to a clean slate** (with the app closed):
```bash
# Linux example — wipe everything the app stored
rm -rf ~/.config/remotecommander/

# …or remove just one concern
rm ~/.config/remotecommander/profiles.json      # forget servers (restores seed demo data)
rm ~/.config/remotecommander/credentials.json   # forget saved passwords (file-fallback only)
rm ~/.config/remotecommander/audit.db*          # clear connection history
```

**Where to see logs while developing:** renderer errors appear in the in-app DevTools
console (View → Toggle Developer Tools); main-process logs (`[SshService] …`,
`[VpnService] …`, etc.) print to the **terminal running `npm run dev`**.

> **Migrating to a new machine:** copy the `userData` directory, **or** use the in-app
> encrypted **Export Profiles** (`Ctrl+Shift+E`) → **Import Profiles** (`Ctrl+Shift+I`),
> which moves profiles *and* credentials in one password-protected `.rcprofiles` file
> without copying the raw stores.

---

## Quick reference

```bash
# Dev (in remoteCommander/remoteCommander):
npm install            # deps + native rebuild for Electron
npm run dev            # run with hot reload
npm run typecheck      # type-check only
npm run build          # bundle to out/ (no installer)

# Installers (run on the matching OS; output in dist/):
npm run build:win      # Windows  → NSIS .exe
npm run build:mac      # macOS    → .dmg (must run on macOS)
npm run build:linux    # Linux    → AppImage + .deb
npm run build:unpack   # any OS   → unpacked dir, no installer
```
