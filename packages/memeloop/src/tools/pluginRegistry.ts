import { AsyncLocalStorage } from "node:async_hooks";

import type { HookSlot, PromptConcatHooks, PromptConcatTool } from "./types.js";

const defaultPluginRegistry = new Map<string, PromptConcatTool>();
/**
 * 默认全局注册表。生产与常规定义工具共用此 Map。
 * 测试或沙箱可用 {@link runWithPluginRegistry} 在 AsyncLocalStorage 中替换为独立 Map，避免用例间泄漏。
 */
export const pluginRegistry = defaultPluginRegistry;

const pluginRegistryAls = new AsyncLocalStorage<Map<string, PromptConcatTool>>();

export function getActivePluginRegistry(): Map<string, PromptConcatTool> {
  return pluginRegistryAls.getStore() ?? defaultPluginRegistry;
}

export function runWithPluginRegistry<T>(registry: Map<string, PromptConcatTool>, fn: () => T): T {
  return pluginRegistryAls.run(registry, fn);
}

/** Lightweight hook slot：tapAsync 注册，promise 串行执行（对齐 TidGi tapable AsyncSeriesHook） */
function createHookSlot(): HookSlot & { handlers: Array<(ctx: any, cb: () => void) => void> } {
  const handlers: Array<(ctx: any, cb: () => void) => void> = [];
  return {
    handlers,
    tapAsync(_name: string, fn: (ctx: any, cb: () => void) => void) {
      handlers.push(fn);
    },
    async promise(ctx: unknown) {
      for (const fn of handlers) {
        await new Promise<void>((resolve) => {
          fn(ctx, resolve);
        });
      }
    },
  };
}

export function createAgentFrameworkHooks(): PromptConcatHooks {
  return {
    processPrompts: createHookSlot(),
    finalizePrompts: createHookSlot(),
    postProcess: createHookSlot(),
    userMessageReceived: createHookSlot(),
    agentStatusChanged: createHookSlot(),
    toolExecuted: createHookSlot(),
    responseUpdate: createHookSlot(),
    responseComplete: createHookSlot(),
  };
}

const hookHandlers: {
  processPrompts?: Array<(ctx: any, cb: () => void) => void>;
} = {};

export async function runProcessPromptsHooks(_hooks: PromptConcatHooks, context: any): Promise<any> {
  const slot = _hooks.processPrompts as { handlers?: Array<(ctx: any, cb: () => void) => void> };
  const fns = slot?.handlers ?? hookHandlers.processPrompts ?? [];
  for (const fn of fns) {
    await new Promise<void>((resolve) => fn(context, resolve));
  }
  return context;
}

export async function runResponseCompleteHooks(hooks: PromptConcatHooks, context: unknown): Promise<void> {
  await hooks.responseComplete.promise(context);
}

export async function runPostProcessHooks(hooks: PromptConcatHooks, context: unknown): Promise<void> {
  await hooks.postProcess.promise(context);
}

export async function runToolExecutedHooks(hooks: PromptConcatHooks, context: unknown): Promise<void> {
  await hooks.toolExecuted.promise(context);
}

/**
 * TidGi `createHooksWithPlugins`：按 agentFrameworkConfig.plugins 把插件注册表里的工具挂到 hooks。
 */
/** 从 Agent 上下文解析插件表：优先 `tools.getPromptPlugins()`，否则 ALS / 全局默认。 */
export function resolvePromptPluginMap(context: {
  tools?: { getPromptPlugins?: () => Map<string, PromptConcatTool> };
}): Map<string, PromptConcatTool> {
  const fromTools = context.tools?.getPromptPlugins?.();
  if (fromTools) return fromTools;
  return getActivePluginRegistry();
}

export async function createHooksWithPlugins(
  agentFrameworkConfig: {
    plugins?: Array<{ toolId: string; [key: string]: unknown }>;
  },
  options?: { pluginRegistry?: Map<string, PromptConcatTool> },
): Promise<{
  hooks: PromptConcatHooks;
  pluginConfigs: Array<{ toolId: string; [key: string]: unknown }>;
}> {
  const reg = options?.pluginRegistry ?? getActivePluginRegistry();
  const hooks = createAgentFrameworkHooks();
  if (agentFrameworkConfig.plugins) {
    for (const pluginConfig of agentFrameworkConfig.plugins) {
      const { toolId } = pluginConfig;
      const plugin = reg.get(toolId);
      if (plugin) {
        plugin(hooks);
      }
    }
  }
  return {
    hooks,
    pluginConfigs: agentFrameworkConfig.plugins ?? [],
  };
}
