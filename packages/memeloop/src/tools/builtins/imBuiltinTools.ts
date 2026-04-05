import { z } from "zod";

import type { MemeLoopRuntime } from "../../runtime.js";
import type { IMChannelManager } from "../../im/channelManager.js";
import type { BuiltinToolContext } from "./types.js";
import type { IToolRegistry } from "../../types.js";

import { registerToolParameterSchema } from "../schemaRegistry.js";

export const IM_SESSION_TOOL_IDS = [
  "im.listConversations",
  "im.switchConversation",
  "im.newConversation",
  "im.summarizeHistory",
] as const;

const listSchema = z.object({});

const switchSchema = z.object({
  conversationId: z.string().min(1),
});

const newSchema = z.object({
  definitionId: z.string().min(1).optional(),
});

const summarizeSchema = z.object({
  maxMessages: z.number().int().positive().max(200).optional(),
});

export interface ImSessionBuiltinRegistration {
  imChannelManager: IMChannelManager;
  getMemeLoopRuntime: () => MemeLoopRuntime;
}

function err(msg: string): { error: string } {
  return { error: msg };
}

async function requireImSource(
  ctx: BuiltinToolContext,
  conversationId: string,
): Promise<{ channelId: string; imUserId: string; platform: string } | { error: string }> {
  const meta = await ctx.storage.getConversationMeta(conversationId);
  const sc = meta?.sourceChannel;
  if (!sc) {
    return { error: "im_tools_only_in_im_session" };
  }
  return { channelId: sc.channelId, imUserId: sc.imUserId, platform: sc.platform };
}

export async function imListConversationsImpl(
  args: Record<string, unknown>,
  ctx: BuiltinToolContext,
  _reg: ImSessionBuiltinRegistration,
): Promise<{ result: string } | { error: string }> {
  const parsed = listSchema.safeParse(args);
  if (!parsed.success) return err("invalid_args");
  const cid = ctx.activeToolConversationId;
  if (!cid) return err("no_active_conversation");
  const src = await requireImSource(ctx, cid);
  if ("error" in src) return src;
  const all = await ctx.storage.listConversations({});
  if (all.length === 0) return { result: "（暂无会话）" };
  const sorted = [...all].sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
  const lines = sorted.map((m, i) => {
    const title = m.title || m.conversationId;
    const t = new Date(m.lastMessageTimestamp).toISOString();
    return `${i + 1}. ${title}\n   id: ${m.conversationId}\n   def: ${m.definitionId} | ${t}`;
  });
  return { result: `可切换的会话：\n${lines.join("\n")}` };
}

export async function imSwitchConversationImpl(
  args: Record<string, unknown>,
  ctx: BuiltinToolContext,
  reg: ImSessionBuiltinRegistration,
): Promise<{ result: string } | { error: string }> {
  const parsed = switchSchema.safeParse(args);
  if (!parsed.success) return err("invalid_args");
  const cid = ctx.activeToolConversationId;
  if (!cid) return err("no_active_conversation");
  const src = await requireImSource(ctx, cid);
  if ("error" in src) return src;
  await reg.imChannelManager.switchConversation(src.channelId, src.imUserId, parsed.data.conversationId);
  return { result: `已切换到会话：${parsed.data.conversationId}` };
}

export async function imNewConversationImpl(
  args: Record<string, unknown>,
  ctx: BuiltinToolContext,
  reg: ImSessionBuiltinRegistration,
): Promise<{ result: string } | { error: string }> {
  const parsed = newSchema.safeParse(args);
  if (!parsed.success) return err("invalid_args");
  const cid = ctx.activeToolConversationId;
  if (!cid) return err("no_active_conversation");
  const src = await requireImSource(ctx, cid);
  if ("error" in src) return src;
  const cur = await reg.imChannelManager.getBinding(src.channelId, src.imUserId);
  const defId = parsed.data.definitionId?.trim() || cur?.defaultDefinitionId || "memeloop:general-assistant";
  const rt = reg.getMemeLoopRuntime();
  const { conversationId } = await rt.createAgent({ definitionId: defId, initialMessage: "" });
  await reg.imChannelManager.setBinding({
    channelId: src.channelId,
    imUserId: src.imUserId,
    activeConversationId: conversationId,
    defaultDefinitionId: defId,
  });
  const meta = await ctx.storage.getConversationMeta(conversationId);
  if (meta) {
    await ctx.storage.upsertConversationMetadata({
      ...meta,
      sourceChannel: { channelId: src.channelId, platform: src.platform, imUserId: src.imUserId },
    });
  }
  return {
    result: `已新建并切换到会话：${conversationId}\ndefinition: ${defId}\n请让用户发送下一条消息以开始对话。`,
  };
}

export async function imSummarizeHistoryImpl(
  args: Record<string, unknown>,
  ctx: BuiltinToolContext,
  _reg: ImSessionBuiltinRegistration,
): Promise<{ result: string } | { error: string }> {
  const parsed = summarizeSchema.safeParse(args);
  if (!parsed.success) return err("invalid_args");
  const cid = ctx.activeToolConversationId;
  if (!cid) return err("no_active_conversation");
  const src = await requireImSource(ctx, cid);
  if ("error" in src) return src;
  void src;
  const max = parsed.data.maxMessages ?? 40;
  const msgs = await ctx.storage.getMessages(cid, { mode: "full-content" });
  const tail = msgs.slice(-max);
  if (tail.length === 0) return { result: "（当前会话尚无消息）" };
  const lines = tail.map((m) => `[${m.role}] ${m.content.slice(0, 2000)}${m.content.length > 2000 ? "…" : ""}`);
  return {
    result: `最近 ${tail.length} 条消息摘要（供 IM 上下文）：\n${lines.join("\n---\n")}`,
  };
}

/**
 * 注册 IM 会话专用工具（需节点传入 `imChannelManager` 与 `getMemeLoopRuntime`）。
 */
export function registerImSessionBuiltinTools(registry: IToolRegistry, ctx: BuiltinToolContext, reg: ImSessionBuiltinRegistration): void {
  const bound = (fn: typeof imListConversationsImpl) => (args: Record<string, unknown>) => fn(args, ctx, reg);

  registry.registerTool("im.listConversations", bound(imListConversationsImpl));
  registry.registerTool("im.switchConversation", bound(imSwitchConversationImpl));
  registry.registerTool("im.newConversation", bound(imNewConversationImpl));
  registry.registerTool("im.summarizeHistory", bound(imSummarizeHistoryImpl));

  registerToolParameterSchema("im.listConversations", listSchema, {
    displayName: "IM: list conversations",
    description: "List conversations the user can switch to (IM sessions only).",
  });
  registerToolParameterSchema("im.switchConversation", switchSchema, {
    displayName: "IM: switch conversation",
    description: "Switch this IM user binding to another conversationId.",
  });
  registerToolParameterSchema("im.newConversation", newSchema, {
    displayName: "IM: new conversation",
    description: "Create a new agent conversation and bind this IM user to it.",
  });
  registerToolParameterSchema("im.summarizeHistory", summarizeSchema, {
    displayName: "IM: summarize history",
    description: "Return a plain-text digest of recent messages in the current conversation.",
  });
}
