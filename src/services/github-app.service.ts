/**
 * GitHub App 인증 및 API 헬퍼
 * - RS256 JWT 생성 (내장 crypto 사용, 외부 패키지 불필요)
 * - Installation Access Token 발급
 * - 웹훅 서명 검증
 * - GitHub REST API 래퍼
 */
import crypto from "crypto";
import fs from "fs";

const GH_API = "https://api.github.com";

// ─── Private Key 로드 ─────────────────────────────────────────────────────────
function getPrivateKey(): string {
  const path = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (path) return fs.readFileSync(path, "utf8");
  const b64 = process.env.GITHUB_APP_PRIVATE_KEY_B64;
  if (b64) return Buffer.from(b64, "base64").toString("utf8");
  throw new Error("GitHub App private key 미설정 (GITHUB_APP_PRIVATE_KEY_PATH 또는 GITHUB_APP_PRIVATE_KEY_B64)");
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ─── App JWT 생성 (유효기간 10분) ─────────────────────────────────────────────
export function generateAppJWT(): string {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("GITHUB_APP_ID 미설정");
  const privateKey = getPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const sig = base64url(sign.sign(privateKey));
  return `${signingInput}.${sig}`;
}

// ─── Installation Access Token 발급 ──────────────────────────────────────────
export async function getInstallationToken(installationId: number): Promise<string> {
  const jwt = generateAppJWT();
  const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) throw new Error(`Installation token 발급 실패 ${res.status}: ${await res.text()}`);
  const data = await res.json() as { token: string };
  return data.token;
}

// ─── 웹훅 서명 검증 ───────────────────────────────────────────────────────────
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = `sha256=${hmac.digest("hex")}`;
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── GitHub REST API 래퍼 ─────────────────────────────────────────────────────
async function ghFetch(token: string, path: string, opts: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${GH_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json",
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`GitHub API ${res.status} ${path}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

export function makeGhApi(token: string, owner: string, repo: string) {
  return {
    getComments: () =>
      ghFetch(token, `/repos/${owner}/${repo}/issues`) as Promise<unknown>,
    getIssueComments: (issueNumber: number) =>
      ghFetch(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`) as Promise<Array<{ id: number; body: string; user: { login: string } }>>,
    createComment: (issueNumber: number, body: string) =>
      ghFetch(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: "POST", body: JSON.stringify({ body }),
      }),
    updateComment: (commentId: number, body: string) =>
      ghFetch(token, `/repos/${owner}/${repo}/issues/comments/${commentId}`, {
        method: "PATCH", body: JSON.stringify({ body }),
      }),
    deleteComment: (commentId: number) =>
      fetch(`${GH_API}/repos/${owner}/${repo}/issues/comments/${commentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }),
  };
}
