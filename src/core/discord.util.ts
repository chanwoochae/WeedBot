import { SendableChannels } from "discord.js";

/** 줄 순서를 유지하며 줄바꿈을 포함해 2000자 이내로 묶어 보낸다. 긴 줄은 단독 전송한다. */
export async function sendChunked(
  channel: SendableChannels,
  lines: string[],
): Promise<void> {
  const fullText = lines.join("\n");
  if (fullText.length <= 2000) {
    await channel.send(fullText);
    return;
  }

  let batch: string[] = [];
  let batchLength = 0;
  for (const line of lines) {
    if (batch.length > 0 && batchLength + 1 + line.length > 2000) {
      await channel.send(batch.join("\n"));
      batch = [];
      batchLength = 0;
    }
    batchLength += (batch.length > 0 ? 1 : 0) + line.length;
    batch.push(line);
  }
  if (batch.length > 0) {
    await channel.send(batch.join("\n"));
  }
}
