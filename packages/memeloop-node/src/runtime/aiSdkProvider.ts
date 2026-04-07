import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";
import type { ProviderEntry } from "../config";

/**
 * Create a Vercel AI SDK provider from a ProviderEntry configuration.
 * Replaces the custom fetchProvider.ts with standard AI SDK libraries.
 */
export function createAiSdkProvider(entry: ProviderEntry): LanguageModelV1 {
  const { name, baseUrl, apiKey, model } = entry;

  // OpenAI and OpenAI-compatible providers
  if (name.includes("openai") || name.includes("gpt") || !name.includes("anthropic")) {
    const openai = createOpenAI({
      baseURL: baseUrl || "https://api.openai.com/v1",
      apiKey: apiKey,
    });
    return openai(model || "gpt-4");
  }

  // Anthropic (Claude)
  if (name.includes("anthropic") || name.includes("claude")) {
    const anthropic = createAnthropic({
      baseURL: baseUrl,
      apiKey: apiKey,
    });
    return anthropic(model || "claude-3-5-sonnet-20241022");
  }

  // Default fallback: OpenAI-compatible
  const openai = createOpenAI({
    baseURL: baseUrl || "https://api.openai.com/v1",
    apiKey: apiKey,
  });
  return openai(model || "gpt-4");
}
