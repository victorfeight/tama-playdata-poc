# Ghost preview update plan

The playdate relay stays a byte pipe between two real devices. The browser already
observes and decodes the ghost payload for its preview, so preview calculations
belong in `tama-protocol` and run in each browser. The server has no need to
inspect ghosts, store their bytes, or maintain a character catalog.

## Phase 1 — Freeze examples

- Use the 141 current `TamaParadise-Licenses/CROSSPLATFORM_TAMA/BuiltinItems/Ghosts`
  files as a read-only fixture corpus. Include Tropical, Glacier, Forest, Lab,
  and the 4017 template cases.
- Record expected close-up pixels from the desktop `UnifiedGhostCompositor` for
  representative ghosts. Keep the original bins as the source for metadata and
  checksum checks.
- Add a small test table for ghost name, identity, dimensions, eye/mouth offsets,
  and whether each part decodes. No server changes.

## Phase 2 — Derive close-up geometry from ghost bytes

- Add one parser in `tama-protocol` for the composite table at `0x600`. Read the
  body, eye, and mouth positions from the first usable close-up pose; compute
  body-relative offsets with the part-height centering used by the desktop
  renderer. Validate table bounds and sprite slot references before using them.
- Change `web-client/src/ghost-compositor.ts` to use those offsets. Keep the
  existing character table only as a fallback when a ghost has no usable
  composite pose.
- Scope this phase to the layered Type-0 ghosts in the current corpus. A separate
  precomposed Gen-2 layout detector is outside this plan.

## Phase 3 — Update labels and verify pixels

- Refresh names and habitat labels from the current desktop character catalog.
  Do not use the catalog to position sprites.
- Compare browser output with the desktop reference images. Investigate pixel
  differences in frame choice, palette, or transparency before adjusting
  offsets by hand.
- Run a two-device playdate with an older ghost and with Tropical/Glacier ghosts.
  Confirm previews on both browsers and that exchange bytes and relay behavior
  remain unchanged.

## Why the browser owns this calculation

`TcpObserver` in the browser already reconstructs the playdate packet and passes
the ghost bytes to the preview. Moving preview work to the relay would require
the server to parse or retain device data and return extra metadata over a new
protocol, while each browser would still need to render the pixels. A pure
byte-to-geometry function in `tama-protocol` is smaller, testable against the
ghost corpus, and keeps the relay independent of firmware releases.
