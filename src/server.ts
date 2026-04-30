/**
 * WeedBot HTTP Server
 * GitHub Actions에서 마크업 요청을 받아 Ollama/Gemini로 처리
 * Port: 3002
 */
import http from "http";
import { processMarkup, MarkupRequest } from "./services/markup.service";

const PORT = Number(process.env.WEEDBOT_HTTP_PORT ?? 3002);

function send(res: http.ServerResponse, status: number, body: unknown) {
  try {
    if (res.writableEnded) return;
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(json),
    });
    res.end(json);
  } catch (e) {
    console.error("[HTTP] send() error:", (e as Error).message);
  }
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
  const apiKey = (process.env.PIPELINE_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error("[HTTP] PIPELINE_API_KEY 미설정");
    return false;
  }
  const auth = req.headers["authorization"] ?? "";
  return auth === `Bearer ${apiKey}`;
}

export function startHttpServer() {
  // ── 프로세스 전역 에러 핸들러 ────────────────────────────
  process.on("uncaughtException", (err) => {
    console.error("[HTTP] uncaughtException:", err.message, err.stack);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[HTTP] unhandledRejection:", reason);
  });

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";

    // res 에러 이벤트 처리 (클라이언트 조기 연결 종료 등)
    res.on("error", (e) => console.error("[HTTP] res error:", e.message));

    // ── Health check ──────────────────────────────────────
    if (req.method === "GET" && url === "/health") {
      return send(res, 200, { status: "ok", service: "weedbot" });
    }

    // ── Markup endpoint ───────────────────────────────────
    if (req.method === "POST" && url === "/api/markup") {
      if (!isAuthorized(req)) {
        console.log(`[HTTP] 401 Unauthorized — auth: ${req.headers["authorization"]?.slice(0, 20) ?? "없음"}`);
        return send(res, 401, { error: "Unauthorized" });
      }

      let body: MarkupRequest;
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw) as MarkupRequest;
      } catch (e) {
        console.error("[HTTP] body parse error:", (e as Error).message);
        return send(res, 400, { error: "Invalid JSON" });
      }

      try {
        console.log(`[HTTP] /api/markup type=${body.type}`);
        const result = await processMarkup(body);
        console.log(`[HTTP] /api/markup 완료 — markup len=${result.markup?.length ?? 0}`);
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
