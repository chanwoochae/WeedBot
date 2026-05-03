/**
 * GitHub 웹훅 이벤트 핸들러
 * issue_comment.created → /markup 명령어 또는 대화 이어가기
 * GitHub App 봇 코멘트로 마크업/스펙/대화 3개 유지
 */
import { processMarkup } from "./markup.service";
import { getInstallationToken, makeGhApi } from "./github-app.service";

// ─── 봇 코멘트 식별자 ────────────────────────────────────────────────────────
const MARKER = {
  markup: "<!-- MARKUP_BOT:markup -->",
  spec:   "<!-- MARKUP_BOT:spec -->",
  thread: "<!-- MARKUP_BOT:thread -->",
};

// ─── Figma URL 추출 (마크다운 링크 대응) ─────────────────────────────────────
function extractFigmaUrl(text: string): string | null {
  // 1) 마크다운 링크 [text](url) 내부 URL
  const md = text.match(/\[.*?\]\((https?:\/\/(?:www\.)?figma\.com\/[^)]+)\)/);
  if (md) return md[1];
  // 2) 순수 URL (], ), > 등으로 안 끊기게)
  const plain = text.match(/https?:\/\/(?:www\.)?figma\.com\/[^\s)\]>]+/);
  return plain?.[0] ?? null;
}

// ─── Figma API ───────────────────────────────────────────────────────────────
function parseFigmaUrl(url: string) {
  const fileMatch = url.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
  const nodeMatch = url.match(/node-id=([^&\s]+)/);
  if (!fileMatch) return null;
  return {
    fileKey: fileMatch[1],
    nodeId: nodeMatch ? decodeURIComponent(nodeMatch[1]).replace(/-/g, ":") : null,
  };
}

function summarizeFigmaNode(node: Record<string, unknown>, depth = 0): string {
  if (!node) return "";
  const indent = "  ".repeat(depth);
  const name = (node.name as string) ?? "unnamed";
  const type = (node.type as string) ?? "";
  const bb = node.absoluteBoundingBox as { width: number; height: number } | undefined;
  const bounds = bb ? ` [${Math.round(bb.width)}×${Math.round(bb.height)}]` : "";
  const text = node.characters ? ` "${node.characters}"` : "";
  let out = `${indent}- ${name} (${type})${bounds}${text}\n`;
  const children = node.children as Record<string, unknown>[] | undefined;
  if (children && depth < 4) {
    for (const child of children.slice(0, 12)) {
      out += summarizeFigmaNode(child, depth + 1);
    }
    if (children.length > 12) out += `${indent}  ... (${children.length - 12}개 더)\n`;
  }
  return out;
}

async function fetchFigmaContext(url: string | null): Promise<string | null> {
  const figmaKey = process.env.FIGMA_ACCESS_TOKEN;
  if (!figmaKey || !url) return null;
  const parsed = parseFigmaUrl(url);
  if (!parsed) return null;
  try {
    const endpoint = parsed.nodeId
      ? `https://api.figma.com/v1/files/${parsed.fileKey}/nodes?ids=${encodeURIComponent(parsed.nodeId)}`
      : `https://api.figma.com/v1/files/${parsed.fileKey}`;
    const res = await fetch(endpoint, { headers: { "X-Figma-Token": figmaKey } });
    if (!res.ok) return null;
    const data = await res.json() as { name?: string; nodes?: Record<string, { document: Record<string, unknown> }>; document?: Record<string, unknown> };
    const node = parsed.nodeId
      ? Object.values(data.nodes ?? {})[0]?.document
      : data.document;
    if (!node) return null;
    return `파일: ${data.name ?? "unknown"}\n컴포넌트 트리:\n${summarizeFigmaNode(node)}`;
  } catch (e) {
    console.warn("[Webhook] Figma fetch 실패:", (e as Error).message);
    return null;
  }
}

// ─── 코멘트 본문 빌더 ────────────────────────────────────────────────────────
function buildMarkupComment(markup: string) {
  return `${MARKER.markup}
## 📐 마크업

> 이 코멘트는 대화를 통해 업데이트됩니다.

\`\`\`
${markup}
\`\`\`
`;
}

function buildSpecComment(spec: string) {
  return `${MARKER.spec}
## 📋 컴포넌트 스펙

${spec}
`;
}

function buildThreadComment(reply: string, history: string) {
  const historyBlock = history.trim()
    ? `\n\n---\n\n<details>\n<summary>대화 요약</summary>\n\n${history}\n</details>`
    : "";
  return `${MARKER.thread}
## 💬

${reply}${historyBlock}
`;
}

function extractMarkdownCode(body: string) {
  const m = body.match(/```[\s\S]*?\n([\s\S]*?)```/);
  return m?.[1]?.trim() ?? body;
}

function extractSummary(body: string) {
  const m = body.match(/<summary>대화 요약<\/summary>\n\n([\s\S]*?)\n<\/details>/);
  return m?.[1]?.trim() ?? "";
}

async function upsertComment(
  api: ReturnType<typeof makeGhApi>,
  issueNumber: number,
  existing: { id: number } | undefined,
  body: string
) {
  if (existing) {
    await api.updateComment(existing.id, body);
  } else {
    await api.createComment(issueNumber, body);
  }
}

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────
export interface IssueCommentPayload {
  action: string;
  installation: { id: number };
  repository: { name: string; owner: { login: string } };
  issue: { number: number; title: string; pull_request?: unknown };
  comment: { id: number; body: string; user: { login: string; type: string } };
}

export async function handleIssueComment(payload: IssueCommentPayload): Promise<void> {
  const { action, installation, repository, issue, comment } = payload;

  // PR 코멘트 무시
  if (issue.pull_request) return;
  // 이벤트 타입 확인
  if (action !== "created") return;
  // 봇 코멘트 무시
  if (comment.user.type === "Bot") return;

  const owner = repository.owner.login;
  const repo  = repository.name;
  const issueNumber = issue.number;
  const commentBody = comment.body.trim();
  const isMarkupCmd = commentBody.startsWith("/markup");

  console.log(`[Webhook] issue_comment #${issueNumber} by ${comment.user.login}: ${commentBody.slice(0, 60)}`);

  const token = await getInstallationToken(installation.id);
  const api   = makeGhApi(token, owner, repo);

  const allComments = await api.getIssueComments(issueNumber);
  const botComments = {
    markup: allComments.find(c => c.body.includes(MARKER.markup)),
    spec:   allComments.find(c => c.body.includes(MARKER.spec)),
    thread: allComments.find(c => c.body.includes(MARKER.thread)),
  };
  const isInitialized = !!botComments.markup;

  if (!isMarkupCmd && !isInitialized) {
    console.log("[Webhook] /markup 명령 아님 + 세션 없음 — 스킵");
    return;
  }

  if (isMarkupCmd) {
    await handleInit(api, botComments, issueNumber, issue.title, comment.id, commentBody);
  } else {
    await handleConversation(api, botComments, issueNumber, comment.id, commentBody);
  }
}

// ─── 초기화 ───────────────────────────────────────────────────────────────────
async function handleInit(
  api: ReturnType<typeof makeGhApi>,
  botComments: { markup?: { id: number; body: string }; spec?: { id: number; body: string }; thread?: { id: number; body: string } },
  issueNumber: number,
  issueTitle: string,
  triggerCommentId: number,
  body: string
) {
  const figmaUrl = extractFigmaUrl(body);
  const extraInstruction = body
    .replace("/markup", "")
    .replace(/\[.*?\]\(https?:\/\/(?:www\.)?figma\.com\/[^)]+\)/g, "")  // md 링크
    .replace(/https?:\/\/(?:www\.)?figma\.com\/[^\s)\]>]+/g, "")        // plain 링크
    .trim();
  const figmaContext = await fetchFigmaContext(figmaUrl);

  console.log("[Webhook] handleInit — issueTitle:", issueTitle);

  const result = await processMarkup({
    type: "init",
    issueTitle,
    figmaContext: figmaContext ?? null,
    extraInstruction: extraInstruction || undefined,
  });

  const markup  = result.markup  ?? "마크업 생성 실패";
  const spec    = result.spec    ?? "스펙 정리 중...";
  const reply   = result.reply   ?? "마크업 초안을 작성했습니다.";
  const history = result.history ?? "";

  await upsertComment(api, issueNumber, botComments.markup, buildMarkupComment(markup));
  await upsertComment(api, issueNumber, botComments.spec,   buildSpecComment(spec));
  await upsertComment(api, issueNumber, botComments.thread, buildThreadComment(reply, history));
  await api.deleteComment(triggerCommentId);

  console.log("[Webhook] handleInit 완료");
}

// ─── 대화 이어가기 ────────────────────────────────────────────────────────────
async function handleConversation(
  api: ReturnType<typeof makeGhApi>,
  botComments: { markup?: { id: number; body: string }; spec?: { id: number; body: string }; thread?: { id: number; body: string } },
  issueNumber: number,
  triggerCommentId: number,
  userMessage: string
) {
  const currentMarkup  = extractMarkdownCode(botComments.markup?.body ?? "");
  const currentHistory = extractSummary(botComments.thread?.body ?? "");

  const result = await processMarkup({
    type: "conversation",
    currentMarkup,
    currentHistory,
    userMessage,
  });

  const newMarkup = result.markup;
  const reply     = result.reply   ?? userMessage;
  const history   = result.history ?? currentHistory;

  if (newMarkup && newMarkup !== "UNCHANGED" && botComments.markup) {
    await api.updateComment(botComments.markup.id, buildMarkupComment(newMarkup));
  }
  if (botComments.thread) {
    await api.updateComment(botComments.thread.id, buildThreadComment(reply, history));
  }
  await api.deleteComment(triggerCommentId);

  console.log("[Webhook] handleConversation 완료");
}
