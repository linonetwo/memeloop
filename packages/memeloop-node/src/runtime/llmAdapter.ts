import type { ILLMProvider } from "memeloop";
import type { ProviderRegistry } from "memeloop";

/**
 * Adapts ProviderRegistry to a single ILLMProvider for AgentFrameworkContext.
 * Routes chat() to registry.chat(defaultModelId, request).
 */
export function createRegistryLLMProvider(
  registry: ProviderRegistry,
  defaultModelId: string,
): ILLMProvider {
  return {
    name: "registry",
    model: undefined,
    async chat(request: unknown): Promise<unknown> {
      return registry.chat(defaultModelId, request);
    },
  };
}
