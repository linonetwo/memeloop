import { describe, expect, it } from "vitest";

describe("@memeloop/protocol", () => {
  it("loads public API", async () => {
    const m = await import("../index.js");
    expect(m).toBeTypeOf("object");
  });
});
