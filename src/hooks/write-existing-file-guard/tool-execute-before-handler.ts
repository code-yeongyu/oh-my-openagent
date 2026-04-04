import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "fs"
import { log } from "../../shared"
import { MAX_TRACKED_PATHS_PER_SESSION } from "./hook"
import {
  asRecord,
  getPathFromArgs,
  isOverwriteEnabled,
  isPathInsideDirectory,
  resolveInputPath,
  toCanonicalPath,
  type GuardArgs,
} from "./hook"
import {
  evictLeastRecentlyUsedSession,
  touchSession,
  trimSessionReadSet,
} from "./session-read-permissions"

function ensureSessionReadSet(params: {
  sessionID: string
  readPermissionsBySession: Map<string, Set<string>>
  sessionLastAccess: Map<string, number>
  maxTrackedSessions: number
}): Set<string> {
  const { sessionID, readPermissionsBySession, sessionLastAccess, maxTrackedSessions } = params
  let readSet = readPermissionsBySession.get(sessionID)
  if (!readSet) {
    if (readPermissionsBySession.size >= maxTrackedSessions) {
      evictLeastRecentlyUsedSession(readPermissionsBySession, sessionLastAccess)
    }

    readSet = new Set<string>()
    readPermissionsBySession.set(sessionID, readSet)
  }

  touchSession(sessionLastAccess, sessionID)
  return readSet
}

function registerReadPermission(params: {
  sessionID: string
  canonicalPath: string
  readPermissionsBySession: Map<string, Set<string>>
  sessionLastAccess: Map<string, number>
  maxTrackedSessions: number
}): void {
  const readSet = ensureSessionReadSet(params)
  if (readSet.has(params.canonicalPath)) {
    readSet.delete(params.canonicalPath)
  }

  readSet.add(params.canonicalPath)
  trimSessionReadSet(readSet, MAX_TRACKED_PATHS_PER_SESSION)
}

function consumeReadPermission(params: {
  sessionID: string
  canonicalPath: string
  readPermissionsBySession: Map<string, Set<string>>
  sessionLastAccess: Map<string, number>
}): boolean {
  const readSet = params.readPermissionsBySession.get(params.sessionID)
  if (!readSet || !readSet.has(params.canonicalPath)) {
    return false
  }

  readSet.delete(params.canonicalPath)
  touchSession(params.sessionLastAccess, params.sessionID)
  return true
}

function invalidateOtherSessions(
  readPermissionsBySession: Map<string, Set<string>>,
  canonicalPath: string,
  writingSessionID?: string,
): void {
  for (const [sessionID, readSet] of readPermissionsBySession.entries()) {
    if (writingSessionID && sessionID === writingSessionID) {
      continue
    }

    readSet.delete(canonicalPath)
  }
}

export async function handleWriteExistingFileGuardToolExecuteBefore(params: {
  ctx: PluginInput
  input: { tool?: string; sessionID?: string }
  output: { args?: unknown }
  readPermissionsBySession: Map<string, Set<string>>
  sessionLastAccess: Map<string, number>
  canonicalSessionRoot: string
  maxTrackedSessions: number
}): Promise<void> {
  const { ctx, input, output, readPermissionsBySession, sessionLastAccess, canonicalSessionRoot, maxTrackedSessions } = params
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
  if (!isPathInsideDirectory(canonicalPath, canonicalSessionRoot)) {
    return
  }

  if (toolName === "read") {
    if (!existsSync(resolvedPath) || !input.sessionID) {
      return
    }

    registerReadPermission({
      sessionID: input.sessionID,
      canonicalPath,
      readPermissionsBySession,
      sessionLastAccess,
      maxTrackedSessions,
    })
    return
  }

  const overwriteEnabled = isOverwriteEnabled(args?.overwrite)
  if (argsRecord && "overwrite" in argsRecord) {
    delete argsRecord.overwrite
  }

  if (!existsSync(resolvedPath)) {
    return
  }

  const isSisyphusPath = canonicalPath.includes("/.sisyphus/")
  if (isSisyphusPath) {
    log("[write-existing-file-guard] Allowing .sisyphus/** overwrite", {
      sessionID: input.sessionID,
      filePath,
    })
    invalidateOtherSessions(readPermissionsBySession, canonicalPath, input.sessionID)
    return
  }

  if (overwriteEnabled) {
    log("[write-existing-file-guard] Allowing overwrite flag bypass", {
      sessionID: input.sessionID,
      filePath,
      resolvedPath,
    })
    invalidateOtherSessions(readPermissionsBySession, canonicalPath, input.sessionID)
    return
  }

  if (input.sessionID && consumeReadPermission({ sessionID: input.sessionID, canonicalPath, readPermissionsBySession, sessionLastAccess })) {
    log("[write-existing-file-guard] Allowing overwrite after read", {
      sessionID: input.sessionID,
      filePath,
      resolvedPath,
    })
    invalidateOtherSessions(readPermissionsBySession, canonicalPath, input.sessionID)
    return
  }

  log("[write-existing-file-guard] Blocking write to existing file", {
    sessionID: input.sessionID,
    filePath,
    resolvedPath,
  })

  throw new Error("File already exists. Use edit tool instead.")
}
