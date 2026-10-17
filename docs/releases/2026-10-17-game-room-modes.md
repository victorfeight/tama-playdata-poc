# Named game rooms and mode guidance — release candidate

Local implementation and qualification complete; deployment requires the current
live room to finish before restarting the relay. This file is not proof of a
production publication. SDK main: `ae94ad9`.

## What changes for players

- Both games share named public/private rooms, invitations, player cards and an
  adapter-preserving Leave room action for **Versus** and **Online**.
- **Versus · direct, 2 players:** join together, then choose Versus on both toys.
  The toys start the match; the room owner need not be the protocol's toy host.
- **Online · hosted, 2–16 players:** choose Online on each toy, click I'm ready
  after its handshake, then the room owner clicks Start match.
- CRC-valid toy HELLO frames identify a wrong menu or different game/version
  and give contextual correction. No synthetic input or packet rewriting.
- Direct peer loss stops both old sessions and offers explicit fresh-session
  reconnect. USB failure clears the Connected indicator instead of stranding
  the user behind a stale state. Names appear in the direct score display.
- The manual BIN download link is removed. The browser sender still needs the
  static assets, which remain publicly retrievable. This is not access control.
  Login/license gating requires a separate product choice and implementation.

## Diagnosis and source boundaries

Versus and Online use different HELLO mode words but identical initial waiting
text on the toy. Mode mismatch is silently ignored by the source transport.
This reproduces indefinite waiting; it does not establish the exact cause of
the user's particular physical attempt. Their originally selected room mode
and complete adapter traces were not supplied.

SDK `docs/GAME_ROOM_MODES.md` identifies both games' C paths, mode words and
reproduction commands. `net/tests/hosted/clients.h` now accepts an optional
direct flag; default hosted behavior is preserved. No firmware or music bytes
changed. Existing payloads remain Blocks `59322650c915…` and Puzzle `4ccad84f0801…`.

One `GameRoomHub` handles membership. Direct rooms forward unchanged peer bytes;
hosted rooms retain their existing per-toy sessions and match engine. One
`GameRoom` UI uses the existing SerialBridge and sender. The superseded separate
direct page flow was removed; legacy `/sessions` remains compatible for already
open clients. Stock Playdate readiness/B/outcome behavior was not changed.

## Validation

- All 53 relay tests pass, including new direct capacity, mode mismatch,
  credentials, byte forwarding, peer-loss and backpressure checks.
- Shared/server/web TypeScript checks and production Vite build pass.
- Blocks and Puzzle each complete direct and hosted two-round matches through
  two actual browsers, HTTP/WebSocket and their compiled C multiplayer clients.
- Fragmented wrong-mode HELLO gives correction; returning to the correct mode
  recovers. Hosted ready/start/results/fresh-session rematch passes.
- Public named room listing, direct join-by-list, leave/rejoin with fresh native
  sessions and the same USB adapter pass. Simulated UART read failure clears
  the indicator and stops the peer session.
- Browser music verification covers 248 sectors with write/skip replies, game
  sending and room handoff through one open adapter, plus unplug recovery.
- 390px viewport has no horizontal overflow; screenshots retained.

Evidence: `TamaSuite-validation/game-room-usability-20261017/`, including
`relay-tests.log`, `{blocks,puzzle}-{hosted,direct-final}/browser.json`,
`puzzle-direct-unplug/browser.json` and `installer-r2/browser.json`.
USB responses/top-outs are simulated; these are not two physical players or
sixteen qualified devices. Two-human WAN retest remains required.

## Release procedure

Build with the production origin (no local VITE_RELAY_URL), package both pinned
payload receipts and the existing reviewed music stream with `--full-web`.
Verify using `scripts/publish-web-release.py` before publication. Backend and
frontend must be released together because direct named rooms need the new
`mode` capability. Existing hosted clients may omit mode (defaults hosted).
No nginx route change or new service is needed. Preserve DB/settings and old
hashed assets. Confirm active user rooms are finished before the service restart.
