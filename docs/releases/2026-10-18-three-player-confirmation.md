# Three-player Pocket Puzzle and Blocks confirmation

On October 18 the user reported successful physical three-player Online matches
in both Pocket Puzzle and Blocks (called Tetris in the report). This adds hardware
feedback to the prior native and browser tests. Firmware editions, installed
payload hashes, duration, completed rounds and raw UART traces were not supplied;
do not extrapolate to every edition or sixteen physical toys.

During the preceding review the public Pocket Puzzle BIN was fetched and matched
`b0ae478a84e48fa498de9a07a67df94390da83ddf737572bd5ea0294035d5b71`.
This is the UART receive-service candidate with the 85%-of-previous BGM mix.
The web release manifest identified clean full-web source `b341d1e`; the relay
was active at `50f3a43`. These identify the inspected deployment, not independently
read-back contents of the players' toys.

Fresh public-site two-browser tests passed both direct and hosted Pocket Puzzle
with a freshly compiled SDK C client: rounds/results, room names, mode guidance,
reconnect, adapter-preserving leave and hosted next-match handshake. USB and
top-outs were simulated. Evidence is in
`TamaSuite-validation/pocket-puzzle-review-20261018/{direct-current,hosted-current}`.
The initial `direct/` run used an obsolete hosted-only test executable; it failed
before the correct client was rebuilt. Preserve that failed receipt separately.

Canonical physical report:
`sdk/paradise/net/tests/hosted/evidence/physical-three-player-20261018.json`
in the SDK repository. No new payload or deployment accompanies this report.
