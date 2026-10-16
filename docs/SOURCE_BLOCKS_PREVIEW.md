# TamaHome Blocks source preview

This is the current entry point. [TETRIS_DEMO.md](TETRIS_DEMO.md) preserves the
earlier captured-binary transport experiment; its old device labels and test
limits describe that checkpoint, not the current source candidate.

The maintained game is in the SDK repository at
`sdk/paradise/examples/tetris-versus`. Reusable UART, TET3 framing/reliability,
the source reconstruction, native probes and RE evidence live there together.
Start at `sdk/paradise/research/tetris-versus/README.md`; `CONNECTIVITY.md`
records the recovered online feature inventory and deployment layout.

## Use the preview

1. Download Blocks from the packaged game-room page. Add/send its BIN through
   TamaHome Launchpad using Paradise's normal Download screen.
2. Disconnect in TamaHome and leave Blocks on its menu.
3. Connect the browser, create a room and share the six-character code. Your
   friend connects their toy and joins that code.
4. After the peer prompt, choose **Versus** on both toys. The game uses the same
   seed and plays first to two round wins. Keep the browser pages open.
5. A disconnect ends the room session. Reconnect/create a fresh room; on each
   toy return to the menu with C and choose Versus again once paired.

**Online** on the toy is a different, recovered external-coordinator protocol.
It accepts up to 16 players but is not served by this two-peer relay preview.
Physical two-device play and WAN behavior still need qualification.

## Build and package

```sh
pnpm install --frozen-lockfile
pnpm -r build
node scripts/package-game-demo.mjs /new/staging-directory \
  /path/to/source-sdk-build/app-build.json
```

The packager verifies application/route, BIN SHA-256, underlying build-receipt
SHA-256 and source-only declaration before creating its exclusive output folder.
The package contains `games/`, hashed `assets/`, a download manifest and a
package manifest recording frontend HEAD and dirty status. It never uploads.
Use a clean committed frontend for a publishable package. The source-build
receipt identifies SDK inputs independently; frontend HEAD is not SDK HEAD.

The browser uses activity ID `tamahome-blocks-v1`; another game's room is rejected
by its join flow. The shared relay remains a generic byte pipe. The UI guard is
not server-side anti-cheat or a cryptographic protocol boundary.

## Site placement

The `tama-tools` gateway already links Live Playdate and Trade under “Multiplayer
& full app”. Add an Online Games card there once the preview is published.
The proposed first URL is `https://playdate.bbamorachi.us/games/`.

Read-only inspection on 2026-10-16 verified SSH alias `playdate` reaches
`vic@24.199.69.115:222`. Nginx serves `/srv/playdate/web-client/dist`; rooms,
WebSockets and health proxy to `playdate-relay.service` on localhost:3001.
The existing relay checkout is `a2cee39`, and health was OK. Trade is a separate
service on port 3002. Build locally; the server need only serve static assets
and forward bytes. No additional DNS or daemon is required for this preview.

For deployment, verify the package manifest, copy only the game directory and
its new hashed assets, preserve the root Playdate HTML and existing assets,
and publish the game entry HTML last. Check `/health`, existing Playdate and
Trade, `/games/`, payload hash, room creation and two-peer forwarding. Do not
describe a local package or read-only server audit as a production deployment.

## Test evidence

The SDK native pair probe has completed a source-game first-to-two match,
automatic second round, identical seeds/player assignment and loss detection
using retail Download, physical button events and the real local relay.
Rules/audio have separate differential comparison against captured ARM code.

The frontend build passes; all 11 relay and 14 protocol tests pass with the
private ghost fixture supplied via `TAMA_GHOST_FIXTURE`. The browser smoke test
uses actual Chromium with explicitly simulated UART/room endpoints and covers
download, gating, invalid/incompatible join, room/peer state, binary forwarding,
disconnect/reconnect/leave and a 390px layout without horizontal overflow:

```sh
node scripts/test-game-browser.mjs http://127.0.0.1:5176/games/ /new/browser-evidence
```

It needs Playwright installed separately; `PLAYWRIGHT_MODULE` can point to its
module without adding a production dependency. It is not a physical USB test.
The native pair and browser UI tests are complementary, not one combined
hardware/WAN qualification. The captured-reference probe remains available as
`scripts/probe-native-game.py`; use the SDK probe for rebuilt source payloads.

UI research references: [Retris](https://github.com/frgarciames/retris) for a
separate deterministic engine/theme layer and
[Rustris](https://github.com/kkoishichan/Rustris) for compact versus/rematch UX.
No source or assets from either project were imported.
