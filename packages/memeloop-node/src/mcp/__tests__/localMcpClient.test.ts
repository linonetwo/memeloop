import { describe, expect, it } from "vitest";

import { listAllMcpTools } from "../localMcpClient.js";

describe("localMcpClient", () => {
  it("listAllMcpTools returns empty array when no servers configured", async () => {
    await expect(listAllMcpTools([])).resolves.toEqual([]);
  });
});
