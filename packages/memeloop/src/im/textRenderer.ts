import type { IIMMessageRenderer } from "./interface.js";

/** 通用文本/Markdown 友好输出（IM 端以纯文本展示） */
export class TextMessageRenderer implements IIMMessageRenderer {
  renderPlainText(content: string): string {
    return content.trim();
  }

  renderToolCall(toolName: string, args: unknown): string {
    return `🔧 工具调用：${toolName}\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;
  }

  renderToolResult(toolName: string, result: unknown): string {
    const s =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
    const clipped = s.length > 3500 ? `${s.slice(0, 3500)}\n…(截断)` : s;
    return `✅ 工具结果：${toolName}\n\`\`\`\n${clipped}\n\`\`\``;
  }

  renderToolApproval(toolName: string, args: unknown): string {
    return `⏸ 需要审批执行工具：${toolName}\n参数：\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n回复 Y 同意 / N 拒绝`;
  }

  renderAskQuestion(question: string, options?: string[]): string {
    const lines = options?.length
      ? [`❓ ${question}`, ...options.map((o, i) => `${i + 1}. ${o}`)]
      : [`❓ ${question}`];
    return lines.join("\n");
  }

  renderThinking(content: string): string {
    return `💭 ${content}`;
  }

  renderError(error: string): string {
    return `⚠️ 错误：${error}`;
  }

  renderTodoList(todos: Array<{ id: string; text: string; done?: boolean }>): string {
    return [
      "📋 Todo",
      ...todos.map((t) => `${t.done ? "[x]" : "[ ]"} ${t.text}`),
    ].join("\n");
  }
}
