import { describe, expect, it } from "vitest";
import { nicknameProblem, normalizeNickname } from "../src/nickname";

describe("shared nickname policy", () => {
  it.each(["catalyst", "unexists", "Scunthorpe", "Cassie", "Buttercup", "Neomametchi", "GayTama", "Fern", "桜🌸"])("allows ordinary names: %s", name => {
    expect(nicknameProblem(name)).toBeUndefined();
  });
  it.each(["fuck", "FUCK123", "fück", "ＦＵＣＫ", "fu\u200bck", "fuuuuuck", "shit42", "nigger"])("rejects profanity and common disguises: %s", name => {
    expect(nicknameProblem(name)).toBe("Please choose a nickname without offensive words.");
  });
  it("normalizes once and checks the displayed length", () => {
    expect(normalizeNickname("  Ｆｅｒｎ\u200b  ")).toBe("Fern");
    expect(nicknameProblem("\u200b ")).toContain("1–20");
    expect(nicknameProblem("🌸".repeat(20))).toBeUndefined();
    expect(nicknameProblem("🌸".repeat(21))).toContain("1–20");
  });
});
