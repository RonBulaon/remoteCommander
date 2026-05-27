# Remote Commander — Markdown Test

This file exercises the built-in **Markdown viewer**. If it renders nicely, the
*formatter* is working. Toggle **Raw** in the toolbar to see the source.

## Headings

### H3 looks like this
#### H4 looks like this

## Text styles

- **Bold**, *italic*, and `inline code`
- A [link to the local JSON test](sample.json)
- An [external link](https://www.example.com)
- Nested formatting: a **bold word with `code`** inside

> Blockquote: device consoles often live on isolated management networks,
> which is exactly why the Web Console supports proxies and jump hosts.

---

## Ordered runbook

1. Open the Web Console profile
2. Navigate to the device URL
3. Authenticate
4. Check the interface status

## Code block

```bash
# Open a SOCKS tunnel through a bastion, then hit the device API
ssh -D 1080 bastion.example.com
curl -k https://10.0.0.2/api/status
```

## Intentionally unsupported

The compact renderer does **not** do tables — the next block should appear as
plain text, not a grid (see the README note):

| Interface | VLAN |
|-----------|------|
| Gi1/0/1   | 10   |
| Gi1/0/2   | —    |

That is expected behavior, not a bug.
