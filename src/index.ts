import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import { startHttpServer } from "./server";
import { chat } from "./services/llm.service";
import { getHistory, saveMessage } from "./services/history.service";
import { registerCoreCommands } from "./core/commands";
import { registerModule, dispatch } from "./core/router";
import { trendivModule } from "./modules/trendiv.module";

dotenv.config();

// ─── 명령어 등록 ──────────────────────────────────────
// 공용 명령어(!help/!clear/!model)는 core/commands.ts, 앱별 명령어는 모듈 단위로 등록.
// 새 앱이 생기면 여기에 registerModule(...)만 한 줄 추가하면 된다.
registerCoreCommands();
registerModule(trendivModule);

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
    const name = command.slice(1).toLowerCase();
    try {
      const handled = await dispatch(name, args, { message, channel });
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
