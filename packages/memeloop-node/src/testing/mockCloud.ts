import http from "node:http";

export interface StartedMockCloud {
  server: http.Server;
  port: number;
  baseUrl: string;
  stop(): Promise<void>;
}

export async function startMockCloud(): Promise<StartedMockCloud> {
  const nodeSecrets = new Map<string, string>();
  const issuedTokens = new Map<string, { nodeId: string }>();

  function json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  function readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", (d) => (data += d.toString()));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  function requireAuth(req: http.IncomingMessage): { ok: true; token: string } | { ok: false } {
    const h = req.headers["authorization"];
    if (!h || typeof h !== "string") return { ok: false };
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (!m) return { ok: false };
    const token = m[1];
    if (!issuedTokens.has(token)) return { ok: false };
    return { ok: true, token };
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "POST" && url === "/api/nodes/register") {
      const body = await readBody(req);
      if (!body.otp || typeof body.otp !== "string") return json(res, 400, { error: "missing otp" });
      // In real cloud, otp would be validated. Here: any otp works.
      const nodeId = `node_${Math.random().toString(16).slice(2, 10)}`;
      const nodeSecret = `secret_${Math.random().toString(16).slice(2, 18)}`;
      nodeSecrets.set(nodeId, nodeSecret);
      return json(res, 200, { nodeId, nodeSecret });
    }

    if (method === "POST" && url === "/api/nodes/token") {
      const body = await readBody(req);
      const { nodeId, nodeSecret } = body ?? {};
      if (!nodeId || !nodeSecret) return json(res, 400, { error: "missing nodeId/nodeSecret" });
      const expected = nodeSecrets.get(String(nodeId));
      if (!expected || expected !== String(nodeSecret)) return json(res, 401, { error: "invalid credentials" });
      const accessToken = `jwt_${Math.random().toString(16).slice(2, 18)}`;
      issuedTokens.set(accessToken, { nodeId: String(nodeId) });
      return json(res, 200, { accessToken, expiresIn: 900 });
    }

    const putNodeMatch = /^\/api\/nodes\/([^/]+)$/.exec(url);
    if (method === "PUT" && putNodeMatch) {
      const auth = requireAuth(req);
      if (!auth.ok) return json(res, 401, { error: "unauthorized" });
      // We accept any payload here as long as it's valid JSON.
      await readBody(req);
      return json(res, 200, { ok: true });
    }

    const heartbeatMatch = /^\/api\/nodes\/([^/]+)\/heartbeat$/.exec(url);
    if (method === "POST" && heartbeatMatch) {
      const auth = requireAuth(req);
      if (!auth.ok) return json(res, 401, { error: "unauthorized" });
      return json(res, 200, { ok: true });
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to start mock cloud server");

  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    server,
    port,
    baseUrl,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

