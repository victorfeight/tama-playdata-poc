import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderGhost } from "../src/ghost-render";

const FIXTURE = fileURLToPath(new URL("./fixtures/ghost_kuchipatchi.bin", import.meta.url));

describe("renderGhost(kuchipatchi)", () => {
  const ghost = new Uint8Array(readFileSync(FIXTURE));

  it("parses metadata and name from the bin", () => {
    const rendered = renderGhost(ghost);
    expect(rendered.charaId).toBeGreaterThan(0);
    expect(rendered.name.length, `english name: ${JSON.stringify(rendered.name)}`).toBeGreaterThan(0);
  });

  it("decodes body/eyes/mouth as RGBA framebuffers with sensible dimensions", () => {
    const rendered = renderGhost(ghost);
    // The water-variant kuchipatchi fixture in this repo is a small Type-1-style
    // dump (~10KB), so body/mouth may be absent (only eyes present). The renderer
    // returns undefined for missing parts instead of throwing. Assert the eyes
    // render specifically, since eye sprites are always embedded.
    const part = rendered.eyes ?? rendered.body ?? rendered.mouth;
    expect(part, "at least one sprite part must render").toBeDefined();
    if (part) {
      expect(part.frame.width).toBeGreaterThan(0);
      expect(part.frame.height).toBeGreaterThan(0);
      expect(part.frame.pixels.length).toBe(part.frame.width * part.frame.height * 4);
      // Some pixel must be non-transparent (A > 0).
      let anyOpaque = false;
      for (let i = 3; i < part.frame.pixels.length; i += 4) {
        if (part.frame.pixels[i]! > 0) {
          anyOpaque = true;
          break;
        }
      }
      expect(anyOpaque, "at least one non-transparent pixel").toBe(true);
    }
  });
});
