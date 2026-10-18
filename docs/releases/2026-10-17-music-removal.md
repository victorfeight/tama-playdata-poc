# Guarded Pocket Puzzle music removal

Games → Pocket Puzzle → connect Paradise → Music → **Remove music…**.
Open Connection → Download → Download and confirm. The page sends the source
helper, checks firmware/bank ownership, erases/verifies the owned music range,
then asks for **C** to return home. The same open adapter can send another game
after reopening Download. Music setup remains outside rooms and unavailable
during another transfer. Cancelling confirmation sends nothing.

This extends `GameInstallService` and shared `media-sender.ts`; no new daemon,
raw flash API or CLI workflow. The device's `puzzle-clear-v1` contract accepts
only a matching bank CRC and valid confirmation frame, never host addresses.
Every sector must match the pinned soundtrack or be erased before any erase.
Unrelated media/firmware refuses removal. Completed-sector interruptions can
resume; arbitrary partial-sector power loss is not automatically repaired.

SDK sources: `examples/music-remover`, shared `examples/music-installer/game.c`
and `stream-launch/receiver.c`; lifecycle guide: `docs/MUSIC_BANK_LIFECYCLE.md`.

| Artifact | SHA-256 |
| --- | --- |
| New remover | `95eb88751241ce4fde11f9f6b8e6d99f05a291f0dd9fd7ca0914f6461c6c2356` |
| Unchanged installer | `4f4ca8646fedda5bf8a9e16bdccf47c8d65d38736d0aac9d4c6fd971949ae886` |
| Unchanged music bundle | `e20837ed3f23dbb0a015aada69a615dbaaab4de5dffe3ca31fe73a3a19d31674` |
| Unchanged music bank | `fb75efd0de4b85705916653d267349398812d3cbe752548e70ff4ebddd7096fe` |

Release packaging now requires `--music-remover=DIR` alongside
`--music-stream=DIR` and both game receipts for `--full-web`; it checks matching
bank identity, helper size/hash and protected range. The production game payloads
remain the UART-service Blocks candidate and quieter-BGM Pocket Puzzle candidate.
No game resend or music reinstall is needed just to expose removal.

Qualification in `TamaSuite-validation/puzzle-music-removal-20261017/`:

* 16 compiled native ownership/command/erase policy checks, all six retail
  identities; complete retail Download/erase/C-return on reviewed Monster Glacier.
* 13 shared UART service tests, including refused/wrong-helper readiness and
  failed final verification; TypeScript checks and production build pass.
* Actual packaged browser with simulated UART: install/skip, cancellation,
  removal/refusal, game send, same-reader relay, unplug/reconnect, mobile layout.
* Packaging rejects stale payloads/receipts, missing remover and wrong bank.

Physical removal qualification remains pending. Native readback and simulated
browser tests do not establish all-device USB behavior or speaker sound quality.
Three-source-voice listening exports live in the SDK; no production arrangement
change is included. This is a static web release; **no relay restart** required.
