import { Message, SendableChannels } from "discord.js";

export interface CommandContext {
  message: Message;
  channel: SendableChannels;
  args: string[];
}

export interface ModuleCommand {
  description: string;
  usage?: string;
  handler: (ctx: CommandContext) => Promise<void>;
}

export interface BotModule {
  name: string;
  description: string;
  commands: Record<string, ModuleCommand>;
}
