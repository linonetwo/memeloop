/**
 * Wiki manager using the tiddlywiki npm package: boot wiki from path, use Wiki API for get/set/list/search.
 * Types from tw5-typed (ITiddlerFields). Supports wikiSearch, editTiddler, listTiddlers, getTiddler.
 * Wiki folder must exist and contain tiddlywiki.info (e.g. created with `npx tiddlywiki <path> --init`).
 */
/// <reference types="tw5-typed" />

import fs from "node:fs";
import path from "node:path";
import type { ITiddlerFields } from "tiddlywiki";

export type TiddlerFields = ITiddlerFields;

export interface IWikiManager {
  getTiddler(wikiId: string, title: string): Promise<ITiddlerFields | null>;
  setTiddler(wikiId: string, tiddler: ITiddlerFields): Promise<void>;
  listTiddlers(wikiId: string, filter?: { tag?: string; type?: string }): Promise<ITiddlerFields[]>;
  search(wikiId: string, query: string): Promise<ITiddlerFields[]>;
}

type TiddlyWikiInstance = {
  wiki: {
    getTiddler(title: string): { fields: ITiddlerFields } | undefined;
    addTiddler(tiddler: unknown): void;
    filterTiddlers(filter: string): string[];
  };
  Tiddler: new (fields: ITiddlerFields) => unknown;
  boot: { argv: string[]; boot: (cb?: (err?: Error) => void) => void };
};

function loadTiddlyWikiBoot(): { TiddlyWiki: () => TiddlyWikiInstance } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("tiddlywiki") as { TiddlyWiki: () => TiddlyWikiInstance };
}

function bootWiki(wikiPath: string): Promise<TiddlyWikiInstance> {
  const absolutePath = path.resolve(wikiPath);
  if (!fs.existsSync(absolutePath)) {
    return Promise.reject(new Error(`Wiki path does not exist: ${absolutePath}`));
  }
  const boot = loadTiddlyWikiBoot();
  const $tw = boot.TiddlyWiki();
  $tw.boot.argv = [absolutePath, "--load"];
  return new Promise((resolve, reject) => {
    $tw.boot.boot((err?: Error) => {
      if (err) {
        reject(err);
        return;
      }
      resolve($tw);
    });
  });
}

function tiddlerToFields(tiddler: { fields: ITiddlerFields }, title: string): ITiddlerFields {
  const f = { ...tiddler.fields };
  if (!f.title) f.title = title;
  if (!f.type) f.type = "text/vnd.tiddlywiki";
  return f;
}

export class TiddlyWikiWikiManager implements IWikiManager {
  private cache = new Map<string, Promise<TiddlyWikiInstance>>();

  constructor(private basePath: string) {}

  private wikiPath(wikiId: string): string {
    const resolved = path.resolve(this.basePath, wikiId);
    const base = path.resolve(this.basePath);
    if (!resolved.startsWith(base) && resolved !== base) {
      throw new Error("wikiId escapes base path");
    }
    return resolved;
  }

  private getWiki(wikiId: string): Promise<TiddlyWikiInstance> {
    let p = this.cache.get(wikiId);
    if (!p) {
      const wp = this.wikiPath(wikiId);
      p = bootWiki(wp);
      this.cache.set(wikiId, p);
    }
    return p;
  }

  async getTiddler(wikiId: string, title: string): Promise<ITiddlerFields | null> {
    const $tw = await this.getWiki(wikiId);
    const tiddler = $tw.wiki.getTiddler(title);
    if (!tiddler) return null;
    return tiddlerToFields(tiddler, title);
  }

  async setTiddler(wikiId: string, tiddler: ITiddlerFields): Promise<void> {
    const $tw = await this.getWiki(wikiId);
    const fields = { ...tiddler };
    if (!fields.title) fields.title = "";
    $tw.wiki.addTiddler(new $tw.Tiddler(fields));
  }

  async listTiddlers(
    wikiId: string,
    filter?: { tag?: string; type?: string },
  ): Promise<ITiddlerFields[]> {
    const $tw = await this.getWiki(wikiId);
    let filterStr = "[all[tiddlers]!is[system]sort[title]]";
    if (filter?.tag) {
      filterStr = `[all[tiddlers]!is[system]tag[${filter.tag}]sort[title]]`;
    } else if (filter?.type) {
      filterStr = `[all[tiddlers]!is[system]type[${filter.type}]sort[title]]`;
    }
    const titles = $tw.wiki.filterTiddlers(filterStr);
    const out: ITiddlerFields[] = [];
    for (const title of titles) {
      const tiddler = $tw.wiki.getTiddler(title);
      if (tiddler) out.push(tiddlerToFields(tiddler, title));
    }
    return out;
  }

  async search(wikiId: string, query: string): Promise<ITiddlerFields[]> {
    const $tw = await this.getWiki(wikiId);
    const escaped = query.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
    const filterStr = `[all[tiddlers]!is[system]search:title,text,tags[${escaped}]]`;
    const titles = $tw.wiki.filterTiddlers(filterStr);
    const out: ITiddlerFields[] = [];
    for (const title of titles) {
      const tiddler = $tw.wiki.getTiddler(title);
      if (tiddler) out.push(tiddlerToFields(tiddler, title));
    }
    return out;
  }
}

/** @deprecated Use TiddlyWikiWikiManager. FileWikiManager kept for backward compat or environments without tiddlywiki. */
export class FileWikiManager implements IWikiManager {
  private impl: TiddlyWikiWikiManager;
  constructor(basePath: string) {
    this.impl = new TiddlyWikiWikiManager(basePath);
  }
  getTiddler(wikiId: string, title: string): Promise<ITiddlerFields | null> {
    return this.impl.getTiddler(wikiId, title);
  }
  setTiddler(wikiId: string, tiddler: ITiddlerFields): Promise<void> {
    return this.impl.setTiddler(wikiId, tiddler);
  }
  listTiddlers(wikiId: string, filter?: { tag?: string; type?: string }): Promise<ITiddlerFields[]> {
    return this.impl.listTiddlers(wikiId, filter);
  }
  search(wikiId: string, query: string): Promise<ITiddlerFields[]> {
    return this.impl.search(wikiId, query);
  }
}
