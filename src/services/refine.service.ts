import { spawn } from "node:child_process";

// agy의 모델 카탈로그는 원격에서 동적으로 바뀔 수 있으므로,
// 모델명 변경 시 코드 수정 없이 AGY_MODEL 환경변수로 대응할 수 있게 한다.
function getAgyModel() { return process.env.AGY_MODEL ?? "Claude Opus 4.6 (Thinking)"; }

// agy CLI로 답변 초안의 의미를 유지하며 표현을 다듬는다.
// 정제는 부가 단계이므로 실행에 실패하면 원본 초안을 반환한다.
export async function refineWithAgy(draftText: string): Promise<string> {
  const prompt = "다음은 AI 비서가 사용자에게 보낼 답변 초안이야. 내용과 의미는 그대로 유지하면서 더 자연스럽고 정확하게 다듬어줘. 다듬은 결과만 출력하고, 별도 설명이나 전후 코멘트는 절대 붙이지 마.\n\n초안:\n" + draftText;

  try {
    return await new Promise<string>((resolve, reject) => {
      // 초안이 셸 명령으로 해석되지 않도록 인자로 전달하고, stdin 입력 대기로 멈추지 않게 한다.
      // 환경변수로 지정한 모델 또는 품질 우선순위 1순위 기본 모델을 명시적으로 사용한다.
      const child = spawn("agy", ["-p", prompt, "--model", getAgyModel()], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      // agy가 멈춰도 최종 응답을 무기한 지연시키지 않도록 60초 뒤 종료하고 원본 반환으로 넘긴다.
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("agy 응답 시간 초과 (60초)"));
      }, 60_000);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (text: string) => { stdout += text; });
      // 사용하지 않는 stderr도 비워 파이프 버퍼가 가득 차 자식 프로세스가 멈추는 것을 막는다.
      child.stderr.resume();
      child.on("error", (error) => {
        // 실행 파일 누락 등 실행 오류는 타이머를 해제하고 바깥 catch의 원본 반환으로 연결한다.
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code, signal) => {
        // 종료 후 타이머가 발동하지 않게 정리하고, 비정상 종료의 부분 출력은 정제 결과로 쓰지 않는다.
        clearTimeout(timeout);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`agy 실행 실패 (code=${code}, signal=${signal})`));
      });
    });
  } catch (e) {
    // 정제 실패가 이미 생성된 답변까지 실패시키지 않도록 로그만 남기고 원본을 제공한다.
    const err = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️ agy 정제 실패: ${err}`);
    return draftText;
  }
}
