import { spawn } from "node:child_process";

export async function refineWithAgy(draftText: string): Promise<string> {
  const prompt = "다음은 AI 비서가 사용자에게 보낼 답변 초안이야. 내용과 의미는 그대로 유지하면서 더 자연스럽고 정확하게 다듬어줘. 다듬은 결과만 출력하고, 별도 설명이나 전후 코멘트는 절대 붙이지 마.\n\n초안:\n" + draftText;

  try {
    return await new Promise<string>((resolve, reject) => {
      // spawn은 shell 없이 인자를 전달하며 stdin을 명시적으로 무시할 수 있다.
      const child = spawn("agy", ["-p", prompt], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("agy 응답 시간 초과 (60초)"));
      }, 60_000);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (text: string) => { stdout += text; });
      child.stderr.resume();
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`agy 실행 실패 (code=${code}, signal=${signal})`));
      });
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️ agy 정제 실패: ${err}`);
    return draftText;
  }
}
