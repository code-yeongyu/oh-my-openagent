import { tokenizeCommand } from "../../tools/interactive-bash/tools"

const COMPOUND_START = new Set(["for", "while", "until", "if", "case", "select", "function", "{", "[[", "!"])
const COMMAND_WRAPPERS = new Set(["command", "builtin", "exec", "nohup", "time"])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// Reserved words that may precede a simple command inside a compound one; the command after them is what runs.
const RESERVED_PREFIXES = new Set(["!", "{", "}", "do", "done", "then", "else", "elif", "fi", "if", "while", "until"])
// Headers whose words are not run (`for i in 1 2 3`); their body is checked as separate commands.
const LOOP_HEADERS = new Set(["for", "select"])
// Syntax whose commands cannot be split out by this scanner.
const UNSPLITTABLE = new Set(["case", "function", "coproc"])

type SplitOptions = { allowRedirects: boolean }

/**
 * Programs a shell command would run, for the allowlist fallback.
 * Returns null when the command has syntax this check cannot see through
 * (compound commands, subshells, redirects, command substitution).
 */
export function programsForAllowlist(command: string): string[] | null {
  const segments = splitSegments(command, { allowRedirects: false })
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

/**
 * The simple commands a shell command line runs, each starting at its program, for the
 * Bash permission ask. Leading reserved words, assignments and wrappers are dropped, so
 * `for i in 1; do rm x; done` yields `rm x`. Redirects stay part of their command.
 * Returns null when the line hides commands this scanner cannot split out
 * (command substitution, subshells, `case`, `function`).
 */
export function commandsForPermission(command: string): string[] | null {
  const segments = splitSegments(command, { allowRedirects: true })
  if (segments === null) return null
  const commands: string[] = []
  for (const segment of segments) {
    let rest = segment.trim()
    let word = firstWord(rest)
    while (word !== "" && (RESERVED_PREFIXES.has(word) || COMMAND_WRAPPERS.has(word) || ASSIGNMENT.test(word))) {
      rest = rest.slice(word.length).trim()
      word = firstWord(rest)
    }
    if (word === "" || LOOP_HEADERS.has(word)) continue
    if (UNSPLITTABLE.has(word)) return null
    commands.push(rest)
  }
  return commands
}

/** The first shell word of `text` as written, quotes included. */
function firstWord(text: string): string {
  let quote: "'" | '"' | null = null
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== null) {
      if (char === "\\" && quote === '"') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === "\\") index += 1
    else if (char === "'" || char === '"') quote = char
    else if (char === " ") return text.slice(0, index)
  }
  return text
}

/**
 * Splits a command line at `;`, `|`, `&`, `&&`, `||` and newlines, outside quotes.
 * Unquoted tabs become spaces, and a `#` that starts a word comments out the rest of
 * its line, the way the shell reads them.
 */
function splitSegments(command: string, options: SplitOptions): string[] | null {
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
    if (char === "#" && (current === "" || current.endsWith(" "))) {
      while (index + 1 < command.length && command[index + 1] !== "\n") index += 1
      continue
    }
    if (char === "\t") {
      current += " "
      continue
    }
    if (char === "`" || char === "(" || char === ")") return null
    if (!options.allowRedirects && (char === "<" || char === ">")) return null
    if (char === "$" && command[index + 1] === "(") return null
    if (char === "&" && (current.endsWith(">") || current.endsWith("<"))) {
      current += char
      continue
    }
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
