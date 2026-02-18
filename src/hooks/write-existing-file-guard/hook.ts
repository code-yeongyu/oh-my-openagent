import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import { existsSync, realpathSync } from "fs"
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "path"

import { log } from "../../shared"

type GuardArgs = {
  filePath?: string
  path?: string
  file_path?: string
  overwrite?: boolean | string
}

const MAX_TRACKED_SESSIONS = 256

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  return value as Record<string, unknown>
}

function getPathFromArgs(args: GuardArgs | undefined): string | undefined {
  return args?.filePath ?? args?.path ?? args?.file_path
}

function resolveInputPath(ctx: PluginInput, inputPath: string): string {
  return normalize(isAbsolute(inputPath) ? inputPath : resolve(ctx.directory, inputPath))
}

function toCanonicalPath(absolutePath: string): string {
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

function isOverwriteEnabled(value: boolean | string | undefined): boolean {
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
  const sisyphusRoot = join(canonicalSessionRoot, ".sisyphus") + sep

  const touchSession = (sessionID: string): void => {
    sessionLastAccess.set(sessionID, Date.now())
  }

  const evictLeastRecentlyUsedSession = (): void => {
    let oldestSessionID: string | undefined
    let oldestSeen = Number.POSITIVE_INFINITY

    for (const [sessionID, lastSeen] of sessionLastAccess.entries()) {
      if (lastSeen < oldestSeen) {
        oldestSeen = lastSeen
        oldestSessionID = sessionID
      }
    }

    if (!oldestSessionID) {
      return
    }

    readPermissionsBySession.delete(oldestSessionID)
    sessionLastAccess.delete(oldestSessionID)
  }

  const ensureSessionReadSet = (sessionID: string): Set<string> => {
    let readSet = readPermissionsBySession.get(sessionID)
    if (!readSet) {
      if (readPermissionsBySession.size >= MAX_TRACKED_SESSIONS) {
        evictLeastRecentlyUsedSession()
      }

      readSet = new Set<string>()
      readPermissionsBySession.set(sessionID, readSet)
    }

    touchSession(sessionID)
    return readSet
  }

  const registerReadPermission = (sessionID: string, canonicalPath: string): void => {
    const readSet = ensureSessionReadSet(sessionID)
    readSet.add(canonicalPath)
  }

  const consumeReadPermission = (sessionID: string, canonicalPath: string): boolean => {
    const readSet = readPermissionsBySession.get(sessionID)
    if (!readSet || !readSet.has(canonicalPath)) {
      return false
    }

    readSet.delete(canonicalPath)
    touchSession(sessionID)
    return true
  }

  const invalidateOtherSessions = (canonicalPath: string, writingSessionID?: string): void => {
    for (const [sessionID, readSet] of readPermissionsBySession.entries()) {
      if (writingSessionID && sessionID === writingSessionID) {
        continue
      }

      if (readSet.delete(canonicalPath)) {
        touchSession(sessionID)
      }
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool?.toLowerCase()
      if (toolName !== "write" && toolName !== "read") {
        return
      }

      const argsRecord = asRecord(output.args)
      const args = argsRecord as GuardArgs | undefined
      const filePath = getPathFromArgs(args)
      if (!filePath) {
        return
      }

      const resolvedPath = resolveInputPath(ctx, filePath)
      const canonicalPath = toCanonicalPath(resolvedPath)

      if (toolName === "read") {
        if (!existsSync(resolvedPath) || !input.sessionID) {
          return
        }

        registerReadPermission(input.sessionID, canonicalPath)
        return
      }

      const overwriteEnabled = isOverwriteEnabled(args?.overwrite)

      if (argsRecord && "overwrite" in argsRecord) {
        delete argsRecord.overwrite
      }

      if (!existsSync(resolvedPath)) {
        return
      }

      const isSisyphusPath = canonicalPath.startsWith(sisyphusRoot)
      if (isSisyphusPath) {
        log("[write-existing-file-guard] Allowing .sisyphus/** overwrite", {
          sessionID: input.sessionID,
          filePath,
        })
        invalidateOtherSessions(canonicalPath, input.sessionID)
        return
      }

      if (overwriteEnabled) {
        log("[write-existing-file-guard] Allowing overwrite flag bypass", {
          sessionID: input.sessionID,
          filePath,
          resolvedPath,
        })
        invalidateOtherSessions(canonicalPath, input.sessionID)
        return
      }

      if (input.sessionID && consumeReadPermission(input.sessionID, canonicalPath)) {
        log("[write-existing-file-guard] Allowing overwrite after read", {
          sessionID: input.sessionID,
          filePath,
          resolvedPath,
        })
        invalidateOtherSessions(canonicalPath, input.sessionID)
        return
      }

      log("[write-existing-file-guard] Blocking write to existing file", {
        sessionID: input.sessionID,
        filePath,
        resolvedPath,
      })

      throw new Error("File already exists. Use edit tool instead.")
    },
  }
}
