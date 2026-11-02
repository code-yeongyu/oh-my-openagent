// The two primitives that keep work off the startup critical path.
//
// senpi bills the extension in two phases a user waits through before the first prompt: the
// `<plugin>/extensions/omo.js factory` row (every component's `register`) and the
// `interactiveMode.init` row (the session-binding step that dispatches `session_start` to every
// extension). Registration itself - tools, commands, flags, hooks - MUST stay in the first phase:
// the engine's tool and command tables have to be complete before the first prompt. Everything a
// component builds AROUND that registration does not.
//
// - `createLazyValue` defers CONSTRUCTION to first use: the machinery behind a feature is built the
//   first time the feature is actually exercised, so a session that never touches it never pays.
// - `createStartupDeferral` defers WORK that must still happen, but not before the first paint: it
//   is handed to components through `ComponentContext.deferStartupWork` and retired on
//   `session_shutdown`, so a session that ends before the tick never runs a half-session's work.
//
// `deferUntilAfterFirstPaint` is the call site helper: a context without the seam (isolated
// component unit tests, older hosts) runs the work inline, which is exactly today's behaviour.

export interface LazyValue<T> {
  /** Constructs on the first call, then hands back the same value. */
  get(): T
  /** Whether `get()` has ever run - the seam a deferral regression test asserts on. */
  readonly constructed: boolean
}

export function createLazyValue<T>(construct: () => T): LazyValue<T> {
  // The holder box (not the value) records construction, so a factory returning `undefined` is
  // still constructed exactly once.
  let holder: { readonly value: T } | undefined
  return {
    get(): T {
      holder ??= { value: construct() }
      return holder.value
    },
    get constructed(): boolean {
      return holder !== undefined
    },
  }
}

export type StartupWork = () => void | Promise<void>

/** Schedules `run` off the current call stack and returns its cancel. */
export type StartupWorkScheduler = (run: () => void) => () => void

export interface StartupDeferral {
  /** Queues `work` for the next tick. A retired deferral silently refuses. */
  defer(label: string, work: StartupWork): void
  /** Cancels every pending tick and refuses later ones (compose calls this on session_shutdown). */
  retire(): void
}

export interface StartupDeferralOptions {
  readonly schedule?: StartupWorkScheduler
  readonly onError?: (label: string, error: unknown) => void
}

// A macrotask, NOT an unref'd one: the deferred work still has to happen in a session that exits
// right after startup (telemetry for a one-shot `-p` run), so the handle keeps the loop alive for
// the one tick it takes. Retirement, not unref, is what stops post-shutdown work.
//
// `setTimeout(..., 0)` is NOT enough on its own: `session_start` is dispatched from inside the
// engine's `interactiveMode.init`, and that phase awaits I/O, so a zero-delay macrotask fires while
// init is still running and stays billed to it - measured as a 0 ms improvement where a scheduler
// that never fired saved 34 ms. `createFirstPaintScheduler` is what production uses.
const scheduleOnNextTick: StartupWorkScheduler = (run) => {
  const timer = setTimeout(run, 0)
  return () => clearTimeout(timer)
}

// Host edges that cannot happen before the TUI is up: the user typing, or a turn starting (print
// mode and `--message` runs, which never paint, reach the second one straight after startup).
const FIRST_PAINT_EVENTS = ["input", "before_agent_start"] as const

// Backstop for a session that paints and then sits idle: comfortably past the measured
// `interactiveMode.init` window (66-100 ms warm, 270-450 ms cold on the profiling host) while still
// early enough that a short session runs the work it would otherwise lose.
export const FIRST_PAINT_BACKSTOP_MS = 750

export interface FirstPaintSchedulerOptions {
  readonly on: (event: string, handler: (payload?: unknown) => void, options?: { previewSafe?: boolean }) => void
  readonly backstopMs?: number
}

/**
 * Runs queued work on the FIRST of: a post-paint host edge, or the backstop timer. Both are one-way:
 * once the gate opens, later work is scheduled on the next tick, because by then the paint is past.
 */
export function createFirstPaintScheduler(options: FirstPaintSchedulerOptions): StartupWorkScheduler {
  const waiting = new Set<{ readonly run: () => void; readonly timer: ReturnType<typeof setTimeout> }>()
  let opened = false
  const open = (): void => {
    if (opened) return
    opened = true
    const pending = [...waiting]
    waiting.clear()
    for (const entry of pending) {
      clearTimeout(entry.timer)
      entry.run()
    }
  }
  const openOnPaint = (payload?: unknown): void => {
    if (isPreview(payload)) return
    open()
  }
  for (const event of FIRST_PAINT_EVENTS) {
    options.on(event, openOnPaint, event === "before_agent_start" ? { previewSafe: true } : undefined)
  }

  return (run) => {
    if (opened) return scheduleOnNextTick(run)
    const entry = {
      run,
      timer: setTimeout(() => {
        waiting.delete(entry)
        run()
      }, options.backstopMs ?? FIRST_PAINT_BACKSTOP_MS),
    }
    waiting.add(entry)
    return () => {
      waiting.delete(entry)
      clearTimeout(entry.timer)
    }
  }
}

function isPreview(value: unknown): boolean {
  return typeof value === "object" && value !== null && "preview" in value && value.preview === true
}

export function createStartupDeferral(options: StartupDeferralOptions = {}): StartupDeferral {
  const schedule = options.schedule ?? scheduleOnNextTick
  const pending = new Set<() => void>()
  let retired = false

  const report = (label: string, error: unknown): void => {
    options.onError?.(label, error)
  }

  return {
    defer(label: string, work: StartupWork): void {
      if (retired) return
      let cancel: (() => void) | undefined
      const run = (): void => {
        if (cancel !== undefined) pending.delete(cancel)
        if (retired) return
        try {
          const result = work()
          if (result instanceof Promise) {
            void result.catch((error: unknown) => report(label, error))
          }
        } catch (error) {
          report(label, error)
        }
      }
      cancel = schedule(run)
      pending.add(cancel)
    },
    retire(): void {
      retired = true
      for (const cancel of pending) cancel()
      pending.clear()
    },
  }
}

/** The seam as components see it; `ComponentContext` satisfies it structurally. */
export interface StartupDeferralHost {
  readonly deferStartupWork?: (label: string, work: StartupWork) => void
}

export function deferUntilAfterFirstPaint(host: StartupDeferralHost, label: string, work: StartupWork): void {
  if (host.deferStartupWork !== undefined) {
    host.deferStartupWork(label, work)
    return
  }
  void work()
}
