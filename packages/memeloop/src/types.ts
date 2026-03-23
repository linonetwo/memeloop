import type {
  AgentDefinition,
  AgentInstanceMeta,
  AttachmentRef,
  ChatMessage,
  ConversationMeta,
} from "@memeloop/protocol";

import type { TaskAgentGenerator, TaskAgentInput } from "./framework/taskAgentContract.js";

export type ConversationQueryMode = "metadata-only" | "full-content" | "on-demand";

export interface ListConversationsOptions {
  limit?: number;
  offset?: number;
}

export interface GetMessagesOptions {
  mode?: ConversationQueryMode;
}

export interface IAgentStorage {
  listConversations(options?: ListConversationsOptions): Promise<ConversationMeta[]>;

  getMessages(conversationId: string, options?: GetMessagesOptions): Promise<ChatMessage[]>;

  appendMessage(message: ChatMessage): Promise<void>;

  /**
   * Upsert conversation directory row (sync / Solid / peer metadata).
   */
  upsertConversationMetadata(meta: ConversationMeta): Promise<void>;

  /**
   * Insert messages if messageId not present (merge from remote / Pod); refreshes per-conversation messageCount.
   */
  insertMessagesIfAbsent(messages: ChatMessage[]): Promise<void>;

  getAttachment(contentHash: string): Promise<AttachmentRef | null>;

  saveAttachment(ref: AttachmentRef, data: Buffer | Uint8Array): Promise<void>;

  /**
   * 读取已落库的附件二进制（用于节点间 RPC `memeloop.storage.getAttachmentBlob`）。
   * 未实现时远端同步应通过其它通道拉取附件。
   */
  readAttachmentData?(contentHash: string): Promise<Uint8Array | null>;

  getAgentDefinition(id: string): Promise<AgentDefinition | null>;

  /**
   * 若实现，可用 `SELECT MAX(lamportClock)` 避免为时钟扫描全量消息。
   */
  getMaxLamportClockForConversation?(conversationId: string): Promise<number>;

  saveAgentInstance(meta: AgentInstanceMeta): Promise<void>;

  /**
   * 读取会话目录行（用于 TaskAgent 解析 definitionId 等）。
   */
  getConversationMeta(conversationId: string): Promise<ConversationMeta | null>;

  /** IM 用户与会话绑定（memeloop-node + SQLite 持久化）。 */
  getImBinding?(channelId: string, imUserId: string): Promise<ImChannelBindingRecord | null>;
  setImBinding?(record: ImChannelBindingRecord): Promise<void>;
}

/** 与 {@link IAgentStorage.getImBinding} / IMChannelManager 对齐的绑定记录。 */
export interface ImChannelBindingRecord {
  channelId: string;
  imUserId: string;
  activeConversationId: string;
  defaultDefinitionId?: string;
}

export interface MemeLoopLogger {
  debug?(msg: string, ...args: unknown[]): void;
  info?(msg: string, ...args: unknown[]): void;
  warn?(msg: string, ...args: unknown[]): void;
  error?(msg: string, ...args: unknown[]): void;
}

export interface ILLMProvider {
  name: string;
  /**
   * 统一的 chat completion 接口（后续对接 Vercel AI SDK）。
   */
  chat(request: unknown): AsyncIterable<unknown> | Promise<unknown>;
}

export interface IToolRegistry {
  registerTool(id: string, impl: unknown): void;
  getTool(id: string): unknown | undefined;
  listTools(): string[];
  /**
   * Prompt-concat 插件表（defineTool 注册的 `PromptConcatTool`），按运行时隔离。
   * 未实现时回退到进程级默认注册表（见 pluginRegistry）。
   */
  getPromptPlugins?: () => Map<string, (hooks: import("./tools/types.js").PromptConcatHooks) => void>;
}

export interface IChatSyncAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface INetworkService {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface TaskAgentRuntimeOptions {
  /** 最大 LLM↔工具往返次数，0 表示不限制（仍受内部安全上限约束） */
  maxIterations?: number;
  /** 是否解析 `<tool_use>` / `<function_call>` 并通过 IToolRegistry 执行（默认 true） */
  enableToolLoop?: boolean;
  /** 取消检查（例如用户点停止）；按会话维度 */
  isCancelled?: (conversationId: string) => boolean;
  /** promptConcat 附件注入（与 PromptConcatOptions 一致） */
  readAttachmentFile?: (path: string) => Promise<Uint8Array | Buffer>;
  /** 超过该时长的历史消息不送入 LLM（毫秒）；0 或未设置表示不裁剪 */
  maxHistoryAgeMs?: number;
  /**
   * 在已配置 `defineTool` / plugins 时，对未被 `onResponseComplete` 处理的 tool 调用回退到 `IToolRegistry`（默认 true）。
   */
  fallbackRegistryTools?: boolean;
}

export interface AgentFrameworkContext {
  storage: IAgentStorage;
  llmProvider: ILLMProvider;
  tools: IToolRegistry;
  syncAdapters: IChatSyncAdapter[];
  network: INetworkService;
  /** TaskAgent ReAct 行为（从 TidGi-Desktop taskAgent 迁移） */
  taskAgent?: TaskAgentRuntimeOptions;
  /**
   * 由宿主注入（如 memeloop-node）：存在时 `createMemeLoopRuntime` 在用户发消息后运行完整 TaskAgent 管线。
   */
  runTaskAgent?: (input: TaskAgentInput) => TaskAgentGenerator;
  /**
   * defineTool / TidGi 兼容：当前轮次的 agent 视图（`agent.messages` 与 `ChatMessage` 由 TaskAgent 同步）。
   */
  agent?: { id: string; messages: AgentInstanceMessage[] };
  /** 将 `AgentInstanceMessage` 持久化为协议 `ChatMessage`（可选，由 runtime 注入） */
  persistAgentMessage?: (message: AgentInstanceMessage) => Promise<void>;
  /**
   * 由 `createMemeLoopRuntime` 写入取消标记，`taskAgent.isCancelled` 应与此集合一致（如 memeloop-node）。
   */
  conversationCancellation?: Set<string>;
  /**
   * 解析 AgentDefinition（如节点合并 YAML + 内置 + SQLite）。未设置时仅用 `storage.getAgentDefinition`。
   */
  resolveAgentDefinition?: (definitionId: string) => Promise<AgentDefinition | null>;
  /** 未注入时 TaskAgent 等对关键路径使用 console.warn/error。 */
  logger?: MemeLoopLogger;
}

export type AgentInstanceState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "unknown";

export interface AgentInstanceLatestStatus {
  state: AgentInstanceState;
  message?: AgentInstanceMessage;
  created?: Date;
  modified?: Date;
}

export interface AgentInstanceMessage {
  id: string;
  agentId: string;
  role: "user" | "assistant" | "agent" | "tool" | "error";
  content: string;
  reasoning_content?: string;
  contentType?:
    | "text/plain"
    | "text/markdown"
    | "text/html"
    | "application/json"
    | "application/json+ndjson"
    | string;
  created?: Date;
  modified?: Date;
  metadata?: Record<string, unknown>;
  hidden?: boolean;
  duration?: number | null;
}

export interface AgentInstanceModel extends Omit<AgentDefinition, "name"> {
  agentDefId: string;
  name?: string;
  agentFrameworkConfig?: Record<string, unknown>;
  messages: AgentInstanceMessage[];
  status: AgentInstanceLatestStatus;
  created: Date;
  modified?: Date;
  closed?: boolean;
  volatile?: boolean;
  isSubAgent?: boolean;
  parentAgentId?: string;
}

export function isUserInitiatedConversation(meta: ConversationMeta): boolean {
  return meta.isUserInitiated;
}

export function createInstanceDeltaFromDefinition(
  def: AgentDefinition,
  overrides: Partial<AgentDefinition>,
): Partial<AgentDefinition> {
  const delta: Partial<AgentDefinition> = {};
  for (const key of Object.keys(overrides) as (keyof AgentDefinition)[]) {
    const val = overrides[key];
    if (val !== undefined && val !== def[key]) {
      (delta as Record<string, unknown>)[key] = val;
    }
  }
  return delta as Partial<AgentDefinition>;
}



