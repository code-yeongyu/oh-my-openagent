import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { LOADING_SPINNER_FRAME_MS, loadingSpinnerFrame } from "@oh-my-opencode/utils/loading-spinner"

const STATUS_KEY = "ulw-loop"

type TimerHandle = ReturnType<typeof setInterval> | number

export interface UlwLoopFooterTimers {
  set(callback: () => void, intervalMs: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface UlwLoopFooterStatusOptions {
  readonly isGoalActive?: (runtime: UlwLoopFooterRuntime) => boolean
  readonly timers?: UlwLoopFooterTimers
  readonly now?: () => number
}

export interface UlwLoopFooterUi {
  setStatus(key: string, text: string | undefined): void
}

export interface UlwLoopFooterRuntime {
  readonly ui: UlwLoopFooterUi
  readonly goalPaths: readonly string[]
}

export interface UlwLoopFooterStatus {
  sync(eventCtx: unknown, ulwActive: boolean): void
  dispose(): void
}

export function createUlwLoopFooterStatus(options: UlwLoopFooterStatusOptions = {}): UlwLoopFooterStatus {
  const goalCache = createGoalJsonCache()
  const isGoalActive =
    options.isGoalActive ?? ((runtime: UlwLoopFooterRuntime) => goalActiveFromContext(runtime, goalCache))
  const timers = options.timers ?? defaultTimers
  const now = options.now ?? Date.now
  let timer: TimerHandle | undefined
  let runtime: UlwLoopFooterRuntime | undefined
  let published = false
  let ulwActive = false

  function publish(): void {
    if (runtime === undefined) return
    runtime.ui.setStatus(STATUS_KEY, `⚡ ${loadingSpinnerFrame(now())} ultraworking`)
    published = true
  }

  function stop(): void {
    if (timer !== undefined) {
      timers.clear(timer)
      timer = undefined
    }
    if (published && runtime !== undefined) runtime.ui.setStatus(STATUS_KEY, undefined)
    published = false
  }

  function tick(): void {
    if (runtime === undefined || !ulwActive || !isGoalActive(runtime)) {
      stop()
      return
    }
    publish()
  }

  return {
    sync(eventCtx, active) {
      const nextRuntime = runtimeFromContext(eventCtx)
      if (nextRuntime !== undefined) runtime = nextRuntime
      ulwActive = active
      if (runtime === undefined || !ulwActive || !isGoalActive(runtime)) {
        stop()
        return
      }
      if (timer !== undefined) return
      publish()
      timer = timers.set(tick, LOADING_SPINNER_FRAME_MS)
    },
    dispose() {
      ulwActive = false
      stop()
      goalCache.clear()
      runtime = undefined
    },
  }
}

const defaultTimers: UlwLoopFooterTimers = {
  set(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs)
    handle.unref()
    return handle
  },
  clear(handle) {
    clearInterval(handle)
  },
}

function runtimeFromContext(value: unknown): UlwLoopFooterRuntime | undefined {
  if (!isRecord(value)) return undefined
  const ui = value["ui"]
  if (!isRecord(ui)) return undefined
  const setStatus = ui["setStatus"]
  if (typeof setStatus !== "function") return undefined
  return {
    ui: {
      setStatus(key, text) {
        Reflect.apply(setStatus, ui, [key, text])
      },
    },
    goalPaths: goalPathsFromContext(value),
  }
}

type GoalJsonCache = {
  read(path: string): Record<string, unknown> | undefined
  clear(): void
}

type GoalJsonCacheEntry = {
  readonly mtimeMs: number
  readonly size: number
  readonly raw: string
  readonly parsed: Record<string, unknown> | undefined
}

// A rewrite that lands within the filesystem's timestamp granule keeps the previous mtime, so an
// unchanged mtime+size is trusted only once it is older than this window (git's racily-clean rule).
const RACY_MTIME_WINDOW_MS = 2_000

// An unchanged goal file costs one stat per tick once its mtime is outside the racy window.
export function createGoalJsonCache(): GoalJsonCache {
  const entries = new Map<string, GoalJsonCacheEntry>()
  return {
    read(path) {
      let mtimeMs: number
      let size: number
      try {
        ;({ mtimeMs, size } = statSync(path))
      } catch {
        entries.delete(path)
        return undefined
      }
      const hit = entries.get(path)
      const statUnchanged = hit !== undefined && hit.mtimeMs === mtimeMs && hit.size === size
      if (hit !== undefined && statUnchanged && Date.now() - mtimeMs >= RACY_MTIME_WINDOW_MS) return hit.parsed
      let raw: string
      try {
        raw = readFileSync(path, "utf8")
      } catch {
        entries.delete(path)
        return undefined
      }
      if (hit !== undefined && statUnchanged && hit.raw === raw) return hit.parsed
      const parsed = parseGoalJson(raw)
      entries.set(path, { mtimeMs, size, raw, parsed })
      return parsed
    },
    clear() {
      entries.clear()
    },
  }
}

function parseGoalJson(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function readGoalJsonUncached(path: string): Record<string, unknown> | undefined {
  try {
    return parseGoalJson(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function goalActiveFromContext(runtime: UlwLoopFooterRuntime, cache?: GoalJsonCache): boolean {
  for (const goalPath of runtime.goalPaths) {
    const parsed = cache === undefined ? readGoalJsonUncached(goalPath) : cache.read(goalPath)
    if (
      parsed !== undefined &&
      parsed["version"] === 1 &&
      isRecord(parsed["goal"]) &&
      typeof parsed["goal"]["status"] === "string"
    ) {
      return parsed["goal"]["status"] === "active"
    }
  }
  return false
}

export function goalPathsFromContext(value: unknown): readonly string[] {
  if (!isRecord(value)) return []
  const manager = value["sessionManager"]
  if (!isRecord(manager)) return []
  const getSessionFile = manager["getSessionFile"]
  const getSessionDir = manager["getSessionDir"]
  const getSessionId = manager["getSessionId"]
  if (typeof getSessionId !== "function") return []
  const sessionId = Reflect.apply(getSessionId, manager, [])
  if (typeof sessionId !== "string") return []
  const goalFile = `${encodeURIComponent(sessionId)}.json`
  const paths: string[] = []
  if (
    typeof getSessionFile === "function" &&
    typeof getSessionDir === "function" &&
    Reflect.apply(getSessionFile, manager, []) !== undefined
  ) {
    const sessionDir = Reflect.apply(getSessionDir, manager, [])
    if (typeof sessionDir === "string") paths.push(join(sessionDir, "extensions", "goal", goalFile))
  }
  const cwd = value["cwd"]
  if (typeof cwd === "string") paths.push(join(cwd, ".omo", "goal", goalFile))
  return paths
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
