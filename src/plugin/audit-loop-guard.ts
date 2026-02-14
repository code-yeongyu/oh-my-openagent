import type { CreatedHooks } from "../create-hooks"
import { log } from "../shared"
import {
  readAuditCheckpoint,
  writeAuditCheckpoint,
} from "../hooks/ralph-loop/audit-ledger"

type ToolInput = { tool: string; sessionID: string; callID: string }
type ToolOutput = { args: Record<string, unknown> }

const DATABASE_MUTATION_COMMAND_PATTERNS = [
  /\bdb\s+(push|reset|pull|seed)\b/i,
  // Provider-agnostic CLI migration subcommands: "<tool> migration <subcommand>"
  /\b[a-z0-9_.-]+\s+migration\s+[a-z0-9_-]+\b/i,
  /\bprisma\s+(migrate|db\s+push|db\s+pull|db\s+seed)\b/i,
  /\bdrizzle-kit\s+(push|migrate|generate)\b/i,
  /\b(knex|typeorm|sequelize)\b.*\bmigration\b/i,
  /\bflyway\b/i,
  /\bliquibase\b/i,
  /\bpostgres(?:ql)?\b.*\b(schema|migration|sql|table|column|policy|rls|insert|update|delete|alter|drop)\b/i,
  /\b(mysql|mariadb|sqlite|mongodb)\b.*\b(schema|migration|sql|table|column|index|insert|update|delete|alter|drop)\b/i,
  /\b(psql|pg_dump|pg_restore)\b/i,
]

const DATABASE_MUTATION_INTENT_PATTERN =
  /\b(migrate|migration|schema|sql|db push|db reset|db pull|table|column|policy|rls|seed|create|alter|drop|insert|update|delete|truncate)\b/i

const DATABASE_CONTEXT_PATTERN =
  /\b(database|db|sql|schema|migration|postgres|postgresql|mysql|mariadb|sqlite|mongodb|prisma|drizzle|typeorm|sequelize|knex|flyway|liquibase)\b/i

const DATABASE_NEGATION_PATTERN =
  /\b(do not|don't|dont|avoid|must not|never)\b.{0,40}\b(modify|change|touch|update|migrate|db|database|schema)\b/i

const HARD_CODED_VISUAL_LITERAL_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgb|rgba|hsl|hsla)\s*\(/,
  /\bColor\s*\(\s*0x[0-9a-fA-F]{8}\s*\)/,
  /\b(?:fontSize|padding|margin|borderRadius|letterSpacing|lineHeight|gap)\s*[:=]\s*\d+/,
]

const TOKEN_ALIAS_PATTERNS = [
  /var\(--/i,
  /\btoken[s]?\b/i,
  /\btheme\b/i,
  /\bAppTokens?\b/,
  /\bDesignTokens?\b/,
  /\bTheme\.of\(/,
  /\bcontext\.theme\b/i,
]

const TOKEN_DEFINITION_PATH_PATTERN =
  /(token|tokens|theme|design-system|palette|color|colors|typography|spacing)/i

const UI_FILE_PATTERN = /\.(dart|css|scss|less|tsx|jsx|vue|ts)$/i
const BLOCKER_REPORT_PATTERN = /\bBLOCKER REPORT\b/i
const FOCUS_SWITCH_INTENT_PATTERN = /\b(switch|change|move)\b.{0,20}\bfocus\b/i
const BUG_EVIDENCE_PATTERN = /\b(BUG EVIDENCE|REGRESSION EVIDENCE)\b/i

const MUTATING_SHELL_PATTERN =
  /\b(rm|mv|cp)\b|\bsed\s+-i\b|\bperl\s+-i\b|\bpython\s+-c\b|\bnode\s+-e\b|\bgit\s+(add|commit|push|reset|checkout|switch|merge|rebase)\b/i

const SAFE_SHELL_PATTERN =
  /\b(git\s+status|git\s+diff|rg\b|grep\b|ls\b|cat\b|find\b|pwd\b|flutter\s+analyze|flutter\s+test|flutter\s+build|bun\s+test|bun\s+run\s+build|bun\s+run\s+typecheck|npm\s+run\s+(test|build|lint)|pnpm\s+(test|build|lint)|yarn\s+(test|build|lint))\b/i

const DB_BLOCK_MESSAGE =
  "[audit-loop guard] Database mutation is blocked while /audit-loop is active. Keep changes UI-first and never run DB/migration/schema operations."

const FOCUS_BLOCK_MESSAGE =
  "[audit-loop guard] Focus lock violation. Keep edits inside the current focus path. Submit a BLOCKER REPORT task first to approve a one-time focus switch."

const SHELL_BLOCK_MESSAGE =
  "[audit-loop guard] Mutating shell command blocked during /audit-loop focus lock. Use write/edit/multiedit for deterministic, path-scoped edits."

const TOKEN_BLOCK_MESSAGE =
  "[audit-loop guard] Hardcoded visual style values are blocked in /audit-loop. Use global tokens/theme/shared UI primitives."

function normalizePath(pathLike: string): string {
  return pathLike.replace(/\\/g, "/").replace(/^\.\//, "").trim()
}

function getAuditLoopState(hooks: CreatedHooks, sessionID: string): { session_id?: string } | null {
  const state = hooks.ralphLoop?.getState?.()
  if (!state?.active || state.mode !== "audit-loop") return null
  if (state.session_id && state.session_id !== sessionID) return null
  return state
}

function hasDatabaseMutationCommand(command: string): boolean {
  return DATABASE_MUTATION_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

function hasDatabaseMutationIntent(text: string): boolean {
  const lower = text.toLowerCase()
  if (DATABASE_NEGATION_PATTERN.test(lower)) return false
  if (!DATABASE_CONTEXT_PATTERN.test(lower)) return false
  return DATABASE_MUTATION_INTENT_PATTERN.test(lower) || hasDatabaseMutationCommand(lower)
}

function isDatabaseMutationPath(pathLike: string): boolean {
  const normalized = normalizePath(pathLike).toLowerCase()
  if (normalized.endsWith(".sql")) return true
  if (/(^|\/)(migrations?|migration)(\/|$)/.test(normalized)) return true
  if (/(^|\/)(db|database|schema|schemas|seed|seeds)(\/|$)/.test(normalized)) return true
  if (/(^|\/)(prisma|drizzle|typeorm|sequelize|knex|flyway|liquibase)(\/|$)/.test(normalized))
    return true
  if (normalized.endsWith("schema.prisma")) return true
  return false
}

function getFilePathsFromArgs(args: Record<string, unknown>): string[] {
  const result: string[] = []
  for (const key of ["filePath", "path", "file_path"]) {
    const value = args[key]
    if (typeof value === "string" && value.length > 0) result.push(value)
  }

  const edits = args.edits
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (typeof edit !== "object" || edit === null) continue
      const rec = edit as Record<string, unknown>
      const filePath =
        typeof rec.filePath === "string"
          ? rec.filePath
          : typeof rec.path === "string"
            ? rec.path
            : typeof rec.file_path === "string"
              ? rec.file_path
              : undefined
      if (filePath) result.push(filePath)
    }
  }
  return [...new Set(result.map(normalizePath))]
}

function extractMutationTexts(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === "write") {
    return typeof args.content === "string" ? [args.content] : []
  }

  if (toolName === "edit") {
    const text =
      typeof args.newString === "string"
        ? args.newString
        : typeof args.new_string === "string"
          ? args.new_string
          : typeof args.newText === "string"
            ? args.newText
            : ""
    return text ? [text] : []
  }

  if (toolName === "multiedit" && Array.isArray(args.edits)) {
    const parts: string[] = []
    for (const edit of args.edits) {
      if (typeof edit !== "object" || edit === null) continue
      const rec = edit as Record<string, unknown>
      const text =
        typeof rec.newString === "string"
          ? rec.newString
          : typeof rec.new_string === "string"
            ? rec.new_string
            : typeof rec.newText === "string"
              ? rec.newText
              : ""
      if (text) parts.push(text)
    }
    return parts
  }

  return []
}

function isWithinFocus(pathLike: string, focusRoot: string): boolean {
  const target = normalizePath(pathLike)
  const root = normalizePath(focusRoot)
  return target === root || target.startsWith(`${root}/`)
}

function deriveFocusRoot(pathLike: string): string {
  const normalized = normalizePath(pathLike)
  const lastSlash = normalized.lastIndexOf("/")
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized
}

function hasHardcodedVisualLiteral(text: string): boolean {
  return HARD_CODED_VISUAL_LITERAL_PATTERNS.some((pattern) => pattern.test(text))
}

function hasTokenAlias(text: string): boolean {
  return TOKEN_ALIAS_PATTERNS.some((pattern) => pattern.test(text))
}

function shouldEnforceTokenLint(pathLike: string): boolean {
  const normalized = normalizePath(pathLike)
  return UI_FILE_PATTERN.test(normalized) && !TOKEN_DEFINITION_PATH_PATTERN.test(normalized)
}

export function createAuditLoopGuard(directory: string) {
  const focusBySession = new Map<string, string>()
  const focusSwitchApprovalBySession = new Set<string>()
  const lockedFileUnlockBySession = new Set<string>()

  const clearSession = (sessionID: string): void => {
    focusBySession.delete(sessionID)
    focusSwitchApprovalBySession.delete(sessionID)
    lockedFileUnlockBySession.delete(sessionID)
  }

  const resetSession = (sessionID: string): void => {
    clearSession(sessionID)
  }

  const enforce = (input: ToolInput, output: ToolOutput, hooks: CreatedHooks): void => {
    const state = getAuditLoopState(hooks, input.sessionID)
    if (!state) return

    const toolName = input.tool.toLowerCase()
    const args = output.args

    if (toolName === "task") {
      const prompt = typeof args.prompt === "string" ? args.prompt : ""
      const description = typeof args.description === "string" ? args.description : ""
      const combined = `${description}\n${prompt}`
      if (hasDatabaseMutationIntent(combined)) throw new Error(DB_BLOCK_MESSAGE)
      if (BLOCKER_REPORT_PATTERN.test(combined) && FOCUS_SWITCH_INTENT_PATTERN.test(combined)) {
        focusSwitchApprovalBySession.add(input.sessionID)
      }
      if (BUG_EVIDENCE_PATTERN.test(combined)) {
        lockedFileUnlockBySession.add(input.sessionID)
      }
      return
    }

    if (toolName === "bash" || toolName === "interactive_bash") {
      const command =
        typeof args.command === "string"
          ? args.command
          : typeof args.tmux_command === "string"
            ? args.tmux_command
            : ""
      if (command && hasDatabaseMutationCommand(command)) throw new Error(DB_BLOCK_MESSAGE)
      const hasFocus = focusBySession.has(input.sessionID)
      if (hasFocus && MUTATING_SHELL_PATTERN.test(command) && !SAFE_SHELL_PATTERN.test(command)) {
        throw new Error(SHELL_BLOCK_MESSAGE)
      }
      return
    }

    if (toolName !== "write" && toolName !== "edit" && toolName !== "multiedit") return

    const filePaths = getFilePathsFromArgs(args)
    if (filePaths.some((pathLike) => isDatabaseMutationPath(pathLike))) throw new Error(DB_BLOCK_MESSAGE)
    if (filePaths.length === 0) return

    const checkpoint = readAuditCheckpoint(directory)
    const lockedFiles = checkpoint.locked_files
    const lockedPath = filePaths.find((pathLike) =>
      lockedFiles.includes(pathLike.replace(/\\/g, "/")),
    )
    if (lockedPath) {
      if (!lockedFileUnlockBySession.has(input.sessionID)) {
        throw new Error(
          `[audit-loop guard] File is locked after saturation: ${lockedPath}. Provide BUG EVIDENCE or REGRESSION EVIDENCE via task before editing.`,
        )
      }
      lockedFileUnlockBySession.delete(input.sessionID)
    }

    let focusRoot = focusBySession.get(input.sessionID)
    if (!focusRoot) {
      focusRoot = deriveFocusRoot(filePaths[0])
      focusBySession.set(input.sessionID, focusRoot)
      log("[audit-loop guard] Focus path initialized", { sessionID: input.sessionID, focusRoot })
    }
    if (!focusRoot) return
    const activeFocusRoot = focusRoot

    const firstOutsideFocus = filePaths.find((pathLike) => !isWithinFocus(pathLike, activeFocusRoot))
    if (firstOutsideFocus) {
      const checkpoint = readAuditCheckpoint(directory)
      const hasBlockerApproval = focusSwitchApprovalBySession.has(input.sessionID)
      const hasAutoProgression = checkpoint.allow_focus_progression_once === true
      if (hasBlockerApproval || hasAutoProgression) {
        focusRoot = deriveFocusRoot(firstOutsideFocus)
        focusBySession.set(input.sessionID, focusRoot)
        focusSwitchApprovalBySession.delete(input.sessionID)
        if (hasAutoProgression) {
          checkpoint.allow_focus_progression_once = false
          checkpoint.updated_at = new Date().toISOString()
          writeAuditCheckpoint(directory, checkpoint)
        }
        log("[audit-loop guard] Focus path switched with authorization", {
          sessionID: input.sessionID,
          focusRoot,
          switchType: hasAutoProgression ? "screen_complete_auto_progression" : "blocker_report",
        })
      } else {
        throw new Error(FOCUS_BLOCK_MESSAGE)
      }
    }

    const payloadTexts = extractMutationTexts(toolName, args)
    if (payloadTexts.length === 0) return
    const payloadCombined = payloadTexts.join("\n")
    if (hasTokenAlias(payloadCombined)) return

    for (const filePath of filePaths) {
      if (shouldEnforceTokenLint(filePath) && hasHardcodedVisualLiteral(payloadCombined)) {
        throw new Error(`${TOKEN_BLOCK_MESSAGE} File: ${filePath}`)
      }
    }
  }

  return {
    enforce,
    clearSession,
    resetSession,
  }
}
