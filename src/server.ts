/**
 * WeedBot HTTP Server
 * GitHub Actions에서 마크업 요청을 받아 Ollama/Gemini로 처리
 * Port: 3002
 */
import http from "http";
import { processMarkup, MarkupRequest } from "./services/markup.service";

const PORT = Number(process.env.WEEDBOT_HTTP_PORT ?? 3002);
const API_KEY = process.env.PIPELINE_API_KEY ?? "";

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end",  () => resolve(data));
    req.on("error", reject);
  });
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!API_KEY) return false;
  const auth = req.headers["authorization"] ?? "";
  return auth === `Bearer ${API_KEY}`;
}

export function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";

    // ── Health check ──────────────────────────────────────
    if (req.method === "GET" && url === "/health") {
      return send(res, 200, { status: "ok", service: "weedbot" });
    }

    // ── Markup endpoint ───────────────────────────────────
    if (req.method === "POST" && url === "/api/markup") {
      if (!isAuthorized(req)) {
        return send(res, 401, { error: "Unauthorized" });
      }

      let body: MarkupRequest;
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw) as MarkupRequest;
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }

      try {
        console.log(`[HTTP] /api/markup type=${body.type}`);
        const result = await processMarkup(body);
        return send(res, 200, result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[HTTP] /api/markup error:", msg);
        return send(res, 500, { error: msg });
      }
    }

    // ── 404 ───────────────────────────────────────────────
    send(res, 404, { error: "Not found" });
  });

  server.listen(PORT, () => {
    console.log(`🌐 [WeedBot HTTP] Listening on port ${PORT}`);
  });

  return server;
}
