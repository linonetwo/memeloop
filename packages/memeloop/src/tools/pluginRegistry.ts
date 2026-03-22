import type { HookSlot, PromptConcatHooks, PromptConcatTool } from "./types.js";

export const pluginRegistry = new Map<string, PromptConcatTool>();

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
 * TidGi `createHooksWithPlugins`：按 agentFrameworkConfig.plugins 把 `pluginRegistry` 里的工具挂到 hooks。
 */
export async function createHooksWithPlugins(agentFrameworkConfig: {
  plugins?: Array<{ toolId: string; [key: string]: unknown }>;
}): Promise<{
  hooks: PromptConcatHooks;
  pluginConfigs: Array<{ toolId: string; [key: string]: unknown }>;
}> {
  const hooks = createAgentFrameworkHooks();
  if (agentFrameworkConfig.plugins) {
    for (const pluginConfig of agentFrameworkConfig.plugins) {
      const { toolId } = pluginConfig;
      const plugin = pluginRegistry.get(toolId);
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
