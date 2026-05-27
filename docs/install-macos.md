# Install Remote Commander on macOS

Everything you need to **download, install, and run** Remote Commander on macOS 11+
(Intel **or** Apple Silicon), on one page. No developer tools required.

---

## 1. Download

Download from the official Releases page and grab the `.dmg` for your Mac's chip —
**`Remote Commander-<version>-arm64.dmg`** (Apple Silicon: M1/M2/M3/M4) or
**`Remote Commander-<version>-x64.dmg`** (Intel). Not sure which? Apple menu →  **About This Mac** → "Chip".

👉 **https://github.com/RonBulaon/remoteCommander/releases/latest**

Or download the right one straight from the **Terminal** (auto-detects your chip):

```bash
arch=$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64)
curl -fsSL https://api.github.com/repos/RonBulaon/remoteCommander/releases/latest \
  | grep -o "\"browser_download_url\": *\"[^\"]*-$arch\.dmg\"" | cut -d'"' -f4 \
  | xargs -n1 curl -fL -O
```

## 2. Install

Open the downloaded `.dmg`, drag **Remote Commander** into the **Applications** folder, then eject the disk image.

Prefer the command line?
```bash
hdiutil attach "Remote Commander-"*.dmg
cp -R "/Volumes/Remote Commander/Remote Commander.app" /Applications/
hdiutil detach "/Volumes/Remote Commander"
```

## 3. First launch — get past Gatekeeper

The app isn't notarized yet, so macOS blocks the first launch. Use **either**:

- **Right-click** `Remote Commander` in `/Applications` → **Open** → **Open**, or
- ```bash
  xattr -dr com.apple.quarantine "/Applications/Remote Commander.app"
  ```

After the first launch it opens normally (double-click or Spotlight).

## 4. ✅ You're ready

These work immediately, with nothing else to install:

- **SSH** terminal · **SFTP** file transfer · **Remote file editor**
- **Web console** (built-in browser) · **VNC** (the *remote host* must run a VNC server)
- **Local terminal** · credentials stored in the macOS **Keychain**

---

## 5. (Optional) Enable in-app RDP and VPN

Only if you'll use remote desktop (RDP) or VPN. Commands use **[Homebrew](https://brew.sh)** — install it
first if needed: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`.

### RDP — remote desktop in a tab (Docker + guacd)
```bash
brew install --cask docker        # then launch Docker once from /Applications
docker run -d --name guacd -p 4822:4822 guacamole/guacd
```

### RDP — fallback window (FreeRDP, optional)
```bash
brew install freerdp              # provides xfreerdp
```
You only need **one** RDP path — Docker/guacd **or** FreeRDP.

### VPN — OpenVPN and WireGuard
```bash
brew install openvpn              # OpenVPN
brew install wireguard-tools      # WireGuard (provides wg-quick)
```

**Required for in-app VPN Connect:** the app runs these as `sudo -n …`, so add a passwordless-sudo rule:
```bash
sudo visudo -f /etc/sudoers.d/remote-commander
# add (adjust the username and the paths from `which openvpn wg-quick`):
youruser ALL=(root) NOPASSWD: /opt/homebrew/sbin/openvpn, /opt/homebrew/bin/wg-quick, /usr/bin/pkill
```
> On **Apple Silicon** Homebrew is under `/opt/homebrew/…`; on **Intel** under `/usr/local/…`.

### Check what's installed
```bash
which openvpn ; which wg-quick ; which xfreerdp ; docker --version ; docker ps
```

---

## Updating

There's **no in-app auto-update yet**, so update manually: download the newer `.dmg` for your chip
(**`…-arm64.dmg`** or **`…-x64.dmg`**, the same step 1 above), open it, and drag **Remote Commander** into
**Applications**, choosing **Replace** — **no need to uninstall first**. If Gatekeeper blocks the new
build, repeat the first-launch step (right-click → Open, or
`xattr -dr com.apple.quarantine "/Applications/Remote Commander.app"`).

Your profiles and Keychain credentials are preserved across updates (settings live in
`~/Library/Application Support/remotecommander/`).

---

## Uninstall

Drag `/Applications/Remote Commander.app` to the Trash. Your saved profiles live in
`~/Library/Application Support/remotecommander/` — delete that folder to remove them too.

---

Other platforms: **[Windows](install-windows.md)** · **[Linux](install-linux.md)**
