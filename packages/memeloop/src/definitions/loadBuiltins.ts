import type { AgentDefinition } from "@memeloop/protocol";

import generalAssistant from "./general-assistant.json";
import codeAssistant from "./code-assistant.json";

/** 内置 Agent 定义（与 `general-assistant.json` / `code-assistant.json` 同步）。 */
export function getBuiltinAgentDefinitions(): AgentDefinition[] {
  return [generalAssistant, codeAssistant] as unknown as AgentDefinition[];
}
