const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getOllamaBaseUrl() { return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"; }
function getOllamaModel() { return process.env.OLLAMA_MODEL ?? "gemma4:31b"; }
function getOllamaTimeoutMs() { return Number(process.env.OLLAMA_TIMEOUT_MS ?? 600000); }
function getGeminiModel() { return process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"; }

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
    return { reply, model: getGeminiModel() };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error(`❌ Gemini 실패: ${err}`);
    throw new Error("Ollama + Gemini 모두 실패");
  }
}

export async function chatStream(
  userInput: string,
  history: HistoryEntry[],
  onChunk: (text: string) => void,
): Promise<ChatResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), 90_000);
  };

  try {
    // 첫 응답 대기에도 적용하고, 이후에는 수신 청크마다 갱신한다.
    resetTimeout();
    const messages = [
      { role: "system", content: "너는 CCW의 개인 AI 비서야. 한국어로 친근하게 대화해." },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: userInput },
    ];
    const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getOllamaModel(), messages, stream: true }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error("Ollama 스트림 본문 없음");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    const processLine = (line: string): boolean => {
      if (!line.trim()) return false;
      const data = JSON.parse(line) as {
        message?: { content?: string };
        done?: boolean;
        error?: string;
      };
      if (data.error) throw new Error(data.error);
      if (typeof data.message?.content === "string") {
        reply += data.message.content;
        onChunk(data.message.content);
      }
      return data.done === true;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (!done) resetTimeout();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (processLine(line)) return { reply, model: "ollama" };
        }
        if (done) {
          if (processLine(buffer)) return { reply, model: "ollama" };
          throw new Error("Ollama 스트림이 done 없이 종료됨");
        }
      }
    } finally {
      controller.abort();
      reader.releaseLock();
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️ Ollama 스트리밍 실패: ${err} → Gemini 폴백`);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  try {
    const reply = await callGemini(userInput, history);
    onChunk(reply);
    return { reply, model: getGeminiModel() };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error(`❌ Gemini 실패: ${err}`);
    throw new Error("Ollama + Gemini 모두 실패");
  }
}

// Ollama 연결 상태 확인 (5초 타임아웃)
export async function checkActiveModel(): Promise<{
  active: "ollama" | "gemini";
  modelName: string;
  ollamaOnline: boolean;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      return { active: "ollama", modelName: getOllamaModel(), ollamaOnline: true };
    }
  } catch {
    // Ollama 오프라인
  }
  return { active: "gemini", modelName: getGeminiModel(), ollamaOnline: false };
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
  const timeout = setTimeout(() => controller.abort(), getOllamaTimeoutMs());

  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getOllamaModel(), messages, stream: false }),
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
    `${GEMINI_API_BASE}/${getGeminiModel()}:generateContent?key=${apiKey}`,
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
