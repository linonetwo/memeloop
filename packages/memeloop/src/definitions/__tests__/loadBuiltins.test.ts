import { describe, expect, it } from "vitest";

import { getBuiltinAgentDefinitions } from "../loadBuiltins.js";

describe("getBuiltinAgentDefinitions", () => {
  it("returns built-in agent definitions array", () => {
    const defs = getBuiltinAgentDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBe(2);
    for (const d of defs as any[]) {
      expect(typeof d).toBe("object");
      expect(d).toMatchObject({
        id: expect.any(String),
      });
    }
  });
});

