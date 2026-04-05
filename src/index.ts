import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import { chat } from "./services/llm.service";
import { getHistory, saveMessage } from "./services/history.service";
import {
  listPending,
  markDone,
  markSkipped,
  getCollectStatus,
} from "./services/blocked.service";

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

  // 명령어 처리 (!list, !done, !skip, !status)
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
