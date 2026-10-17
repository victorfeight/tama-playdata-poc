# Pocket Puzzle music balance

User-requested 85% of the previous background music amplitude. The SDK game
mixer changes `7/8` to `119/160` before adding effects. Effect levels, music
ducking, PCM/master gain, protocol and UART receive-service fix are preserved.
The soundtrack bank and browser music helper stay byte-identical; resend only
the game, not the music bank. Blocks is unchanged.

Puzzle SHA256: `b0ae478a84e48fa498de9a07a67df94390da83ddf737572bd5ea0294035d5b71`.
Build receipt: `TamaSuite-validation/game-room-usability-20261017/puzzle-music-85/app-build.json`.
Full-song/two-loop reference checks for all three tracks, effect priority,
headroom and muted fallback pass. SDK source/qualification details live in
`sdk/paradise/examples/pocket-puzzle/README.md` and its `evidence/` directory.
No relay restart is needed for this asset-only update.
