export const games = {
  blocks: {
    title: "TamaHome Blocks", application: "tetris-versus",
    controls: "Dial to move · A/C to rotate · B to drop slowly · Push the dial to drop. A+C holds a piece.",
    payloadPattern: /^blocks\.[a-f0-9]{12}\.pdlo\.bin$/,
    directMode: 3, hostedMode: 4,
  },
  "pocket-puzzle": {
    title: "Pocket Puzzle", application: "pocket-puzzle",
    controls: "Dial up/down · A/C left/right · B swaps two panels · Hold the dial button to raise. Match three, build chains and clear incoming garbage.",
    payloadPattern: /^pocket-puzzle\.[a-f0-9]{12}\.pdlo\.bin$/,
    directMode: 0x50500102, hostedMode: 0x50500202,
  },
} as const;
export type GameId = keyof typeof games;
export function gameId(value: string | null): GameId {
  return value === "pocket-puzzle" ? value : "blocks";
}

/** UI-only diagnosis of a CRC-validated toy HELLO. Never rewrites UART. */
export function modeAdvice(game: GameId, hosted: boolean, observed: number | undefined): string | undefined {
  if (observed === undefined || observed === (hosted ? games[game].hostedMode : games[game].directMode)) return;
  if (observed === (hosted ? games[game].directMode : games[game].hostedMode))
    return `Your toy is in ${hosted ? "Versus" : "Online"}. Press C to return to the game menu, then choose ${hosted ? "Online" : "Versus"}. Keep your adapter connected.`;
  return `Your toy is running a different game or version. Leave this room, send ${games[game].title} above, then rejoin.`;
}
