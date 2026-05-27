# Install Remote Commander on Linux

Everything you need to **download, install, and run** Remote Commander on 64-bit Linux, on one page.
Two formats are provided: a portable **AppImage** and a Debian/Ubuntu **`.deb`**. No developer tools required.

---

## 1. Download

Download from the official Releases page and grab the **`...AppImage`** (any distro) or the **`...deb`**
(Debian/Ubuntu):

👉 **https://github.com/RonBulaon/remoteCommander/releases/latest**

Or download the latest build straight from the **terminal** (no need to know the version):

```bash
# AppImage:
curl -fsSL https://api.github.com/repos/RonBulaon/remoteCommander/releases/latest \
  | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | cut -d'"' -f4 \
  | xargs -n1 curl -fL -O

# …or the .deb — swap the extension:
curl -fsSL https://api.github.com/repos/RonBulaon/remoteCommander/releases/latest \
  | grep -o '"browser_download_url": *"[^"]*\.deb"' | cut -d'"' -f4 \
  | xargs -n1 curl -fL -O
```

## 2. Install & run

### Option A — AppImage (portable, any distro)
```bash
sudo apt install -y libfuse2                 # AppImage needs FUSE (Debian/Ubuntu; Fedora: sudo dnf install fuse)
chmod +x ./*.AppImage
./*.AppImage                                 # double-click also works in a file manager
```

### Option B — `.deb` (Debian/Ubuntu)
The `.deb` is named like `remotecommander_<version>_amd64.deb` (Debian lowercases/strips the name).
**The leading `./` is required** — without it, `apt` treats the filename as a repo package name and
fails with *"Unable to locate package."*
```bash
sudo apt install ./remotecommander_*_amd64.deb     # or: ./*.deb
```
Then launch **Remote Commander** from your applications menu (or run `remotecommander` in a terminal).

## 3. ✅ You're ready

These work immediately, with nothing else to install:

- **SSH** terminal · **SFTP** file transfer · **Remote file editor**
- **Web console** (built-in browser) · **VNC** (the *remote host* must run a VNC server)
- **Local terminal**

> **Saved passwords:** for the system keyring (instead of an encrypted-file fallback), install
> `sudo apt install -y libsecret-1-0 gnome-keyring` (Fedora: `sudo dnf install libsecret gnome-keyring`).

---

## 4. (Optional) Enable in-app RDP and VPN

Only if you'll use remote desktop (RDP) or VPN. (Debian/Ubuntu `apt` shown; Fedora `dnf` noted.)

### RDP — remote desktop in a tab (guacd)
```bash
sudo apt install -y guacd                    # Ubuntu/Debian
# …or run it in Docker on any distro:
docker run -d --name guacd -p 4822:4822 guacamole/guacd
```

### RDP — fallback window (FreeRDP, optional)
```bash
sudo apt install -y freerdp2-x11             # provides xfreerdp; Fedora: sudo dnf install freerdp
```
You only need **one** RDP path — guacd **or** FreeRDP.

### VPN — OpenVPN and WireGuard
```bash
sudo apt install -y openvpn                  # Fedora: sudo dnf install openvpn
sudo apt install -y wireguard-tools          # provides wg-quick; Fedora: sudo dnf install wireguard-tools
```

**Required for in-app VPN Connect:** the app runs these as `sudo -n …`, so add a passwordless-sudo rule:
```bash
sudo visudo -f /etc/sudoers.d/remote-commander
# add (adjust the username and paths from `which openvpn wg-quick pkill`):
youruser ALL=(root) NOPASSWD: /usr/sbin/openvpn, /usr/bin/wg-quick, /usr/bin/pkill
```

### Check what's installed
```bash
which openvpn ; which wg-quick ; which xfreerdp ; which guacd || docker ps
```

---

## Updating

No in-app auto-update yet — update manually by re-downloading the newer build (the same step 1 above):

- **AppImage:** delete the old `.AppImage`, drop in the new one, and `chmod +x ./*.AppImage`
  (it's a single self-contained file).
- **`.deb`:** install the newer package over the old one — `sudo apt install ./remotecommander_*_amd64.deb`
  upgrades it in place. **No need to uninstall first.**

Your profiles, credentials, and workspaces in `~/.config/remotecommander/` are preserved across updates.

---

## Uninstall

- **AppImage:** just delete the `.AppImage` file.
- **`.deb`:** `sudo apt remove remotecommander` (confirm the exact name with `dpkg -l | grep -i remote`).

Saved profiles live in `~/.config/remotecommander/` — delete that folder to remove them too.

---

Other platforms: **[Windows](install-windows.md)** · **[macOS](install-macos.md)**
