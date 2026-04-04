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

client.once("clientReady", () => {
  console.log(`✅ WeedBot online: ${client.user?.tag}`);
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user!);
  if (!isDM && !isMentioned) return;

  const channel = message.channel;
  if (!channel.isSendable()) return;

  const userInput = message.content
    .replace(/<@!?\d+>/g, "")
    .trim();

  if (!userInput) return;

  await channel.sendTyping();

  try {
    const history = await getHistory(message.author.id);
    const { reply, model } = await chat(userInput, history);

    await saveMessage(message.author.id, "user", userInput);
    await saveMessage(message.author.id, "assistant", reply);

    const modelLabel = model === "ollama"
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
