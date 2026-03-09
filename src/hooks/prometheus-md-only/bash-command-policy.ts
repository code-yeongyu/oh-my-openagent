import { resolve, relative, isAbsolute } from "node:path"

import { HOOK_NAME } from "./constants"
import { ALLOWED_EXTENSIONS } from "./constants"

const COMMAND_WRAPPERS = new Set([
  "env", "sudo", "sh", "bash", "zsh", "command", "xargs", "nohup", "exec",
])

const READ_ONLY_COMMANDS = new Set([
  "cat", "grep", "rg", "find", "ls", "tree", "wc", "head", "tail", "less",
  "file", "stat", "du", "df", "pwd", "which", "realpath", "dirname", "basename",
  "diff", "sort", "uniq", "tr", "cut", "jq", "xxd",
  "hexdump", "strings",
])

const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  "log", "diff", "status", "show", "blame",
  "rev-parse", "ls-files", "ls-tree", "shortlog", "describe",
])

const DANGEROUS_FIND_FLAGS = new Set([
  "-exec", "-execdir", "-ok", "-delete", "-fprint", "-fprintf", "-fls", "-fprint0",
])
const DANGEROUS_OUTPUT_FLAG_COMMANDS = new Set(["sort", "tree"])

interface BashCommandResult {
  allowed: boolean
  reason: string
}

/**
 * Quote-aware tokenizer that splits a command string into tokens.
 * Handles single quotes, double quotes, and backslash escapes.
 * Does NOT handle heredocs, command substitution, or other shell features.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === "\\" && !inSingleQuote) {
      escaped = true
      current += char
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }

    if ((char === " " || char === "\t") && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

function hasCompoundOperators(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\" && !inSingleQuote) {
      escaped = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (inSingleQuote || inDoubleQuote) {
      continue
    }

    if (char === ";") return true
    if (char === "|" && command[i + 1] === "|") return true
    if (char === "|") return true
    if (char === "&" && command[i + 1] === "&") return true
    if (char === "&" && command[i + 1] !== "&" && command[i + 1] !== ">") return true
  }

  return false
}

function hasSubshells(command: string): boolean {
  let inSingleQuote = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\" && !inSingleQuote) {
      escaped = true
      continue
    }

    if (char === "'") {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (inSingleQuote) {
      continue
    }

    if (char === "$" && command[i + 1] === "(") return true
    if (char === "`") return true
    if ((char === "<" || char === ">") && command[i + 1] === "(") return true
  }

  return false
}

function stripSurroundingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function hasNewlines(command: string): boolean {
  return command.includes("\n")
}

/**
 * Extract redirect target paths from a command string (outside quotes).
 * Returns an array of target file paths.
 */
function extractRedirectTargets(tokens: string[]): string[] {
  const targets: string[] = []
  const redirectOps = new Set([">", ">>", "1>", "2>", "&>", ">|"])

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (redirectOps.has(token) && i + 1 < tokens.length) {
      targets.push(stripSurroundingQuotes(tokens[i + 1]))
      continue
    }

    for (const op of redirectOps) {
      if (token.startsWith(op) && token.length > op.length) {
        targets.push(stripSurroundingQuotes(token.slice(op.length)))
        break
      }
    }
  }

  return targets
}

function isAllowedRedirectTarget(filePath: string, workspaceRoot: string): boolean {
  const resolved = resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, resolved)

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false
  }

  if (!/\.sisyphus[/\\]/i.test(rel)) {
    return false
  }

  const hasAllowedExtension = ALLOWED_EXTENSIONS.some(
    ext => resolved.toLowerCase().endsWith(ext.toLowerCase())
  )

  return hasAllowedExtension
}

function validateGitCommand(tokens: string[]): BashCommandResult {
  if (tokens.length < 2) {
    return { allowed: true, reason: "bare git command" }
  }

  const subcommand = tokens[1]

  const isAllowedSub = GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)
    || subcommand === "remote"
    || subcommand === "config"

  if (!isAllowedSub) {
    return {
      allowed: false,
      reason: `[${HOOK_NAME}] Command 'git ${subcommand}' is not in the allowed list for Prometheus. ` +
        `Prometheus can only run read-only commands and write to .sisyphus/**/*.md files.`,
    }
  }

  if (subcommand === "remote") {
    const hasVFlag = tokens.includes("-v") || tokens.includes("--verbose")
    if (!hasVFlag) {
      return {
        allowed: false,
        reason: `[${HOOK_NAME}] Command 'git remote' without -v is not allowed for Prometheus. ` +
          `Prometheus can only run read-only commands.`,
      }
    }
  }

  if (subcommand === "tag") {
    const hasDangerousFlag = tokens.some(t => t === "-d" || t === "-a")
    if (hasDangerousFlag) {
      return {
        allowed: false,
        reason: `[${HOOK_NAME}] Command 'git tag' with mutating flags (-d, -a) is not allowed for Prometheus. ` +
          `Prometheus can only run read-only commands.`,
      }
    }
  }

  if (subcommand === "config") {
    const hasGet = tokens.includes("--get")
    const hasList = tokens.includes("--list")
    if (!hasGet && !hasList) {
      return {
        allowed: false,
        reason: `[${HOOK_NAME}] Command 'git config' without --get or --list is not allowed for Prometheus. ` +
          `Prometheus can only run read-only commands.`,
      }
    }
  }

  const hasOutputEqualsFlag = tokens.some(t => t.startsWith("--output="))
  const hasOutputSpaceFlag = tokens.some((t, idx) => t === "--output" && idx + 1 < tokens.length)
  if (hasOutputEqualsFlag || hasOutputSpaceFlag) {
    return {
      allowed: false,
      reason: `[${HOOK_NAME}] Command 'git' with --output flag is not allowed for Prometheus. ` +
        `Prometheus can only run read-only commands.`,
    }
  }

  return { allowed: true, reason: "allowed git read-only subcommand" }
}

function validateFindCommand(tokens: string[]): BashCommandResult {
  for (const token of tokens) {
    if (DANGEROUS_FIND_FLAGS.has(token)) {
      return {
        allowed: false,
        reason: `[${HOOK_NAME}] Command 'find' with '${token}' flag is not allowed for Prometheus. ` +
          `Prometheus can only run read-only commands.`,
      }
    }
  }
  return { allowed: true, reason: "allowed find command without dangerous flags" }
}

function validateOutputFlagCommand(command: string, tokens: string[]): BashCommandResult {
  const hasOutputFlag = tokens.some(t => t === "-o")
  if (hasOutputFlag) {
    return {
      allowed: false,
      reason: `[${HOOK_NAME}] Command '${command}' with '-o' flag is not allowed for Prometheus. ` +
        `Prometheus can only run read-only commands.`,
    }
  }
  return { allowed: true, reason: `allowed ${command} command without -o flag` }
}

function validateEchoCommand(tokens: string[], workspaceRoot: string): BashCommandResult {
  const redirectTargets = extractRedirectTargets(tokens)
  if (redirectTargets.length === 0) {
    return { allowed: true, reason: "echo without redirection" }
  }

  for (const target of redirectTargets) {
    if (!isAllowedRedirectTarget(target, workspaceRoot)) {
      return {
        allowed: false,
        reason: `[${HOOK_NAME}] Redirect target '${target}' is outside .sisyphus/**/*.md. ` +
          `Prometheus can only write to .sisyphus/ markdown files.`,
      }
    }
  }

  return { allowed: true, reason: "echo with allowed redirect target" }
}

function validateRedirections(tokens: string[], workspaceRoot: string): BashCommandResult {
  const redirectTargets = extractRedirectTargets(tokens)

  for (const target of redirectTargets) {
    if (!isAllowedRedirectTarget(target, workspaceRoot)) {
      return {
        allowed: false,
        reason: `[${HOOK_NAME}] Redirect target '${target}' is outside .sisyphus/**/*.md. ` +
          `Prometheus can only write to .sisyphus/ markdown files.`,
      }
    }
  }

  return { allowed: true, reason: "no disallowed redirections" }
}

export function analyzeBashCommand(command: string, workspaceRoot: string): BashCommandResult {
  const trimmed = command.trim()

  if (!trimmed) {
    return { allowed: false, reason: `[${HOOK_NAME}] Empty command is not allowed.` }
  }

  if (hasNewlines(trimmed)) {
    return {
      allowed: false,
      reason: `[${HOOK_NAME}] Compound commands (;, &&, ||, |) are not allowed. Run each command separately.`,
    }
  }

  if (hasCompoundOperators(trimmed)) {
    return {
      allowed: false,
      reason: `[${HOOK_NAME}] Compound commands (;, &&, ||, |) are not allowed. Run each command separately.`,
    }
  }

  if (hasSubshells(trimmed)) {
    return {
      allowed: false,
      reason: `[${HOOK_NAME}] Compound commands (;, &&, ||, |) are not allowed. Run each command separately.`,
    }
  }

  const tokens = tokenize(trimmed)
  if (tokens.length === 0) {
    return { allowed: false, reason: `[${HOOK_NAME}] Empty command is not allowed.` }
  }

  const firstToken = tokens[0]

  if (COMMAND_WRAPPERS.has(firstToken)) {
    return {
      allowed: false,
      reason: `[${HOOK_NAME}] Command '${firstToken}' is not in the allowed list for Prometheus. ` +
        `Prometheus can only run read-only commands and write to .sisyphus/**/*.md files.`,
    }
  }

  if (firstToken === "git") {
    const gitResult = validateGitCommand(tokens)
    if (!gitResult.allowed) return gitResult
    return validateRedirections(tokens, workspaceRoot)
  }

  if (firstToken === "echo") {
    return validateEchoCommand(tokens, workspaceRoot)
  }

  if (!READ_ONLY_COMMANDS.has(firstToken)) {
    return {
      allowed: false,
      reason: `[${HOOK_NAME}] Command '${firstToken}' is not in the allowed list for Prometheus. ` +
        `Prometheus can only run read-only commands and write to .sisyphus/**/*.md files.`,
    }
  }

  if (firstToken === "find") {
    const findResult = validateFindCommand(tokens)
    if (!findResult.allowed) return findResult
  }

  if (DANGEROUS_OUTPUT_FLAG_COMMANDS.has(firstToken)) {
    const outputResult = validateOutputFlagCommand(firstToken, tokens)
    if (!outputResult.allowed) return outputResult
  }

  return validateRedirections(tokens, workspaceRoot)
}
