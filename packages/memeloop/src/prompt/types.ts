export interface PromptNode {
  id: string;
  text?: string;
  /** TidGi IPrompt 兼容 */
  caption?: string;
  role?: "system" | "user" | "assistant" | "tool";
  enabled?: boolean;
  children?: PromptNode[];
  /** UI 溯源，可选 */
  source?: unknown;
}

/** 与 TidGi `IPrompt` 对齐的别名 */
export type IPrompt = PromptNode;

export interface PromptPluginConfig {
  id: string;
  toolId: string;
  enabled?: boolean;
  /** defineTool：`approval`（mode / allowPatterns / denyPatterns）等，类型见 `tools/types` */
  [key: string]: unknown;
}

export interface AgentFrameworkConfig {
  prompts: PromptNode[];
  response?: unknown[];
  plugins: PromptPluginConfig[];
}

export interface AgentPromptDescription {
  agentFrameworkConfig?: AgentFrameworkConfig;
}

