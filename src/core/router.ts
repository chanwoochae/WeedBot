import { Message, SendableChannels } from "discord.js";
import { BotModule, ModuleCommand } from "./types";

// ─── 명령어 레지스트리 ─────────────────────────────────
// 공용 명령어: !help, !clear, !model 처럼 네임스페이스 없이 바로 호출.
// 모듈: !trendiv list 처럼 "!<모듈명> <서브커맨드>" 형태로 호출.
const coreCommands: Record<string, ModuleCommand> = Object.create(null);
const modules = new Map<string, BotModule>();

export function registerCoreCommand(name: string, command: ModuleCommand): void {
  coreCommands[name] = command;
}

export function registerModule(module: BotModule): void {
  modules.set(module.name, module);
}

function formatUsage(name: string, cmd: ModuleCommand): string {
  return `\`!${name}${cmd.usage ? " " + cmd.usage : ""}\` — ${cmd.description}`;
}

function moduleCommandLines(module: BotModule): string[] {
  return Object.entries(module.commands).map(([sub, cmd]) =>
    formatUsage(`${module.name} ${sub}`, cmd),
  );
}

export function buildHelpText(): string {
  const lines: string[] = ["**공용 명령어**"];
  for (const [name, cmd] of Object.entries(coreCommands)) {
    lines.push(formatUsage(name, cmd));
  }

  for (const module of modules.values()) {
    lines.push(`\n**${module.name}** — ${module.description}`);
    lines.push(...moduleCommandLines(module));
  }

  return lines.join("\n");
}

function buildModuleHelpText(module: BotModule): string {
  const lines = moduleCommandLines(module);
  return `📋 **${module.name} 명령어**\n${lines.join("\n")}`;
}

/**
 * 최상위 토큰(name)이 공용 명령어면 바로, 모듈명이면 다음 토큰을 서브커맨드로 찾아 실행한다.
 * 둘 다 아니면 false를 반환해 호출부가 일반 AI 채팅으로 폴백하게 한다.
 */
export async function dispatch(
  name: string,
  args: string[],
  message: Message,
  channel: SendableChannels,
): Promise<boolean> {
  const core = coreCommands[name];
  if (core) {
    await core.handler({ message, channel, args });
    return true;
  }

  const module = modules.get(name);
  if (module) {
    const [sub, ...rest] = args;
    const cmd = sub ? module.commands[sub.toLowerCase()] : undefined;
    if (!cmd) {
      await channel.send(buildModuleHelpText(module));
      return true;
    }
    await cmd.handler({ message, channel, args: rest });
    return true;
  }

  return false;
}
