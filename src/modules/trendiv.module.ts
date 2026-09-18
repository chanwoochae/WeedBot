import { BotModule } from "../core/types";
import { sendChunked } from "../core/discord.util";
import {
  listPending,
  markDone,
  markSkipped,
  getCollectStatus,
} from "../services/blocked.service";
import { triggerPipeline, triggerRetry, PipelineMode } from "../services/pipeline.service";

// ─── trendiv 모듈 ───────────────────────────────────────
// 수집 큐(blocked_queue)와 파이프라인 제어. 전부 "!trendiv <서브커맨드>"로 호출.
export const trendivModule: BotModule = {
  name: "trendiv",
  description: "trendiv 수집 큐 조회 + 파이프라인 제어",
  commands: {
    list: {
      description: "차단 대기 목록을 보여줘요.",
      handler: async (ctx) => {
        const items = await listPending();
        if (items.length === 0) {
          await ctx.channel.send("✅ 차단된 항목이 없어요.");
          return;
        }
        const lines = [
          `📋 **차단 대기 목록 (${items.length}개)**`,
          ...items.flatMap((item, i) => [
            "",
            `**${i + 1}.** [ID: ${item.id}] ${item.title ?? "제목 없음"}\n` +
            `   🔗 ${item.link}\n` +
            `   ❌ ${item.block_reason ?? "알 수 없음"} | ${new Date(item.created_at).toLocaleString("ko-KR")}`,
          ]),
        ];
        await sendChunked(ctx.channel, lines);
      },
    },

    done: {
      description: "항목을 완료 처리해요.",
      usage: "<id>",
      handler: async (ctx) => {
        const id = parseInt(ctx.args[0]);
        if (isNaN(id)) {
          await ctx.channel.send("사용법: `!trendiv done <id>`\n예: `!trendiv done 3`");
          return;
        }
        await markDone(id);
        await ctx.channel.send(`✅ ID ${id} → 완료 처리했어요.`);
      },
    },

    skip: {
      description: "항목을 스킵 처리해요.",
      usage: "<id>",
      handler: async (ctx) => {
        const id = parseInt(ctx.args[0]);
        if (isNaN(id)) {
          await ctx.channel.send("사용법: `!trendiv skip <id>`\n예: `!trendiv skip 3`");
          return;
        }
        await markSkipped(id);
        await ctx.channel.send(`🚫 ID ${id} → 스킵 처리했어요.`);
      },
    },

    status: {
      description: "차단 큐 현황을 보여줘요.",
      handler: async (ctx) => {
        const stat = await getCollectStatus();
        await ctx.channel.send(
          `📊 **차단 큐 현황**\n` +
            `• 대기 중: ${stat.pending}개\n` +
            `• 완료: ${stat.done}개\n` +
            `• 스킵: ${stat.skipped}개\n` +
            `• 오늘 감지: ${stat.todayBlocked}개`,
        );
      },
    },

    pipeline: {
      description: "파이프라인을 실행하거나 재시도해요.",
      usage: "run|daily|weekly|retry",
      handler: async (ctx) => {
        const sub = ctx.args[0]?.toLowerCase();

        if (sub === "run" || sub === "daily" || sub === "weekly") {
          const mode: PipelineMode = sub === "weekly" ? "weekly" : "daily";
          await ctx.channel.send(`🚀 파이프라인 시작 중... (mode: **${mode}**)`);
          try {
            const msg = await triggerPipeline(mode);
            await ctx.channel.send(`✅ ${msg}`);
          } catch (e) {
            await ctx.channel.send(`❌ 파이프라인 시작 실패: ${(e as Error).message}`);
          }
          return;
        }

        if (sub === "retry") {
          await ctx.channel.send("🔄 실패 항목 재시도 중...");
          try {
            const msg = await triggerRetry();
            await ctx.channel.send(`✅ ${msg}`);
          } catch (e) {
            await ctx.channel.send(`❌ 재시도 실패: ${(e as Error).message}`);
          }
          return;
        }

        await ctx.channel.send(
          "📋 **파이프라인 명령어**\n" +
            "`!trendiv pipeline run` / `!trendiv pipeline daily` — 일간 파이프라인 실행 (X, YouTube)\n" +
            "`!trendiv pipeline weekly` — 주간 파이프라인 실행 (전체 소스)\n" +
            "`!trendiv pipeline retry` — 실패 항목 재시도",
        );
      },
    },
  },
};
