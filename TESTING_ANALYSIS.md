# MemeLoop Node 端到端测试分析与改进计划

## 测试目标

验证 memeloop-node 的核心使用场景：

- 用户在 Node A（控制节点）通过 remoteAgent 工具
- 连接到 Node B（工作节点）
- 在 Node B 上执行编程任务（创建 Next.js 应用）
- 在 Node A 上获得执行结果和验证

## 当前实现状态

### ✅ 已实现的功能

1. **节点间通信**
   - WebSocket + JSON-RPC 2.0 传输层
   - Noise_XX 加密握手
   - LAN mDNS 自动发现
   - PIN 确认码配对

2. **remoteAgent 工具**
   - 列出在线节点和可用 definitions
   - 在远程节点创建 agent 实例
   - 发送任务消息
   - 订阅流式输出（30秒超时）
   - 返回摘要和 detailRef

3. **Provider 配置**
   - 支持自定义 provider（name, baseUrl, apiKey, model）
   - 支持 direct 和 cloud-proxy 两种模式
   - ProviderRegistry 动态路由

4. **工具系统**
   - file.read/write/list/search
   - terminal.execute/start/list/getOutput
   - wiki 工具
   - MCP 客户端透明代理

## 🚨 发现的问题

### 1. **缺少结果验证机制** (Critical)

**问题**: 用户无法直观验证远程节点的工作成果

- remoteAgent 只返回文本摘要
- 无法看到实际运行的应用界面
- 无法确认代码是否真的工作

**Cursor 3 的解决方案**:

> "Cloud agents produce demos and screenshots of their work for you to verify."

**需要实现**:

- `screenshot` 工具：截取本地运行结果
- `demo.start` 工具：启动开发服务器并返回 URL
- `demo.screenshot` 工具：自动打开浏览器并截图
- 结果附件传输机制（通过 RPC 或 Solid Pod）

### 2. **流式输出超时限制** (High)

**问题**: 30秒超时对复杂任务不够

- 创建 Next.js 应用需要 npm install，可能超过 30 秒
- 超时后无法继续获取输出

**需要改进**:

- 支持可配置的超时时间
- 支持主动轮询获取最新输出
- 支持任务完成通知机制

### 3. **错误处理和重试** (Medium)

**问题**: 网络中断或节点离线时缺少优雅处理

- 没有自动重连机制
- 没有任务状态持久化
- 无法恢复中断的任务

### 4. **工具权限管理** (Medium)

**问题**: 远程工具调用的安全性

- 配置文件中的 allowlist/blocklist 是静态的
- 没有运行时审批机制
- 没有工具调用审计日志

### 5. **Provider 配置验证** (Low)

**问题**: 配置错误时缺少友好提示

- API key 错误时才会在运行时发现
- 没有配置测试命令
- 没有 provider 健康检查

## 📋 改进计划

### Phase 1: 结果验证工具 (Priority: Critical)

#### 1.1 实现 screenshot 工具

```typescript
// packages/memeloop-node/src/tools/screenshot.ts
export const screenshotTool = {
  name: "screenshot",
  description: "Take a screenshot of a URL or local application",
  parameters: {
    url: { type: "string", description: "URL to screenshot" },
    selector: { type: "string", optional: true, description: "CSS selector to focus" },
    fullPage: { type: "boolean", optional: true, description: "Capture full page" },
  },
  async execute(params) {
    // Use puppeteer or playwright
    // Return base64 image data
    // Store in attachments with contentHash
  },
};
```

#### 1.2 实现 demo 工具

```typescript
// packages/memeloop-node/src/tools/demo.ts
export const demoStartTool = {
  name: "demo.start",
  description: "Start a development server and return access URL",
  parameters: {
    command: { type: "string", description: "Command to start server (e.g., 'npm run dev')" },
    cwd: { type: "string", description: "Working directory" },
    port: { type: "number", optional: true, description: "Expected port" },
  },
  async execute(params) {
    // Start server in background
    // Wait for port to be ready
    // Return local URL
    // Register for cleanup on agent completion
  },
};

export const demoScreenshotTool = {
  name: "demo.screenshot",
  description: "Start server, open in browser, and take screenshot",
  parameters: {
    command: { type: "string" },
    cwd: { type: "string" },
    url: { type: "string", optional: true, description: "Path to screenshot (default: /)" },
  },
  async execute(params) {
    // Combine demo.start + screenshot
    // Return screenshot + server URL
  },
};
```

#### 1.3 附件传输机制

- 扩展 RPC 协议支持二进制附件
- 或通过 Solid Pod 共享附件
- remoteAgent 返回时包含 attachments 数组

### Phase 2: 改进流式输出 (Priority: High)

#### 2.1 可配置超时

```yaml
# memeloop-node.yaml
remoteAgentStreamTimeoutMs: 120000 # 2 minutes
```

#### 2.2 主动轮询 API

```typescript
// 新增 RPC 方法
"memeloop.agent.getStatus": {
  conversationId: string
} => {
  status: "running" | "completed" | "error",
  lastUpdate: timestamp,
  summary: string
}
```

### Phase 3: 错误处理和重试 (Priority: Medium)

#### 3.1 任务状态持久化

- 将远程任务状态存入本地 SQLite
- 支持查询历史任务
- 支持重新连接后恢复

#### 3.2 自动重连

- WebSocket 断开时自动重连
- 重连后恢复订阅

### Phase 4: 安全和审计 (Priority: Medium)

#### 4.1 运行时工具审批

- 敏感工具（terminal.execute, file.write）需要用户确认
- 通过 askQuestion 机制实现
- 支持"本次允许"/"会话级允许"/"永久允许"

#### 4.2 审计日志

- 记录所有远程工具调用
- 包含：时间、节点、工具名、参数、结果

## 🧪 测试计划

### 测试场景 1: 基础连接测试

1. 启动 Node A (port 38472)
2. 启动 Node B (port 38473)
3. 验证 mDNS 发现
4. 验证 PIN 配对
5. 验证 RPC 通信

### 测试场景 2: 简单远程任务

1. Node A 调用 remoteAgent
2. Node B 执行 `echo "Hello from Node B"`
3. Node A 接收输出
4. 验证摘要和 detailRef

### 测试场景 3: Next.js 应用创建

1. Node A 发送任务："Create a simple Next.js app with a hello world page"
2. Node B 执行：
   - `npx create-next-app@latest my-app --typescript --tailwind --app --no-git`
   - 修改 app/page.tsx
   - `npm run dev`
3. Node B 截图 http://localhost:3000
4. Node A 接收截图和代码摘要

### 测试场景 4: 错误恢复

1. 任务执行中断开 Node B
2. 重新连接 Node B
3. 验证任务状态恢复

## 📝 配置示例

### Node A (控制节点)

```yaml
name: control-node
providers:
  - name: siliconflow
    baseUrl: https://api.siliconflow.cn/v1
    apiKey: sk-gzprlcjsxalqsqxutzmxnumpynrwulvgekadbgmiyzgtvwpk
    model: Qwen/Qwen3.5-397B-A17B
    mode: direct

auth:
  ws:
    enabled: true
    mode: lan-pin
    pin: "123456"

tools:
  allowlist:
    - "remoteAgent"
    - "file.read"
    - "terminal.execute"

remoteAgentStreamTimeoutMs: 120000
```

### Node B (工作节点)

```yaml
name: worker-node
providers:
  - name: siliconflow
    baseUrl: https://api.siliconflow.cn/v1
    apiKey: sk-gzprlcjsxalqsqxutzmxnumpynrwulvgekadbgmiyzgtvwpk
    model: Qwen/Qwen3.5-397B-A17B
    mode: direct

auth:
  ws:
    enabled: true
    mode: lan-pin
    pin: "123456"

tools:
  allowlist:
    - "file.*"
    - "terminal.*"
    - "screenshot"
    - "demo.*"
```

## 🎯 下一步行动

1. **立即实现** (本次会话):
   - [ ] 创建 screenshot 工具基础实现
   - [ ] 创建 demo 工具基础实现
   - [ ] 更新 remoteAgent 支持附件返回
   - [ ] 编写集成测试脚本

2. **后续优化**:
   - [ ] 实现可配置超时
   - [ ] 实现任务状态持久化
   - [ ] 实现工具审批机制
   - [ ] 添加审计日志

3. **文档完善**:
   - [ ] 编写端到端使用教程
   - [ ] 添加故障排查指南
   - [ ] 更新 API 文档
