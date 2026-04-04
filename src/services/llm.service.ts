const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:31b";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 600000);
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

interface ChatResult {
  reply: string;
  model: "ollama" | string;
}

export async function chat(
  userInput: string,
  history: HistoryEntry[],
): Promise<ChatResult> {
  // 1차: Ollama (MacBook)
  try {
    const reply = await callOllama(userInput, history);
    return { reply, model: "ollama" };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️ Ollama 실패: ${err} → Gemini 폴백`);
  }

  // 2차: Gemini 폴백
  try {
    const reply = await callGemini(userInput, history);
    return { reply, model: GEMINI_MODEL };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error(`❌ Gemini 실패: ${err}`);
    throw new Error("Ollama + Gemini 모두 실패");
  }
}

async function callOllama(
  userInput: string,
  history: HistoryEntry[],
): Promise<string> {
  const messages = [
    { role: "system", content: "너는 CCW의 개인 AI 비서야. 한국어로 친근하게 대화해." },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userInput },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { message: { content: string } };
    return data.message.content;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(
  userInput: string,
  history: HistoryEntry[],
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 없음");

  const contents = [
    ...history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    })),
    { role: "user", parts: [{ text: userInput }] },
  ];

  const res = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "너는 CCW의 개인 AI 비서야. 한국어로 친근하게 대화해." }] },
        contents,
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    candidates: { content: { parts: { text: string }[] } }[];
  };

  return data.candidates[0].content.parts[0].text;
}
