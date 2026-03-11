import picomatch from "picomatch"
import type { TtsrMatchContext, TtsrScope } from "./types"

const DEFAULT_SCOPE: TtsrScope = {
  allowText: true,
  allowThinking: false,
  allowAnyTool: false,
  toolScopes: [],
}

const GLOB_SHORTCUT_TOOLS = ["edit", "write", "multiedit"] as const

function isGlobShortcutToken(token: string): boolean {
  return token.includes("*") || token.includes("?") || token.includes("[")
}

function parseToolScopeToken(token: string): { toolName: string; fileGlobs?: string[] } {
  const rest = token.slice("tool:".length)
  const parenIndex = rest.indexOf("(")

  if (parenIndex === -1) {
    return { toolName: rest }
  }

  const toolName = rest.slice(0, parenIndex)
  const closeParenIndex = rest.lastIndexOf(")")
  const glob = rest.slice(parenIndex + 1, closeParenIndex)
  return { toolName, fileGlobs: [glob] }
}

export function parseScope(scopeTokens: string[]): TtsrScope {
  if (scopeTokens.length === 0) {
    return {
      ...DEFAULT_SCOPE,
      toolScopes: [...DEFAULT_SCOPE.toolScopes],
    }
  }

  const scope: TtsrScope = {
    allowText: false,
    allowThinking: false,
    allowAnyTool: false,
    toolScopes: [],
  }

  for (const token of scopeTokens) {
    if (token === "text") {
      scope.allowText = true
      continue
    }

    if (token === "thinking") {
      scope.allowThinking = true
      continue
    }

    if (token === "tool") {
      scope.allowAnyTool = true
      continue
    }

    if (token.startsWith("tool:")) {
      scope.toolScopes.push(parseToolScopeToken(token))
      continue
    }

    if (isGlobShortcutToken(token)) {
      for (const toolName of GLOB_SHORTCUT_TOOLS) {
        scope.toolScopes.push({ toolName, fileGlobs: [token] })
      }
    }
  }

  return scope
}

export function matchesScope(scope: TtsrScope, context: TtsrMatchContext): boolean {
  if (context.source === "text") {
    return scope.allowText
  }

  if (context.source === "thinking") {
    return scope.allowThinking
  }

  if (context.source === "tool") {
    if (scope.allowAnyTool) {
      return true
    }

    for (const toolScope of scope.toolScopes) {
      if (toolScope.toolName !== context.toolName) {
        continue
      }

      if (!toolScope.fileGlobs || toolScope.fileGlobs.length === 0) {
        return true
      }

      if (!context.filePaths || context.filePaths.length === 0) {
        return true
      }

      for (const filePath of context.filePaths) {
        for (const glob of toolScope.fileGlobs) {
          if (picomatch.isMatch(filePath, glob, { dot: true, bash: true })) {
            return true
          }
        }
      }
    }

    return false
  }

  return false
}
