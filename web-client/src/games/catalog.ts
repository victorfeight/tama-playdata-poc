export const games = {
  blocks: {
    title: "TamaHome Blocks", app: "tamahome-blocks-v1", application: "tetris-versus",
    controls: "Dial to move · A/C to rotate · B to drop slowly · Push the dial to drop. A+C holds a piece.",
    payloadPattern: /^blocks\.[a-f0-9]{12}\.pdlo\.bin$/,
  },
  "pocket-puzzle": {
    title: "Pocket Puzzle", app: "tamahome-pocket-puzzle-v2", application: "pocket-puzzle",
    controls: "Dial up/down · A/C left/right · B swaps two panels · Hold the dial button to raise. Match three, build chains and clear incoming garbage.",
    payloadPattern: /^pocket-puzzle\.[a-f0-9]{12}\.pdlo\.bin$/,
  },
} as const;
export type GameId = keyof typeof games;
export function gameId(value: string | null): GameId {
  return value === "pocket-puzzle" ? value : "blocks";
}
