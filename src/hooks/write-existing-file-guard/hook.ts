import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import { existsSync, realpathSync } from "fs"
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "path"

import { log } from "../../shared"
import { handleWriteExistingFileGuardToolExecuteBefore } from "./tool-execute-before-handler"
import { evictLeastRecentlyUsedSession, touchSession, trimSessionReadSet } from "./session-read-permissions"

export type GuardArgs = {
  filePath?: string
  path?: string
  file_path?: string
  overwrite?: boolean | string
}

const MAX_TRACKED_SESSIONS = 256
export const MAX_TRACKED_PATHS_PER_SESSION = 1024
const BLOCK_MESSAGE = "File already exists. Use edit tool instead."

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

export function getPathFromArgs(args: GuardArgs | undefined): string | undefined {
  return args?.filePath ?? args?.path ?? args?.file_path
}

export function resolveInputPath(ctx: PluginInput, inputPath: string): string {
  return normalize(isAbsolute(inputPath) ? inputPath : resolve(ctx.directory, inputPath))
}

export function isPathInsideDirectory(pathToCheck: string, directory: string): boolean {
  const relativePath = relative(directory, pathToCheck)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}



export function toCanonicalPath(absolutePath: string): string {
  let canonicalPath = absolutePath

  if (existsSync(absolutePath)) {
    try {
      canonicalPath = realpathSync.native(absolutePath)
    } catch {
      canonicalPath = absolutePath
    }
  } else {
    const absoluteDir = dirname(absolutePath)
    const resolvedDir = existsSync(absoluteDir) ? realpathSync.native(absoluteDir) : absoluteDir
    canonicalPath = join(resolvedDir, basename(absolutePath))
  }

  // Preserve canonical casing from the filesystem to avoid collapsing distinct
  // files on case-sensitive volumes (supported on all major OSes).
  return normalize(canonicalPath)
}

export function isOverwriteEnabled(value: boolean | string | undefined): boolean {
  if (value === true) {
    return true
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true"
  }

  return false
}

export function createWriteExistingFileGuardHook(ctx: PluginInput): Hooks {
  const readPermissionsBySession = new Map<string, Set<string>>()
  const sessionLastAccess = new Map<string, number>()
  const canonicalSessionRoot = toCanonicalPath(resolveInputPath(ctx, ctx.directory))

  return {
    "tool.execute.before": async (input, output) => {
      await handleWriteExistingFileGuardToolExecuteBefore({
        ctx,
        input,
        output,
        readPermissionsBySession,
        sessionLastAccess,
        canonicalSessionRoot,
        maxTrackedSessions: MAX_TRACKED_SESSIONS,
      })
    },
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.deleted") {
        return
      }

      const props = event.properties as { info?: { id?: string } } | undefined
      const sessionID = props?.info?.id
      if (!sessionID) {
        return
      }

      readPermissionsBySession.delete(sessionID)
      sessionLastAccess.delete(sessionID)
    },
  }
}
