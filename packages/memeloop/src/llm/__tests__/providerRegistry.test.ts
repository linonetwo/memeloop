import { describe, expect, it, vi } from "vitest";

import type { ILLMProvider } from "../../types.js";
import { ProviderRegistry } from "../providerRegistry.js";

function createProvider(name: string): ILLMProvider {
  return {
    name,
    chat: vi.fn().mockResolvedValue({ provider: name }),
  };
}

describe("ProviderRegistry", () => {
  it("registers and lists providers", () => {
    const registry = new ProviderRegistry();
    registry.register(createProvider("memeloop"));
    registry.register(createProvider("openai"));

    expect(registry.list()).toEqual(["memeloop", "openai"]);
  });

  it("unregisters provider", () => {
    const registry = new ProviderRegistry();
    registry.register(createProvider("memeloop"));
    registry.unregister("memeloop");

    expect(registry.get("memeloop")).toBeUndefined();
  });

  it("routes chat calls by provider name", async () => {
    const registry = new ProviderRegistry();
    const p = createProvider("memeloop");
    registry.register(p);

    const result = await registry.chat("memeloop/claude-opus-4.6", { prompt: "hi" });

    expect(result).toEqual({ provider: "memeloop" });
    expect(p.chat).toHaveBeenCalledWith({ prompt: "hi" });
  });

  it("throws if provider not found", async () => {
    const registry = new ProviderRegistry();

    await expect(registry.chat("unknown/model", { prompt: "hi" })).rejects.toThrow(
      /Provider not found/,
    );
  });
});

