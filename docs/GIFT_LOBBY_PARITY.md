# Gift lobby parity — 2026-10-17

## Phases and architecture

1. Reconcile existing Gift fixes and retain evidence. Gift's local checkout is
   based on `669d0f0`; most modified paths only change executable bits. Preserve
   that checkout. Its substantive reader handoff, binary-only UART and replaced
   socket guards already exist in this maintained Playdate/Games implementation.
   Run their regression tests rather than copying the older lifecycle back.
2. Share the stock lobby shell, client, server hub, adapter lifecycle, nickname
   policy, readiness, code/invite copy, logging and CSS. Gift-specific code is
   only its packet interpretation, catalogue and item scene. Keep the existing
   Playdate entry and separate Games page. Add `/gifts/` for development/build;
   publish that entry at `https://trade.bbamorachi.us/`.
3. Run shared lobby tests for both activities, Gift packet/outcome regressions,
   and the same real two-browser harness against both local services. Check
   small screens, role swaps, fresh readiness, timeout, reconnect, leave,
   legacy desktop compatibility and unchanged binary forwarding.
4. Prepare an independent Gift release, preserving the live Playdate/Games
   service. Qualify a real Gift exchange through selection, confirmation and
   both resulting inventories before calling the one-B full-trade path proven.

## One source, separate deployments

Canonical source: `victorfeight/tama-playdata-poc` (this repository). This avoids
copying an entire lobby/USB stack back into the historical Gift repository.
Both existing domains can run this same source revision with separate ports,
databases and `STOCK_ACTIVITY=playdate|gift` (default Playdate). Gift keeps port
3002 and its existing database; Playdate remains port3001. Do not point a Gift
frontend at the Playdate service. Do not enable `HOSTED_GAMES` on the Gift unit.
Invalid activity configuration fails startup; snapshots identify their activity.
Gift's old `trade-web` session tag is retained for legacy guests.

`web-client/src/ui/stock-shell.ts`, `stock-lobby.ts` and `../stock-link.ts` are
shared, including the room credential and serial reader lifecycle. Storage keys
are activity-specific. Gift uses `VITE_GIFT_RELAY_URL`, defaulting in production
to `https://trade.bbamorachi.us`; Playdate retains its existing configuration.
Room control JSON never reaches UART. Readiness coordinates people; it does not
query menus, inject a B press, gate bytes or replay a gift.

## Gift-specific evidence and corrections

Source imports: Gift parser, item catalogue and item artwork from local
`tama-tools/tama-gifts-poc` at `669d0f0`; source contents were unchanged there.
Attribution is retained under `public/sprites/GIFT_ATTRIBUTION.md`.

The old Gift page called two observed item packets “trade complete” and swapped
their preview positions. Neither is evidence that the native trade saved.
The new scene shows item offers and directs review/confirmation to the toys;
repeated item packets do not replay an exchange animation. Raw two/four-byte
WebSocket messages are no longer interpreted as plaintext item/version packets:
only framed, decoded type2 packets supply previews. A peer or adapter change
resets previews without kicking the room or losing the serial reader.

The existing passive outcome observer is reused for pending-transfer CAN only
in Gift mode. Gift bytes cannot trigger Playdate result/breeding states. Silence,
resync, ACK and item packets are never treated as saved/completed. Framed aborts
return to preparation with a reminder to inspect both toys before retrying.

Firmware provenance: `Desktop/PARADISE_RELAY_FIRMWARE_REPLY.md` and
`PARADISE_RELAY_TIMING_HANDOFF.md`; the source SDK's
`src/AnimationLab/evidence/relay-readiness/tropical-gift-start.json` reaches item
selection with one B, including 100ms one-way delay. Historical Gift
`docs/FIRST_SUCCESSFUL_TRADE.md` documents a completed two-B hardware exchange.
These support coordinated initiation, not a universal full-trade guarantee.
The eight-second prompt is a human coordination window, not a verified Gift
timeout or an automatic transaction deadline.

## Physical qualification

Connect both adapters and join the same Gift room before opening toy menus.
Choose who starts; the starter asks the friend to get ready. The friend freshly
opens Connection → Gift and clicks “I'm on Gift screen.” Only the starter presses
B to begin. Both then follow their own toy's item selection/review/confirmation.
Keep the page open until both finish. Record firmware edition/hash, roles,
selected items, both before/after inventories and both saved connection logs.
Check an ordinary exchange and Don't Give separately. Do not replay captured
packets or automatically retry a partially completed trade. A browser/mock test
does not qualify stock save behavior or physical WAN timing.

## Build, test and release

From this repository, using Node22 and the frozen pnpm workspace dependencies:

```sh
pnpm --filter @tama-breed-poc/tama-protocol build
pnpm --filter @tama-breed-poc/relay-server test -- test/lobby.test.ts test/relay-isolation.test.ts test/serial-bridge.test.ts
pnpm --filter @tama-breed-poc/tama-protocol test -- test/playdate-outcome.test.ts test/gift.test.ts test/nickname.test.ts test/webusb-serial.test.ts
pnpm --filter @tama-breed-poc/web-client build
pnpm --filter @tama-breed-poc/relay-server build
```

For local browser tests, build with `VITE_RELAY_URL=http://127.0.0.1:3041`
and `VITE_GIFT_RELAY_URL=http://127.0.0.1:3042`. Start two copies of the existing
relay entry with `STOCK_ACTIVITY=playdate`/`gift`, ports3041/3042 and different
temporary SQLite paths. Serve `web-client/dist` on localhost5184. Then:

```sh
node scripts/test-playdate-lobby-browser.mjs http://127.0.0.1:5184/ OUTPUT_PLAYDATE http://127.0.0.1:3041 playdate
node scripts/test-playdate-lobby-browser.mjs http://127.0.0.1:5184/gifts/ OUTPUT_GIFT http://127.0.0.1:3042 gift
node --import ./relay-server/node_modules/tsx/dist/loader.mjs scripts/test-gift-preview-browser.mjs http://127.0.0.1:5184/gifts/ OUTPUT_ITEMS
```

The harness uses `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_BROWSERS_PATH` and the existing
local browser-library path when supplied, as in the earlier Playdate tests.
Evidence is retained in `docs/evidence/gift-parity-20261017.json` and
`TamaSuite-validation/gift-lobby-parity-20261017/`. The local-only historical
Gift fix diff is archived there as `legacy-gift-local-fixes.patch`; its hash is
in the receipt. The original Gift checkout and its file modes are preserved.

After committing reviewed source, create the independent production artifact:

```sh
node scripts/package-gift-web.mjs /path/to/NEW_GIFT_RELEASE
python3 scripts/publish-web-release.py /path/to/NEW_GIFT_RELEASE
```

The packager rebuilds clean source with explicit production origins, maps the
Gift HTML to the root page, includes shared hashed assets and sprites, and
records every file hash and source commit. It includes no game/music payloads,
database, test capture or credentials. It rejects a dirty checkout and local
relay URLs. The shared publisher validates hashes, takes an exclusive backup,
retains old hashed assets and replaces HTML last. Packaging does not deploy.

### Existing server / activation boundary

Read-only SSH audit on2026-10-17: both services active and both loopback health
checks passed. Playdate backend was `50f3a43`; Gift backend was `669d0f0` with a
clean checkout. Before activation, Gift unit `tama-gift-relay.service` launched
`/srv/tama-gifts-poc/relay-server/node_modules/.bin/tsx` against that directory's
`src/index.ts`; WorkingDirectory is `/srv/tama-gifts-poc/relay-server`.
Its static root remains `/srv/tama-gifts-poc/web-client/dist`.

For activation, stage the reviewed shared-source commit in a **new** Gift
checkout, e.g. `/srv/paradise-link-gift`, install its frozen workspace dependencies
and build the protocol package. First run it on an unused loopback port with a
temporary database, `STOCK_ACTIVITY=gift`, `HOSTED_GAMES=0`, and the deployment's
explicit trusted-proxy settings. Probe both new lobbies and legacy sessions.
Retain the current unit/config/source and verify no active Gift sessions before
the cutover. Update only the Gift unit's WorkingDirectory/ExecStart to the new
checkout, preserving its current database path and other service settings, and
set `STOCK_ACTIVITY=gift`. Restart only that unit, check port3002, then use the
shared publisher to install the Gift artifact into the existing static root.
Verify the trade domain's assets, lobbies, nicknames, two-way bytes and old
session endpoints. Playdate/Games need no restart for this Gift deployment.

Do not simply pull the historical Gift repository and expect this shared code,
or publish the new frontend against the old backend: they need to move together.
No remote deployment was performed during the implementation checkpoint.

### Activated 2026-10-18 UTC (October 17 Pacific)

Release `a2a0fc4bc1b50f041f4948d31767b5eaf143959b` is live at
`https://trade.bbamorachi.us/`, pushed to the canonical repository's `main`.
Gift now runs from `/srv/paradise-link-gift/a2a0fc4/relay-server`, with the
original database and service restrictions preserved. Its systemd drop-in is
`/etc/systemd/system/tama-gift-relay.service.d/20-shared-gift.conf`; the additional
runtime file sets Gift activity, disables hosted games and configures the
reviewed trusted proxies. The static root remains unchanged.

The staging service passed real HTTP/WebSocket duplex, readiness and legacy
Gift checks, plus 23 server regressions. No Gift connections were active at the
switch. The public site then passed both browser suites: shared lobby/reconnect/
legacy flows and encrypted Gift offer previews. These used simulated UART, not
physical toys. All eight public JS/CSS asset hashes and the origin HTML match
the release; Cloudflare injects its own challenge markup into public HTML.

Playdate/Games were not restarted. Previous Gift service/config/database/web
files are retained under `/srv/paradise-link-gift/before-a2a0fc4`; the publisher
also retained its exclusive web backup. The temporary staging service is stopped.
Receipt: `docs/evidence/gift-deployment-20261017.json`. A complete physical Gift
trade and saved inventories on both toys remain to be tested.
