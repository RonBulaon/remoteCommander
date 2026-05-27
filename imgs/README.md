# imgs — logo & screenshots

This folder holds the project's **logo source** and **screenshots** used in the docs.

## Logo

**[logo.svg](logo.svg)** — the Remote Commander logo: a **secure shield** (encrypted credentials,
hardened web consoles, VPN) wrapping a **`>_` terminal prompt**, in the app's VS Code accent blue.

| Token | Hex | Use |
|---|---|---|
| Accent blue | `#007acc` | primary mark |
| Bright blue | `#1f9cf0` | shield gradient top |
| Deep blue | `#0069ac` | shield gradient bottom |
| Foreground | `#ffffff` | the `>_` prompt |

The logo also appears as **inline SVG** in the app's title bar
([TitleBar.tsx](../remoteCommander/src/renderer/src/components/layout/TitleBar.tsx)) and About dialog
([AboutDialog.tsx](../remoteCommander/src/renderer/src/components/AboutDialog.tsx)).

### Regenerating the app icons

The app icon PNGs (`remoteCommander/build/icon.png` 1024×1024 and `remoteCommander/resources/icon.png`
512×512) are rasterized from `logo.svg`. electron-builder generates the Windows `.ico` and macOS `.icns`
from `build/icon.png` at packaging time. To regenerate after editing `logo.svg`:

```bash
cd remoteCommander
npm install --no-save @resvg/resvg-js     # one-time, transient rasterizer (not a project dep)
node ../imgs/generate-icons.mjs           # rewrites build/icon.png + resources/icon.png
```

## Screenshots

![RDP CLI Split Screen VPN](rdp_cli_split_vpn.png)

![SFTP File Edit](sftp_edit.png)

