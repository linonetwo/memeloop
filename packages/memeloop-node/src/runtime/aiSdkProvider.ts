import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";
import type { ProviderEntry } from "../config";

/**
 * Create a Vercel AI SDK provider from a ProviderEntry configuration.
 * Supports two modes:
 * - "direct": Connect directly to LLM provider (default)
 * - "cloud-proxy": Route through memeloop-cloud /api/llm/* proxy (uses cloud JWT)
 */
export function createAiSdkProvider(entry: ProviderEntry): LanguageModelV1 {
  const { name, baseUrl, apiKey, model, mode } = entry;

  // Cloud-proxy mode: route through memeloop-cloud /api/llm/*
  // baseUrl should be cloud URL (e.g. https://cloud.memeloop.com)
  // apiKey should be user JWT token
  if (mode === "cloud-proxy") {
    const cloudBaseUrl = baseUrl || "http://localhost:3000";
    const proxyBaseUrl = `${cloudBaseUrl.replace(/\/$/, "")}/api/llm`;

    // Use OpenAI-compatible client pointing to cloud proxy
    const openai = createOpenAI({
      baseURL: proxyBaseUrl,
      apiKey: apiKey || "cloud-jwt-required",
    });
    return openai(model || "gpt-4");
  }

  // Direct mode: connect directly to LLM provider
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

export function resolveProviderModelId(entry: ProviderEntry): string {
  return entry.model?.trim() ? `${entry.name}/${entry.model.trim()}` : entry.name;
}
