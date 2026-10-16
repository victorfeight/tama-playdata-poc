import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayClient } from "../../web-client/src/relay-client";
afterEach(() => vi.unstubAllGlobals());
describe("game room selection", () => {
  it("refuses an incompatible activity without changing older clients", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "test", app: "playdate-web" }))));
    const game = new RelayClient({ baseUrl: "https://example.test", appName: "game", expectedApp: "game" });
    await expect(game.fetchToken("ABC123")).rejects.toThrow("another activity");
    const older = new RelayClient({ baseUrl: "https://example.test", appName: "playdate-web" });
    await expect(older.fetchToken("ABC123")).resolves.toBe("test");
  });
});
