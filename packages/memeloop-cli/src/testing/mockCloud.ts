import { randomBytes, verify, createPublicKey } from "node:crypto";
import http from "node:http";

export interface StartedMockCloud {
  server: http.Server;
  port: number;
  baseUrl: string;
  stop(): Promise<void>;
}

export async function startMockCloud(): Promise<StartedMockCloud> {
  const nodeSecrets = new Map<string, string>();
  const nodePubkeys = new Map<string, string>();
  const issuedTokens = new Map<string, { nodeId: string }>();
  const challenges = new Map<string, string>();

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
      if (typeof body.ed25519PublicKey === "string") nodePubkeys.set(nodeId, body.ed25519PublicKey);
      return json(res, 200, { nodeId, nodeSecret });
    }
    if (method === "POST" && url === "/api/nodes/auth/challenge") {
      const body = await readBody(req);
      const nodeId = typeof body?.nodeId === "string" ? body.nodeId : "";
      if (!nodeId) return json(res, 400, { error: "missing nodeId" });
      if (!nodePubkeys.has(nodeId)) return json(res, 404, { error: "node_not_found_or_no_pubkey" });
      const challenge = randomBytes(32).toString("base64url");
      challenges.set(nodeId, challenge);
      return json(res, 200, { challenge, expiresIn: 300 });
    }

    if (method === "POST" && url === "/api/nodes/auth/verify") {
      const body = await readBody(req);
      const nodeId = typeof body?.nodeId === "string" ? body.nodeId : "";
      const signature = typeof body?.signature === "string" ? body.signature : "";
      if (!nodeId || !signature) return json(res, 400, { error: "missing nodeId/signature" });
      const challenge = challenges.get(nodeId);
      const pub = nodePubkeys.get(nodeId);
      if (!challenge || !pub) return json(res, 401, { error: "challenge_not_found" });
      const ok = verify(
        null,
        Buffer.from(challenge, "base64url"),
        createPublicKey({ key: Buffer.from(pub, "base64url"), format: "der", type: "spki" }),
        Buffer.from(signature, "base64url"),
      );
      if (!ok) return json(res, 401, { error: "invalid_signature" });
      const accessToken = `jwt_${Math.random().toString(16).slice(2, 18)}`;
      issuedTokens.set(accessToken, { nodeId: String(nodeId) });
      challenges.delete(nodeId);
      return json(res, 200, { accessToken, expiresIn: 900 });
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
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
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
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

