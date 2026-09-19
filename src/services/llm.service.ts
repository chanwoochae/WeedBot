const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getOllamaBaseUrl() { return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"; }
function getOllamaModel() { return process.env.OLLAMA_MODEL ?? "gemma4:31b"; }
function getOllamaTimeoutMs() { return Number(process.env.OLLAMA_TIMEOUT_MS ?? 600000); }
// Ollama 스트림의 첫 응답 및 다음 청크를 기다리는 무응답 제한 시간을 반환한다(기본 90초).
function getOllamaStreamIdleTimeoutMs() { return Number(process.env.OLLAMA_STREAM_IDLE_TIMEOUT_MS ?? 90000); }
function getGeminiModel() { return process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"; }

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

interface ChatResult {
  reply: string;
  model: "ollama" | string;
}

// 시스템 지침, 기존 대화 이력, 새 사용자 입력을 순서대로 묶어 Ollama 요청 메시지를 구성한다.
function buildMessages(userInput: string, history: HistoryEntry[]) {
  return [
    { role: "system", content: "너는 CCW의 개인 AI 비서야. 한국어로 친근하게 대화해." },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userInput },
  ];
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

// Ollama 답변을 청크 단위로 전달하고 완성된 답변을 반환한다.
// 스트리밍 실패 시 Gemini로 재시도하며, 폴백 답변은 기존 부분 답변을 대체하도록 전달한다.
export async function chatStream(
  userInput: string,
  history: HistoryEntry[],
  onChunk: (text: string, opts?: { reset?: boolean }) => void,
): Promise<ChatResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // 청크마다 대기 시간을 다시 세어 전체 생성 시간이 아닌 스트림의 멈춤만 감지한다.
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), getOllamaStreamIdleTimeoutMs());
  };

  try {
    // 첫 응답 대기에도 적용하고, 이후에는 수신 청크마다 갱신한다.
    resetTimeout();
    const messages = buildMessages(userInput, history);
    const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getOllamaModel(), messages, stream: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 실패 응답의 본문을 해제하되, 취소 오류가 원래 HTTP 오류를 가리지 않게 한다.
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    // 읽을 스트림이 없으면 정상 답변으로 처리하지 않고 Gemini 폴백으로 넘긴다.
    if (!res.body) throw new Error("Ollama 스트림 본문 없음");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    // 완성된 NDJSON 한 줄의 답변을 누적·전달하고, Ollama의 완료 여부를 반환한다.
    const processLine = (line: string): boolean => {
      if (!line.trim()) return false;
      // 잘못된 JSON이나 모델 오류는 바깥 catch로 전파해 불완전한 답변 대신 폴백을 시도한다.
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
          // 연결 종료만으로는 생성 완료를 보장할 수 없어, done 없는 부분 답변은 실패로 취급한다.
          throw new Error("Ollama 스트림이 done 없이 종료됨");
        }
      }
    } finally {
      // 정상 완료 신호로 일찍 반환하거나 파싱·읽기에 실패해도 연결과 reader 잠금을 정리한다.
      controller.abort();
      reader.releaseLock();
    }
  } catch (e) {
    // Ollama의 연결·무응답·스트림 오류가 전체 응답 실패로 이어지지 않도록 Gemini로 재시도한다.
    const err = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️ Ollama 스트리밍 실패: ${err} → Gemini 폴백`);
  } finally {
    // reader 생성 전 실패도 포함해 타이머와 요청을 정리하여 폴백 중 Ollama 작업이 남지 않게 한다.
    clearTimeout(timeout);
    controller.abort();
  }

  try {
    const reply = await callGemini(userInput, history);
    // reset:true는 클라이언트가 이미 표시한 Ollama 부분 답변을 버리고 Gemini 답변으로 대체하라는 뜻이다.
    onChunk(reply, { reset: true });
    return { reply, model: getGeminiModel() };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error(`❌ Gemini 실패: ${err}`);
    // 폴백까지 실패하면 완성된 답변이 없으므로 호출자가 실패를 알릴 수 있게 전파한다.
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
  const messages = buildMessages(userInput, history);

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
