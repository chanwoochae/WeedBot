/**
 * 마크업 협업 서비스
 * GitHub Issue 봇에서 호출 — Ollama (로컬) 또는 Gemini (폴백) 사용
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getOllamaBaseUrl() { return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"; }
function getOllamaModel()   { return process.env.OLLAMA_MODEL ?? "gemma4:31b"; }
function getOllamaTimeout() { return Number(process.env.OLLAMA_TIMEOUT_MS ?? 120000); }
function getGeminiModel()   { return process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"; }

export interface MarkupInitRequest {
  type: "init";
  issueTitle: string;
  figmaContext?: string | null;
  extraInstruction?: string;
}

export interface MarkupConversationRequest {
  type: "conversation";
  currentMarkup: string;
  currentHistory: string;
  userMessage: string;
}

export type MarkupRequest = MarkupInitRequest | MarkupConversationRequest;

export interface MarkupResponse {
  markup: string;
  spec?: string;
  reply: string;
  history: string;
}

// XML 태그에서 섹션 추출
function extract(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`));
  return m ? m[0].replace(new RegExp(`^<${tag}>|<\\/${tag}>$`, "g"), "").trim() : null;
}

async function callOllama(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getOllamaTimeout());
  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json() as { message: { content: string } };
    return data.message.content;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 없음");
  const res = await fetch(
    `${GEMINI_API_BASE}/${getGeminiModel()}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
  return data.candidates[0].content.parts[0].text;
}

async function callLLM(prompt: string): Promise<string> {
  try {
    const result = await callOllama(prompt);
    console.log("[Markup] LLM: Ollama");
    return result;
  } catch (e) {
    console.warn("[Markup] Ollama 실패, Gemini 폴백:", (e as Error).message);
    const result = await callGemini(prompt);
    console.log("[Markup] LLM: Gemini");
    return result;
  }
}

const MARKUP_RULES = `## 마크업 규칙
- ASCII 박스 레이아웃으로 컴포넌트 구조 표현
- Svelte 컴포넌트명 사용 (<ScoreBadge />, <ArticleCard />, <TagChip /> 등)
- 예시:
  | <DragHandle />                                           |
  | <ScoreBadge score={9} />  <SourceInfo />  <Bookmark />  |
  |----------------------------------------------------------|
  | <TitlePanel>제목</TitlePanel>                            |
  | <SummaryPanel>AI 요약</SummaryPanel>                    |
  | <TagList tags={tags} />                                 |
  | <PrimaryButton>원문 보기</PrimaryButton>                |

## 스펙 작성 규칙 (중요!)
- 이슈 제목에서 요청한 **대상 컴포넌트 1개**의 Props/Slots만 정의
- 마크업에 보이는 하위 컴포넌트를 개별 행으로 분리하여 Props를 나열하지 말 것
- 하위 컴포넌트는 마크업 구조도에서 이름만 보여주면 충분
- Figma 데이터가 없으면 Props를 추측하지 말 것 — "Figma 링크 제공 시 상세 스펙 작성 가능" 표시
- children은 \`children: Snippet\`으로 통일 (slot 금지)
- 스펙 표 컬럼: 컴포넌트명 | Props/Slots | 설명
- 불필요한 prop 남발 금지 — 실제 필요한 최소 인터페이스만

## Svelte 5 컨벤션
- Runes 문법: $state(), $derived(), $effect(), $props()
- Props: interface Props 정의 필수, class?: string 포함
- 이벤트: onclick, oninput (on:click 금지)
- 렌더링: {@render children()} (slot 금지)
- rest props: {...rest}로 루트 요소에 전달

## Tailwind v4 색상 (주요 매핑)
- Primary: bg-primary, text-primary (#1ba896)
- Background: bg-bg-body, bg-bg-main, bg-bg-surface
- Border: border-border-default, border-border-strong
- Gray: text-gray-500 ~ text-gray-900
- Status: bg-confirm, bg-caution, bg-alert, bg-info
- 하드코딩 색상(#hex, rgb) 금지 → CSS 변수 클래스 사용

## 응답 형식 (반드시 XML 태그로 구분)
<markup>ASCII 마크업</markup>
<spec>대상 컴포넌트의 스펙만 (마크다운 표)</spec>
<reply>사용자에게 보내는 자연어 응답</reply>
<history>세션 요약 (3줄 이내)</history>`;

export async function processMarkup(req: MarkupRequest): Promise<MarkupResponse> {
  console.log("[Markup] processMarkup start, type:", req.type);
  let prompt: string;

  if (req.type === "init") {
    prompt = `당신은 Svelte/SvelteKit 컴포넌트 마크업 전문가입니다.
피그마 디자인을 분석해 ASCII 마크업으로 표현하고, 컴포넌트 스펙을 정리합니다.

${MARKUP_RULES}

---
이슈 제목: ${req.issueTitle}
${req.figmaContext ? `\n피그마 구조:\n${req.figmaContext}` : "※ 피그마 데이터 없음 (링크만 참고)"}
${req.extraInstruction ? `\n추가 요청: ${req.extraInstruction}` : ""}

위 내용을 바탕으로 마크업 초안, 스펙, 그리고 짧은 안내 메시지를 작성해주세요.`;
  } else {
    prompt = `당신은 Svelte/SvelteKit 컴포넌트 마크업 전문가입니다.
사용자와 대화하며 마크업을 점진적으로 완성합니다.

${MARKUP_RULES}
- 마크업 변경 없으면 <markup>UNCHANGED</markup>

---
현재 마크업:
\`\`\`
${req.currentMarkup}
\`\`\`
${req.currentHistory ? `\n이전 대화 요약:\n${req.currentHistory}` : ""}

사용자 메시지: ${req.userMessage}`;
  }

  console.log("[Markup] calling LLM, prompt len:", prompt.length);
  const raw = await callLLM(prompt);
  console.log("[Markup] LLM 응답 수신, len:", raw.length);

  const markup  = extract(raw, "markup")  ?? (req.type === "conversation" ? "UNCHANGED" : raw);
  const spec    = extract(raw, "spec")    ?? undefined;
  const reply   = extract(raw, "reply")   ?? raw;
  const history = extract(raw, "history") ?? "";

  return { markup, spec, reply, history };
}
