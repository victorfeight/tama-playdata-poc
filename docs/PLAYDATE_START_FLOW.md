# Playdate starter and ready prompts — 2026-10-17

Status: implemented and locally qualified; not yet published. The live baseline
is `4c98c65`. Publishing this change requires a relay restart and closes rooms.

The room has one shared **Who presses B?** choice, shown as **Me / My friend**
from each player's perspective. Either player can choose. The server accepts
an explicit member ID, not a toggle; both pages render the authoritative reply.
The guest is the initial default, not a protocol restriction. A choice survives
rejoining but is reset for a new pair. It changes instructions only.

1. The starter clicks **Ask friend to get ready**.
2. The receiver sees **Go to Connection → Playdate and wait now**, with
   **I'm on Playdate screen** as the confirmation button. They do not press B.
3. That confirmation tells the starter **Press B now**, and tells the receiver
   **Wait—your friend is starting**. B is pressed on the physical toy.
4. Readiness expires after eight seconds unless starter traffic appears. This
   is a short-lived human confirmation, not a firmware readiness measurement.
   On expiry the receiver must freshly reopen Playdate and confirm again.
5. Starter traffic changes the prompt to **Follow your toy**. It proves only
   bytes appeared, not a complete handshake, exchange or saved friendship.
   **Prepare another attempt** is available if the device reports a failure.

Changing starter, adapter disconnect, socket replacement, or leaving clears the
ready prompt. No synthetic ACK, button command, UART gate, packet rewrite or
buffered replay is introduced. A room restart still loses ephemeral membership.
Both clients must advertise this UI capability. Cached older browsers and desktop
clients retain their original instructions; they are not sent unsupported JSON.

## Implementation and evidence

- `tama-protocol/src/lobby.ts`: shared metadata contract.
- `relay-server/src/lobby.ts`: assignment, role-checked prompts, eight-second expiry.
- `web-client/src/ui/playdate-lobby.ts`: shared-state rendering and contextual actions.
- `relay-server/test/lobby.test.ts`: assignment/reconnect, invalid/stale requests,
  capability fallback, confirmation ordering, expiry and unchanged UART bytes.
- `scripts/test-playdate-lobby-browser.mjs`: two actual browsers and HTTP/WS
  service, simulated serial; switching from either side, preserved selection on
  reload, prompts/expiry, 390px layout, and both desktop interoperability directions.
- Local receipt: `TamaSuite-validation/playdate-lobby-20261017/starter-ready-1/browser.json`.

Connection details now show the adapter VID:PID, timestamped byte directions and
a local **Save connection log** action. Logs include no room credential and are
not automatically uploaded. Preview decoder resync warnings explicitly say they
are passive; they do not establish corruption of the forwarded bytes.

## Hardware incident: unresolved root cause

The user reported a failed live attempt with 99 bytes in and zero bytes out on
the guest, matching repeated host `PKT 2` and cancellation. The guest received
no local UART response during that attempt. The user subsequently reported a
successful attempt after reconnecting the dongle and pressing B on their toy.
Neither an enforced host/guest direction nor the exact recovery mechanism has
been established. Reopening the adapter replaces its streams and bridge; device
menu state and timing may also have changed. These UI changes coordinate people;
they do not claim to repair that unresolved physical connection problem.

Firmware evidence: `Desktop/PARADISE_RELAY_FIRMWARE_REPLY.md` and
`paradise-scene-sdk/src/AnimationLab/evidence/relay-readiness/README.md`.
The tested Gen2 waiting screen expires; one B works in native experiments, while
exact simultaneous cloned-clock initiation collided. Those tests are not a
universal physical-device or WAN qualification.
