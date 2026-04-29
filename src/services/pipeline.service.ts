const PIPELINE_URL = process.env.PUBLIC_API_URL ?? "http://168.107.43.222:3000";
const PIPELINE_API_KEY = process.env.PIPELINE_API_KEY ?? "";

export type PipelineMode = "daily" | "weekly";

export async function triggerPipeline(mode: PipelineMode = "daily"): Promise<string> {
  const res = await fetch(`${PIPELINE_URL}/api/pipeline/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PIPELINE_API_KEY}`,
    },
    body: JSON.stringify({ mode }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const data = await res.json() as { message?: string; count?: number };
  return data.message ?? `파이프라인 시작됨 (mode: ${mode})`;
}

export async function triggerRetry(): Promise<string> {
  const res = await fetch(`${PIPELINE_URL}/api/pipeline/retry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PIPELINE_API_KEY}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const data = await res.json() as { message?: string };
  return data.message ?? "재시도 파이프라인 시작됨";
}
