/**
 * JSON-RPC 2.0 handlers: agent.*, terminal.*, knowledge.*, chat.*, file.*, mcp.*, auth.*, wiki.*
 */

import type { AgentDefinition, ConversationMeta, WikiInfo } from "@memeloop/protocol";

import type { MemeLoopRuntime } from "memeloop";
import { resolveQuestionAnswer } from "memeloop";
import { resolveApproval } from "memeloop";
import type { IAgentStorage } from "memeloop";
import type { ITerminalSessionManager } from "../terminal/index.js";
import type { IWikiManager } from "../knowledge/wikiManager.js";
import type { ImChannelYaml } from "../config.js";

function maxTimestampPerOrigin(metas: ConversationMeta[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of metas) {
    const t = typeof c.lastMessageTimestamp === "number" ? c.lastMessageTimestamp : 0;
    m[c.originNodeId] = Math.max(m[c.originNodeId] ?? 0, t);
  }
  return m;
}

export interface McpServerInfo {
  name: string;
  command: string;
  args?: string[];
}

export interface RpcHandlerContext {
  runtime: MemeLoopRuntime;
  storage: IAgentStorage;
  terminalManager?: ITerminalSessionManager;
  wikiManager?: IWikiManager;
  toolRegistry?: { listTools(): string[] };
  nodeId: string;
  /** Local MCP server configs for memeloop.mcp.listServers. */
  mcpServers?: McpServerInfo[];
  /** memeloop.im.* 使用的 YAML 配置（不含明文 token 输出） */
  imChannels?: ImChannelYaml[];
  /** memeloop.agent.getDefinitions */
  agentDefinitions?: AgentDefinition[];
  /** memeloop.file.* 根目录（与 CLI fileBaseDir 一致） */
  fileBaseDir?: string;
  /** 可选通知发送器（JSON-RPC notification）。 */
  notify?: (method: string, params: unknown) => void;
}

export async function handleRpc(
  context: RpcHandlerContext,
  method: string,
  params: unknown,
): Promise<unknown> {
  const { runtime, storage, terminalManager, wikiManager } = context;

  if (method === "memeloop.auth.handshake") {
    return { ok: true, nodeId: context.nodeId };
  }

  if (method === "memeloop.im.listChannels") {
    const channels = (context.imChannels ?? []).map((ch) => ({
      channelId: ch.channelId,
      platform: ch.platform,
      defaultDefinitionId: ch.defaultDefinitionId,
      hasBotToken: Boolean(ch.botToken?.trim()),
      hasWebhookSecret: Boolean(ch.webhookSecret?.trim()),
      hasDiscordPublicKey: Boolean(ch.discordPublicKey?.trim()),
      hasLarkEncryptKey: Boolean(ch.larkEncryptKey?.trim()),
      hasWecomEncodingAesKey: Boolean(ch.wecomEncodingAesKey?.trim()),
    }));
    return { channels };
  }

  if (method === "memeloop.im.getChannel") {
    const p = params as { channelId?: string };
    const id = typeof p?.channelId === "string" ? p.channelId.trim() : "";
    const ch = (context.imChannels ?? []).find((c) => c.channelId === id);
    if (!ch) {
      return { channel: null };
    }
    return {
      channel: {
        channelId: ch.channelId,
        platform: ch.platform,
        defaultDefinitionId: ch.defaultDefinitionId,
        hasBotToken: Boolean(ch.botToken?.trim()),
        hasWebhookSecret: Boolean(ch.webhookSecret?.trim()),
        hasDiscordPublicKey: Boolean(ch.discordPublicKey?.trim()),
        hasLarkEncryptKey: Boolean(ch.larkEncryptKey?.trim()),
        hasWecomEncodingAesKey: Boolean(ch.wecomEncodingAesKey?.trim()),
      },
    };
  }

  if (method === "memeloop.agent.create") {
    const p = params as { definitionId: string; initialMessage?: string };
    return runtime.createAgent({
      definitionId: p.definitionId,
      initialMessage: p.initialMessage,
    });
  }
  if (method === "memeloop.agent.send") {
    const p = params as { conversationId: string; message: string };
    await runtime.sendMessage({ conversationId: p.conversationId, message: p.message });
    return { ok: true };
  }
  if (method === "memeloop.agent.cancel") {
    const p = params as { conversationId: string };
    await runtime.cancelAgent(p.conversationId);
    return { ok: true };
  }
  if (method === "memeloop.agent.list") {
    const list = await storage.listConversations({ limit: 100 });
    return { conversations: list };
  }
  if (method === "memeloop.agent.getDefinitions") {
    return { definitions: context.agentDefinitions ?? [] };
  }
  if (method === "memeloop.agent.resolveQuestion") {
    const p = params as { questionId?: string; answer?: string };
    const questionId = typeof p?.questionId === "string" ? p.questionId.trim() : "";
    const answer = typeof p?.answer === "string" ? p.answer : "";
    if (!questionId || !answer) {
      return { ok: false };
    }
    const ok = resolveQuestionAnswer(questionId, answer);
    return { ok };
  }
  if (method === "memeloop.agent.resolveApproval") {
    const p = params as { approvalId?: string; decision?: "allow" | "deny" };
    const approvalId = typeof p?.approvalId === "string" ? p.approvalId.trim() : "";
    const decision = p?.decision === "allow" ? "allow" : "deny";
    if (!approvalId) {
      return { ok: false };
    }
    resolveApproval(approvalId, decision);
    return { ok: true };
  }

  if (terminalManager) {
    if (method === "memeloop.terminal.execute") {
      const p = params as {
        command: string;
        timeoutMs?: number;
        cwd?: string;
        waitMode?: "until-exit" | "until-timeout" | "detached";
        maxWaitMs?: number;
        stream?: boolean;
      };
      const command = p.command;
      const timeoutMs = p.timeoutMs ?? 60_000;
      const cwd = p.cwd;
      const waitMode = p.waitMode ?? "until-timeout";
      const maxWaitMs = p.maxWaitMs ?? timeoutMs;
      const stream = p.stream === true;
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0];
      const cmdArgs = parts.slice(1);

      const { sessionId } = await terminalManager.start({
        command: cmd,
        args: cmdArgs.length ? cmdArgs : undefined,
        cwd,
        promptPatterns: [{ name: "generic", regex: /[?%]\s*$|>\s*$|:\s*$/m }],
        idleTimeoutMs: Math.min(15_000, timeoutMs),
      });

      if (context.notify) {
        const unsubOutput = terminalManager.onOutput((chunk) => {
          if (chunk.sessionId !== sessionId) return;
          context.notify?.("memeloop.terminal.output.delta", chunk);
        });
        const unsubPrompt = terminalManager.onInteractionPrompt((prompt) => {
          if (prompt.sessionId !== sessionId) return;
          context.notify?.("memeloop.terminal.interaction.prompt", prompt);
        });
        const unsubStatus = terminalManager.onStatusUpdate((status) => {
          if (status.sessionId !== sessionId) return;
          context.notify?.("memeloop.terminal.status.update", status);
          if (status.status !== "running") {
            unsubOutput();
            unsubPrompt();
            unsubStatus();
          }
        });
        const info = terminalManager.get(sessionId);
        if (info?.status !== "running") {
          unsubOutput();
          unsubPrompt();
          unsubStatus();
        }
      }
      if (waitMode === "detached") {
        return { sessionId, status: "running", exitCode: null, done: false, timedOut: false, nextSeq: 1, chunks: [] };
      }
      const follow = await terminalManager.follow(sessionId, {
        fromSeq: 1,
        untilExit: waitMode === "until-exit",
        maxWaitMs,
      });
      const timedOut = waitMode === "until-timeout" && !follow.done;
      if (timedOut) await terminalManager.cancel(sessionId);
      const stdout = follow.chunks.filter((c) => c.stream === "stdout").map((c) => c.data).join("");
      const stderr = follow.chunks.filter((c) => c.stream === "stderr").map((c) => c.data).join("");
      return {
        sessionId,
        status: follow.status,
        exitCode: follow.exitCode,
        done: follow.done,
        nextSeq: follow.nextSeq,
        chunks: stream ? follow.chunks : [],
        timedOut,
        stdout,
        stderr,
        output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ""),
      };
    }

    if (method === "memeloop.terminal.list") {
      return { sessions: await terminalManager.list() };
    }
    if (method === "memeloop.terminal.respond") {
      const p = params as { sessionId: string; input: string };
      await terminalManager.respond(p.sessionId, p.input);
      return { ok: true };
    }
    if (method === "memeloop.terminal.cancel") {
      const p = params as { sessionId: string };
      await terminalManager.cancel(p.sessionId);
      const info = terminalManager.get(p.sessionId);
      return { ok: true, sessionId: p.sessionId, finalStatus: info?.status ?? "killed" };
    }
    if (method === "memeloop.terminal.follow") {
      const p = params as { sessionId: string; fromSeq?: number; untilExit?: boolean; maxWaitMs?: number };
      return terminalManager.follow(p.sessionId, {
        fromSeq: p.fromSeq ?? 1,
        untilExit: p.untilExit === true,
        maxWaitMs: p.maxWaitMs ?? 30_000,
      });
    }
  }

  if (wikiManager) {
    if (method === "memeloop.knowledge.query" || method === "memeloop.knowledge.list") {
      const p = (params as { wikiId?: string; query?: string }) ?? {};
      const wikiId = p.wikiId ?? "default";
      const tiddlers = p.query
        ? await wikiManager.search(wikiId, p.query)
        : await wikiManager.listTiddlers(wikiId);
      return { tiddlers };
    }
    if (method === "memeloop.knowledge.get") {
      const p = params as { wikiId?: string; title: string };
      const tiddler = await wikiManager.getTiddler(p.wikiId ?? "default", p.title);
      return { tiddler: tiddler ?? null };
    }
    if (method === "memeloop.knowledge.write") {
      const p = params as { wikiId?: string; title: string; text?: string; type?: string; tags?: string | string[] };
      const tags = p.tags == null ? undefined : Array.isArray(p.tags) ? p.tags : p.tags.split(/\s+/).filter(Boolean);
      await wikiManager.setTiddler(p.wikiId ?? "default", {
        title: p.title,
        text: p.text ?? "",
        type: p.type ?? "text/vnd.tiddlywiki",
        ...(tags?.length ? { tags } : {}),
      });
      return { ok: true };
    }
  }

  if (method === "memeloop.wiki.listWikis") {
    const wikis: WikiInfo[] = wikiManager
      ? [{ wikiId: "default", title: "default" }]
      : [];
    return { wikis };
  }
  if (method === "memeloop.node.getInfo") {
    const tools = context.toolRegistry?.listTools?.() ?? [];
    const imChannelIds = (context.imChannels ?? []).map((c) => c.channelId);
    const wikis: WikiInfo[] = wikiManager
      ? [{ wikiId: "default", title: "default" }]
      : [];
    return {
      nodeId: context.nodeId,
      capabilities: {
        tools,
        hasWiki: !!wikiManager,
        mcpServers: (context.mcpServers ?? []).map((s) => s.name),
        imChannels: imChannelIds,
        wikis,
      },
    };
  }

  if (method === "memeloop.mcp.listServers") {
    return { servers: (context.mcpServers ?? []).map((s) => ({ name: s.name })) };
  }
  if (method === "memeloop.mcp.listTools") {
    try {
      const { listAllMcpTools } = await import("../mcp/localMcpClient.js");
      const tools = await listAllMcpTools(context.mcpServers ?? []);
      return { tools };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `MCP listTools failed: ${message}`, tools: [] as unknown[] };
    }
  }
  if (context.fileBaseDir) {
    const root = context.fileBaseDir;
    if (method === "memeloop.file.read") {
      const { runFileReadRpc } = await import("../tools/fileSystem.js");
      return runFileReadRpc((params as Record<string, unknown>) ?? {}, root);
    }
    if (method === "memeloop.file.write") {
      const { runFileWriteRpc } = await import("../tools/fileSystem.js");
      return runFileWriteRpc((params as Record<string, unknown>) ?? {}, root);
    }
    if (method === "memeloop.file.list") {
      const { runFileListRpc } = await import("../tools/fileSystem.js");
      return runFileListRpc((params as Record<string, unknown>) ?? {}, root);
    }
    if (method === "memeloop.file.search") {
      const { runFileSearchRpc } = await import("../tools/fileSystem.js");
      return runFileSearchRpc((params as Record<string, unknown>) ?? {}, root);
    }
    if (method === "memeloop.file.tail") {
      const { runFileTailRpc } = await import("../tools/fileSystem.js");
      return runFileTailRpc((params as Record<string, unknown>) ?? {}, root);
    }
  }

  if (method === "memeloop.sync.exchangeVersionVector") {
    const p = params as { localVersion?: Record<string, number> };
    const localVersion =
      p?.localVersion && typeof p.localVersion === "object" && !Array.isArray(p.localVersion)
        ? p.localVersion
        : {};
    const all = await storage.listConversations({ limit: 5000 });
    const clocks = maxTimestampPerOrigin(all);
    clocks[context.nodeId] = Math.max(clocks[context.nodeId] ?? 0, Date.now());
    const missingForRemote = all.filter(
      (c) => (localVersion[c.originNodeId] ?? 0) < (clocks[c.originNodeId] ?? 0),
    );
    return { remoteVersion: clocks, missingForRemote };
  }
  if (method === "memeloop.sync.pullMissingMetadata") {
    const p = params as { sinceVersion?: Record<string, number> };
    const since =
      p?.sinceVersion && typeof p.sinceVersion === "object" && !Array.isArray(p.sinceVersion)
        ? p.sinceVersion
        : {};
    const all = await storage.listConversations({ limit: 5000 });
    const clocks = maxTimestampPerOrigin(all);
    const metas = all.filter((c) => (since[c.originNodeId] ?? 0) < (clocks[c.originNodeId] ?? 0));
    return { metas };
  }
  if (method === "memeloop.sync.pullMissingMessages") {
    const p = params as { conversationId?: string; knownMessageIds?: string[] };
    const cid = typeof p?.conversationId === "string" ? p.conversationId.trim() : "";
    const known = new Set(Array.isArray(p?.knownMessageIds) ? p.knownMessageIds : []);
    if (!cid) {
      return { messages: [] };
    }
    const msgs = await storage.getMessages(cid, { mode: "full-content" });
    const messages = msgs.filter((m) => !known.has(m.messageId));
    return { messages };
  }

  if (method === "memeloop.storage.getAttachmentBlob") {
    const p = params as { contentHash?: string };
    const contentHash = typeof p?.contentHash === "string" ? p.contentHash.trim() : "";
    if (!contentHash) {
      return { error: "contentHash is required" };
    }
    const reader = storage.readAttachmentData;
    if (!reader) {
      return { error: "readAttachmentData not supported on this storage" };
    }
    const data = await reader(contentHash);
    if (!data?.length) {
      return { found: false as const };
    }
    const ref = await storage.getAttachment(contentHash);
    return {
      found: true as const,
      contentHash,
      filename: ref?.filename ?? "attachment",
      mimeType: ref?.mimeType ?? "application/octet-stream",
      size: ref?.size ?? data.length,
      dataBase64: Buffer.from(data).toString("base64"),
    };
  }

  if (method === "memeloop.mcp.callTool") {
    const p = params as { serverName?: string; toolName?: string; arguments?: Record<string, unknown> };
    const serverName = typeof p?.serverName === "string" ? p.serverName.trim() : "";
    const toolName = typeof p?.toolName === "string" ? p.toolName.trim() : "";
    if (!serverName || !toolName) {
      return { error: "serverName and toolName are required" };
    }
    try {
      const { callMcpToolOnServer } = await import("../mcp/localMcpClient.js");
      const result = await callMcpToolOnServer(context.mcpServers ?? [], serverName, toolName, p.arguments ?? {});
      return { result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `MCP callTool failed: ${message}` };
    }
  }

  throw new Error(`Method not found: ${method}`);
}
