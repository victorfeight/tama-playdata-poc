# Playdate outcome evidence

See [the full handoff](../../docs/PLAYDATE_OUTCOME_HANDOFF.md) for conclusions,
exact references, integration instructions, evidence limits and the next UI phase.
[SDK_RESUME.md](SDK_RESUME.md) preserves the previous SDK work and precise resume.

- `native_contract.py` / `native-contract.json`: 72 native six-edition transport
  cases; callback/clock/retransmit interception explicitly recorded.
- `breeding_contract.py` / `breeding-contract.json`: 12 bounded Gen2 branches;
  `ghidra-breeding` contains the recovered controller, not original source.
- `capture_failure.py`, `native-failures.json`, `native-chunk-timeout.json`:
  three native Tropical failure/cancel cases, one with controlled host ACK.
- `replay-captures.ts` / `capture-replay.json`: retained native success/failure
  wires through the exact shared production observer; private raw wires remain
  in the SDK paths documented in the handoff.
- `sources.json`: SDK dependencies pinned by hash.
- `browser/browser.json` and screenshots: real browser/HTTP/WebSocket flows,
  simulated serial. Not physical hardware qualification.
- `reproduce.sh`: toolchain, focused test, native, replay and browser commands.

No failure is inferred from a missing stream/packet, silence or decoder warning.
No observed result, animation synchronization or UART teardown is called a save.
