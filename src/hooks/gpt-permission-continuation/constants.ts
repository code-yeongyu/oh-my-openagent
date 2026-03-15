export const HOOK_NAME = "gpt-permission-continuation"
export const CONTINUATION_PROMPT = "continue"
export const MAX_CONSECUTIVE_AUTO_CONTINUES = 3

export const DEFAULT_STALL_PATTERNS = [
  "if you want",
  "would you like",
  "shall i",
  "do you want me to",
  "let me know if",
] as const
