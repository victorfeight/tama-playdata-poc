# Tama Breed POC

Standalone proof-of-concept for relaying Tamagotchi Paradise playdate and breeding bytes between two browsers over WebSocket, with each browser connected to a USB serial dongle through WebSerial.

This project intentionally does not modify `TAMA_NEW`, `unexists-nextjs-frontend`, `strapi-backend-unexists`, `security-audit`, or `bbamorachi_site-main`.

## What Is Here

- `tama-protocol/`: TypeScript ports of the Paradise CRC, chunk header, SHA-256 XOR cipher shape, play data structs, ghost metadata parser, checksum verifier, and transport interfaces.
- `relay-server/`: Fastify + WebSocket + SQLite byte relay with 6-character room codes, shared-secret protection, 10 minute TTL, heartbeats, byte counters, and close cascade.
- `web-client/`: Vite + vanilla TypeScript + Canvas 2D UI. No React, Pixi, Phaser, or Three.js.

## Critical Reference Finding

The requested spec listed `115200` baud as a guess. The local ground truth says Paradise TCP/link mode uses `460800` baud:

- `TAMA_NEW/tama-cli/tamacom/comm.py`: `Serial(port, baudrate=460800, timeout=cmd_timeout)`
- `TAMA_NEW/TamaHomeMini/desktop/TamaDesktop/Program.cs`: desktop harness prints selected port at `460800`
- `TAMA_NEW/tama-para-research/protocols/tcp.md`: UART `460800/8-N-1`

The POC defaults to `460800`, `8N1`, no flow control in `tama-protocol/src/types.ts`.

## Prerequisites

- Node 20 LTS
- pnpm 9+
- Chrome or Edge for WebSerial
- Two USB serial dongles wired to Paradise prongs
- `TCP_SECRET` for protocol tests or `VITE_TCP_SECRET` for browser experiments. The reference secret is not committed here.

## Install

```bash
cd /home/vic/Documents/SITE_LATEST/tama-breed-poc
pnpm install
```

## Run

Terminal 1:

```bash
cd /home/vic/Documents/SITE_LATEST/tama-breed-poc
cp relay-server/.env.example relay-server/.env
pnpm dev:relay
```

Terminal 2:

```bash
cd /home/vic/Documents/SITE_LATEST/tama-breed-poc
VITE_RELAY_URL=http://localhost:3001 VITE_RELAY_SECRET=dev-only pnpm dev:web
```

Browser:

1. Open the Vite URL in Chrome.
2. Click `Connect Dongle`.
3. Click `Create Room` on side A.
4. Open a second tab, connect dongle B, enter the room code, and click `Join Room`.
5. On both Paradise devices, enter the Friend/Playdate flow and connect prongs.

## Loopback Test

The web UI includes a `Loopback mode` checkbox as a scaffold for a two-dongle, one-tab test. The current implementation marks the UI as paired, but it still needs a second WebSerial transport instance before it can fully act as both A and B in one tab.

For server-only byte relay testing after dependencies are installed:

```bash
pnpm --filter @tama-breed-poc/relay-server test
```

## Protocol Port Fidelity

| Reference | TypeScript target | Status | Evidence |
| --- | --- | --- | --- |
| `tamacom/chunk.py:create_chunk` | `tama-protocol/src/framing.ts:createChunk` | Ported | Same 12 byte `<I3sBBBH` header, `TCP` magic, index complement, CRC-16/IBM |
| `tamacom/chunk.py:parse` and C# `Protocol/Chunk.cs` | `tama-protocol/src/framing.ts:parseChunk` | Ported | Round-trip test added |
| C# `Protocol/Crc16.cs` | `tama-protocol/src/crc.ts:crc16Ibm` | Ported | Standard `123456789 -> 0xbb3d` vector |
| `tamacom/utils.py:crypt` and C# `Protocol/Crypto.cs` | `tama-protocol/src/encryption.ts:crypt` | Ported shape | Requires env-provided secret; does not commit reference secret |
| `commands/playdate.py:build_play_data_struct` | `tama-protocol/src/play-data.ts` | Ported | 20 byte little-endian struct |
| `commands/playdate.py:build_ghost_struct` | `tama-protocol/src/ghost.ts:parseGhost` | Ported metadata | Header offsets, sprite table, checksum coverage from Python/C# research |
| `GhostChecksum.cs` | `tama-protocol/src/ghost.ts:calculateGhostChecksum` | Ported | Pads to `0x20000`, zeros checksum fields, sums header/composites/sprites |
| `commands/playdate.py:run_playdate` | `tama-protocol/src/playdate-flow.ts` | Partial | Semantic async state machine present; TODO remains for full TCPComm command adapter |
| `tamacom/comm.py:TCPComm` | `tama-protocol/src/transport*.ts` | Partial | Transport abstraction and WebSerial implemented; full PKT/ACK/NAK retry adapter still TODO |
| `commands/send_gift.py` | `tama-protocol/src/packets.ts` | Minimal | Packet type and primitive encoders present |
| `commands/send_download.py` | `tama-protocol/src/packets.ts` / `framing.ts` | Minimal | Packet type 3 and chunking primitives present |

## Paradise Compatibility Results

No hardware compatibility result has been proven yet from this workspace. The current deliverable is a buildable POC scaffold plus protocol primitives. A successful result still needs:

- Node/pnpm install and test execution
- Two dongles connected through Chrome WebSerial
- One captured successful exchange saved under `tama-protocol/test/fixtures/`
- Latency tests around the local relay

If the dumb relay fails in practice, the likely next design is a protocol-aware relay that buffers around `SYNC 1` / `SYNC 2`, or an Electron/local-helper transport that gives tighter serial timing than browser streams.

## Known Good Chipsets

The local hardware note lists CH340C and CP2102 as compatible starting points, with a warning to verify 3.3V logic. Record VID/PID, OS, and dongle board variant here after POC testing.

## Troubleshooting

- WebSerial only works in Chromium-family browsers on secure origins or `localhost`.
- If room creation returns `401`, align `SHARED_SECRET` on the relay and `VITE_RELAY_SECRET` in the web client. Browser WebSocket cannot set custom headers, so WS auth uses `?secret=` while Node tools may still use `x-poc-secret`.
- If the device does not respond, verify the dongle is in Paradise Friend/Playdate mode and configured at `460800`, `8N1`, no flow control.
- If ghost parsing does not update, capture the raw byte log first; incoming bytes may still be encrypted/chunked until the TCPComm adapter is completed.

## Asset Attribution

The web-client copies a small set of local Tamaweb sprites/fonts into `web-client/public/sprites/`. See `web-client/public/sprites/ATTRIBUTION.md`. The referenced local license is `TAMA_NEW/Tamaweb/LICENSE`, CC BY-NC-SA 4.0.
