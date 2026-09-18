import { SendableChannels } from "discord.js";

/** 전체 텍스트가 2000자를 넘으면 전달받은 각 항목을 순서대로 보낸다. */
export async function sendChunked(
  channel: SendableChannels,
  fullText: string,
  lines: string[],
): Promise<void> {
  if (fullText.length <= 2000) {
    await channel.send(fullText);
  } else {
    for (const line of lines) {
      await channel.send(line);
    }
  }
}
