import type { PreToolUseContext } from "./pre-tool-use"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { execSync } from "node:child_process"

export interface GitCommitValidationResult {
  blocked: boolean
  reason?: string
}

export type CommandExecutor = (cmd: string, cwd: string) => string

const defaultExecutor: CommandExecutor = (cmd: string, cwd: string): string => {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString()
  } catch {
    return "" // Fail-open: return empty string on error
  }
}

export function validateGitCommit(
  context: PreToolUseContext,
  config: OhMyOpenCodeConfig,
  executor?: CommandExecutor
): GitCommitValidationResult {
  if (context.agent !== "git-owner") {
    return { blocked: false }
  }

  const command = extractCommand(context)
  if (!command) {
    return { blocked: false }
  }

  if (!isGitCommit(command)) {
    return { blocked: false }
  }

  const fullMessage = extractCommitMessage(command)
  if (!fullMessage) {
    // Can't extract message (e.g., git commit without -m) - fail-open
    return { blocked: false }
  }

  const subject = fullMessage.split("\n")[0]
  const exec = executor ?? defaultExecutor

  const forbiddenCheck = checkForbiddenPatterns(subject)
  if (forbiddenCheck) {
    return forbiddenCheck
  }

  const secretCheck = checkSecrets(exec, context.cwd)
  if (secretCheck) {
    return secretCheck
  }

  const filesCheck = checkForbiddenFiles(exec, context.cwd)
  if (filesCheck) {
    return filesCheck
  }

  const isCompanyRepo = detectCompanyRepo(exec, context.cwd)

  if (isCompanyRepo) {
    if (!hasJiraPrefix(subject)) {
      return {
        blocked: true,
        reason: "Company repo commit requires JIRA ticket prefix (e.g., SYSTEM-1234)",
      }
    }

    if (!hasKoreanChars(subject)) {
      return {
        blocked: true,
        reason: "Company repo commit message must be in Korean",
      }
    }

    if (!hasCoAuthoredBy(fullMessage)) {
      return {
        blocked: true,
        reason: "Company repo commit requires Co-authored-by trailer for AI tool usage",
      }
    }
  }

  return { blocked: false }
}

function extractCommand(context: PreToolUseContext): string {
  const toolInput = context.toolInput
  const toolLower = context.toolName.toLowerCase()

  if (toolLower === "bash" || toolLower === "mcp_bash") {
    return (toolInput.command as string) ?? ""
  }

  if (toolLower === "interactive_bash") {
    return (toolInput.tmux_command as string) ?? ""
  }

  return ""
}

function isGitCommit(command: string): boolean {
  // Scan full command for git commit (handle chained commands with &&, ||, ;)
  const parts = command.split(/[;&|]+/)

  for (const part of parts) {
    const trimmed = part.trim()
    if (/\bgit\s+commit\b/.test(trimmed)) {
      return true
    }
  }

  return false
}

function extractCommitMessage(command: string): string | null {
  // Extract message from -m "..." or --message="..." or --message "..."
  // Handle multiple -m flags (concatenate with newlines)
  const messages: string[] = []

  // Pattern 1: -m "..." or -m '...'
  const shortFlagPattern = /-m\s+(['"])((?:\\.|(?!\1).)*)\1/g
  let match: RegExpExecArray | null

  while ((match = shortFlagPattern.exec(command)) !== null) {
    messages.push(match[2])
  }

  // Pattern 2: --message="..." or --message='...'
  const longFlagEqualPattern = /--message=(['"])((?:\\.|(?!\1).)*)\1/g
  while ((match = longFlagEqualPattern.exec(command)) !== null) {
    messages.push(match[2])
  }

  // Pattern 3: --message "..." or --message '...'
  const longFlagSpacePattern = /--message\s+(['"])((?:\\.|(?!\1).)*)\1/g
  while ((match = longFlagSpacePattern.exec(command)) !== null) {
    messages.push(match[2])
  }

  if (messages.length === 0) {
    return null
  }

  return messages.join("\n")
}

function checkForbiddenPatterns(subject: string): GitCommitValidationResult | null {
  // Forbidden patterns: WIP, fixup, squash (case-insensitive, at start of message)
  if (/^WIP\b/i.test(subject)) {
    return { blocked: true, reason: "Commit message starts with forbidden pattern: WIP" }
  }

  if (/^fixup\b/i.test(subject)) {
    return { blocked: true, reason: "Commit message starts with forbidden pattern: fixup" }
  }

  if (/^squash\b/i.test(subject)) {
    return { blocked: true, reason: "Commit message starts with forbidden pattern: squash" }
  }

  return null
}

function checkSecrets(exec: CommandExecutor, cwd: string): GitCommitValidationResult | null {
  let diff: string
  try {
    diff = exec("git diff --staged", cwd)
  } catch {
    return null // No diff or error (fail-open)
  }

  if (!diff) {
    return null // No diff or error (fail-open)
  }

  // Secret patterns from constraints.yaml
  const secretPatterns = [
    /password\s*=\s*['"]/i,
    /api[_-]?key\s*=\s*['"]/i,
    /secret\s*=\s*['"]/i,
    /token\s*=\s*['"]/i,
    /-----BEGIN (RSA |DSA )?PRIVATE KEY-----/,
  ]

  // Only scan + lines (additions)
  const lines = diff.split("\n")
  for (const line of lines) {
    if (!line.startsWith("+")) {
      continue
    }

    for (const pattern of secretPatterns) {
      if (pattern.test(line)) {
        return {
          blocked: true,
          reason: "Staged changes contain potential secrets (password, api_key, token, private key)",
        }
      }
    }
  }

  return null
}

function checkForbiddenFiles(exec: CommandExecutor, cwd: string): GitCommitValidationResult | null {
  let files: string
  try {
    files = exec("git diff --staged --name-only", cwd)
  } catch {
    return null // No files or error (fail-open)
  }

  if (!files) {
    return null // No files or error (fail-open)
  }

  // Forbidden file patterns (hardcoded list from requirements)
  const forbiddenPatterns = [
    /\.env$/,
    /\.env\./,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
    /credentials\.json$/,
    /serviceAccountKey\.json$/,
    /\.DS_Store$/,
    /\.secret$/,
    /id_rsa$/,
    /id_dsa$/,
    /id_ed25519$/,
  ]

  const fileList = files.split("\n").filter((f) => f.trim())

  for (const file of fileList) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(file)) {
        return {
          blocked: true,
          reason: `Forbidden file in staged changes: ${file}`,
        }
      }
    }
  }

  return null
}

function detectCompanyRepo(exec: CommandExecutor, cwd: string): boolean {
  try {
    const remoteUrl = exec("git remote get-url origin", cwd)
    if (!remoteUrl) {
      return false // No remote or error (fail-open)
    }

    // Check for musinsa in URL (SSH or HTTPS)
    return /github\.com[:/]musinsa\//i.test(remoteUrl) || /musinsa\.com/i.test(remoteUrl)
  } catch {
    return false // Error → treat as non-company (fail-open)
  }
}

function hasJiraPrefix(subject: string): boolean {
  // JIRA pattern: {PROJECT}-{NUMBER} (e.g., SYSTEM-1234, SNDDEV-6448)
  // At least 2 uppercase letters, dash, digits
  return /^[A-Z]{2,}-\d+/.test(subject)
}

function hasKoreanChars(subject: string): boolean {
  // Korean Unicode range: AC00-D7AF (Hangul syllables)
  return /[\uAC00-\uD7AF]/.test(subject)
}

function hasCoAuthoredBy(fullMessage: string): boolean {
  return /Co-authored-by:/i.test(fullMessage)
}
