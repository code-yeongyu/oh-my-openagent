/**
 * Quote-aware command tokenizer with escape handling.
 * Handles single/double quotes and backslash escapes.
 */
function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote = false
  let quoteChar = ""
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if ((char === "'" || char === '"') && !inQuote) {
      inQuote = true
      quoteChar = char
    } else if (char === quoteChar && inQuote) {
      inQuote = false
      quoteChar = ""
    } else if (char === " " && !inQuote) {
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens
}

/**
 * Normalize session name by stripping :window and .pane suffixes.
 * e.g., "omo-x:1" -> "omo-x", "omo-x:1.2" -> "omo-x"
 */
function normalizeSessionName(name: string): string {
  return name.split(":")[0].split(".")[0]
}

function findFlagValue(tokens: string[], flag: string): string | null {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === flag) return tokens[i + 1]
  }
  return null
}

/**
 * Extract session name from tokens, considering the subcommand.
 * For new-session: prioritize -s over -t
 * For other commands: use -t
 */
function extractSessionNameFromTokens(tokens: string[], subCommand: string): string | null {
  if (subCommand === "new-session") {
    const sFlag = findFlagValue(tokens, "-s")
    if (sFlag) return normalizeSessionName(sFlag)
    const tFlag = findFlagValue(tokens, "-t")
    if (tFlag) return normalizeSessionName(tFlag)
  } else {
    const tFlag = findFlagValue(tokens, "-t")
    if (tFlag) return normalizeSessionName(tFlag)
  }
  return null
}

/**
 * Find the tmux subcommand from tokens, skipping global options.
 * tmux allows global options before the subcommand:
 * e.g., `tmux -L socket-name new-session -s omo-x`
 */
function findSubcommand(tokens: string[]): string {
  // Options that require an argument: -L, -S, -f, -c, -T
  const globalOptionsWithArgs = new Set<string>(["-L", "-S", "-f", "-c", "-T"])

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    // Handle end of options marker
    if (token === "--") {
      // Next token is the subcommand
      return tokens[i + 1] ?? ""
    }

    if (globalOptionsWithArgs.has(token)) {
      // Skip the option and its argument
      i += 2
      continue
    }

    if (token.startsWith("-")) {
      // Skip standalone flags like -C, -v, -V
      i++
      continue
    }

    // Found the subcommand
    return token
  }

  return ""
}

export function parseTmuxCommand(tmuxCommand: string): {
  subCommand: string
  sessionName: string | null
} {
  const tokens = tokenizeCommand(tmuxCommand)
  const subCommand = findSubcommand(tokens)
  const sessionName = extractSessionNameFromTokens(tokens, subCommand)
  return { subCommand, sessionName }
}
