import fs from "node:fs"
import os from "node:os"
import path, { isAbsolute, relative, resolve } from "node:path"

export type MemoAnchorScope = "session" | "global"

const DEFAULT_ENABLED = false

let globalEnabled = DEFAULT_ENABLED

const lastRealUserMessage = new Map<string, string>()
const memoReadSinceLastCompaction = new Map<string, boolean>()
const lastCompactionWasAuto = new Map<string, boolean>()
const pendingSystemDirectives = new Map<string, string[]>()
const sessionParentIDs = new Map<string, string | undefined>()

const OPENCODE_KV_FILE = "kv.json"
const OPENCODE_KV_MEMO_ANCHOR_KEY = "omo.memo_anchor.enabled"
let cachedKvMtimeMs: number | undefined
let lastKvSyncAtMs = 0

function getOpencodeStateDir(): string {
  const home = os.homedir()
  if (process.platform === "win32") {
    const base =
      process.env.XDG_STATE_HOME ||
      process.env.LOCALAPPDATA ||
      process.env.APPDATA ||
      path.join(home, "AppData", "Local")
    return path.join(base, "opencode")
  }
  const base = process.env.XDG_STATE_HOME || path.join(home, ".local", "state")
  return path.join(base, "opencode")
}

function syncMemoAnchorFromOpencodeKV(): void {
  const now = Date.now()
  // Throttle to avoid excessive fs ops on tight loops (tools can call isMemoAnchorEnabled often).
  if (now - lastKvSyncAtMs < 250) return
  lastKvSyncAtMs = now

  try {
    const kvPath = path.join(getOpencodeStateDir(), OPENCODE_KV_FILE)
    const stat = fs.statSync(kvPath)
    if (cachedKvMtimeMs === stat.mtimeMs) return
    cachedKvMtimeMs = stat.mtimeMs

    const raw = fs.readFileSync(kvPath, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown> | undefined
    const enabled = parsed?.[OPENCODE_KV_MEMO_ANCHOR_KEY]
    if (typeof enabled !== "boolean") return
    globalEnabled = enabled
  } catch {
    // Best-effort only. If KV is unavailable, fall back to in-memory + persisted plugin state.
  }
}

export function isMemoAnchorEnabled(sessionID: string | undefined): boolean {
  syncMemoAnchorFromOpencodeKV()
  return globalEnabled
}

export function getMemoAnchorStatus(sessionID: string | undefined): { enabled: boolean; scope: MemoAnchorScope } {
  syncMemoAnchorFromOpencodeKV()
  return { enabled: globalEnabled, scope: "global" }
}

export function setMemoAnchorEnabled(input: {
  sessionID: string | undefined
  enabled: boolean
  scope?: MemoAnchorScope
}): { enabled: boolean; scope: MemoAnchorScope } {
  globalEnabled = input.enabled
  return { enabled: globalEnabled, scope: "global" }
}

export function setGlobalMemoAnchorEnabled(enabled: boolean): { enabled: boolean; scope: MemoAnchorScope } {
  globalEnabled = enabled
  return { enabled: globalEnabled, scope: "global" }
}

export function clearMemoAnchorSessionState(sessionID: string): void {
  lastRealUserMessage.delete(sessionID)
  memoReadSinceLastCompaction.delete(sessionID)
  lastCompactionWasAuto.delete(sessionID)
  pendingSystemDirectives.delete(sessionID)
  sessionParentIDs.delete(sessionID)
}

export function recordLastRealUserMessage(sessionID: string, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  lastRealUserMessage.set(sessionID, trimmed)
}

export function getLastRealUserMessage(sessionID: string): string | undefined {
  return lastRealUserMessage.get(sessionID)
}

export function resetMemoReadState(sessionID: string): void {
  memoReadSinceLastCompaction.set(sessionID, false)
}

export function markMemoRead(sessionID: string): void {
  memoReadSinceLastCompaction.set(sessionID, true)
}

export function hasReadMemo(sessionID: string): boolean {
  return memoReadSinceLastCompaction.get(sessionID) === true
}

export function recordLastCompactionMode(sessionID: string, auto: boolean): void {
  lastCompactionWasAuto.set(sessionID, auto)
}

export function wasLastCompactionAuto(sessionID: string): boolean | undefined {
  return lastCompactionWasAuto.get(sessionID)
}

export function queueSystemDirective(sessionID: string, directive: string): void {
  const text = directive.trim()
  if (!text) return
  const current = pendingSystemDirectives.get(sessionID) ?? []
  current.push(text)
  pendingSystemDirectives.set(sessionID, current)
}

export function drainQueuedSystemDirectives(sessionID: string): string[] {
  const queued = pendingSystemDirectives.get(sessionID) ?? []
  pendingSystemDirectives.delete(sessionID)
  return queued
}

export function recordSessionParentID(sessionID: string, parentID: string | undefined): void {
  sessionParentIDs.set(sessionID, parentID)
}

export function getSessionParentID(sessionID: string): string | undefined {
  return sessionParentIDs.get(sessionID)
}

export function isChildSession(sessionID: string): boolean | undefined {
  if (!sessionParentIDs.has(sessionID)) return undefined
  return Boolean(sessionParentIDs.get(sessionID))
}

export function isMemoFilePath(filePath: string, workspaceRoot: string): boolean {
  if (!filePath) return false
  const resolved = isAbsolute(filePath) ? filePath : resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, resolved).replaceAll("\\", "/")
  return rel.toLowerCase().endsWith(".sisyphus/memo.md")
}
