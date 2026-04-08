import type { ILLMProvider } from "../types.js";

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface RegisteredProvider {
  provider: ILLMProvider;
  config: ProviderConfig;
}

export class ProviderRegistry {
  private providers = new Map<string, RegisteredProvider>();

  register(provider: ILLMProvider, config?: Omit<ProviderConfig, "name">): void {
    this.providers.set(provider.name, {
      provider,
      config: {
        name: provider.name,
        baseUrl: config?.baseUrl,
        apiKey: config?.apiKey,
      },
    });
  }

  unregister(name: string): void {
    this.providers.delete(name);
  }

  get(name: string): ILLMProvider | undefined {
    return this.providers.get(name)?.provider;
  }

  getConfig(name: string): ProviderConfig | undefined {
    return this.providers.get(name)?.config;
  }

  upsertConfig(config: ProviderConfig): void {
    const existing = this.providers.get(config.name);
    if (!existing) {
      throw new Error(`Provider not found: ${config.name}`);
    }
    this.providers.set(config.name, {
      provider: existing.provider,
      config: {
        name: config.name,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
      },
    });
  }

  list(): string[] {
    return Array.from(this.providers.keys()).sort();
  }

  listConfigs(): ProviderConfig[] {
    return this.list().map((name) => {
      const config = this.providers.get(name)?.config;
      if (!config) {
        throw new Error(`Provider config missing: ${name}`);
      }
      return { ...config };
    });
  }

  resolve(modelId: string): { provider: ILLMProvider; providerName: string; modelName?: string } {
    const [providerName, ...rest] = modelId.split("/");
    const registered = this.providers.get(providerName);
    if (!registered) {
      throw new Error(`Provider not found: ${providerName}`);
    }
    return {
      provider: registered.provider,
      providerName,
      modelName: rest.length > 0 ? rest.join("/") : undefined,
    };
  }

  /**
   * 路由一个 chat 请求：
   * - modelId 形如 "provider/model" 或仅 provider 名称
   * - registry 负责按 provider 前缀分发，并将 modelId 原样透传给底层 provider
   */
  async chat(modelId: string, request: unknown): Promise<unknown> {
    const { provider, providerName } = this.resolve(modelId);
    if (!provider.chat) {
      throw new Error(
        `Provider ${providerName} does not support legacy chat() method. Use AI SDK's streamText instead.`,
      );
    }

    const payload =
      request && typeof request === "object"
        ? { ...(request as Record<string, unknown>), modelId }
        : { request, modelId };

    return provider.chat(payload);
  }
}
