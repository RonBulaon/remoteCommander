# Install Remote Commander on Windows

Everything you need to **download, install, and run** Remote Commander on Windows 10/11 (64-bit),
on one page. No developer tools required.

---

## 1. Download

Download from the official Releases page and grab the file named **`Remote Commander-<version>-setup.exe`**:

👉 **https://github.com/RonBulaon/remoteCommander/releases/latest**

Or download the latest installer straight from **PowerShell** (no need to know the version):

```powershell
$a = (Invoke-RestMethod https://api.github.com/repos/RonBulaon/remoteCommander/releases/latest).assets |
     Where-Object { $_.name -like '*setup.exe' } | Select-Object -First 1
Invoke-WebRequest $a.browser_download_url -OutFile $a.name
"Downloaded $($a.name)"
```

## 2. Install

Double-click **`Remote Commander-<version>-setup.exe`** and follow the prompts. It installs
per-user (no administrator rights needed).

Prefer the command line? Silent install:
```powershell
Start-Process ".\Remote Commander-"*"-setup.exe" -ArgumentList "/S" -Wait
```

## 3. First launch — clear the SmartScreen warning

The installer isn't code-signed yet, so Windows SmartScreen may show **"Windows protected your PC."**
Click **More info → Run anyway**. This happens once.

## 4. ✅ You're ready

These work immediately, with nothing else to install:

- **SSH** terminal · **SFTP** file transfer · **Remote file editor**
- **Web console** (built-in browser) · **VNC** (the *remote host* must run a VNC server)
- **Local terminal**

To launch later: **Start menu → Remote Commander**.

---

## 5. (Optional) Enable in-app RDP and VPN

Only do this if you'll use remote desktop (RDP) or VPN inside the app. Run commands in a terminal,
then **open a new terminal** so `PATH` updates. (Commands use **winget**, built into Windows 10/11.)

### RDP — remote desktop in a tab (recommended path: Docker + guacd)
```powershell
winget install Docker.DockerDesktop          # then launch Docker Desktop once
docker run -d --name guacd -p 4822:4822 guacamole/guacd
```
Docker must be running while you use RDP. Start it again later with `docker start guacd`.

### RDP — fallback window (FreeRDP, optional)
If Docker/guacd isn't available, the app can open an external **FreeRDP** window; it needs
**`wfreerdp.exe`** on `PATH`. Easiest source is MSYS2 (`pacman -S mingw-w64-x86_64-freerdp`, then add
`C:\msys64\mingw64\bin` to `PATH`) or `choco install freerdp`. You only need **one** RDP path.

### VPN — OpenVPN
```powershell
winget install OpenVPNTechnologies.OpenVPN
```
…or get it from **https://openvpn.net/community-downloads/**. Make sure `openvpn.exe` is on `PATH`
(default `C:\Program Files\OpenVPN\bin`). **Run Remote Commander as Administrator** when connecting an
OpenVPN profile — OpenVPN needs admin to create its network adapter.

### VPN — WireGuard (not available on Windows via the app)
The app drives WireGuard through `wg-quick`, which doesn't exist on Windows. For WireGuard on Windows,
use the official **[WireGuard app](https://www.wireguard.com/install/)** directly, and use **OpenVPN**
inside Remote Commander.

### Check what's installed
```powershell
where openvpn ; where wfreerdp.exe ; docker --version ; docker ps
```

---

## Updating

There's **no in-app auto-update yet**, so update manually: download the newer
**`Remote Commander-<version>-setup.exe`** (the same step 1 above) and run it. The one-click installer
replaces the existing version **in place — no need to uninstall first** (close the app before running it).
Silent: `Start-Process ".\Remote Commander-"*"-setup.exe" -ArgumentList "/S" -Wait`.

Your profiles, credentials, and workspaces in `%APPDATA%\remotecommander\` are preserved across updates.

---

## Uninstall

**Settings → Apps → Installed apps → Remote Commander → Uninstall** (or run the uninstaller from the
Start menu). Your saved profiles live in `%APPDATA%\remotecommander\` — delete that folder to remove them too.

---

Other platforms: **[macOS](install-macos.md)** · **[Linux](install-linux.md)**
