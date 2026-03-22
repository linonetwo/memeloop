import { describe, expect, it } from "vitest";

import { getSchemaFromDefinition } from "../core/schemaGenerator.js";

describe("getSchemaFromDefinition", () => {
  it("returns empty object schema when promptSchema missing", () => {
    const s = getSchemaFromDefinition({});
    expect(s.type).toBe("object");
    expect(s.properties).toEqual({});
  });

  it("returns promptSchema when non-empty object", () => {
    const custom = { type: "object" as const, title: "T" };
    expect(getSchemaFromDefinition({ promptSchema: custom })).toEqual(custom);
  });
});
