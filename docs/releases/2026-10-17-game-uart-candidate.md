# Game receive-service candidate

The live physical report showed both Pocket Puzzle toys repeatedly sending valid
Versus HELLOs, forwarded unchanged, without READY. Browser traffic totals alone
do not establish device acceptance. SDK source fix `acf4890` adds bounded UART
receive servicing during tick waits and synchronous display work; see
`sdk/paradise/docs/GAME_UART_SERVICE.md` in tama-paradise-emu.

Candidate payload SHA-256:

- Pocket Puzzle: `073c1b3a89818b4e18d3fe46c0355bb3a8927beb8799310fc6cd89d83cb2bcbb`
- Blocks: `0c7cb5c352b52b1390f83aab71efdfb5b58ca4aef3716ba33fd2addd4335c27a`

Finite FIFO regression and compiled ARM driver checks pass. Both source builds
fit their memory contracts. Puzzle native Download, controls, three music
tracks, mute/resume and stock return pass. Physical multiplayer confirmation
remains pending; these assets are candidates for the browser demo, not an
installer or Store rollout. Existing installed music is unchanged.

Both players must leave their room, refresh the page and Send game again from
retail Download. Hold A+B+C for one second to exit the old game. Rejoin the same
room type: Versus for direct two-player, Online for hosted 2–16. The browser
explains the pending handshake without prescribing repeated C/menu retries.
Setup intentionally stays outside rooms. No backend restart is required.

The two-browser test now waits for both adapter acknowledgments before testing
peer disconnect: otherwise WAN timing can exercise an unattached peer and
incorrectly expect a reconnect state. This changes the fixture, not routing.
