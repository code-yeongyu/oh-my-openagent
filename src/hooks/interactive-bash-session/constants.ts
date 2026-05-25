import { join } from "node:path";
import { OPENCODE_STORAGE } from "../../shared";
export const INTERACTIVE_BASH_SESSION_STORAGE = join(
  OPENCODE_STORAGE,
  "interactive-bash-session",
);

export const OMO_SESSION_PREFIX = "omo-";

export function buildSessionReminderMessage(sessions: string[]): string {
  if (sessions.length === 0) return "";
  return `\n\n[系统提醒] 活跃的 omo-* tmux 会话：${sessions.join(", ")}`;
}
