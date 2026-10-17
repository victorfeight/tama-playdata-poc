# Hosted games and Playdate outcomes — published preview

Application: `599b807fa7bbbdf41520c7c8089ed316406df7d6` on GitHub main.
SDK hosted-game source: `69277c1`. Original isolated outcome work `06b36c4`
is preserved by merge commit `4e96747`.
Published 2026-10-17 at 20:44:14 UTC after live room connections had closed.

## User-facing changes

- Playdate: confirmed framed abort returns both pages to preparation; normal
  exchanges contain no retry advice/button. Selected starter gets a decreasing,
  nonblocking B prompt; receiver freshly confirms and waits. No synthetic B,
  UART gating, or guessed save-completion state.
- Games: optional hosted 2–16-player rooms for Blocks Online and Pocket Puzzle
  Online, nicknames, public/private listing, ready/start, rounds/results and
  fresh-session rematch. Leave keeps the adapter connected. Direct two-player
  Versus is retained. The reproduced heartbeat/start admission race is fixed.
- New Puzzle payload: `4ccad84f0801f96b1bfde71565bf0731124a5e990693297cb43e74d7765e0f06`.
  Existing music bank and browser music/game sender remain compatible.

## Validation and exact boundary

Local and server Node 20.20.2 relay suites: 51 tests. Local shared protocol:
44 tests with explicit owned Kuchipatchi fixture at
`tama-tools/TamaHome-main/CROSSPLATFORM_TAMA/BuiltinItems/Ghosts/ghost_kuchipatchi.bin`.
The old standalone `TamaParadise-Licenses` path was absent; the first full run
failed for that fixture, then passed using the maintained checkout.
All TypeScript builds, Vite production build, and 117-file publisher hash checks pass.

Local SDK comparisons: 1,094 C/TS transport checks, 14 compiled-client scenarios
across 2/3/8/16 players, deterministic faults/delay/ties/disconnects. Full native
Pocket Puzzle firmware pairs pass direct/hosted modes with installed music on
the retained Glacier/Monster fixture. These are distinct from physical toys.

Against both isolated server staging and the public service:

- Ten Playdate browser groups, including legacy compatibility, abort/reprepare,
  both starter roles, timer expiry, replayed readiness snapshot, reconnect and
  mobile layout. UART is simulated.
- Both games: two browsers plus compiled SDK clients, actual HTTP/WS,
  two-round matches, final wins, fresh-session rematch and adapter-preserving leave.
- Public packaged music/game installation, write/skip verification, same-adapter
  relay handoff and unplug recovery, with simulated UART responses.

Evidence root: `TamaSuite-validation/hosted-mode-audit-20261017/`, specifically
`playdate-{integrated,server-stage,public}`, `{blocks,puzzle}-{server-stage,public}`,
`installer-public`, `native-host-final` and the two `puzzle-firmware-*` receipts.
Public tests use disposable test rooms and never touch a user's physical toy.

Physical two-human WAN testing remains required before increasing player count.
Sixteen protocol clients are not sixteen qualified devices. Full original-BIN
UART parity and all-edition gameplay are also still open. Silence/results/SYNC
cannot prove failure or saving; the outcome observer deliberately leaves them unknown.

## Deployment

Local package: `TamaSuite-validation/hosted-mode-audit-20261017/release-integrated/`.
Server package, matching source and receipt:
`/srv/game-demo/releases/hosted-outcomes-599b807/{web,source,deployment.json}`.
Existing database/settings retained; source fast-forwarded from `23b0b2d`.
The single Playdate nginx location adds `game-rooms` and `game-ws/`; a service
drop-in enables `HOSTED_GAMES=1`. Nginx config validation and backend/Gift health
checks pass. Gift service and desktop installer feeds are unchanged.
The existing publisher retains old hashed assets for already-open browsers.

Next requested phases remain unimplemented: ownership-verified browser music
removal; bounded live board/score telemetry; casual per-game high scores. Their
order and qualification requirements are in the SDK `ONLINE_UART_ROADMAP.md`.
