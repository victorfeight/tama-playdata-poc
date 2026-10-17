# Playdate lobby and browser UART release — published

Application: `4c98c6584643d746980d197fc0305727685d1c54`, on GitHub main.
SDK reconciliation/evidence: `7180096cf2d47ab399640964e796b4ad61fef5aa`, on GitHub main.
Later docs/test-only commits do not change these packaged applications.

## Qualification

- Relay suite: 32 tests; subsequent installer suite: 8 tests including unplug
  (33 distinct relay/service tests across those runs).
- Shared protocol: 34 tests, including private Kuchipatchi decoding, six-family
  preview geometry and EOF. All three TypeScript projects build.
- Packaged Chromium music/game flow: write/skip sectors, single serial reader,
  multiplayer handoff, unplug/reconnect and 390px layout pass.
- Actual browser service against native populated Glacier: 248 verified sectors,
  protected flash unchanged, ordinary-stock-equivalent C return, second retail
  Download and Pocket Puzzle audio without underruns pass.
- Browser lobby flow against isolated **server Node 20.20.2** through SSH:
  public/private rooms, raw UART bytes, reload/leave, mobile layout and both
  legacy desktop/browser host directions pass. The test now waits for room
  creation and first serial data rather than assuming localhost response times.
- Existing two-player game admission and bidirectional bytes pass on staging.
  The 2–16-player endpoint remains a non-exported, unqualified draft.
- Local and server publisher verification accept all 117 files and the clean
  source commit. No private firmware, configs or test dumps are packaged.

Evidence: `TamaSuite-validation/playdate-lobby-20261017/server-stage-3/browser.json`,
`server-game-probe.json` in its parent directory, and
`TamaSuite-validation/browser-uart-20261017/{browser-3/browser.json,native-3/service.json}`.

## Prepared artifacts

Local: `TamaSuite-validation/browser-uart-20261017/release-4c98c65/`.
The production build uses `https://playdate.bbamorachi.us`, not localhost.
Server: `/srv/game-demo/releases/lobby-uart-4c98c65/web/`.
Isolated source: `/srv/game-demo/releases/lobby-uart-4c98c65/source/`.
Its separate database is `../staging.sqlite`; never copy it into production.

## Published baseline

Published `4c98c65` on 2026-10-17. The Playdate service and both public pages
now use that application. Existing environment/database were preserved; reviewed
trusted-proxy CIDRs are active. Gifts were not changed or restarted.
The user explicitly requested publication; the one pre-existing waiting client
was accounted for before the short restart. Server receipt:
`/srv/game-demo/releases/lobby-uart-4c98c65/deployment.json`.

Public two-browser lobby and legacy compatibility tests passed, as did the
public browser music/game flow with simulated UART and live two-player game
transport probe. Evidence: `playdate-lobby-20261017/live-browser/browser.json`,
`live-game-probe.json`, and `browser-uart-20261017/live-browser/browser.json`
under `TamaSuite-validation`. These do not establish physical reliability.

The subsequent physical Playdate attempt failed with 99 incoming/zero outgoing
bytes; the user later reported success after reconnecting the dongle. Root cause
is unresolved. The separate starter/ready UI and diagnostics are locally
qualified, not published: see `../PLAYDATE_START_FLOW.md`.

Physical browser/USB installation and two-human WAN gameplay remain open.
The live game page supports music/game installation and solo play without
another player. Online matches still require a second toy.
