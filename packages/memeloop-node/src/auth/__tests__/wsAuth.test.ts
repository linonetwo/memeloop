import { describe, expect, it, vi, afterEach } from "vitest";

import { createLanPinWsAuth } from "../wsAuth.js";

vi.mock("../../config", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

import { loadConfig, saveConfig } from "../../config";

describe("createLanPinWsAuth", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined when disabled or missing pin", () => {
    expect(createLanPinWsAuth({ auth: { ws: { enabled: false } } } as any, "x")).toBeUndefined();
    expect(createLanPinWsAuth({ auth: { ws: { enabled: true, mode: "lan-pin" } } } as any, "x")).toBeUndefined();
    expect(createLanPinWsAuth({ auth: { ws: { enabled: true, mode: "cloud", pin: "1" } } } as any, "x")).toBeUndefined();
  });

  it("verifies success and resets lanPinState", async () => {
    (loadConfig as any).mockReturnValue({
      auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" }, lanPinState: { failCount: 2, nextAllowedAt: 1 } },
    });
    const auth = createLanPinWsAuth({ auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" } } } as any, "cfg")!;
    const ok = await auth.verify({ nodeId: "n1", authType: "pin", credential: "123456" } as any);
    expect(ok).toBe(true);
    expect(saveConfig).toHaveBeenCalled();
  });

  it("rejects wrong credential and persists backoff state", async () => {
    (loadConfig as any).mockReturnValue({
      auth: { ws: { enabled: true, mode: "lan-pin", pin: "654321" }, lanPinState: { failCount: 0, nextAllowedAt: 0 } },
    });
    const auth = createLanPinWsAuth({ auth: { ws: { enabled: true, mode: "lan-pin", pin: "654321" } } } as any, "cfg")!;
    const ok = await auth.verify({ nodeId: "n1", authType: "pin", credential: "bad" } as any);
    expect(ok).toBe(false);
    expect(saveConfig).toHaveBeenCalled();
  });

  it("uses default lanPinState when latest config has no lanPinState", async () => {
    (loadConfig as any).mockReturnValue({
      auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" } },
    });
    const auth = createLanPinWsAuth({ auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" } } } as any, "cfg")!;
    const ok = await auth.verify({ nodeId: "n1", authType: "pin", credential: "bad" } as any);
    expect(ok).toBe(false);

    const savedCfg = (saveConfig as any).mock.calls[0][0];
    expect(savedCfg.auth.lanPinState.failCount).toBe(1);
  });

  it("caps exponential backoff at max value", async () => {
    const now = 1_700_000_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      (loadConfig as any).mockReturnValue({
        auth: {
          ws: { enabled: true, mode: "lan-pin", pin: "123456" },
          lanPinState: { failCount: 25, nextAllowedAt: 0 },
        },
      });
      const auth = createLanPinWsAuth(
        { auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" } } } as any,
        "cfg",
      )!;
      const ok = await auth.verify({ nodeId: "n1", authType: "pin", credential: "bad" } as any);
      expect(ok).toBe(false);

      const savedCfg = (saveConfig as any).mock.calls[0][0];
      expect(savedCfg.auth.lanPinState.failCount).toBe(26);
      expect(savedCfg.auth.lanPinState.nextAllowedAt).toBe(now + 300_000);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("rejects non-pin auth type", async () => {
    (loadConfig as any).mockReturnValue({
      auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" }, lanPinState: { failCount: 0, nextAllowedAt: 0 } },
    });
    const auth = createLanPinWsAuth({ auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" } } } as any, "cfg")!;
    const ok = await auth.verify({ nodeId: "n1", authType: "jwt", credential: "x" } as any);
    expect(ok).toBe(false);
  });

  it("rejects when latest config disables ws/mode/pin or backoff not reached", async () => {
    const base = { auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" }, lanPinState: { failCount: 0, nextAllowedAt: 0 } } };
    const auth = createLanPinWsAuth(base as any, "cfg")!;

    (loadConfig as any).mockReturnValueOnce({ auth: { ws: { enabled: false, mode: "lan-pin", pin: "123456" } } });
    await expect(auth.verify({ nodeId: "n1", authType: "pin", credential: "123456" } as any)).resolves.toBe(false);

    (loadConfig as any).mockReturnValueOnce({ auth: { ws: { enabled: true, mode: "cloud", pin: "123456" } } });
    await expect(auth.verify({ nodeId: "n1", authType: "pin", credential: "123456" } as any)).resolves.toBe(false);

    (loadConfig as any).mockReturnValueOnce({ auth: { ws: { enabled: true, mode: "lan-pin", pin: "" } } });
    await expect(auth.verify({ nodeId: "n1", authType: "pin", credential: "123456" } as any)).resolves.toBe(false);

    (loadConfig as any).mockReturnValueOnce({
      auth: { ws: { enabled: true, mode: "lan-pin", pin: "123456" }, lanPinState: { failCount: 3, nextAllowedAt: Date.now() + 60_000 } },
    });
    await expect(auth.verify({ nodeId: "n1", authType: "pin", credential: "123456" } as any)).resolves.toBe(false);
  });
});
