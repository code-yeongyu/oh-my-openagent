import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { getMainSessionID, subagentSessions } from "../../features/claude-code-session-state"
import { BASH_FILE_CREATION_PATTERNS, ERROR_MESSAGE, INTERCEPTED_TOOLS, PLANNING_FILE_PATTERNS } from "./constants"

export * from "./constants"

type ToolArgs = Record<string, unknown> | undefined

const PLANNING_FILE_REGEXES = PLANNING_FILE_PATTERNS.map(toPatternRegex)

function toPatternRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const withWildcard = escaped.replace(/\*/g, "[^/]+")
  return new RegExp(`^${withWildcard}$`, "i")
}

function normalizeRelativePath(filePath: string, workspaceRoot: string): string | null {
  const resolved = resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, resolved)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return null
  }
  return rel.replace(/\\/g, "/")
}

function matchesPlanningFilePattern(filePath: string, workspaceRoot: string): boolean {
  const rel = normalizeRelativePath(filePath, workspaceRoot)
  if (!rel) {
    return false
  }
  return PLANNING_FILE_REGEXES.some(regex => regex.test(rel))
}

function extractFilePathsFromBashCommand(command: string): string[] {
  const paths: string[] = []
  for (const pattern of BASH_FILE_CREATION_PATTERNS) {
    const match = command.match(pattern)
    const pathMatch = match?.[1]
    if (pathMatch) {
      paths.push(pathMatch)
    }
  }
  return paths
}

function getFilePaths(args: ToolArgs, toolName: string): string[] {
  if (!args) {
    return []
  }

  const paths: string[] = []
  
  // Handle Bash tool - extract file paths from command
  if (toolName.toLowerCase() === "bash") {
    const command = args.command as string | undefined
    if (command) {
      paths.push(...extractFilePathsFromBashCommand(command))
    }
    return paths
  }

  // Handle Write/Edit tools
  const directPath = args.filePath ?? args.file_path ?? args.path ?? args.file
  if (typeof directPath === "string") {
    paths.push(directPath)
  }

  const edits = args.edits as Array<Record<string, unknown>> | undefined
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      const editPath = edit.filePath ?? edit.file_path ?? edit.path
      if (typeof editPath === "string") {
        paths.push(editPath)
      }
    }
  }

  return paths
}

export function createTasksMdCreationGuardHook(ctx: PluginInput) {
  const skillUsedSessions = new Set<string>()

  function hasSkillAuthorization(sessionID?: string): boolean {
    if (!sessionID) return false
    if (skillUsedSessions.has(sessionID)) return true

    const mainSessionID = getMainSessionID()
    if (!mainSessionID) return false

    const isMainSession = sessionID === mainSessionID
    const isSubagentSession = subagentSessions.has(sessionID)
    if (!isMainSession && !isSubagentSession) return false

    if (skillUsedSessions.has(mainSessionID)) return true

    for (const subagentSession of subagentSessions) {
      if (skillUsedSessions.has(subagentSession)) return true
    }

    return false
  }

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID?: string },
      output: { args?: Record<string, unknown>; blocked?: boolean; message?: string }
    ): Promise<void> => {
      const toolName = input.tool
      const isIntercepted = INTERCEPTED_TOOLS.some(
        tool => tool.toLowerCase() === toolName.toLowerCase()
      )
      if (!isIntercepted) {
        return
      }

      const filePaths = getFilePaths(output.args, toolName)
      if (filePaths.length === 0) {
        return
      }

      const matchingPaths = filePaths.filter(path => matchesPlanningFilePattern(path, ctx.directory))
      if (matchingPaths.length === 0) {
        return
      }

      if (hasSkillAuthorization(input.sessionID)) {
        return
      }

      for (const filePath of matchingPaths) {
        const resolved = resolve(ctx.directory, filePath)
        if (!existsSync(resolved)) {
          output.blocked = true
          output.message = ERROR_MESSAGE
          return
        }
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID?: string; args?: Record<string, unknown> },
      output: { metadata?: Record<string, unknown> }
    ): Promise<void> => {
      const toolLower = input.tool.toLowerCase()
      // Recognize both "skill" and "slashcommand" tools
      if (toolLower !== "skill" && toolLower !== "slashcommand") {
        return
      }

      // Check both output metadata (for tools that provide it) and input args (for skill name)
      const outputSkillName = (output.metadata?.name ?? output.metadata?.skillName ?? "") as string
      const inputSkillName = (input.args?.name ?? input.args?.skillName ?? "") as string
      const skillName = outputSkillName || inputSkillName

      if (!skillName.toLowerCase().includes("creating-changes")) {
        return
      }

      if (input.sessionID) {
        skillUsedSessions.add(input.sessionID)
      }
    },
  }
}
