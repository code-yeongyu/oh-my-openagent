export const HOOK_NAME = "question-command-handoff"

export const QUESTION_TOOL_NAMES = new Set(["question", "askuserquestion", "ask_user_question"])

// Planner agents advertise commands they are forbidden to run themselves.
// Executor agents act on answers directly, so auto-dispatch there would
// double-execute the same intent.
export const HANDOFF_AGENTS = new Set(["prometheus"])

// An option that mentions a command while declining it must not run it.
export const NEGATION_MARKERS = [
  "don't",
  "do not",
  "not now",
  "not yet",
  "skip",
  "without",
  "instead of",
  "later",
]

export const SLASH_COMMAND_TOKEN_REGEX = /\/([a-z0-9:_-]+)/gi
