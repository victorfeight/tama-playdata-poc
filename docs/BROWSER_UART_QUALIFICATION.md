# Browser music/game installation qualification — 2026-10-17

Native qualification below is not a physical-device receipt. The application
was published at `4c98c65`; see `releases/2026-10-17-lobby-uart.md`. The game remains
two-player direct relay; hosted 2–16-player matches are a separate open phase.

## Tested path

The actual `GameInstallService` sends the source music helper through retail
Download, streams the approved bank, verifies completion, releases its serial
ownership, then sends Pocket Puzzle through retail Download on the same open
adapter. The user presses C and reopens Download between music and game.
No firmware restore, CLI, Python installation or TamaHome handoff is required.
The page does not pretend this helper supports the animated flasher's X command.

`scripts/test-browser-installer.mjs` exercises the packaged page in Chromium
with simulated serial replies, including 248 sectors, existing-sector skips,
the same-connection relay handoff and 390px layout. The final run also unplugs
during a send, checks that connected state clears without additional writes,
then reconnects and sends successfully. Evidence:
`TamaSuite-validation/browser-uart-20261017/browser-3/browser.json`.
Initial browser testing
found an unbound-fetch `Illegal invocation`; the service's default fetch is now
called without the service object as its receiver.

`scripts/test-native-installer.ts` runs the same service against
`scripts/native-install-peer.py`, a JSON-lines adapter to the SDK's canonical
native emulator. It uses actual firmware menu/button inputs, actual UART and
actual helper/game instructions. No injected ACKs, app-state writes, flash
injection, semantic accelerators or IDMA-start acceleration are used.

Native run: `TamaSuite-validation/browser-uart-20261017/native-3/`.
`service.json` and `native.json` pass:

- All 248 music sectors written and verified; complete final MiB matches target.
- All bytes below the final MiB unchanged during streaming.
- C restores stock PRAM; complete flash after return matches independent stock boot.
- A second actual retail Download delivers the exact Pocket Puzzle bytes.
- Game menu runs with audio ready/active, 33,608 samples, zero underruns or empty ticks.
- Maximum simultaneous serial readers: one.

| Input | SHA-256 |
| --- | --- |
| Reviewed populated Monster Glacier firmware (private) | `39f3e762fb29e5f57e15a5f4538c1fbb0673bfbf09e01ab4bdf0ea857b489eb8` |
| Source music helper | `4f4ca8646fedda5bf8a9e16bdccf47c8d65d38736d0aac9d4c6fd971949ae886` |
| Music bundle | `e20837ed3f23dbb0a015aada69a615dbaaab4de5dffe3ca31fe73a3a19d31674` |
| Pocket Puzzle candidate 7 | `abe48efeec09e7d0f331b57e915b55ac8daa177508c60efaa88b6d5618e6da7d` |
| Native library | `5cd47978ad835c84d72246e1601d3f56ab723b0536a9bfdae936abd19225ed43` |

## Reproduce

Build the protocol package, then build/package the web app using the existing
receipt verifier with `--full-web --music-stream=SDK_MUSIC_DIRECTORY` and both
game build receipts. For Chromium, run:

```sh
node scripts/test-browser-installer.mjs http://localhost:PORT/games/?game=pocket-puzzle OUTPUT
node --import ./relay-server/node_modules/tsx/dist/loader.mjs \
  scripts/test-native-installer.ts PRIVATE_CONFIG.json PACKAGED_SITE OUTPUT
```

The private config contains local paths named `sdk` (repository root),
`firmware`, `library`, `nm`, `python`, and `gameElf`. Use the populated firmware
above for the recorded Glacier navigation sequence; a factory-clean fixture
does not have the same menus. Do not upload firmware or private configs.
The Python environment needs the SDK native dependencies/Pillow; ARM `nm` must
match the ELF and its runtime libraries must be available.

## Remaining limits

Physical browser/USB transfer and two-human WAN testing remain open. This
Glacier run does not qualify every firmware/save state. Simulated unplug tests
check immediate stopping, no blind write retries and fresh connection handling;
they do not establish power-loss atomicity. Partial-sector corruption is not
automatically repaired: the helper retains its FF-or-exact ownership refusal.
Do not label a stopped transfer verified or promise that every interrupted bank
can resume. Preserve the exact device message and examine its state first.
