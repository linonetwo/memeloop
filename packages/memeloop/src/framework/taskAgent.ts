import type { AgentDefinition, ChatMessage } from "@memeloop/protocol";

import { matchAllToolCallings, type ToolCallingMatch } from "../prompt/responsePatternUtility.js";
import { promptConcatStream } from "../prompt/promptConcat.js";
import { responseConcat } from "../prompt/responseConcat.js";
import type { AgentFrameworkContext } from "../types.js";
import { nextLamportClockForConversation } from "../storage/nextLamport.js";
import { createHooksWithPlugins, runResponseCompleteHooks } from "../tools/pluginRegistry.js";
import type { DefineToolAgentFrameworkContext } from "../tools/types.js";
import { agentInstanceMessageToChatMessage, chatMessagesToAgentMessages } from "./agentMessageBridge.js";

export type { TaskAgentGenerator, TaskAgentInput, TaskAgentStep } from "./taskAgentContract.js";
import type { TaskAgentGenerator, TaskAgentInput } from "./taskAgentContract.js";

const ABSOLUTE_MAX_ITERATIONS = 256;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

type LlmRequestMessage = { role: "system" | "user" | "assistant" | "tool"; content: unknown };

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
      history,
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
    return [...withoutTrailingUser, ...history.map(chatMessageToModelMessage)];
  }

  const systemText = typeof def?.systemPrompt === "string" ? def.systemPrompt.trim() : "";
  if (systemText.length > 0) {
    return [{ role: "system", content: systemText }, ...history.map(chatMessageToModelMessage)];
  }

  return history.map(chatMessageToModelMessage);
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

    while (iteration < maxIterations) {
      iteration++;

      if (opts.isCancelled?.(input.conversationId)) {
        yield { type: "thinking", data: { status: "cancelled", conversationId: input.conversationId } };
        return;
      }

      const history = await context.storage.getMessages(input.conversationId, { mode: "full-content" });
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
        const { hooks } = await createHooksWithPlugins(fw as { plugins: Array<{ toolId: string }> });
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

      const execOne = async (call: (typeof pending)[0]) => {
        const { text, isError } = await executeRegistryTool(context, call.toolId, call.parameters);
        const lamportTool = await nextLamportClockForConversation(context.storage, input.conversationId);
        await context.storage.appendMessage({
          messageId: `${input.conversationId}:t:${call.toolId}:${Date.now().toString(36)}`,
          conversationId: input.conversationId,
          originNodeId: "local",
          timestamp: Date.now(),
          lamportClock: lamportTool,
          role: "tool",
          content: formatToolResultMessage(call.toolId, call.parameters, text, isError),
        });
      };

      if (parallel) {
        const results = await Promise.all(
          pending.map(async (call) => ({ call, ...(await executeRegistryTool(context, call.toolId, call.parameters)) })),
        );
        for (const row of results) {
          yield {
            type: "tool" as const,
            data: { toolId: row.call.toolId, parameters: row.call.parameters, parallel: true },
          };
        }
        for (const row of results) {
          const lamportTool = await nextLamportClockForConversation(context.storage, input.conversationId);
          await context.storage.appendMessage({
            messageId: `${input.conversationId}:t:${row.call.toolId}:${Date.now().toString(36)}`,
            conversationId: input.conversationId,
            originNodeId: "local",
            timestamp: Date.now(),
            lamportClock: lamportTool,
            role: "tool",
            content: formatToolResultMessage(row.call.toolId, row.call.parameters, row.text, row.isError),
          });
        }
      } else {
        for (const call of pending) {
          yield {
            type: "tool",
            data: { toolId: call.toolId, parameters: call.parameters, parallel: false },
          };
          await execOne(call);
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
