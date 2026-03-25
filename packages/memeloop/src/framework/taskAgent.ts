import type { AgentDefinition, ChatMessage } from "@memeloop/protocol";

import { matchAllToolCallings, type ToolCallingMatch } from "../prompt/responsePatternUtility.js";
import { filterOldMessagesByDuration } from "../prompt/utilities.js";
import { promptConcatStream } from "../prompt/promptConcat.js";
import { responseConcat } from "../prompt/responseConcat.js";
import type { AgentFrameworkContext } from "../types.js";
import { nextLamportClockForConversation } from "../storage/nextLamport.js";
import { createHooksWithPlugins, resolvePromptPluginMap, runResponseCompleteHooks } from "../tools/pluginRegistry.js";
import { requestApproval } from "../tools/approval.js";
import type { DefineToolAgentFrameworkContext } from "../tools/types.js";
import { agentInstanceMessageToChatMessage, chatMessagesToAgentMessages } from "./agentMessageBridge.js";

export type { TaskAgentGenerator, TaskAgentInput, TaskAgentStep } from "./taskAgentContract.js";
import type { TaskAgentGenerator, TaskAgentInput } from "./taskAgentContract.js";

const ABSOLUTE_MAX_ITERATIONS = 256;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

type LlmRequestMessage = { role: "system" | "user" | "assistant" | "tool"; content: unknown };
type ToolPermissionAction = "allow" | "ask" | "deny";

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function resolveToolPermission(
  opts: AgentFrameworkContext["taskAgent"],
  definitionId: string,
  toolId: string,
): ToolPermissionAction {
  const global = opts?.toolPermissions;
  const scoped = global?.perAgent?.[definitionId];
  const rules = [...(scoped?.rules ?? []), ...(global?.rules ?? [])];
  for (const rule of rules) {
    if (wildcardMatch(rule.pattern, toolId)) {
      return rule.action;
    }
  }
  return scoped?.default ?? global?.default ?? "allow";
}

function compactHistory(history: ChatMessage[], opts: AgentFrameworkContext["taskAgent"]): ChatMessage[] {
  const maxMessages = opts?.contextCompaction?.maxMessages ?? 0;
  if (maxMessages <= 0 || history.length <= maxMessages) return history;
  const dropped = history.length - maxMessages;
  const tail = history.slice(-maxMessages);
  const summaryMessage: ChatMessage = {
    ...(tail[0] as ChatMessage),
    messageId: `${tail[0]?.conversationId ?? "unknown"}:summary:${Date.now().toString(36)}`,
    role: "assistant",
    content: `[context-summary] ${dropped} earlier messages were compacted.`,
  };
  if (opts?.contextCompaction?.replayLastUserMessage === false) return tail;
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (!lastUser) return [summaryMessage, ...tail];
  if (tail.some((m) => m.messageId === lastUser.messageId)) return tail;
  return [summaryMessage, lastUser, ...tail];
}

function chunkToText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk != null && typeof chunk === "object" && "content" in chunk) {
    const c = (chunk as { content?: unknown }).content;
    return typeof c === "string" ? c : JSON.stringify(c);
  }
  return JSON.stringify(chunk);
}

async function streamLlm(
  context: AgentFrameworkContext,
  request: unknown,
): Promise<{ chunks: unknown[]; text: string }> {
  const raw = context.llmProvider.chat(request);
  let resolved: unknown = raw;
  if (raw != null && typeof (raw as Promise<unknown>).then === "function") {
    resolved = await (raw as Promise<unknown>);
  }
  const chunks: unknown[] = [];
  if (isAsyncIterable(resolved)) {
    let acc = "";
    for await (const chunk of resolved) {
      chunks.push(chunk);
      acc += chunkToText(chunk);
    }
    return { chunks, text: acc };
  }
  chunks.push(resolved);
  return { chunks, text: chunkToText(resolved) };
}

function chatMessageToModelMessage(m: ChatMessage): LlmRequestMessage {
  return {
    role: m.role,
    content: m.content,
  };
}

async function resolveAgentDefinitionModel(
  context: AgentFrameworkContext,
  definitionId: string,
): Promise<AgentDefinition | null> {
  if (context.resolveAgentDefinition) {
    return context.resolveAgentDefinition(definitionId);
  }
  return context.storage.getAgentDefinition(definitionId);
}

async function inferDefinitionId(storage: AgentFrameworkContext["storage"], conversationId: string): Promise<string> {
  try {
    const meta = await storage.getConversationMeta(conversationId);
    if (meta?.definitionId) return meta.definitionId;
  } catch {
    /* optional on old mocks */
  }
  const parts = conversationId.split(":");
  if (parts.length >= 2) {
    return parts.slice(0, -1).join(":");
  }
  return conversationId;
}

async function buildLlmMessages(
  context: AgentFrameworkContext,
  conversationId: string,
  history: ChatMessage[],
): Promise<LlmRequestMessage[]> {
  const definitionId = await inferDefinitionId(context.storage, conversationId);
  const def = await resolveAgentDefinitionModel(context, definitionId);
  const fw = def?.agentFrameworkConfig as { prompts?: unknown[]; plugins?: unknown[] } | undefined;
  const maxHistoryAgeMs = context.taskAgent?.maxHistoryAgeMs ?? 0;
  const historyForPrompt =
    maxHistoryAgeMs > 0 ? filterOldMessagesByDuration(history, maxHistoryAgeMs) : history;

  if (fw?.prompts && Array.isArray(fw.prompts) && fw.prompts.length > 0) {
    const readAttachmentFile = context.taskAgent?.readAttachmentFile;
    const gen = promptConcatStream(
      {
        agentFrameworkConfig: {
          prompts: fw.prompts as import("../prompt/types.js").PromptNode[],
          plugins: (fw.plugins ?? []) as import("../prompt/types.js").PromptPluginConfig[],
          response: [],
        },
      },
      historyForPrompt,
      context,
      readAttachmentFile ? { readAttachmentFile } : undefined,
    );
    let lastFlat: LlmRequestMessage[] = [];
    for await (const state of gen) {
      lastFlat = state.flatPrompts as LlmRequestMessage[];
    }
    const withoutTrailingUser =
      lastFlat.length > 0 && lastFlat[lastFlat.length - 1]?.role === "user"
        ? lastFlat.slice(0, -1)
        : lastFlat;
    return [...withoutTrailingUser, ...historyForPrompt.map(chatMessageToModelMessage)];
  }

  const systemText = typeof def?.systemPrompt === "string" ? def.systemPrompt.trim() : "";
  if (systemText.length > 0) {
    return [{ role: "system", content: systemText }, ...historyForPrompt.map(chatMessageToModelMessage)];
  }

  return historyForPrompt.map(chatMessageToModelMessage);
}

function formatToolResultMessage(toolName: string, parameters: Record<string, unknown>, body: string, isError: boolean): string {
  return `<functions_result>
Tool: ${toolName}
Parameters: ${JSON.stringify(parameters)}
${isError ? "Error" : "Result"}: ${body}
</functions_result>`;
}

async function executeRegistryTool(
  context: AgentFrameworkContext,
  toolId: string,
  parameters: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const impl = context.tools.getTool(toolId) as
    | ((args: Record<string, unknown>) => unknown | Promise<unknown>)
    | undefined;

  if (typeof impl !== "function") {
    return {
      text: `No tool registered for "${toolId}".`,
      isError: true,
    };
  }

  try {
    const raw = await impl(parameters);
    if (raw != null && typeof raw === "object") {
      const o = raw as { error?: string; result?: unknown };
      if (typeof o.error === "string" && o.error.length > 0) {
        return { text: o.error, isError: true };
      }
      if ("result" in o) {
        return { text: typeof o.result === "string" ? o.result : JSON.stringify(o.result), isError: false };
      }
    }
    return { text: typeof raw === "string" ? raw : JSON.stringify(raw), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const log = context.logger?.warn ?? console.warn.bind(console);
    log("[taskAgent] tool execution error", toolId, message);
    return { text: message, isError: true };
  }
}

function toolCallHandledInAgentMessages(
  agentMessages: import("../types.js").AgentInstanceMessage[],
  assistantContent: string,
  call: ToolCallingMatch & { found: true },
): boolean {
  let assistantIdx = -1;
  for (let i = agentMessages.length - 1; i >= 0; i--) {
    const m = agentMessages[i];
    if (m.role === "assistant" && m.content === assistantContent) {
      assistantIdx = i;
      break;
    }
  }
  if (assistantIdx < 0) return false;
  const after = agentMessages.slice(assistantIdx + 1);
  return after.some(
    (m) =>
      m.role === "tool" &&
      (m.metadata?.toolId === call.toolId || (typeof m.content === "string" && m.content.includes(`Tool: ${call.toolId}`))),
  );
}

/**
 * TaskAgent：TidGi `basicPromptConcatHandler` 对齐版。
 *
 * - defineTool：`createHooksWithPlugins` + `responseComplete` + `responseConcat`（postProcess）
 * - 回退：`IToolRegistry` 执行未被插件处理的 tool 调用
 */
export function createTaskAgent(context: AgentFrameworkContext): (input: TaskAgentInput) => TaskAgentGenerator {
  return async function* taskAgent(input: TaskAgentInput): TaskAgentGenerator {
    const opts = context.taskAgent ?? {};
    const enableToolLoop = opts.enableToolLoop !== false;
    const fallbackRegistry = opts.fallbackRegistryTools !== false;
    const maxIterations =
      opts.maxIterations != null && opts.maxIterations > 0
        ? Math.min(opts.maxIterations, ABSOLUTE_MAX_ITERATIONS)
        : opts.maxIterations === 0
          ? ABSOLUTE_MAX_ITERATIONS
          : 32;

    const now = Date.now();
    const lamportClock = await nextLamportClockForConversation(context.storage, input.conversationId);
    const userMessage: ChatMessage = {
      messageId: `${input.conversationId}:${now.toString(36)}`,
      conversationId: input.conversationId,
      originNodeId: "local",
      timestamp: now,
      lamportClock,
      role: "user",
      content: input.message,
    };

    await context.storage.appendMessage(userMessage);

    let iteration = 0;
    const recentToolCalls: string[] = [];

    while (iteration < maxIterations) {
      iteration++;

      if (opts.isCancelled?.(input.conversationId)) {
        yield { type: "thinking", data: { status: "cancelled", conversationId: input.conversationId } };
        return;
      }

      const rawHistory = await context.storage.getMessages(input.conversationId, { mode: "full-content" });
      const history = compactHistory(rawHistory, opts);
      const agentMessages = chatMessagesToAgentMessages(input.conversationId, history);

      const hookCtx: DefineToolAgentFrameworkContext = {
        ...context,
        agent: { id: input.conversationId, messages: agentMessages },
        persistAgentMessage: async (m) => {
          const cm = await agentInstanceMessageToChatMessage(context.storage, input.conversationId, "local", m);
          await context.storage.appendMessage(cm);
        },
      };

      yield {
        type: "thinking",
        data: {
          status: "calling-llm",
          conversationId: input.conversationId,
          messageCount: history.length,
          iteration,
        },
      };

      const messages = await buildLlmMessages(context, input.conversationId, history);
      const request = { conversationId: input.conversationId, messages };
      const { chunks, text: assistantText } = await streamLlm(context, request);
      for (const c of chunks) {
        yield { type: "message", data: c };
      }

      const definitionId = await inferDefinitionId(context.storage, input.conversationId);
      const def = await resolveAgentDefinitionModel(context, definitionId);
      const fw = def?.agentFrameworkConfig as
        | { prompts?: unknown[]; plugins?: unknown[]; response?: unknown[] }
        | undefined;
      const hasPlugins = Boolean(fw?.plugins && Array.isArray(fw.plugins) && fw.plugins.length > 0);

      const assistantAgentMsg: import("../types.js").AgentInstanceMessage = {
        id: `${input.conversationId}:a:${Date.now().toString(36)}`,
        agentId: input.conversationId,
        role: "assistant",
        content: assistantText,
        created: new Date(),
        modified: new Date(),
      };
      hookCtx.agent.messages.push(assistantAgentMsg);
      await hookCtx.persistAgentMessage?.(assistantAgentMsg);

      const { calls, parallel } = matchAllToolCallings(assistantText);

      if (hasPlugins && fw) {
        const { hooks } = await createHooksWithPlugins(fw as { plugins: Array<{ toolId: string }> }, {
          pluginRegistry: resolvePromptPluginMap(context),
        });
        const rcPayload: {
          agentFrameworkContext: DefineToolAgentFrameworkContext;
          response: { status: "done"; content: string };
          agentFrameworkConfig: { plugins?: import("../tools/types.js").FrameworkPluginToolConfig[] };
          requestId: undefined;
          toolConfig: import("../tools/types.js").FrameworkPluginToolConfig;
          actions?: { yieldNextRoundTo?: "human" | "self" };
        } = {
          agentFrameworkContext: hookCtx,
          response: { status: "done", content: assistantText },
          agentFrameworkConfig: fw as { plugins?: import("../tools/types.js").FrameworkPluginToolConfig[] },
          requestId: undefined,
          toolConfig: { id: "_memeloop", toolId: "_memeloop" },
          actions: {},
        };
        await runResponseCompleteHooks(hooks, rcPayload);

        const post = await responseConcat(
          fw as {
            response?: import("../tools/types.js").AgentResponse[];
            plugins?: import("../tools/types.js").FrameworkPluginToolConfig[];
          },
          assistantText,
          hookCtx,
          hookCtx.agent.messages,
        );

        const yieldTarget = rcPayload.actions?.yieldNextRoundTo ?? post.yieldNextRoundTo;

        if (yieldTarget === "human") {
          yield {
            type: "thinking",
            data: { status: "input-required", conversationId: input.conversationId },
          };
          return;
        }
        if (yieldTarget === "self") {
          continue;
        }
      }

      if (calls.length === 0) {
        return;
      }

      if (!enableToolLoop) {
        return;
      }

      const pending = calls.filter((c) => !toolCallHandledInAgentMessages(hookCtx.agent.messages, assistantText, c));

      if (pending.length === 0) {
        if (hasPlugins && calls.length > 0) {
          continue;
        }
        return;
      }

      if (!fallbackRegistry && hasPlugins) {
        continue;
      }

      const executeWithGuards = async (
        call: (typeof pending)[0],
      ): Promise<{ text: string; isError: boolean }> => {
        const signature = `${call.toolId}:${JSON.stringify(call.parameters)}`;
        recentToolCalls.push(signature);
        const threshold = Math.max(2, opts.doomLoopThreshold ?? 3);
        const last = recentToolCalls.slice(-threshold);
        if (last.length === threshold && last.every((x) => x === signature)) {
          return { text: "Blocked by doom-loop guard", isError: true };
        }
        const permission = resolveToolPermission(opts, definitionId, call.toolId);
        if (permission === "deny") {
          return { text: "Denied by tool permission", isError: true };
        }
        if (permission === "ask") {
          const decision = await requestApproval(
            {
              approvalId: `${input.conversationId}:${Date.now().toString(36)}:${call.toolId}`,
              agentId: input.conversationId,
              toolName: call.toolId,
              parameters: call.parameters,
              created: new Date(),
            },
            60_000,
          );
          if (decision !== "allow") {
            return { text: "Tool approval denied or timed out", isError: true };
          }
        }
        return executeRegistryTool(context, call.toolId, call.parameters);
      };

      const persistToolResult = async (
        call: (typeof pending)[0],
        row: { text: string; isError: boolean },
      ): Promise<void> => {
        const lamportTool = await nextLamportClockForConversation(context.storage, input.conversationId);
        await context.storage.appendMessage({
          messageId: `${input.conversationId}:t:${call.toolId}:${Date.now().toString(36)}`,
          conversationId: input.conversationId,
          originNodeId: "local",
          timestamp: Date.now(),
          lamportClock: lamportTool,
          role: "tool",
          content: formatToolResultMessage(call.toolId, call.parameters, row.text, row.isError),
        });
      };

      if (parallel) {
        const results = await Promise.all(
          pending.map(async (call) => ({ call, ...(await executeWithGuards(call)) })),
        );
        for (const row of results) {
          yield {
            type: "tool" as const,
            data: { toolId: row.call.toolId, parameters: row.call.parameters, parallel: true },
          };
        }
        for (const row of results) {
          await persistToolResult(row.call, { text: row.text, isError: row.isError });
        }
      } else {
        for (const call of pending) {
          yield {
            type: "tool",
            data: { toolId: call.toolId, parameters: call.parameters, parallel: false },
          };
          const row = await executeWithGuards(call);
          await persistToolResult(call, row);
        }
      }

      continue;
    }

    yield {
      type: "thinking",
      data: { status: "max-iterations", conversationId: input.conversationId, maxIterations },
    };
  };
}
