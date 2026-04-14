# GlassForge

> A fast, glassy Linux GUI for Claude Code. Wraps the `claude` CLI in a Tauri 2 app with live session streaming, usage tracking, and KDE Plasma 6 blur integration.

**Status:** early development — see [the execution plan in CLAUDE.md](./CLAUDE.md).

## Why

Claude Code is great in the terminal. On Linux, the window around it isn't. GlassForge gives you:

- Multiple live `claude` sessions in one window, each in its own PTY.
- Token / context / cost / limit tracking surfaced in a sidebar you actually want to look at.
- A theme editor that lets you tune blur, glow, accent, and transparency without touching a config file.
- Native KDE Plasma 6 window blur via `_KDE_NET_WM_BLUR_BEHIND_REGION` — no xprop hacks.

## Requirements

- Claude Code CLI installed and on `PATH` (`claude --version` should work)
- Linux with a WebKitGTK-capable desktop (KDE Plasma 6 tested; GNOME works without blur)
- For building from source: Node.js 20+, Rust stable, and the system packages listed in `scripts/install-deps.sh`

## Install

Prebuilt releases will land in GitHub Releases once v0.1.0 is tagged. Until then:

```bash
git clone https://github.com/<user>/glassforge
cd glassforge
pnpm install
pnpm tauri dev
```

## License

MIT. See `LICENSE`.
