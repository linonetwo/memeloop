# MemeLoop Remote Agent End-to-End Testing Guide

## Overview

This guide describes how to test the complete remote agent workflow where Node A (control node) dispatches tasks to Node B (worker node) for execution, with screenshot/demo verification capabilities.

## Prerequisites

- Two terminal windows
- Node.js installed
- memeloop-node built (`pnpm -C packages/memeloop-node build`)
- puppeteer installed (`pnpm -C packages/memeloop-node install`)

## Test Setup

### Step 1: Start Node B (Worker Node)

```bash
cd packages/memeloop-node
node dist/cli.js start \
  --config test-node-b.yaml \
  --port 38473 \
  --data-dir ./test-data-b \
  --keypair ./test-data-b/keypair.json
```

**Expected output:**

- `[memeloop-node] Starting node: worker-node`
- `[memeloop-node] WebSocket server listening on port 38473`
- `[memeloop-node] mDNS service published`
- `[memeloop-node] LAN PIN mode enabled (pin: 123456)`

### Step 2: Start Node A (Control Node)

In a second terminal:

```bash
cd packages/memeloop-node
node dist/cli.js start \
  --config test-node-a.yaml \
  --port 38472 \
  --data-dir ./test-data-a \
  --keypair ./test-data-a/keypair.json
```

**Expected output:**

- `[memeloop-node] Starting node: control-node`
- `[memeloop-node] WebSocket server listening on port 38472`
- `[memeloop-node] mDNS service published`
- `[memeloop-node] Discovered peer: worker-node (LAN)`
- `[memeloop-node] LAN PIN pairing successful with worker-node`

### Step 3: Verify Node Discovery

Check Node A logs for:

```
[memeloop-node] Peer online: worker-node (nodeId: <id>)
```

Check Node B logs for:

```
[memeloop-node] Peer online: control-node (nodeId: <id>)
```

## Test Scenarios

### Scenario 1: List Remote Nodes and Agents

From Node A, use the `remoteAgent` tool without parameters to list available nodes:

**Expected result:**

```json
{
  "nodes": [
    {
      "nodeId": "<worker-node-id>",
      "name": "worker-node",
      "definitions": [
        { "id": "default", "name": "Default Agent", ... }
      ]
    }
  ]
}
```

### Scenario 2: Create Next.js App on Remote Node

From Node A, dispatch a task to Node B:

**Task parameters:**

- `nodeId`: `<worker-node-id>` (from Step 3)
- `definitionId`: `"default"`
- `message`: `"Create a simple Next.js app in ./test-output/nextjs-demo directory. Use 'npx create-next-app@latest' with default options. After creation, start the dev server and take a screenshot of the homepage."`

**Expected workflow:**

1. Node A sends RPC to Node B: `memeloop.agent.create`
2. Node B creates agent instance with conversationId
3. Node A sends task message via `memeloop.agent.send`
4. Node B executes:
   - Creates directory `./test-output/nextjs-demo`
   - Runs `npx create-next-app@latest`
   - Starts dev server with `npm run dev`
   - Uses `demo.screenshot` tool to capture homepage
5. Node A receives streaming output
6. Node A gets final result with screenshot attachment

**Expected result structure:**

```json
{
  "success": true,
  "remoteNodeId": "<worker-node-id>",
  "remoteConversationId": "<conversation-id>",
  "summary": "Task completed. Next.js app created and running on http://localhost:3000",
  "detailRef": {
    "type": "conversation",
    "nodeId": "<worker-node-id>",
    "conversationId": "<conversation-id>"
  }
}
```

### Scenario 3: Verify Screenshot Tool

After Scenario 2, check Node B's data directory for:

- Screenshot file in attachments storage
- Screenshot metadata with contentHash

**Verification:**

```bash
# On Node B
ls -la test-data-b/attachments/
# Should show PNG files with hash-based names
```

### Scenario 4: Stop Remote Demo Server

From Node A, send cleanup task:

**Task parameters:**

- `nodeId`: `<worker-node-id>`
- `definitionId`: `"default"`
- `message`: `"Stop the demo server that was started earlier using demo.stop tool"`

**Expected:**

- Node B stops the dev server process
- Port 3000 becomes available again

## Verification Checklist

### LAN Discovery & Pairing

- [ ] Node B appears in Node A's peer list
- [ ] Node A appears in Node B's peer list
- [ ] PIN pairing succeeds (both nodes log success)
- [ ] WebSocket connection established

### Remote Agent Execution

- [ ] Node A can list Node B's agent definitions
- [ ] Node A can create agent instance on Node B
- [ ] Node A can send messages to remote agent
- [ ] Node A receives streaming output from Node B
- [ ] Task completes successfully on Node B

### Tool Execution on Remote Node

- [ ] `file.write` creates files on Node B
- [ ] `terminal.execute` runs commands on Node B
- [ ] `demo.start` launches dev server on Node B
- [ ] `screenshot` captures running application
- [ ] `demo.stop` terminates server process

### Screenshot & Demo Tools

- [ ] Screenshot tool captures valid PNG image
- [ ] Image is base64-encoded in result
- [ ] ContentHash is generated correctly
- [ ] Demo server auto-detects port from command
- [ ] Demo server waits for port to be ready
- [ ] Screenshot includes full page or specific selector

## Known Issues & Limitations

### Issue 1: Stream Timeout (30 seconds)

**Problem:** Remote agent stream timeout is hardcoded to 30 seconds in `remoteAgent.ts:92`

```typescript
const streamWaitMs = context.remoteAgentStreamTimeoutMs ?? 30_000;
```

**Impact:** Tasks like `npm install` or `create-next-app` may take longer than 30 seconds
**Workaround:** Increase timeout or implement task status polling
**Fix needed:** Make timeout configurable via agent definition or tool parameters

### Issue 2: No Attachment Transfer in Remote Agent

**Problem:** `remoteAgent` tool returns text summary only, no attachment support
**Impact:** Screenshots captured on Node B are not transferred to Node A
**Workaround:** Access Node B's storage directly or use Solid Pod sync
**Fix needed:** Extend `remoteAgent` result to include attachments array

### Issue 3: No Visual Result Verification on Control Node

**Problem:** User on Node A cannot see screenshot without accessing Node B
**Impact:** Cannot verify remote work results visually (Cursor 3 feature gap)
**Fix needed:** Implement attachment transfer via RPC or Solid Pod

### Issue 4: No Task Status Polling

**Problem:** If stream times out, no way to check if task is still running
**Impact:** Long-running tasks appear to fail even if still executing
**Fix needed:** Add `memeloop.agent.getStatus` RPC method

## Success Criteria

The test is successful if:

1. ✅ Both nodes discover each other via LAN mDNS
2. ✅ PIN pairing succeeds (pin: "123456")
3. ✅ Node A can list Node B's available agents
4. ✅ Node A can dispatch task to Node B
5. ✅ Node B executes task using local tools
6. ✅ Node B creates Next.js app successfully
7. ✅ Node B starts dev server and captures screenshot
8. ✅ Node A receives task completion confirmation
9. ✅ Screenshot file exists in Node B's storage
10. ⚠️ Screenshot is accessible from Node A (pending attachment transfer)

## Next Steps

After successful testing:

1. Fix stream timeout configuration
2. Implement attachment transfer in remote agent
3. Add task status polling API
4. Implement runtime tool approval for sensitive operations
5. Add audit logging for remote tool calls
6. Write user documentation with examples

## Troubleshooting

### Nodes don't discover each other

- Check firewall settings (allow UDP 5353 for mDNS)
- Verify both nodes are on same LAN
- Check mDNS service is running on both nodes

### PIN pairing fails

- Verify PIN matches in both config files (currently: "123456")
- Check `lanPinState.failCount` hasn't exceeded threshold
- Restart both nodes to reset pairing state

### Remote agent task fails

- Check Node B logs for error messages
- Verify tool is in Node B's allowlist
- Check Node B has necessary permissions (file write, terminal execute)

### Screenshot tool fails

- Verify puppeteer is installed: `node -e "require('puppeteer')"`
- Check Chrome/Chromium is downloaded: `ls ~/.cache/puppeteer/`
- Verify URL is accessible from Node B

### Demo server won't start

- Check port is not already in use: `netstat -an | grep 3000`
- Verify Node B has permission to spawn processes
- Check working directory exists and is writable
