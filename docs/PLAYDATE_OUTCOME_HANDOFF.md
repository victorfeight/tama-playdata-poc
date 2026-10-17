# Playdate outcomes — implementation handoff, 2026-10-17

## Decision and scope

Use **one authoritative passive outcome observer per lobby attempt**, shared by
both pages. Automate return to preparation only for a framed transport abort
(`CAN`) while a transfer is pending. Keep ordinary exchanges free of failure
advice and retry buttons. Do not infer failure from resynchronization, retries,
silence, missing previews, or elapsed wall-clock time. Do not infer a saved
Playdate from a result, ACK, SYNC, or released UART.

This is an isolated, tested implementation for integration by the active agent.
It is **not merged, pushed or deployed**. It deliberately does not pretend to
solve silent stock-firmware failures or automatically detect save completion.
The native experiments below prove why those limits are real.

Worktree: `C:\Users\Vic\tama-playdate-outcome`
(`/mnt/c/users/vic/tama-playdate-outcome`).
Branch: `research/playdate-outcome-20261017`. Base: `569b710`.
Commit IDs are in the Desktop copy's final integration section.

The other agent's checkout is `C:\Users\Vic\tama-online-game-demo`, branch
`research/tetris-online-demo-20261016`. At inspection it had modified lobby,
server/config, shared index/TET3, browser-test and Playdate UI files plus new
hosted-game files. **None were overwritten or merged.** Its Playdate UI WIP
already removes the active-exchange retry paragraph/button. Preserve that work;
the isolated branch includes the same necessary behavior against committed HEAD.
Do not wholesale replace its files or reset its checkout to this branch.

## What the wire actually proves

| Observation | What it proves | What it does NOT prove / UI policy |
| --- | --- | --- |
| Room/socket open, adapter connected | Host connections exist | Neither toy's screen, readiness, or saved data |
| Fresh receiver confirmation | A person says the receiver is on Playdate | Not a firmware screen query; use a short expiring start window |
| Starter bytes / `PKT n` | Traffic / a packet request has begun | No acceptance, result or successful exchange |
| Repeated `PKT`, `NAK`, `ENQ` | Request/chunk recovery activity | Not terminal failure; no retry UI |
| Valid framed `CAN` with pending transfer | A participant aborts the transport | Cannot distinguish intentional cancellation, retry exhaustion or corruption; cannot promise rollback |
| Idle/unsolicited `CAN` | A command exists outside a tracked transfer | Native idle transport ignores it; do not call the Playdate failed |
| Decoder CRC/magic/resync warning | Passive decoder lost framing or rejected data | It is not a native error report. Forward bytes unchanged; never fail the room from this |
| Silence | No observed bytes | Could be animation, menu input, completed exchange, or silent timeout. No failure deadline |
| 4-byte type1 result 0..3 | Deciding endpoint transmitted play/fight/eating result | It may still need ACK, farewell, history handling, bank write; not saved |
| Result with breeding flag | Breeding is offered | Not accepted; neither participant's later choice is known |
| `BREED 0` | Peer declines breeding | Normal outcome, not failed Playdate |
| `BREED 1` | Peer accepts its part of breeding negotiation | Initiator may still decline; not a saved baby |
| `SYNC 1` | Breeding-phase rendezvous | Not completion; final result remains to be exchanged |
| Result4 | Breeding result was transmitted | Not proof both accepted the bytes, animations finished or save committed |
| Both directions `SYNC 2`, after result4 | Both send that animation rendezvous | Still not saved. Native next phase is farewell |
| UART freed / stopped | Transport lifecycle ended | One endpoint can still be before its persistence operation |

Do not use native guest-time observations as a universal WAN timeout. Native
clock helpers, emulator advance time, browser wall time and network delay are
not interchangeable.

## Firmware evidence and exact maps

All SDK paths below are under `/mnt/c/users/vic/paradise-scene-sdk` (SDK HEAD
`4264ef2`, branch `research/lab-item-animator`). The initial handoff is
`/mnt/c/users/vic/Desktop/PARADISE_RELAY_FIRMWARE_REPLY.md`.

### CAN and retry behavior

Existing Ghidra source:
`src/AnimationLab/evidence/playdate-uart/ghidra-transport/transport_command_dispatch.c`
and `transport_finish.c`. Original/Jade counterparts:
`evidence/playdate-families/ghidra-{land,jade}-transport/transport_command_dispatch.c`.

New reproducible execution:
`research/playdate-outcome/native_contract.py` and `native-contract.json` in this
worktree. **72 bounded native cases passed**: 6 editions × CAN/NAK/ENQ ×
idle/sending/receiving/active-sending flags.

| Family | Dispatcher | Has-request predicate | Finish |
| --- | --- | --- | --- |
| Land/Water/Sky | 0x600705C8 | 0x60065FD4 | 0x60079DD8 |
| Jade | 0x60073A58 | 0x600692F4 | 0x6007D468 |
| Tropical/Glacier | 0x6007EF0C | 0x600719C8 | 0x6008A2B8 |

The actual native string comparison runs in decrypted PRAM. Active CAN calls
finish(2), clearing transfer flags; idle CAN does not. NAK/ENQ retransmit without
finishing. Transport finish and request predicates execute, while callback,
clock and retransmit I/O are explicitly intercepted. Synthetic object RAM;
these are not 72 full Playdates and do not prove persistence.

Important mapping: ROM-alias `0x100xxxxx` maps to file offset `xxxxx + 0x11000`,
not simply `xxxxx`. Gen2 CAN string is at 0x100A310D, PKT at0x100A3122,
ENQ0x100A311E, NAK0x100A2B30, ACK0x100A4231. The harness reuses SDK PRAM
constant/decryption setup rather than inventing a new firmware loader.

Capstone inspection of Gen2 polling distinguished request retry exhaustion
(0x60071F38..0x60071FA6, sends CAN then finish(1)) from acknowledged-send timeout
(0x60071F0C..0x60071F30, finish(1) without CAN). The full native traces below
confirm the externally observable difference. We do not install their numeric
thresholds as browser deadlines.

### New full-machine failure captures

Probe: `research/playdate-outcome/capture_failure.py`. Reuses SDK driver,
qualified Tropical gameplay fixture and native-input startup. No gameplay RAM
writes. Receipts pin firmware/library/driver/startup hashes.

Raw SDK locations:
- `private/artifacts/playdate-outcome-20261017`
- `private/artifacts/playdate-outcome-chunk-20261017`

Copied receipts/screenshots in this worktree:
`native-failures.json`, `native-chunk-timeout.json`, `unanswered-request.png`,
`pre-transfer-cancel.png` under `research/playdate-outcome`.

1. **Unanswered request:** native B start, no peer response. PKT2 at sampled
   advance times20/1640/3280/4920ms; CAN at6560ms. Native controller enters
   error mode9000 at6560ms. Shared observer reports `interrupted` only at CAN,
   never on the earlier retries. These are this harness's observed times,
   not a recommended timer constant.
2. **Pre-transfer C:** native cancellation emits **zero UART bytes**. Controller
   exits. An observer cannot distinguish it from a receiver still waiting.
3. **Lost chunk ACK:** fault-injection host sends one valid ACK to the initial
   PKT2 request, then stops. Native transmits the encrypted session chunk and
   later ECHO REQ; it exits without CAN. No fabricated gameplay state or native
   packet result. This is a controlled partial peer, not a full native pair.
   The shared observer correctly remains unknown/exchanging.

The final script exposes `--case`; the first two receipts were produced before
adding the third-case selector. Their case logic is unchanged and reproducible.
Do not call a zero-byte or silent timeout case automatically solved.

### Successful native pair replay and persistence separation

Retained raw capture:
`private/artifacts/relay-readiness/tropical-glacier-lifecycle/one-presses-direct`.
It has ordered `trace.json` and `endpoint-{0,1}.wire`, plus native states/images.

`research/playdate-outcome/replay-captures.ts` runs the **same shared observer**
over original UART segmentation and 7-byte fragmentation. Both see the result
at64195ms, never an interruption or saved/completed state. Exact wire/trace
hashes and observed transitions: `capture-replay.json`.

At the original pair's UART release, one endpoint had persisted and the other
was still before completion. Later settled evidence qualified both banks:
SDK `src/AnimationLab/evidence/relay-readiness/settled-preserved-banks.json` and
`inspect_preserved.py`. Transport release is therefore an experimentally
refuted save-completion signal, not merely a precaution.

### Breeding: new Ghidra and native branches

New Ghidra output:
`research/playdate-outcome/ghidra-breeding/breeding_controller.c`, entry
0x6009BEEC. Reused the existing mapped Glacier project, PRAM/ROM alias/SRAM
setup, read-only, noanalysis; command in `reproduce.sh`.

Relevant portions:
- substates1/1001: user choices; receiver emits BREED0/1.
- 2001: initiator sets result4 only when its own choice and peer acceptance agree.
- 2002/2003: SYNC1 rendezvous.
- 2004/2005: final four-byte result send/receive; transport error -> mode9000;
  accepted result4 -> animation, ordinary result -> farewell5000.
- 3002/3003: sends SYNC2, polls synchronization, then mode5000.

`breeding_contract.py` / `breeding-contract.json`: **12 bounded native Gen2
branches passed** across Tropical/Glacier. It executes native routing with
synthetic controller RAM and documented intercepted UI, transport/result getters,
SYNC poll and transition services. It proves those branch distinctions, **not
end-to-end breeding, egg inheritance, or all-family breeding parity**.

Native farewell persistence is separate:
SDK `evidence/playdate-uart/ghidra-lifecycle/farewell_controller.c:41` onward,
entry0x6009D430, substate1000. Transport is released, history insertion
0x60028588 occurs, then persistence0x6008259C. Full-history replacement choice
can intervene. Never replace this evidence with “we saw SYNC2, so saved.”

## Minimal implementation and integration points

1. `tama-protocol/src/playdate-outcome.ts:10`: `PlaydateOutcomeObserver` owns both
   directions, one ordered observation queue and five evidence states:
   `exchanging`, `result-observed`, `breeding`, `settling`, `interrupted`.
   **There is no saved/completed state.** Pending requests retire after observed
   packet plus opposite final ACK. Idle CAN does not abort an old completed
   request. A later valid CAN while a transfer is pending is an interruption.
2. `tama-protocol/src/tcp-observer.ts:31`: adds `framedCommand`, distinct from
   diagnostic command text. Unknown lines/resync invalidate command confidence;
   a validated chunk restores framing. No searching encrypted bytes for CAN.
   Optional duplex initial-ACK mode keeps repeated PKT requests in command mode
   until the peer grants the first chunk. This is necessary: the old one-way
   decoder entered binary mode at the first PKT and could lose the terminal CAN
   in a normal unanswered-request failure.
3. `tcp-observer.ts:75,175`: reset epoch prevents a pending async decrypt from
   emitting an old packet into a new session. Existing one-way preview API still
   works; duplex behavior is opt-in. `settled()` supports ordered deterministic
   replay/tests without sleeps. Packet requests capped at256KiB for observation.
4. `relay-server/src/lobby.ts:144,170`: **forward binary first**, then enqueue
   observation. Observer never emits UART or delays forwarding for decryption.
   A1MiB queued-observation ceiling drops observation, not wire traffic or a
   room-failure event. On framed abort both pages get `outcome: interrupted` and
   `startPrompt: prepare`; starter choice remains unchanged. Receiver must
   confirm freshly. Role/socket/adapter/leave resets stop the old observer;
   stale async callbacks check instance identity.
5. `tama-protocol/src/lobby.ts`: optional shared `outcome` field. No browser
   “trust me, it failed” control message. Older desktop peers still receive only
   existing presence text and unchanged raw UART; outcome observation is scoped
   to the two-capable-browser readiness flow.
6. `web-client/src/ui/playdate-lobby.ts:294`: normal exchange = Follow your toy,
   no retry advice/button. Confirmed interruption = preparation instructions;
   receiver confirms again, starter waits. The other agent already has the
   normal-exchange cleanup locally: preserve it when integrating this delta.
7. `web-client/index.html`: remove the always-visible “To retry...” advice near
   starter selection. This remained visible even after the normal paragraph
   was fixed; screenshot review caught it.
8. `web-client/src/main.ts:114`: replace “breeding successful” and automatic egg
   hatch at SYNC2 with “breeding animation sync observed”. The richer accurate
   pose/animation work is a later phase. Do not restore saved/baby claims here.

No change to `SerialBridge`, baud, ACK generation, B-button behavior, starter
role policy, receiver readiness lifetime, hosted-game networking or deployment.

## Tests and scope

- 72 six-edition native CAN/NAK/ENQ cases.
- 12 Gen2 native breeding branch cases; Ghidra output retained.
- 3 new full-machine Tropical fault/cancel cases, with the one-ACK injection
  explicitly labeled. Native success pair capture replayed twice with different
  segmentation. All five observer-replay expectations pass.
- 10 outcome/observer unit tests: retries, fragmentation, receiver abort, idle CAN,
  binary CAN/resync noise, result versus saved, breeding decline/accept/sync,
  invalid types/flags, queued Node-buffer copying, stale async reset/retired observers.
- 11 lobby tests: existing role/readiness/legacy/raw forwarding plus shared abort
  and stale-observer cancellation after starter switch.
- 4 existing ghost pipeline/render regression tests pass using the actual
  `TamaParadise-Licenses/CROSSPLATFORM_TAMA/BuiltinItems/Ghosts/ghost_kuchipatchi.bin`
  through `TAMA_GHOST_FIXTURE`. The historical default symlink is broken in the
  original checkout; it was not repaired in the other agent's working tree.
- Initial wider protocol run hit that missing fixture and was stopped; do not
  advertise the entire protocol suite as passing. The affected pipeline tests
  were rerun successfully with the explicit fixture.
- Protocol, relay and browser TypeScript builds pass; Vite production build passes.
- Two real Chromium pages + local HTTP/WebSocket server + simulated WebSerial:
  9 browser groups pass, covering both starter roles, readiness expiry, unchanged
  UART in both directions, abort/reprepare, reconnect/reload,390px layout and
  old desktop interoperability. This is browser/relay integration, not physical
  UART timing qualification. `research/playdate-outcome/browser/browser.json`.
- Screenshots: `normal-exchange.png`, `abort-receiver.png`, `mobile-paired.png`.
  The static retry hint was caught visually and removed; final browser rerun
  checks it too.

## Known limits — important for the receiving agent

- No universally reliable stock UART-only completion or failure oracle exists
  in this evidence. The silent failure and successful farewell traces refute
  simple silence/result/SYNC/UART-release rules. Real hardware remains necessary
  for qualification; native execution provides reproducible engineering evidence.
- No full native breeding pair or cross-generation breeding matrix was run here.
  Breeding wire tests are constructed protocol cases backed by bounded native
  routing, not captured successful baby saves.
- Partial binary loss, missed initial ACK, or unframed CAN can defeat passive
  decoding. Prefer unknown over a false failure. This is not a full reliable
  transport parser replacement; repeated final-chunk ambiguity remains a scope
  limit. Never turn a resync warning into room failure to fill this gap.
- First framed CAN after a pending request cannot identify the human cause.
  Don’t say someone pressed C or promise neither save changed.
- Do not add a timer that returns to preparation after a result while the toy
  may be choosing breeding or a full-history replacement. For silent outcomes,
  a deliberate human status confirmation or a future qualified firmware status
  signal is needed. Keep any recovery affordance contextual to a reported toy
  failure, not permanently injected into a healthy exchange.
- The isolated observer drops its own work if overloaded and has no per-room
  telemetry counter yet. It does not close sockets or report an abort for overload.
- Only the current capable-browser lobby gets shared outcomes; legacy desktop
  integration needs a separately agreed metadata capability before broadening.

## Next phases requested by Vic

### 1. Integrate the isolated outcome work

Review the isolated diff, especially observer boundaries and async resets.
Port into your WIP carefully, preserving hosted-game work and the existing UI
refinements. Run the listed focused tests and browser flows. No deployment was
requested for this handoff; do not conflate this branch with a release.

### 2. Timed contextual “Press B now” prompt

Build this in the agent-owned UI, not as a new click barrier. A small prominent
nonblocking callout/popover appears only for the designated starter **after the
receiver's fresh confirmation**. Say “On your Paradise, press B now”. The other
page says to wait; it must not invite both people to press B.

Use existing eight-second readiness window as a **human coordination window**,
not a detected firmware timer. SDK `evidence/relay-readiness/ready-timer-native.json`
and `check_stock_ready_timer.py` execute the Gen2 threshold:10999 counter false,
11000 true; `glacier-idle.json`/9s/12s LCD captures show normal waiting exit.
Don't claim six-family screen-timing qualification from Gen2 alone.

- Dismiss immediately on starter traffic, expiry, role/peer/socket/adapter change.
- On expiry, return to preparation/reopen instructions, not “Playdate failed”;
  an attempt may never have begun.
- No extra acknowledgement button, focus trap or synthetic physical B.
- Add a decreasing visual bar/countdown with accessible text; announce start and
  expiry once, not every tick. Respect reduced motion.
- Preserve one readiness deadline per confirmation. Repeated snapshots must not
  restart or extend the visual countdown; background-tab resume recomputes it.
- Account for network transit;8s is not a promise of8s remaining on the toy.
  Receiver confirmation after already waiting9s cannot be repaired with a
  browser timer. Instructions must require freshly reopening that screen.
- Test early B, expired readiness, stale socket, role flip, background tab, narrow
  screen, and healthy exchange (no recovery UI). Existing browser harness already
  tests real eight-second expiry and role switching.

### 3. SDK checkpoint and return

The exact original checkpoint, files, commands, completed evidence, unresolved
Lab ledger and resume sequence are in `research/playdate-outcome/SDK_RESUME.md`.
Resume SDK in-exchange SRAM/LCD sampling; do not start the research over.

### 4. Predictions and faithful scene previews

Playdate pose work is **unfinished**. Existing six-family bounded decision
matrix and real Tropical fight/play cases are useful, but not proof of every
live pose/eye/mouth combination, love negotiation or inheritance. Complete
in-exchange binding/cursor/frame witnesses, receiver/farewell and breeding
phases, then drive preview from those observations. Keep predicted outcome,
observed result, synchronized animation and persisted save distinct in the UI.
Do not replace known byte-source Jade/Gen2 eye/mouth handling with guessed IDs.
