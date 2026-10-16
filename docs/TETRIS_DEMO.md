# Multiplayer game demo and integration plan

Historical captured-binary checkpoint. For the current rebuilt payload,
instructions, packaging and site architecture use
[SOURCE_BLOCKS_PREVIEW.md](SOURCE_BLOCKS_PREVIEW.md).

2026-10-16. Based on current `victorfeight/tama-playdata-poc` upstream
`a2cee3923f51670abaf53df4741d073dd468ffb2`. This branch is a bounded transport/UI
prototype. It is **not** the finished source reconstruction of multiplayer Tetris.

## What is runnable

The existing relay serves the same room API and WebSocket byte pipe. A second
web entry point at `/games/` reuses its current serial transport, relay client
and serial bridge. It provides connect/disconnect, create/join room, copy code,
round/match status and a bounded diagnostic log. The game observer reconstructs
TET3/COBS/CRC32 frames from arbitrary read boundaries; it never changes, answers
or gates game packets. No captured executable is bundled in the website.

```sh
pnpm install --frozen-lockfile
pnpm --filter @tama-breed-poc/tama-protocol build
# terminal 1: unchanged upstream relay
pnpm dev:relay
# terminal 2
VITE_RELAY_URL=http://localhost:3001 pnpm dev:web
```

Open `http://localhost:5174/games/`. With two devices:

1. Send the privately supplied multiplayer payload through TamaHome's normal
   Download flow. Leave the game on its main menu.
2. Disconnect the port in TamaHome, connect it in the demo, and create/join a room.
3. Once both browsers report the peer, choose LOCAL 1VS1 on both toys. If either
   toy was already waiting in multiplayer, use its A/retry action on both sides.
4. Keep the page open. The toys coordinate the match; the server forwards bytes.
5. A disconnect ends this demo session. Reconnect into a fresh room instead of
   silently attaching an old game state to a replacement peer.

These manual Download/disconnect steps are prototype boundaries. The finished
bbamorachi-tools flow should own the entire session with one connection.
The demo's physical two-device path still needs user testing.

## Validation and reproducibility

The [validation receipt](tetris-demo-validation.json) records 11 relay tests,
14 protocol tests and the captured pair's successful round start through a real
loopback HTTP/WebSocket relay. Both guests reached player 0/1, round 1, identical
seed/session, stayed in play, and reported link loss after the relay was cut.
The production multi-page build passes. Browser hardware interaction, WAN
latency, full-match attacks/results and a rebuilt game are not covered.

```sh
pnpm --filter @tama-breed-poc/relay-server test
# Existing ghost fixture is private; override the historical machine-specific symlink.
TAMA_GHOST_FIXTURE=/private/ghost_kuchipatchi.bin pnpm --filter @tama-breed-poc/tama-protocol test
python scripts/probe-native-game.py --sdk-root /path/to/sdk-repo \
  --driver /path/to/TamaSuite/tools/fields_native_probe.py \
  --library /path/to/libparadise_native.so --firmware /private/Glacier-populated.bin \
  --payload /private/tetris-new-tc.pdlo.bin --output /new/probe-output \
  --relay-url http://127.0.0.1:3001
```

The Python probe pins the capture hash because its state addresses are specific
to that binary. It needs the existing native-driver dependencies and an owned
Glacier Download-navigation fixture. It clones the successfully loaded machine
state for the second toy; it does not patch the game to start a round.

## Captured reference, not a claim of recovered original source

Input: `Desktop/Paradise Captures/tetris-new-tc/tetris-new-tc.pdlo.bin`.
SHA256 `657be002dab1a79bc5da688c36cf19f547f4c1b5984345425ba4b93cc289b37c`.
The full private analysis is in
`TamaSuite-validation/tetris-new-tc-20261016/`:
`README.md`, `GAMEPLAY.md`, `PAIR_RESULTS.md`, disassembly/decompilation,
hash-pinned extraction, captured wire, SRAM/PRAM dumps and screenshots.

The runtime has a shared FUP7 outer and the same three bundled firmware-prefix
hashes as the earlier Pearly Gates reference. Its actual game stages differ:
5,652 bytes at PRAM 9700..AD14 and 10,428 bytes at B000..D8BC. We decoded and
checked the streams rather than applying another payload's hardcoded extractor.

Recovered rules include seven-bag generation, hold, kick-based rotation,
500-ms lock delay, grounded adjustment limit, level/gravity tables, normal and
T-spin scoring, B2B/combo/perfect-clear behavior, garbage cancellation/delay,
local first-to-two rounds, and UART sequencing/retries. Exact code addresses
and tables are in the private gameplay report. Full gameplay equivalence is
not established by these static findings or by a successful handshake.

TET3 messages are 36 decoded bytes, 39 framed bytes, at UART 460800/8N1. Local
mode elects the lower nonce as host and derives the session by nonce XOR. The
host supplies seed/round/player assignment and coordinates results. Online
mode expects an external host; it is unnecessary for the first peer-hosted
internet 1v1. The website does not need to simulate the game or stream video.

## FUD1 decision

Current SDK baseline: `tama-paradise-progress-repair` main
`fcb9b4da681ad2fcb06e0b27bb0d8deb7818a5ed`.

Source FUD1 is the preferred production route for our small Download games:
source-built loader stages, installed-firmware recovery, shared reviewed edition
identification and existing packaging/reset machinery. FUP7 remains a legitimate
bundled-firmware experiment/oracle. It still packages vendor firmware and mixes
that bundled PRAM with installed XIP services. Calling it universally inferior
would conceal those different contracts.

FUD1's corrected edition identification handles populated Gen2 saves and checks
the recovered family before hooks. Its application windows are discontinuous:
9700..B000 and C000..F838, 20,792 bytes total. The reference uses B000..BFFF,
so copying its expanded bytes into FUD1 is not a port. Reconstruct/relink rules,
presentation and protocol against the SDK, then inspect actual map/compression.
The 16,080-byte reference total is encouraging, not proof the new build fits.

The renderer pumps UART/input/audio after every LCD row. A port must preserve
bounded servicing latency. `paradise_ticks()` is a foreground counter; choose
an explicitly owned elapsed timer for network deadlines. Extend reset quiescing
for the UART owner rather than assuming the tone-only portable exit covers it.

Relevant SDK docs: `APP_DEVELOPMENT.md`, `FIRMWARE_IDENTIFICATION.md`,
`FUP7_SOURCE_UTILITIES.md`, `PORTING_GAMES.md`, `LEGACY_PARA_FLAP_PORT.md`.
Para Flap is the reconstruction precedent: recover observed rules/timing/assets,
replace coupled firmware imports with SDK services, then verify parity.

## Recommended product home

**Games in bbamorachi-tools**, with a room URL that can be shared or bookmarked.
Keep a standalone preview during development; do not create another permanent
copied UART app. TamaHome can offer an Online action on the same game cards and
later use the same room protocol natively.

The web-tools checkout already has browser serial/WebUSB, a global connection
manager, Download sender and library-style routes. Its current connection path
immediately starts a stock TcpComm reader. Therefore the key shared change is
an exclusive session owner with explicit transitions:

```
disconnected → connected → sending payload → waiting for game → room ready
                                                         → playing → ended
```

Only one reader may consume the port. Finish/cancel the Download transaction,
release its parser without accidentally closing the owned port, then attach the
game's binary protocol. Route changes and disconnects must stop both serial and
network tasks. Reuse existing WebUSB adapter drivers and Download sender;
do not copy their implementations into a game route.

User flow: **choose game → connect → send to Paradise → create/join room → play
→ rematch or leave**. Show progress, peer readiness and a readable connection
error; keep loader, protocol and firmware-family details in diagnostics.
Room start must verify compatible game/rules versions, not just a shared baud.

## Keep the payload catalog broad, capabilities precise

| Payload family | Sensible first integration |
|---|---|
| Reconstructed Tetris | Peer-hosted live 1v1; shared seed and match rules |
| Tiny Snake / Para Flap / other small games | Offline launch first; seeded challenges/results only after a source protocol is added |
| MineAssemble | Offline launch; do not promise co-op without world/state synchronization |
| Workshop / Progress / Money Bags | Firmware-service utilities, not multiplayer games |
| Pinball / Monster | Existing resident/install contracts; optional scores later, not forced into the small FUD1 Download profile |

Keep one game identity/version/payload hash/provenance record, with capabilities
such as offline, versus, challenge or scores. Extend the existing card/catalog
workflow at its shared boundary when implementing this; do not create a second
unrelated list of downloadable binaries in the room server. Server access can
be independent of Store download authorization while preserving existing asset
distribution rules. No submissions workflow is needed for this demo.

## Concrete flaws found

- **Serial EOF:** old WebSerialTransport returned an empty array on stream end;
  SerialBridge's loop could immediately read again forever. The prototype throws
  a disconnect error and has a focused test.
- **Activity mismatch:** room `app` was a metrics tag, not a join restriction.
  The demo validates the returned activity before opening a socket. This is a
  client UX guard, not a new server authorization boundary. Production needs an
  explicit compatible-game/rules contract for web and desktop clients.
- **Stale session bytes:** the captured peer protocol can choose obsolete HELLO
  nonces when pre-connection bytes are replayed. Preserved negative and positive
  native tests show the difference. Require a fresh session boundary/retry.
- **Two serial owners:** current web-tools TcpComm cannot coexist with a game
  bridge on the same reader. Design the handoff once in the connection layer.
- **Timing:** 150-ms retransmission and five-second failure are the reference's
  behavior. Internet RTT/jitter and browser scheduling require qualification,
  especially with attacks; a localhost handshake does not prove that budget.
- **Buffering:** the current upstream relay forwards without an explicit
  application-level `bufferedAmount` cap; review bounds before continuous game
  release. Keep generic hardening separate from game rules.
- **Documentation/fixtures:** deployment guides contain obsolete shared-secret
  steps and a wrong gift path; existing ghost tests depend on a stale local
  symlink. Test fixtures now accept `TAMA_GHOST_FIXTURE` without packaging them.

## Reconstruction milestones

1. Preserve reference, extraction and exact mechanics/protocol vectors (done as
   research; renderer/audio equivalence and whole-match qualification remain).
2. Exercise the captured pair through the real relay (demo evidence), then
   latency/loss/reconnect scenarios and two physical toys.
3. Build the source game with separated deterministic rules, UI/assets and
   game protocol. Source FUD1 plus shared SDK UART/elapsed-clock/reset contracts.
   Compare captured and rebuilt state transitions, timings, attacks and results.
4. Integrate the exclusive Download-to-game handoff into bbamorachi-tools;
   reuse the existing card/Store provenance and same relay for web/TamaHome.
5. Qualify six editions, real devices, exit/boot/save preservation; then publish
   a new card/build through the existing release workflow. Internet match
   history, challenge boards and multi-player coordination can follow.

Do not describe the current browser preview as a fully reconstructed game.
The toy payload in the present oracle tests is still the supplied FUP7 binary.
