/**
 * Wiki tools for Agent: knowledge.wikiSearch, knowledge.editTiddler, knowledge.listTiddlers, knowledge.getTiddler.
 */

import type { IToolRegistry } from "memeloop";
import type { IWikiManager } from "../knowledge/wikiManager.js";

const WIKI_SEARCH_ID = "knowledge.wikiSearch";
const WIKI_EDIT_ID = "knowledge.editTiddler";
const WIKI_LIST_ID = "knowledge.listTiddlers";
const WIKI_GET_ID = "knowledge.getTiddler";
const WIKI_BACKLINKS_ID = "knowledge.backlinks";
const WIKI_TOC_ID = "knowledge.toc";
const WIKI_RECENT_ID = "knowledge.recent";
const WIKI_OPERATION_ID = "knowledge.wikiOperation";
const WIKI_PLUGIN_ID = "knowledge.tiddlywikiPlugin";
const WIKI_WORKSPACES_ID = "knowledge.workspacesList";

export function registerWikiTools(
  registry: IToolRegistry,
  wikiManager: IWikiManager,
  defaultWikiId: string = "default",
): void {
  registry.registerTool(WIKI_SEARCH_ID, (args: Record<string, unknown>) =>
    searchImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_EDIT_ID, (args: Record<string, unknown>) =>
    editImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_LIST_ID, (args: Record<string, unknown>) =>
    listImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_GET_ID, (args: Record<string, unknown>) =>
    getImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_BACKLINKS_ID, (args: Record<string, unknown>) =>
    backlinksImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_TOC_ID, (args: Record<string, unknown>) =>
    tocImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_RECENT_ID, (args: Record<string, unknown>) =>
    recentImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_OPERATION_ID, (args: Record<string, unknown>) =>
    wikiOperationImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_PLUGIN_ID, (args: Record<string, unknown>) =>
    pluginImpl(args, wikiManager, defaultWikiId),
  );
  registry.registerTool(WIKI_WORKSPACES_ID, (args: Record<string, unknown>) =>
    workspacesListImpl(args, wikiManager, defaultWikiId),
  );
}

async function searchImpl(
  args: Record<string, unknown>,
  manager: IWikiManager,
  defaultWikiId: string,
): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const query = args.query as string | undefined;
  if (!query || typeof query !== "string") {
    return { error: "Missing 'query'. Example: { query: 'keyword', wikiId?: " + defaultWikiId + " }" };
  }
  try {
    const tiddlers = await manager.search(wikiId, query);
    return { query, wikiId, count: tiddlers.length, tiddlers: tiddlers.map((t) => ({ title: t.title, type: t.type, tags: t.tags })) };
  } catch (e) {
    return { error: String(e) };
  }
}

async function editImpl(
  args: Record<string, unknown>,
  manager: IWikiManager,
  defaultWikiId: string,
): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const title = args.title as string | undefined;
  const text = args.text as string | undefined;
  const type = (args.type as string) ?? "text/vnd.tiddlywiki";
  const tags = args.tags as string | undefined;
  if (!title || typeof title !== "string") {
    return { error: "Missing 'title'. Example: { title: 'My Tiddler', text?: '...', type?, tags?, wikiId? }" };
  }
  try {
    const tagsArr =
      tags == null || tags === ""
        ? undefined
        : typeof tags === "string"
          ? tags.split(/[\s,]+/).filter(Boolean)
          : Array.isArray(tags)
            ? tags
            : undefined;
    await manager.setTiddler(wikiId, {
      title,
      text: text ?? "",
      type,
      ...(tagsArr?.length ? { tags: tagsArr } : {}),
    });
    return { ok: true, wikiId, title };
  } catch (e) {
    return { error: String(e) };
  }
}

async function listImpl(
  args: Record<string, unknown>,
  manager: IWikiManager,
  defaultWikiId: string,
): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const tag = args.tag as string | undefined;
  const type = args.type as string | undefined;
  try {
    const tiddlers = await manager.listTiddlers(wikiId, tag ? { tag } : type ? { type } : undefined);
    return { wikiId, count: tiddlers.length, tiddlers: tiddlers.map((t) => ({ title: t.title, type: t.type, tags: t.tags })) };
  } catch (e) {
    return { error: String(e) };
  }
}

async function getImpl(
  args: Record<string, unknown>,
  manager: IWikiManager,
  defaultWikiId: string,
): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const title = args.title as string | undefined;
  if (!title || typeof title !== "string") {
    return { error: "Missing 'title'. Example: { title: 'My Tiddler', wikiId? }" };
  }
  try {
    const tiddler = await manager.getTiddler(wikiId, title);
    if (!tiddler) return { found: false, wikiId, title };
    return { found: true, wikiId, tiddler };
  } catch (e) {
    return { error: String(e) };
  }
}

async function backlinksImpl(args: Record<string, unknown>, manager: IWikiManager, defaultWikiId: string): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const title = args.title as string | undefined;
  if (!title) return { error: "Missing 'title'" };
  const all = await manager.listTiddlers(wikiId);
  const linksTo = `[[${title}]]`;
  const tiddlers = all
    .filter((t) => typeof t.text === "string" && t.text.includes(linksTo))
    .map((t) => ({ title: t.title, type: t.type, tags: t.tags }));
  return { wikiId, title, count: tiddlers.length, tiddlers };
}

async function tocImpl(args: Record<string, unknown>, manager: IWikiManager, defaultWikiId: string): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const prefix = (args.prefix as string) ?? "";
  const all = await manager.listTiddlers(wikiId);
  const tiddlers = all
    .filter((t) => typeof t.title === "string" && (prefix ? t.title.startsWith(prefix) : true))
    .map((t) => ({ title: t.title, tags: t.tags, modified: t.modified }))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return { wikiId, count: tiddlers.length, tiddlers };
}

async function recentImpl(args: Record<string, unknown>, manager: IWikiManager, defaultWikiId: string): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const limit = Math.max(1, Math.min(100, Number(args.limit ?? 20)));
  const all = await manager.listTiddlers(wikiId);
  const tiddlers = all
    .map((t) => ({ title: t.title, modified: t.modified ?? "" }))
    .sort((a, b) => String(b.modified).localeCompare(String(a.modified)))
    .slice(0, limit);
  return { wikiId, count: tiddlers.length, tiddlers };
}

async function wikiOperationImpl(
  args: Record<string, unknown>,
  manager: IWikiManager,
  defaultWikiId: string,
): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const action = String(args.action ?? "get");
  const title = args.title as string | undefined;
  if (action === "get" && title) return getImpl({ wikiId, title }, manager, defaultWikiId);
  if (action === "set" && title) return editImpl(args, manager, defaultWikiId);
  if (action === "search") return searchImpl(args, manager, defaultWikiId);
  if (action === "list") return listImpl(args, manager, defaultWikiId);
  return { error: "Unsupported action. Use get|set|search|list" };
}

async function pluginImpl(args: Record<string, unknown>, manager: IWikiManager, defaultWikiId: string): Promise<unknown> {
  const wikiId = (args.wikiId as string) ?? defaultWikiId;
  const list = await manager.listTiddlers(wikiId, { type: "application/json" });
  const plugins = list
    .filter((t) => String(t.title ?? "").startsWith("$:/plugins/"))
    .map((t) => ({ title: t.title, version: t.version, author: t.author }));
  return { wikiId, count: plugins.length, plugins };
}

async function workspacesListImpl(
  _args: Record<string, unknown>,
  _manager: IWikiManager,
  defaultWikiId: string,
): Promise<unknown> {
  return { workspaces: [{ wikiId: defaultWikiId, title: defaultWikiId }] };
}
