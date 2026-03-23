import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { BuiltinToolContext } from "./types.js";
import { waitForQuestionAnswer } from "./questionWaitRegistry.js";

export const askQuestionConfigSchema = z.object({
  question: z.string().min(1),
  conversationId: z.string().min(1),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
});

export const ASK_QUESTION_TOOL_ID = "askQuestion";

export async function askQuestionImpl(
  args: Record<string, unknown>,
  ctx: BuiltinToolContext,
): Promise<{ result: string } | { error: string }> {
  const parsed = askQuestionConfigSchema.safeParse(args);
  if (!parsed.success) {
    return { error: "invalid_askQuestion_args" };
  }
  const { question, conversationId, timeoutMs } = parsed.data;
  const questionId = randomUUID();
  const timeout = timeoutMs ?? 300_000;
  ctx.notifyAskQuestion?.({ questionId, question, conversationId });
  try {
    const answer = await waitForQuestionAnswer(questionId, timeout);
    return { result: answer };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "askQuestion_failed" };
  }
}
