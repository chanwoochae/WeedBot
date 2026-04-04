import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import { chat } from "./services/llm.service";
import { getHistory, saveMessage } from "./services/history.service";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once("ready", () => {
  console.log(`✅ WeedBot online: ${client.user?.tag}`);
});

client.on("messageCreate", async (message: Message) => {
  // 봇 메시지 무시
  if (message.author.bot) return;

  // DM 또는 봇 멘션 시에만 반응
  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user!);
  if (!isDM && !isMentioned) return;

  const userInput = message.content
    .replace(/<@!?\d+>/g, "")
    .trim();

  if (!userInput) return;

  // 타이핑 표시
  await message.channel.sendTyping();

  try {
    // 히스토리 조회
    const history = await getHistory(message.author.id);

    // LLM 호출 (Ollama → Gemini 폴백)
    const { reply, model } = await chat(userInput, history);

    // 히스토리 저장
    await saveMessage(message.author.id, "user", userInput);
    await saveMessage(message.author.id, "assistant", reply);

    // 2000자 Discord 제한 처리
    const footer = model !== "ollama" ? `\n\n*\`${model}\` 로 답변했어 (맥북 오프라인)*` : "";
    const fullReply = reply + footer;

    if (fullReply.length <= 2000) {
      await message.reply(fullReply);
    } else {
      const chunks = fullReply.match(/[\s\S]{1,1990}/g) ?? [];
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    }
  } catch (e) {
    console.error("❌ Error:", e);
    await message.reply("오류가 발생했어. 잠시 후 다시 시도해줘.");
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
