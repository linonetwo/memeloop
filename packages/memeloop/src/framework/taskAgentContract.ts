/** TaskAgent 对外契约（避免 types.ts ↔ taskAgent 循环引用）。 */

export interface TaskAgentInput {
  conversationId: string;
  message: string;
}

export interface TaskAgentStep {
  type: "thinking" | "tool" | "message";
  data: unknown;
}

export type TaskAgentGenerator = AsyncGenerator<TaskAgentStep, void, unknown>;
