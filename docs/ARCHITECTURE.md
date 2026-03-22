# MemeLoop Core & Node — Architecture Notes

High-level design and operational concerns for the `memeloop` and `memeloop-node` packages. Implementation details live in source.

## Runtime and TaskAgent

- **MemeLoopRuntime** delegates user turns to **TaskAgent** when `AgentFrameworkContext.runTaskAgent` is set (memeloop-node wires this after `createTaskAgent`). Without it, runtime only persists user messages (library/test mode).
- **Cancellation**: `conversationCancellation` (a `Set<string>`) aligns with `taskAgent.isCancelled(conversationId)`. `cancelAgent` adds the id; a new message clears it for that conversation.

## LLM Provider (Node)

- OpenAI-compatible HTTP providers may return **SSE** when the request body sets `stream: true` and the server responds with `text/event-stream`. **TaskAgent** unwraps `Promise` results before treating the value as an `AsyncIterable`.

## Peer Sync

- **ChatSyncEngine** runs against **ChatSyncPeer** implementations. For JSON-RPC peers, **memeloop-node** exposes:
  - `memeloop.sync.exchangeVersionVector`
  - `memeloop.sync.pullMissingMetadata`
  - `memeloop.sync.pullMissingMessages`
- Outbound transport: `createPeerRpcSyncTransport` → `PeerConnectionManager.sendRpcToNode`. A **ChatSyncEngine** instance is created when a peer manager exists; call `syncEngine.syncOnce()` from your host if you want periodic sync (not enabled by default in CLI).

## RPC Surface (Node)

- **File tools** are also available as `memeloop.file.read|write|list|search|tail` when `fileBaseDir` is set on the RPC context (same root as local file tools).
- **Agent definitions** for `memeloop.agent.getDefinitions` come from optional `agents:` in node YAML (`normalizeAgentDefinition` fills defaults).

## Protocol Capabilities

- **NodeCapabilities** includes `wikis: WikiInfo[]` and `imChannels` (channel ids). Consumers should tolerate empty arrays.

## IM Webhooks

- **HTTP**: `createNodeServer` serves `GET` and `POST` under `/im/webhook/<channelId>` (GET used for WeCom URL verification).
- **Platforms**: Telegram (unchanged); Discord (Ed25519 verify, Interaction ping + deferred slash commands); Lark (URL verification + plaintext `im.message.receive_v1`); WeCom (URL verify + JSON body parsing — not full XML/AES).

## Automated testing (Runtime + LLM)

- **Unit (memeloop / Vitest)**: `runtime.taskAgent.pipeline.test.ts` wires `createMemeLoopRuntime` with `createTaskAgent` (same as memeloop-node) and a scripted `ILLMProvider`, asserting a full **tool loop** (user → tool → assistant) and `initialMessage` turns.
- **Integration (memeloop-node / Vitest)**: `nodeRuntime.openaiIntegration.test.ts` starts a local **mock OpenAI** HTTP server (`testing/mockOpenAI.ts`) returning JSON `chat/completions`, uses real **SQLite** storage, and asserts both a simple reply and a **two-step** mock sequence (tool call then final text).
- **E2E (Cucumber)**: `features/agent.feature` drives a real node over WebSocket JSON-RPC; the “tool loop” scenario uses `replySequence` on the mock server plus a test-only `e2eEcho` tool registered on the started node.

## Build Order (Monorepo)

After changing **@memeloop/protocol** or **memeloop** types consumed by memeloop-node:

1. `pnpm --filter @memeloop/protocol build`
2. `pnpm --filter memeloop build`
3. Then build or typecheck **memeloop-node**

Stale `dist/*.d.ts` in dependencies will otherwise produce confusing TypeScript errors.
