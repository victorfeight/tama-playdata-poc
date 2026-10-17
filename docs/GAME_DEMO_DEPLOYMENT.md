# Verified deployment map and reviewable game-preview release

Inspected by read-only SSH on 2026-10-16. No remote files, services or DNS were
changed. Existing SSH credentials were used without printing key contents.

## Combined Playdate + Games release (2026-10-17)

The Games branch now integrates the serial lifecycle fixes and the received-ghost
geometry/SHS2 preview decoder. Publish these together from main. Existing Gift
service/source stays separate. These changes do not change stock firmware's B
ordering, repair native SHS2 visitor portraits, or implement 2–16-player hosting.

1. Run protocol/relay tests, protocol/web/server TypeScript builds and the Vite
   production build with `VITE_RELAY_URL=https://playdate.bbamorachi.us`.
   Legacy private ghost tests accept `TAMA_GHOST_FIXTURE=/path/to/ghost.bin`;
   their old symlink is not portable. Do not silently skip them.
2. Build Pocket Puzzle with the SDK `build_app.py`. Use the reviewed source
   music stream directory (`manifest.json`, helper and bundle); music is optional
   and installed/verified by the browser. The game is a separate ordinary
   Download payload. No full restore or CLI setup is required.
3. Commit the source, then stage **both** pages, both verified games and optional
   music helper/bundle using the shared packager:

   ```sh
   node scripts/package-game-demo.mjs NEW_RELEASE --full-web \
     BLOCKS/app-build.json PUZZLE/app-build.json --music-stream=MUSIC_DIRECTORY
   python3 scripts/publish-web-release.py NEW_RELEASE
   ```

   Full releases require both game receipts and browser music assets. The
   manifest records source commit and every
   public file hash. Never upload private firmware/config/test directories.
4. Push main. Upload the package to a new `/srv/game-demo/releases/RELEASE/web`
   directory; verify the manifest again on the server. Keep the old server HEAD
   and static tree. Install the committed frozen workspace lockfile; the relay
   now depends on the shared protocol workspace.
5. Fetch the reviewed commit, stage its relay sources on a separate loopback port
   and private database, and run `scripts/probe-game-relay.mjs` against it.
   Also run lobby compatibility tests against staging. Configure
   `RELAY_TRUSTED_PROXIES` using the inspected deployment and reviewed
   `docs/relay-proxy.env.example`; default loopback-only trust cannot distinguish
   visitors behind the same Cloudflare edge. Test trusted-header isolation
   before publishing. Do not set unrestricted proxy trust.
   Stop that temporary process afterward. Check live port3001 has no connected
   sessions before the short service restart; do not interrupt an active match.
6. Fast-forward `/srv/playdate` to the reviewed commit, restart only
   `playdate-relay.service`, and verify loopback health. Publish with:

   ```sh
   python3 /srv/playdate/scripts/publish-web-release.py RELEASE/web \
     --live /srv/playdate/web-client/dist --backup RELEASE/previous-web
   ```

   The publisher verifies all hashes before writing, preserves an exclusive
   backup and old assets, then replaces the HTML entry points last. A Git push
   alone does not deploy. Retain the package when cleaning CI/build outputs.
7. Check public Playdate/Games/Gift URLs, referenced assets, game/setup hashes,
   two-way room bytes and reconnect behavior. Physical two-player/WAN testing
   remains separate from emulator/browser/loopback checks.

The setup UI connects once, offers optional Install/verify music, guides C return
and Download re-entry, then sends the game and keeps the adapter for create/join.
Disconnect TamaHome UART before the browser connects. Once both peers arrive,
choose Versus on both toys. The current game flow remains two-player.

The original read-only audit and initial frontend-only plan follow for provenance;
use the combined route above for new full deployments.

## Access and current services

Local alias: `/home/vic/.ssh/config`, host `playdate`, user `vic`, port 222,
host 24.199.69.115, dedicated existing `playdate_droplet` identity.

```sh
ssh -F /home/vic/.ssh/config -o IdentitiesOnly=yes playdate
```

The explicit config avoids the local environment's system SSH include error.
Both deployed worktrees were clean, both units active, both loopback `/health`
endpoints returned `{"ok":true}`. Host had 4.9 GB free and approximately 265 MB
available RAM; build locally rather than unnecessarily loading the small droplet.

| App | Deployed source | Commit | Service / listener | Static root |
|---|---|---|---|---|
| Playdate | `/srv/playdate` | `a2cee3923f51670abaf53df4741d073dd468ffb2` | `playdate-relay.service`, 127.0.0.1:3001 | `/srv/playdate/web-client/dist` |
| Gifts | `/srv/tama-gifts-poc` | `669d0f0707cc05a196d3b0c842d5efbe24d23c4a` | `tama-gift-relay.service`, 127.0.0.1:3002 | `/srv/tama-gifts-poc/web-client/dist` |

GitHub upstreams `victorfeight/tama-playdata-poc` and
`victorfeight/tama-gifts-poc` were fetched and matched those deployed HEADs.
The Playdate service runs tsx from its checkout. Nginx serves static files and
proxies `/sessions`, `/health`, `/ws/` to the corresponding loopback port.
WebSocket proxy timeouts are 3600 seconds. TLS is already configured for
`playdate.bbamorachi.us` and `trade.bbamorachi.us`.

Authentication is create/join-issued room tokens passed as WebSocket
subprotocols. Do not follow old SHARED_SECRET / VITE_RELAY_SECRET instructions.
The existing docs' singular `/srv/tama-gift-poc` is also stale; the live path
is plural. Never print or copy a server .env into a frontend build.

## First preview deployment: frontend only

The current backend already forwards arbitrary binary data. The prototype adds
`/games/` as a second Vite entry and needs no relay change. It can use
`https://playdate.bbamorachi.us` without a new domain, DNS record, nginx rule,
database or service restart. This is the experimental location, not the final
decision to make users visit a separate permanent product.

Local preparation:

```sh
pnpm install --frozen-lockfile
pnpm --filter @tama-breed-poc/tama-protocol build
VITE_RELAY_URL=https://playdate.bbamorachi.us pnpm --filter @tama-breed-poc/web-client build
git diff --check
# Run the tests listed in TETRIS_DEMO.md / the validation receipt.
```

Create a release archive containing **only** `games/` and `assets/` from
`web-client/dist`, accompanied by the exact source commit and SHA-256 manifest.
No original capture, firmware, room database or credentials belong in it.
The included `scripts/package-game-demo.mjs` makes that manifest/staging tree;
it neither uploads nor restarts anything.

After the result is reviewed and deployment authorized:

1. Commit the reviewed source on its feature branch and push that branch.
   A Git push alone does not deploy this server.
2. Copy the built release to a new versioned directory under `/srv/game-demo/`.
   Verify the archive/file hashes on the server against the local manifest.
3. Copy the new hashed assets into `/srv/playdate/web-client/dist/assets/`
   **without deleting existing files**. This preserves the live Playdate build
   and any already-open browser's referenced chunks.
4. Preserve any previous `games/index.html`; install the new file using a
   temporary sibling and atomic rename. Do not replace the root `index.html`.
5. Request `/games/` and its exact referenced assets; check `/health` and a
   disposable room's bidirectional binary relay. Check the existing Playdate
   and Gifts entry points still load. Then perform two physical-device matches.

Rollback swaps back the previous `games/index.html` (or removes only the new
preview entry if none existed). Hashed assets may remain; removing them while
clients are connected is unnecessary. There is no relay restart to roll back.

This frontend-only release leaves the server Git checkout at its earlier
commit, with a separate artifact receipt identifying the preview source. A later
full deployment must include the Games build entry, otherwise it may erase the
preview. Record that intentionally rather than claiming Git HEAD alone describes
the deployed static artifact. Merge the final Games route into web-tools when
its port handoff/source game are ready; do not maintain duplicate production UIs.

## Existing full deployment (future backend changes only)

The established route is local commit/push, then remote `git pull --ff-only`,
`pnpm install --frozen-lockfile`, protocol/web builds and a targeted service
restart. For gameplay backend changes, first test the reviewed commit on a
separate loopback port and private database. Record the old commit and artifact
before updating; restart only the relevant unit and verify reconnect behavior.
Do not restart Gifts or run initial server-provisioning/firewall commands to
deploy a game page.
