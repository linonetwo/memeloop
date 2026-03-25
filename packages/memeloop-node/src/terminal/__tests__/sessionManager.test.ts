import { describe, expect, it } from "vitest";

import { TerminalSessionManager } from "../sessionManager.js";

describe("TerminalSessionManager follow", () => {
  it("streams chunks with seq and supports follow from seq", async () => {
    const manager = new TerminalSessionManager({ maxChunksPerSession: 2000 });
    const { sessionId } = await manager.start({
      command: "node",
      args: ["-e", "console.log('a'); console.log('b');"],
    });

    const first = await manager.follow(sessionId, { fromSeq: 1, untilExit: true, maxWaitMs: 10_000 });
    expect(first.done).toBe(true);
    expect(first.chunks.length).toBeGreaterThan(0);
    expect(first.chunks[0]?.seq).toBeGreaterThanOrEqual(1);

    const next = await manager.follow(sessionId, { fromSeq: first.nextSeq, untilExit: false, maxWaitMs: 10 });
    expect(next.chunks).toEqual([]);
  });

  it("supports timeout follow and later resume", async () => {
    const manager = new TerminalSessionManager({ maxChunksPerSession: 2000 });
    const { sessionId } = await manager.start({
      command: "node",
      args: ["-e", "setTimeout(()=>console.log('late'), 1200);"],
    });
    const early = await manager.follow(sessionId, { fromSeq: 1, untilExit: false, maxWaitMs: 200 });
    expect(early.done).toBe(false);
    const late = await manager.follow(sessionId, { fromSeq: early.nextSeq, untilExit: true, maxWaitMs: 5000 });
    expect(late.done).toBe(true);
    expect(late.chunks.map((c) => c.data).join("")).toContain("late");
  });

  it("supports cancel and status transition", async () => {
    const manager = new TerminalSessionManager({ maxChunksPerSession: 2000 });
    const { sessionId } = await manager.start({
      command: "node",
      args: ["-e", "setInterval(()=>console.log('tick'), 100);"],
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await manager.cancel(sessionId);
    const info = manager.get(sessionId);
    expect(info?.status).toBe("killed");
  });

  it("isolates concurrent sessions", async () => {
    const manager = new TerminalSessionManager({ maxChunksPerSession: 2000 });
    const s1 = await manager.start({ command: "node", args: ["-e", "console.log('S1');"] });
    const s2 = await manager.start({ command: "node", args: ["-e", "console.log('S2');"] });
    const r1 = await manager.follow(s1.sessionId, { untilExit: true, maxWaitMs: 5000 });
    const r2 = await manager.follow(s2.sessionId, { untilExit: true, maxWaitMs: 5000 });
    expect(r1.chunks.map((c) => c.data).join("")).toContain("S1");
    expect(r1.chunks.map((c) => c.data).join("")).not.toContain("S2");
    expect(r2.chunks.map((c) => c.data).join("")).toContain("S2");
    expect(r2.chunks.map((c) => c.data).join("")).not.toContain("S1");
  });
});
