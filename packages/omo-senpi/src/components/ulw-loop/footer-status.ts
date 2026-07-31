import { readFileSync } from "node:fs"
import { join } from "node:path"

const STATUS_KEY = "ulw-loop"
const FRAME_INTERVAL_MS = 320
const BRAILLE_BLANK = "\u2800"

export const ULW_LOOP_FOOTER_FRAMES = [
  `⚡ ultraworking${BRAILLE_BLANK.repeat(3)}`,
  `⚡ ultraworking.${BRAILLE_BLANK.repeat(2)}`,
  `⚡ ultraworking..${BRAILLE_BLANK}`,
  "⚡ ultraworking...",
] as const

type TimerHandle = ReturnType<typeof setInterval> | number

export interface UlwLoopFooterTimers {
  set(callback: () => void, intervalMs: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface UlwLoopFooterStatusOptions {
  readonly isGoalActive?: (runtime: UlwLoopFooterRuntime) => boolean
  readonly timers?: UlwLoopFooterTimers
}

export interface UlwLoopFooterUi {
  setStatus(key: string, text: string | undefined): void
}

export interface UlwLoopFooterRuntime {
  readonly ui: UlwLoopFooterUi
  readonly goalPath: string | undefined
}

export interface UlwLoopFooterStatus {
  sync(eventCtx: unknown, ulwActive: boolean): void
  dispose(): void
}

export function createUlwLoopFooterStatus(options: UlwLoopFooterStatusOptions = {}): UlwLoopFooterStatus {
  const isGoalActive = options.isGoalActive ?? goalActiveFromContext
  const timers = options.timers ?? defaultTimers
  let timer: TimerHandle | undefined
  let frameIndex = 0
  let runtime: UlwLoopFooterRuntime | undefined
  let published = false
  let ulwActive = false

  function publish(): void {
    const frame = ULW_LOOP_FOOTER_FRAMES[frameIndex]
    if (runtime === undefined || frame === undefined) return
    runtime.ui.setStatus(STATUS_KEY, frame)
    published = true
  }

  function stop(): void {
    if (timer !== undefined) {
      timers.clear(timer)
      timer = undefined
    }
    if (published && runtime !== undefined) runtime.ui.setStatus(STATUS_KEY, undefined)
    published = false
    frameIndex = 0
  }

  function tick(): void {
    if (runtime === undefined || !ulwActive || !isGoalActive(runtime)) {
      stop()
      return
    }
    frameIndex = (frameIndex + 1) % ULW_LOOP_FOOTER_FRAMES.length
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
      timer = timers.set(tick, FRAME_INTERVAL_MS)
    },
    dispose() {
      ulwActive = false
      stop()
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
    goalPath: goalPathFromContext(value),
  }
}

function goalActiveFromContext(runtime: UlwLoopFooterRuntime): boolean {
  const goalPath = runtime.goalPath
  if (goalPath === undefined) return false
  try {
    const parsed: unknown = JSON.parse(readFileSync(goalPath, "utf8"))
    return (
      isRecord(parsed) &&
      parsed["version"] === 1 &&
      isRecord(parsed["goal"]) &&
      parsed["goal"]["status"] === "active"
    )
  } catch {
    return false
  }
}

function goalPathFromContext(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const manager = value["sessionManager"]
  if (!isRecord(manager)) return undefined
  const getSessionFile = manager["getSessionFile"]
  const getSessionDir = manager["getSessionDir"]
  const getSessionId = manager["getSessionId"]
  if (
    typeof getSessionFile !== "function" ||
    typeof getSessionDir !== "function" ||
    typeof getSessionId !== "function"
  ) {
    return undefined
  }
  if (Reflect.apply(getSessionFile, manager, []) === undefined) return undefined
  const sessionDir = Reflect.apply(getSessionDir, manager, [])
  const sessionId = Reflect.apply(getSessionId, manager, [])
  if (typeof sessionDir !== "string" || typeof sessionId !== "string") return undefined
  return join(sessionDir, "extensions", "goal", `${encodeURIComponent(sessionId)}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
