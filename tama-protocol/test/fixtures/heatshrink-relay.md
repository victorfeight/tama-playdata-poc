# Heatshrink Playdate preview

Native evidence: `C:\Users\Vic\paradise-scene-sdk\src\AnimationLab\evidence\relay-heatshrink`.
This is a preview decoder fix; UART forwarding/packet contents are unchanged.

A vanilla Tropical SHS2 optimized image (only same-family adult save banks
transplanted) exchanged Type-0 packets with a stock-code Glacier. The native
UART capture completed, with zero RX/TX drops, both valid matching save-bank
pairs, correct peer IDs and received planet archives. Its exported Tropical
packet still contains 35 `SHS2TST!` markers. The old website decoder accepted the
checksum but displayed striped body artwork.

`heatshrink-tile.ts` ports the established 8/4 decoder from
`TamaSuite.Firmware.Core/HeatshrinkTileCodec.cs`: zero-initialized history,
overlapping backreferences, geometric output bound and checked padding. SHS2
detection occurs on bytewise-compressed tiles **before XOR**, exactly as the
reader hook does. Native tiles continue through their original decoder.
Tile decoding happens once before rendering palettes, rather than once per
palette/frame. No packet rewrite or second preview layout was introduced.

Replay of the exact native wire through the updated real TcpObserver/parser/
renderer matches stock-control preview pixels. All six packages' complete
spritesheets and palettes match the corresponding stock packet on both endpoints.
The six authored tests cover literals, zero-window and overlapping references,
mixed native/SHS2 tiles, encryption order (including a plaintext-marker collision),
native wordwise regression and malformed lengths/padding. Together with existing
geometry/packet-preview tests, 23 checks pass; protocol and web TypeScript pass.

Important limitation: the **stock device's native-generated visitor portrait
is corrupted** by the SHS2 incoming body. The optimized device's portrait of the
stock visitor is correct. Fixing website rendering does not fix a stock toy's
reader. Do not advertise mixed stock/optimized device compatibility based on
successful transport. No live WAN, physical-device or all-family matrix claim.

Private packets and firmware stay in the SDK private artifact directory. Small
authored regression fixtures here contain no copied firmware artwork. The SDK
retains input/source hashes, the pre-fix failure, post-fix receipts, original
native LCD captures, decoded native-generated portraits and exact commands.
