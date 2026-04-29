import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import { startHttpServer } from "./server";
import { chat, checkActiveModel } from "./services/llm.service";
import { getHistory, saveMessage, clearHistory } from "./services/history.service";
import {
  listPending,
  markDone,
  markSkipped,
  getCollectStatus,
} from "./services/blocked.service";
import { triggerPipeline, triggerRetry, PipelineMode } from "./services/pipeline.service";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once("clientReady", () => {
  console.log(`✅ WeedBot online: ${client.user?.tag}`);
});

// ─── 명령어 처리 ──────────────────────────────────────
async function handleCommand(
  message: Message,
  command: string,
  args: string[],
): Promise<boolean> {
  const channel = message.channel;
  if (!channel.isSendable()) return false;

  switch (command) {
    // ── 대화 히스토리 초기화 ──
    case "!clear": {
      const count = await clearHistory(message.author.id);
      await channel.send(`🗑️ 대화 히스토리 ${count}개 삭제했어. 새로 시작해보자!`);
      return true;
    }

    // ── 현재 사용 모델 확인 ──
    case "!model": {
      const { active, modelName, ollamaOnline } = await checkActiveModel();
      if (active === "ollama") {
        await channel.send(
          `🟢 **현재 모델: ${modelName}**\n맥북 온라인 — Ollama (로컬 LLM)`,
        );
      } else {
        await channel.send(
          `🟡 **현재 모델: ${modelName}**\n맥북 오프라인 — Gemini 폴백 중`,
        );
      }
      return true;
    }

    // ── 차단 큐 목록 ──
    case "!list": {
      const items = await listPending();
      if (items.length === 0) {
        await channel.send("✅ 차단된 항목이 없어요.");
        return true;
      }
      const lines = items.map(
        (item, i) =>
          `**${i + 1}.** [ID: ${item.id}] ${item.title ?? "제목 없음"}\n` +
          `   🔗 ${item.link}\n` +
          `   ❌ ${item.block_reason ?? "알 수 없음"} | ${new Date(item.created_at).toLocaleString("ko-KR")}`,
      );
      const text = `📋 **차단 대기 목록 (${items.length}개)**\n\n${lines.join("\n\n")}`;
      if (text.length <= 2000) {
        await channel.send(text);
      } else {
        for (const line of lines) {
          await channel.send(line);
        }
      }
      return true;
    }

    // ── 완료 처리 ──
    case "!done": {
      const id = parseInt(args[0]);
      if (isNaN(id)) {
        await channel.send("사용법: `!done <id>`\n예: `!done 3`");
        return true;
      }
      await markDone(id);
      await channel.send(`✅ ID ${id} → 완료 처리했어요.`);
      return true;
    }

    // ── 스킵 처리 ──
    case "!skip": {
      const id = parseInt(args[0]);
      if (isNaN(id)) {
        await channel.send("사용법: `!skip <id>`\n예: `!skip 3`");
        return true;
      }
      await markSkipped(id);
      await channel.send(`🚫 ID ${id} → 스킵 처리했어요.`);
      return true;
    }

    // ── 차단 큐 현황 ──
    case "!status": {
      const stat = await getCollectStatus();
      await channel.send(
        `📊 **차단 큐 현황**\n` +
          `• 대기 중: ${stat.pending}개\n` +
          `• 완료: ${stat.done}개\n` +
          `• 스킵: ${stat.skipped}개\n` +
          `• 오늘 감지: ${stat.todayBlocked}개`,
      );
      return true;
    }

    // ── Trendiv 파이프라인 제어 ──
    case "!pipeline": {
      const sub = args[0]?.toLowerCase();

      if (sub === "run" || sub === "daily" || sub === "weekly") {
        const mode: PipelineMode = sub === "weekly" ? "weekly" : "daily";
        await channel.send(`🚀 파이프라인 시작 중... (mode: **${mode}**)`);
        try {
          const msg = await triggerPipeline(mode);
          await channel.send(`✅ ${msg}`);
        } catch (e) {
          await channel.send(`❌ 파이프라인 시작 실패: ${(e as Error).message}`);
        }
        return true;
      }

      if (sub === "retry") {
        await channel.send("🔄 실패 항목 재시도 중...");
        try {
          const msg = await triggerRetry();
          await channel.send(`✅ ${msg}`);
        } catch (e) {
          await channel.send(`❌ 재시도 실패: ${(e as Error).message}`);
        }
        return true;
      }

      // 도움말
      await channel.send(
        "📋 **파이프라인 명령어**\n" +
        "`!pipeline run` / `!pipeline daily` — 일간 파이프라인 실행 (X, YouTube)\n" +
        "`!pipeline weekly` — 주간 파이프라인 실행 (전체 소스)\n" +
        "`!pipeline retry` — 실패 항목 재시도"
      );
      return true;
    }

    default:
      return false;
  }
}

// ─── 메시지 핸들러 ─────────────────────────────────────
client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user!);
  if (!isDM && !isMentioned) return;

  const channel = message.channel;
  if (!channel.isSendable()) return;

  const raw = message.content.replace(/<@!?\d+>/g, "").trim();
  if (!raw) return;

  // 명령어 처리
  const [command, ...args] = raw.split(/\s+/);
  if (command.startsWith("!")) {
    try {
      const handled = await handleCommand(message, command.toLowerCase(), args);
      if (handled) return;
    } catch (e) {
      console.error("❌ Command Error:", e);
      await channel.send("명령어 처리 중 오류가 발생했어요.");
      return;
    }
  }

  // AI 채팅
  await channel.sendTyping();

  try {
    const history = await getHistory(message.author.id);
    const { reply, model } = await chat(raw, history);

    await saveMessage(message.author.id, "user", raw);
    await saveMessage(message.author.id, "assistant", reply);

    const modelLabel =
      model === "ollama"
        ? `${process.env.OLLAMA_MODEL ?? "ollama"}`
        : `${model} (맥북 오프라인)`;
    const footer = `\n\n*\`${modelLabel}\`*`;
    const fullReply = reply + footer;

    if (fullReply.length <= 2000) {
      await message.reply(fullReply);
    } else {
      const chunks = fullReply.match(/[\s\S]{1,1990}/g) ?? [];
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    }
  } catch (e) {
    console.error("❌ Error:", e);
    await message.reply("오류가 발생했어. 잠시 후 다시 시도해줘.");
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
startHttpServer();
