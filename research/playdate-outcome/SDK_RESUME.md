# SDK checkpoint: resume after the online outcome/timing handoff

2026-10-17. Do not restart completed matrices or leave new research detached
from SDK APIs. Retain missing streams, forced-only cases and evidence limits.

SDK: `/mnt/c/users/vic/paradise-scene-sdk`, branch `research/lab-item-animator`,
HEAD `4264ef2` (predecessor `e7c9d83`). No remote; no push claimed.
The online detour is in `/mnt/c/users/vic/tama-playdate-outcome`, separate branch
`research/playdate-outcome-20261017`, based on `569b710`.
No SDK source was changed for this detour. New full-machine fault captures are
under SDK `private/artifacts/playdate-outcome{,-chunk}-20261017`; executable
probes, receipts and explanations are together in the online worktree's
`research/playdate-outcome`. Bring these proven transport observations into the
SDK evidence index on return; don't duplicate the protocol or scene interpreter.

## Exact previous checkpoint

Read SDK `WORKING_STATE.md:1`,
`src/AnimationLab/ghost_research/PLAYDATE_ROADMAP.md`, and
`src/AnimationLab/evidence/playdate-choreography/README.md` first.

Completed:
- Shared `scene_corpus.reachable_streams`, reused by the Water extractor and
  `ghost_research.playdate_scene_plan`. 54 static graphs across six editions
  match retained native-archive corpus. Roots retain 54 bounded native witnesses.
- Plan outputs `streams`, `spawnEdges`, `resourceReferences`; old new-API
  `rootStream` replaced. The unrelated `playdate_snapshot.rootStream` stays.
- `scene_catalog.scene_observations.reconcile_owner_graph` preserves missing and
  unexpected requests, bindings, coordinates, layers and times; separates UI
  resource construction and rejects incomplete/cross-family evidence.
- Normal actual Home sender -> native Tropical UART replay:
  `private/artifacts/playdate-choreography/play`. 90 entries, no observer errors
  or drops, no new UART drops. Arrival root 0x8C6 saw all 15 streams; play root
  0x8C9 all six. Extra stream 0xB0 belongs to UI resource 0x162, not a missing
  Playdate child. Sound requests 19,19,11 around 0/1.5/3 seconds of normal play.
- Root intervals 22.2s arrival->play, 9.2s play->farewell include controller waits.
  Observing constructor requests does NOT prove every pose or rendered frame.
- History preserved/reused slot1. 45 post-exchange RAM/LCD samples exist, but
  in-exchange capture currently samples LCD only. No new cold-reload claim.
- Prior `encounter_rules.predict`: 7,104 bounded native decision cases across
  six editions; actual Home C# predictor 1,184 cases. Fullness2 vs3 real UART
  Tropical encounter witnesses fight vs play. Love negotiation/inheritance
  remains separate from the post-negotiation deciding controller.

## Resume exactly here

1. Add optional SRAM/scene sampling DURING UART playback through existing
   `NativeSerial` in `ghost_research/uart_peer.py` and `native_replay.py`.
   Preserve scheduling and raw byte flow. Do not add another transport adapter.
2. Correlate body pose, eye frame, mouth frame, inherited bindings, coordinates,
   cursors and cleanup against the simultaneous native LCD. Reuse
   `field_snapshot`, `record_binding` and existing pose/owner decoders.
   Qualify Tropical/family addresses explicitly; never pass Tropical RAM to a
   Glacier-only reader and label it cross-family evidence.
3. Qualify farewell (observed root0x8D2), receiver roles, remaining selectors,
   breeding negotiation/choreography/inheritance; record normal versus bounded
   versus forced separately. Extend APIs/reporter alongside findings.
4. Only then use qualified prediction/scene sequences for online previews.
   Distinguish fight/play, breeding offer, acceptance, synchronization and save.
   Faithful body/eye/mouth combos are unfinished. A pose ID list is insufficient.

Repro entry: SDK
`src/AnimationLab/evidence/playdate-choreography/reproduce.sh` and `play-inputs.txt`.
Do not rerun the entire script unchanged into an existing output directory.
Use the same pinned firmware, recovered state and actual Home sender, with a new
capture path and the new in-exchange observation option once implemented.
Command resources:
- `python3 tools/sdk.py python native_replay.py --help`
- `python3 tools/sdk.py python -m ghost_research.playdate_scene_plan --help`
- `python3 tools/sdk.py python -m ghost_research.report_playdate_choreography --help`
- `python3 tools/sdk.py python -m ghost_research.report_friend_replay --help`

## Do not lose the other obligations

Lab ledger remains **509 normal + 10 forced-only = 519 streams**, and 23
category-owned obligations. Forced-only does not become normal by repetition.
Maintain SDK constructor/frame/palette/transparency/food effect support and the
add/remove Lab-item Suite handoff. No removal of unresolved corpus entries.

The larger roadmap still includes full playdate choreography/inheritance,
TamaHome stable friend identity/deduplication and Planet History screenshots,
prediction verification, patched/custom-field scenes, special food effects,
and cross-generation save migration as research, not promised functionality.
Metafoamtchi and earlier relay/SHS2 findings remain in their existing evidence;
this detour does not certify all those features or complete their research.
