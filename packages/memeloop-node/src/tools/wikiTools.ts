/**
 * Wiki tools for Agent: knowledge.wikiSearch, knowledge.editTiddler, knowledge.listTiddlers, knowledge.getTiddler.
 */

import type { IToolRegistry } from "memeloop";
import type { IWikiManager } from "../knowledge/wikiManager.js";

const WIKI_SEARCH_ID = "knowledge.wikiSearch";
const WIKI_EDIT_ID = "knowledge.editTiddler";
const WIKI_LIST_ID = "knowledge.listTiddlers";
const WIKI_GET_ID = "knowledge.getTiddler";

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
