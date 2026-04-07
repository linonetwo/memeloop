import type { ILLMProvider } from "../types.js";

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  apiKey?: string;
}

export class ProviderRegistry {
  private providers = new Map<string, ILLMProvider>();

  register(provider: ILLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  unregister(name: string): void {
    this.providers.delete(name);
  }

  get(name: string): ILLMProvider | undefined {
    return this.providers.get(name);
  }

  list(): string[] {
    return Array.from(this.providers.keys()).sort();
  }

  /**
   * 路由一个 chat 请求：
   * - modelId 形如 "provider/model" 或仅 provider 名称
   * - 简化版：现在只按 provider 名字路由，后续可扩展到真正的 modelConfig
   */
  async chat(modelId: string, request: unknown): Promise<unknown> {
    const [providerName] = modelId.split("/");
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }
    if (!provider.chat) {
      throw new Error(
        `Provider ${providerName} does not support legacy chat() method. Use AI SDK's streamText instead.`,
      );
    }

    return provider.chat(request);
  }
}
