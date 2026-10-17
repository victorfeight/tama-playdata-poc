import { describe, expect, it } from "vitest";
import { LobbyHub } from "../src/lobby";
import { GameRoomHub } from "../src/game-rooms";

describe("room nickname enforcement", () => {
  it("rejects Playdate creation and joining without reserving a seat", () => {
    const hub = new LobbyHub();
    try {
      expect(() => hub.create("fuck", "public")).toThrow("without offensive words");
      const host = hub.create("Fern", "private");
      expect(() => hub.join(host.code, "ＦＵＣＫ")).toThrow("without offensive words");
      expect(hub.join(host.code, "Scunthorpe").code).toBe(host.code);
    } finally { hub.close(); }
  });
  it.each(["direct", "hosted"] as const)("rejects %s game creation and joining without reserving a seat", mode => {
    const hub = new GameRoomHub();
    try {
      expect(() => hub.create("fuck", "public", "blocks", mode)).toThrow("without offensive words");
      const host = hub.create("Fern", "private", "blocks", mode);
      expect(() => hub.join(host.code, "fuck123", "blocks", mode)).toThrow("without offensive words");
      expect(hub.join(host.code, "Cassie", "blocks", mode).code).toBe(host.code);
    } finally { hub.close(); }
  });
});
