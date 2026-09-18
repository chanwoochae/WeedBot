import { registerCoreCommand, buildHelpLines } from "./router";
import { sendChunked } from "./discord.util";
import { checkActiveModel } from "../services/llm.service";
import { clearHistory } from "../services/history.service";

// ─── 공용 명령어 ────────────────────────────────────────
// WeedBot 자체 기능(대화/모델 상태)만 다룬다. 앱별 기능은 src/modules/*.module.ts로.
export function registerCoreCommands(): void {
  registerCoreCommand("help", {
    description: "사용 가능한 명령어 목록을 보여줘요.",
    handler: async (ctx) => {
      await sendChunked(ctx.channel, buildHelpLines());
    },
  });

  registerCoreCommand("clear", {
    description: "대화 히스토리를 초기화해요.",
    handler: async (ctx) => {
      const count = await clearHistory(ctx.message.author.id);
      await ctx.channel.send(`🗑️ 대화 히스토리 ${count}개 삭제했어. 새로 시작해보자!`);
    },
  });

  registerCoreCommand("model", {
    description: "현재 사용 중인 LLM 모델 상태를 보여줘요.",
    handler: async (ctx) => {
      const { active, modelName } = await checkActiveModel();
      if (active === "ollama") {
        await ctx.channel.send(
          `🟢 **현재 모델: ${modelName}**\n맥북 온라인 — Ollama (로컬 LLM)`,
        );
      } else {
        await ctx.channel.send(
          `🟡 **현재 모델: ${modelName}**\n맥북 오프라인 — Gemini 폴백 중`,
        );
      }
    },
  });
}
