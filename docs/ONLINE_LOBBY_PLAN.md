# Shared online lobby: implementation and qualification

The wider active checklist, including browser UART sending, managed UART v6
reconciliation and retained-helper reconstruction, is maintained in the SDK:
`sdk/paradise/docs/ONLINE_UART_ROADMAP.md` (tama-paradise-tetris-versus worktree).

Requested 2026-10-17. This supersedes the older invite-only/no-public-listing
scope in the SDK external-host design. The published baseline at `4c98c65` is TWO-player
Games plus the repaired stock Playdate relay, reached directly from tools.

## Phases

1. Shared bounded TET3 endpoint and pure match coordinator. Preserve the captured
   codec and C SDK contract; one reliable session per toy. Keep game policy
   (Blocks rows vs Puzzle panels) separate from membership and round timing.
2. Shared lobby service: nicknames, public/private discovery, per-seat credentials,
   owner/start controls, clean departure/expiry, and separate browser/device
   readiness. Stock Playdates remain pairs; no packet conversion or invented ACKs.
3. Extend the existing Playdate page (`web-client/index.html` and
   `web-client/src/main.ts`) with nicknames, public/private rooms, room discovery,
   and each player's connection state. Preserve its ghost scene, live exchange,
   connection controls, and existing visual style. Keep game rooms on their
   separate `/games/` page, reached directly from the tools homepage. Share lobby
   membership and transport code underneath the two pages. First-to-two games
   target 2–16 players; stock Playdate rooms remain pairs.
4. Qualify parser/session parity, sixteen-seat matches, attacks and elimination,
   isolation/replacement/loss, browser flows, and multiple actual native machines
   through the real service. Physical WAN/device results remain distinct.
5. Integrate/push matching SDK and server source, package verified game/setup
   downloads, stage before publishing, verify public hashes/rooms and homepage.

## KISS boundaries

Reuse the existing Fastify/WebSocket process, WebSerial ownership and protocol
workspace. Keep legacy `/sessions` and `/ws/:code` intact. New lobby routes live
under `/sessions/lobby` and `/ws/lobby/:code`, already covered by nginx routing.
Rooms are bounded ephemeral state, not accounts: a restart ends active matches.
No chat, ranks, Redis, board simulation or full firmware flashing.

The host selects one living target per attack, never broadcasts garbage. Freeze
indices for a match, preserve unsigned packed wins through seat15, use an
explicit settlement window, and keep ACK/retry/heartbeat service running during
countdowns/results. A dropped toy forfeits; no fictional mid-match resumption.
The complete transport contract and original-artifact evidence remain in the
SDK's `sdk/paradise/research/tetris-versus/EXTERNAL_HOST_DESIGN.md` and `net/`.

Do not label the baseline or partial implementation as a finished16-player mode.

## UI boundary clarified with the user

The request for a separate games page did not request moving Playdates to a
new combined destination. Existing Playdate links should continue to land on
the Playdate page, with its lobby integrated there. The tools homepage retains
direct entries for Playdates and games; neither activity requires navigating
through the other. Share service/client logic where it is actually common,
while keeping stock Playdate instructions and game match controls in their
respective pages.

Browser qualification must cover discovery, private-code joining, reconnects,
and player status on the existing Playdate page alongside its ghost/exchange
display. Adapter connection must not be presented as proof that the stock toy
is ready. The lobby must not change the firmware's tested host-waits/guest-B
exchange ordering or introduce a browser start gate into the raw byte relay.

The published implementation exists in `relay-server/src/lobby.ts`,
`web-client/src/lobby-client.ts`, and `web-client/src/ui/stock-lobby.ts`.
The existing Playdate page hosts the UI. Five membership tests and the real
local two-browser flow pass, including simulated bidirectional UART, private
and public joining, disconnect/reload/leave, and 390px layout. Evidence is in
`TamaSuite-validation/playdate-lobby-20261017/browser/`.

Browser/legacy interoperability now passes in both directions: a browser-created
lobby accepts a desktop guest with a guest-only token; a browser joins a
desktop-created room using its unchanged legacy contract. Repeated legacy token
pickup is stable, browser-owned seats cannot be taken through legacy routes,
and old clients receive only their existing presence text plus binary UART.
Their adapter status is explicitly unknown. Evidence:
`TamaSuite-validation/playdate-lobby-20261017/compat-browser-4/browser.json`.
Reproduce with `scripts/test-playdate-lobby-browser.mjs PAGE_URL OUTPUT RELAY_URL`.

The relay suite passes 32 tests before the additional unplug regression.
Local browser/native music-install qualification is recorded in
`BROWSER_UART_QUALIFICATION.md`. Both lobby and installer were published at `4c98c65`.
Server Node 20 staging passes the full browser flow and the existing game
transport probe; see `releases/2026-10-17-lobby-uart.md`. Physical two-player/WAN
testing remains open. At that release the 2–16-player host endpoint was a
non-exported draft; neither page silently enabled that mode.

The compatibility run exposed legacy reconnects sharing the ten-request default
limit with creation. Joining and WebSocket reconnects now use the existing lobby
allowance of 60/minute; creation keeps ten/minute. Inspection also found the
previous live server had no trusted proxy configuration, so all nginx visitors were
counted as loopback. `RELAY_TRUSTED_PROXIES` now permits an explicit trusted CIDR
chain (default loopback only). Tests cover visitor isolation, forged leftmost
headers, untrusted direct callers, and creation limits after repeated joins.
Production now uses the reviewed Cloudflare ranges; see
`relay-proxy.env.example`. The service environment was updated during publication; nginx was unchanged.

## Shared starter and ready prompts

The subsequent switchable starter/ready flow and diagnostic logs are live at
`23b0b2d`; all eight public browser check groups pass with simulated UART. See [the flow and incident record](PLAYDATE_START_FLOW.md).
The successful retry after dongle reconnect does not establish a role restriction
or fix the unresolved adapter/device recovery issue.

## Hosted implementation, published preview 2026-10-17

The endpoint is now exported and the existing service has opt-in
`HOSTED_GAMES=1` routes `/game-rooms` and `/game-ws/:code`. Published preview:
`599b807`. `hosted-match.ts` owns pure round/target/result policy;
`game-rooms.ts` owns credentials and connection lifetimes;
`games/game-room.ts` reuses `SerialBridge` and the separate Games page.
No changes to stock Playdate UART forwarding are required.

Both Blocks Online (mode 4) and the new Pocket Puzzle Online (`0x50500202`) use
the host. Direct two-player modes remain separate. The new Puzzle BIN is required;
the live package includes that candidate. Attack routing, tie settlement and
forfeit rules are ours; the original private site's policies remain unknown.

Implemented: private/public rooms, 2–16 distinct seat credentials, owner start,
toy/browser readiness, exact seed barrier, countdown, one-recipient attacks,
alive masks, first-to-two results, bounded slow-peer handling, and explicit
fresh-session rematch. Leaving keeps the adapter connected. Mid-match joining
and board resumption are deliberately unavailable. A reproduced heartbeat/start
race is fixed: queued lobby/heartbeat ACKs do not revoke readiness; the round's
preparation barrier drains them in order.

Qualification: 49 relay tests; 1,094 SDK C/TypeScript endpoint comparisons;
14 compiled-client scenarios across 2/3/8/16 players including latency/loss,
ties and disconnects. Two-browser checks exercise actual HTTP/WS with simulated
WebSerial and compiled C clients. The SDK's native Pocket Puzzle probe also
passes actual firmware UART play with installed music and a direct-mode regression.
Physical devices, WAN, sixteen firmware instances and full captured-binary serial
parity remain unqualified. SDK reproduction and receipts:
`sdk/paradise/net/tests/hosted/README.md`; local audit root
`TamaSuite-validation/hosted-mode-audit-20261017/`.

Build `tama-protocol` before starting the service: it imports compiled workspace
exports. Test source imports alone cannot prove the running server is current.
The packaged new BIN and both games passed server Node 20.20.2 staging; nginx
now routes both new paths with `HOSTED_GAMES=1`. Public match/rematch browser
checks pass for both games. Installer auto-update feeds were not changed.
See [the release receipt](releases/2026-10-17-hosted-outcomes.md).

## Following hosted-match qualification

User-requested order (2026-10-17): browser removal of the verified music bank;
then source-client live board/score telemetry for Blocks and Pocket Puzzle;
then small, separate per-game casual high-score tables in existing SQLite.
No browser audio. These are not part of the recovered TET3 device protocol.
The SDK `docs/ONLINE_UART_ROADMAP.md` records ownership/removal safeguards,
telemetry bandwidth/queue boundaries and device-reported score limitations.
Finish match lifecycle/reconnection qualification before adding visual traffic.

Named direct Versus and hosted Online now share this room UI and membership
service. See [mode clarification and validation](releases/2026-10-17-game-room-modes.md).
