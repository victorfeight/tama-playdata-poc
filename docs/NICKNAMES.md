# Room nicknames

Playdates and both game modes use `tama-protocol/src/nickname.ts` in the browser
and server. `web-client/src/ui/nickname.ts` supplies shared field feedback before
create/join. The existing server `cleanNickname` validates both room hubs before
allocating a room or seat; browser checks cannot bypass it.

The MIT-licensed [Obscenity](https://github.com/jo3-l/obscenity) package is pinned
to **0.4.6** in the workspace lockfile. We use its English dataset, exceptions
and recommended transformations rather than maintaining a duplicate word list
or a broad substring blacklist. NFKC and removal of control/format characters
precede the existing 1–20 character limit. Displayed names retain ordinary case
and accents. Errors do not repeat the matched offensive term. No remote API or
runtime list download is involved.

This is a basic English nickname filter, not complete multilingual moderation
or a promise to defeat every disguise. Dependency updates require running the
shared policy tests and the room creation/join tests, including innocent-name
fixtures. Existing active members are not renamed or disconnected.
