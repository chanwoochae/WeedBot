/**
 * GitHub 웹훅 이벤트 핸들러
 * issue_comment.created → /markup 명령어 또는 대화 이어가기
 * GitHub App 봇 코멘트로 마크업/스펙/대화 3개 유지
 */
import { processMarkup } from "./markup.service";
import { getInstallationToken, makeGhApi } from "./github-app.service";

// ─── 봇 코멘트 식별자 ────────────────────────────────────────────────────────
const MARKER = {
  markup:   "<!-- MARKUP_BOT:markup -->",
  spec:     "<!-- MARKUP_BOT:spec -->",
  thread:   "<!-- MARKUP_BOT:thread -->",
  progress: "<!-- MARKUP_BOT:progress -->",
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

// ─── 진행상황 알림 ────────────────────────────────────────────────────────────
function buildProgressComment(steps: string[]) {
  const stepsBlock = steps.length
    ? `\n<details>\n<summary>진행 상황</summary>\n\n${steps.map(s => `- ${s}`).join("\n")}\n</details>`
    : "";
  return `${MARKER.progress}\n## ⏳ 마크업 생성 중...\n\n> 잠시만 기다려주세요.${stepsBlock}\n`;
}

function startProgressTimer(
  api: ReturnType<typeof makeGhApi>,
  commentId: number,
  steps: string[],
  intervalMs = 20_000,
) {
  const startedAt = Date.now();
  const timer = setInterval(async () => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    try {
      await api.updateComment(
        commentId,
        buildProgressComment([...steps, `🔄 AI 응답 대기 중... (${elapsed}초 경과)`]),
      );
    } catch { /* 코멘트 이미 삭제됐을 수 있음 */ }
  }, intervalMs);
  return {
    addStep(step: string) { steps.push(step); },
    stop() { clearInterval(timer); },
  };
}

async function deleteProgressComment(
  api: ReturnType<typeof makeGhApi>,
  progressCommentId: number | null,
) {
  if (!progressCommentId) return;
  try {
    await api.deleteComment(progressCommentId);
  } catch { /* 이미 삭제됐을 수 있음 */ }
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
    markup:   allComments.find(c => c.body.includes(MARKER.markup)),
    spec:     allComments.find(c => c.body.includes(MARKER.spec)),
    thread:   allComments.find(c => c.body.includes(MARKER.thread)),
    progress: allComments.find(c => c.body.includes(MARKER.progress)),
  };
  const isInitialized = !!botComments.markup;

  // 이전 진행상황 코멘트가 남아있으면 정리
  if (botComments.progress) {
    await deleteProgressComment(api, botComments.progress.id);
  }

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
  // 1. 즉시 진행상황 코멘트 생성
  const steps: string[] = ["✅ 요청 접수"];
  const progressRes = await api.createComment(issueNumber, buildProgressComment(steps)) as { id: number };
  const progressId = progressRes.id;
  const progress = startProgressTimer(api, progressId, steps);

  try {
    // 2. Figma URL 추출 + 데이터 조회
    const figmaUrl = extractFigmaUrl(body);
    const extraInstruction = body
      .replace("/markup", "")
      .replace(/\[.*?\]\(https?:\/\/(?:www\.)?figma\.com\/[^)]+\)/g, "")  // md 링크
      .replace(/https?:\/\/(?:www\.)?figma\.com\/[^\s)\]>]+/g, "")        // plain 링크
      .trim();

    if (figmaUrl) {
      progress.addStep("🔄 Figma 데이터 조회 중...");
      await api.updateComment(progressId, buildProgressComment(steps));
    }
    const figmaContext = await fetchFigmaContext(figmaUrl);
    if (figmaUrl) {
      steps[steps.length - 1] = figmaContext ? "✅ Figma 데이터 조회 완료" : "⚠️ Figma 데이터 조회 실패 (링크만 참고)";
      await api.updateComment(progressId, buildProgressComment(steps));
    }

    // 3. AI 모델 호출
    progress.addStep("🔄 AI 모델 호출 중...");
    await api.updateComment(progressId, buildProgressComment(steps));

    console.log("[Webhook] handleInit — issueTitle:", issueTitle);
    const result = await processMarkup({
      type: "init",
      issueTitle,
      figmaContext: figmaContext ?? null,
      extraInstruction: extraInstruction || undefined,
    });

    progress.stop();
    steps[steps.length - 1] = "✅ AI 응답 수신 완료";
    progress.addStep("🔄 코멘트 작성 중...");
    await api.updateComment(progressId, buildProgressComment(steps));

    // 4. 결과 코멘트 생성/업데이트
    const markup  = result.markup  ?? "마크업 생성 실패";
    const spec    = result.spec    ?? "스펙 정리 중...";
    const reply   = result.reply   ?? "마크업 초안을 작성했습니다.";
    const history = result.history ?? "";

    await upsertComment(api, issueNumber, botComments.markup, buildMarkupComment(markup));
    await upsertComment(api, issueNumber, botComments.spec,   buildSpecComment(spec));
    await upsertComment(api, issueNumber, botComments.thread, buildThreadComment(reply, history));

    // 5. 진행상황 코멘트 + 유저 코멘트 삭제
    await deleteProgressComment(api, progressId);
    await api.deleteComment(triggerCommentId);

    console.log("[Webhook] handleInit 완료");
  } catch (e) {
    progress.stop();
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Webhook] handleInit 에러:", msg);
    // 에러 시 진행상황 코멘트를 에러 메시지로 업데이트
    try {
      await api.updateComment(progressId, `${MARKER.progress}\n## ❌ 마크업 생성 실패\n\n\`\`\`\n${msg}\n\`\`\`\n`);
    } catch { /* 코멘트 업데이트 실패 무시 */ }
  }
}

// ─── 대화 이어가기 ────────────────────────────────────────────────────────────
async function handleConversation(
  api: ReturnType<typeof makeGhApi>,
  botComments: { markup?: { id: number; body: string }; spec?: { id: number; body: string }; thread?: { id: number; body: string } },
  issueNumber: number,
  triggerCommentId: number,
  userMessage: string
) {
  // 1. 즉시 진행상황 코멘트 생성
  const steps: string[] = ["✅ 메시지 접수", "🔄 AI 응답 대기 중..."];
  const progressRes = await api.createComment(issueNumber, buildProgressComment(steps)) as { id: number };
  const progressId = progressRes.id;
  const progress = startProgressTimer(api, progressId, steps);

  try {
    const currentMarkup  = extractMarkdownCode(botComments.markup?.body ?? "");
    const currentHistory = extractSummary(botComments.thread?.body ?? "");

    const result = await processMarkup({
      type: "conversation",
      currentMarkup,
      currentHistory,
      userMessage,
    });

    progress.stop();

    const newMarkup = result.markup;
    const reply     = result.reply   ?? userMessage;
    const history   = result.history ?? currentHistory;

    if (newMarkup && newMarkup !== "UNCHANGED" && botComments.markup) {
      await api.updateComment(botComments.markup.id, buildMarkupComment(newMarkup));
    }
    if (botComments.thread) {
      await api.updateComment(botComments.thread.id, buildThreadComment(reply, history));
    }

    // 진행상황 코멘트 + 유저 코멘트 삭제
    await deleteProgressComment(api, progressId);
    await api.deleteComment(triggerCommentId);

    console.log("[Webhook] handleConversation 완료");
  } catch (e) {
    progress.stop();
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Webhook] handleConversation 에러:", msg);
    try {
      await api.updateComment(progressId, `${MARKER.progress}\n## ❌ 처리 실패\n\n\`\`\`\n${msg}\n\`\`\`\n`);
    } catch { /* 무시 */ }
  }
}
