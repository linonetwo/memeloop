import { describe, expect, it } from "vitest";

import { rjsfFieldPathToSegments, shouldShowConditionalField } from "../core/conditionVisibility.js";

describe("rjsfFieldPathToSegments", () => {
  it("parses nested array path without breaking property underscores", () => {
    expect(rjsfFieldPathToSegments("root_prompts_0_children_1")).toEqual(["prompts", "0", "children", "1"]);
  });

  it("parses property names that contain underscores", () => {
    expect(rjsfFieldPathToSegments("root_model_config_0")).toEqual(["model_config", "0"]);
  });

  it("parses dot-separated paths", () => {
    expect(rjsfFieldPathToSegments("root.model_config.max_tokens")).toEqual(["model_config", "max_tokens"]);
  });

  it("uses form data to disambiguate nested keys with underscores", () => {
    const root = { model_config: { mode: "basic" } };
    expect(
      rjsfFieldPathToSegments("root_model_config_max_tokens", root as Record<string, unknown>),
    ).toEqual(["model_config", "max_tokens"]);
  });
});

describe("shouldShowConditionalField", () => {
  it("reads dependsOn from parent when field name has underscores", () => {
    const root = {
      model_config: { mode: "advanced" },
    };
    const show = shouldShowConditionalField(
      { dependsOn: "mode", showWhen: "advanced" },
      root as Record<string, unknown>,
      "root_model_config_max_tokens",
    );
    expect(show).toBe(true);
  });
});
