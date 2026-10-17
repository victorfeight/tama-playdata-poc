# Online ghost geometry regression fixtures

These contain pose/header metadata, not private artwork or player names.
`ghost-preview-geometry.json` records the exact packet SHA-256 and source path
relative to the sibling `paradise-scene-sdk` workspace. Native UART captures
provide one retained packet per family; Papillotchi and Metafoamtchi additionally
exercise nonzero header origins and hidden genetic artwork.

## Corrected behavior

`src/ghost-placement.ts::layoutGhostPreview` is the single layout implementation
used by `web-client/src/ghost-compositor.ts`. It retains the existing signed
16-bit composite positions and height centering, and applies each decoded
sprite's signed 8-bit header X/Y origin once. It excludes empty/erased eye or
mouth pose blocks from drawing and bounds, while retaining their packet artwork.
This is especially relevant to precomposed custom bodies carrying hidden eyes.
It uses packet geometry rather than guessing offsets from edition or species ID.

The first close pose begins at 0x66e; its X field is 0x670, with 22-byte part
blocks. The previous geometry code already used the correct X address. Do not
add another two-byte correction. Type is the low two bits of flags: flags=4 is
still Type-0, as seen in Jade and Gen2 captures.

Native origin evidence is in the sibling SDK:
`src/AnimationLab/scene_catalog/provenance/sprite-offsets/SPRITE_HEADER_OFFSETS.md`
and `scene_catalog/probe_sprite_offsets.py`. The bounded Glacier renderer check
compared 65,536 pixels with zero mismatches for four signed-origin cases. This
is not an all-family physical-device qualification. Papillotchi's eye origin
(0,-2) is a real stock example, independently of its composite coordinates.

The Metafoamtchi pose contract and native replay limits are documented in
`src/AnimationLab/evidence/metafoamtchi/README.md`. This preview fix does not add
missing poses to a packet or qualify breeding/inheritance.

## Reproduce

From `tama-protocol`, with Node and the existing dependencies installed:

```sh
node node_modules/vitest/vitest.mjs run test/ghost-placement.test.ts test/ghost-preview.test.ts --maxWorkers=1 --minWorkers=1
```

17 tests passed on 2026-10-16: retained geometry, custom signed nudges, hidden
layers, invalid body geometry, and an authored BIN through the real package
decoder and layout. The authored BIN removes dependence on an external artwork
fixture and verifies that preview does not mutate the input. Protocol and web
TypeScript builds and the web Vite production build passed.

The separate historical `ghost-render.test.ts` could not load its existing
`ghost_kuchipatchi.bin` fixture: its tracked symlink targets a missing old
TAMA_NEW checkout. That suite is not counted as passed by this work.

Limits: the existing duplicate-package heuristic, first-frame selection and
palette policy are unchanged. This is static close-pose geometry, not a complete
animation player, all-character matrix or proof of internet relay stability.
