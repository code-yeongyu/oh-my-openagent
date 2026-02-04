import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { TASKS_MD_PATTERN, ERROR_MESSAGE, INTERCEPTED_TOOLS, BASH_FILE_CREATION_PATTERNS } from "./constants"

export * from "./constants"

type ToolArgs = Record<string, unknown> | undefined

const TASKS_MD_REGEX = toPatternRegex(TASKS_MD_PATTERN)

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

function matchesTasksMdPattern(filePath: string, workspaceRoot: string): boolean {
  const rel = normalizeRelativePath(filePath, workspaceRoot)
  if (!rel) {
    return false
  }
  return TASKS_MD_REGEX.test(rel)
}

function extractFilePathsFromBashCommand(command: string): string[] {
  const paths: string[] = []
  for (const pattern of BASH_FILE_CREATION_PATTERNS) {
    const match = command.match(pattern)
    if (match && match[1]) {
      paths.push(match[1])
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

      const matchingPaths = filePaths.filter(path => matchesTasksMdPattern(path, ctx.directory))
      if (matchingPaths.length === 0) {
        return
      }

      const hasSkill = input.sessionID ? skillUsedSessions.has(input.sessionID) : false
      if (hasSkill) {
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
      input: { tool: string; sessionID?: string },
      output: { metadata?: Record<string, unknown> }
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "skill") {
        return
      }

      const skillName = (output.metadata?.name ?? output.metadata?.skillName ?? "") as string
      if (!skillName.toLowerCase().includes("creating-changes")) {
        return
      }

      if (input.sessionID) {
        skillUsedSessions.add(input.sessionID)
      }
    },
  }
}
