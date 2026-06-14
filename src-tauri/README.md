# Loom desktop shell (Tauri) — bookmark (D2.4, v2)

This is a **bookmark**, not a built desktop app. MVP (v1) ships Loom as a local
server + browser: `loom serve` boots the Bun host (Hono API + web on localhost)
and opens the browser.

**v2 plan** (when desktop is prioritised):
1. Add Tauri (Rust shell) + `@tauri-apps/cli`.
2. Run the Bun host as a **sidecar** (`externalBin`) — it's the same `loom serve`
   process exposing the localhost API.
3. Point the Tauri **webview** at `http://localhost:<port>/` (the built `web/dist`).
4. Flip `bundle.active` to `true` and produce installers (dmg/msi/AppImage).

`tauri.conf.json` here holds the window/identifier scaffold so v2 starts from a
known shape without touching the host.
