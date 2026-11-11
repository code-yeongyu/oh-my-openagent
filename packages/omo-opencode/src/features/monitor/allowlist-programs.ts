import { tokenizeCommand } from "../../tools/interactive-bash/tools"

const COMPOUND_START = new Set(["for", "while", "until", "if", "case", "select", "function", "{", "[[", "!"])
const COMMAND_WRAPPERS = new Set(["command", "builtin", "exec", "nohup", "time"])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * Programs a shell command would run, for the allowlist fallback.
 * Returns null when the command has syntax this check cannot see through
 * (compound commands, subshells, redirects, command substitution).
 */
export function programsForAllowlist(command: string): string[] | null {
  const segments = splitSegments(command)
  if (segments === null) return null
  const programs: string[] = []
  for (const segment of segments) {
    const words = tokenizeCommand(segment)
    let index = 0
    while (index < words.length && (ASSIGNMENT.test(words[index] ?? "") || COMMAND_WRAPPERS.has(words[index] ?? ""))) {
      index += 1
    }
    const program = words[index]
    if (program === undefined) continue
    if (COMPOUND_START.has(program)) return null
    programs.push(program)
  }
  return programs
}

function splitSegments(command: string): string[] | null {
  const segments: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ""
    if (quote === "'") {
      current += char
      if (char === "'") quote = null
      continue
    }
    if (quote === '"') {
      if (char === "\\" && index + 1 < command.length) {
        current += char + (command[index + 1] ?? "")
        index += 1
        continue
      }
      if (char === "`" || (char === "$" && command[index + 1] === "(")) return null
      current += char
      if (char === '"') quote = null
      continue
    }
    if (char === "\\" && index + 1 < command.length) {
      current += char + (command[index + 1] ?? "")
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === "`" || char === "(" || char === ")" || char === "<" || char === ">") return null
    if (char === "$" && command[index + 1] === "(") return null
    if (char === "\n" || char === "\r" || char === ";" || char === "|" || char === "&") {
      segments.push(current)
      current = ""
      const next = command[index + 1]
      if ((char === "|" || char === "&") && (next === "|" || next === "&")) index += 1
      continue
    }
    current += char
  }
  if (quote !== null) return null
  segments.push(current)
  return segments
}
