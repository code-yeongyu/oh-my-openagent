import type { ChildSpec, InProcessRunnerLike } from "@oh-my-opencode/senpi-task"

type ChildHandle = Awaited<ReturnType<InProcessRunnerLike["start"]>>

export type BoundedChildOutcome =
  | { readonly kind: "advice"; readonly text: string; readonly model: string; readonly ms: number }
  | { readonly kind: "failed"; readonly reason: string; readonly model?: string }
  | { readonly kind: "start_failed"; readonly reason: string }

// One deadline covers the start and the turn together, and the session's shutdown signal ends both:
// a start that never settles must not hold the session's single in-flight slot, and a child must not
// keep spending tokens for a session that is gone. A handle that arrives after either is disposed.
export async function runBoundedChild(
  runner: InProcessRunnerLike,
  spec: ChildSpec,
  model: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<BoundedChildOutcome> {
  const startedAt = Date.now()
  const stop = stopSignal(timeoutMs, signal)
  try {
    const started = await race(runner.start(spec), stop.promise)
    if (started.kind === "stopped") {
      void started.pending.then(disposeQuietly, () => undefined)
      return { kind: "failed", reason: started.reason, model }
    }
    if (started.kind === "rejected") return { kind: "start_failed", reason: describe(started.error) }
    return await awaitTurn(started.value, model, stop.promise, startedAt)
  } finally {
    stop.clear()
  }
}

async function awaitTurn(handle: ChildHandle, model: string, stopped: Promise<string>, startedAt: number): Promise<BoundedChildOutcome> {
  try {
    const finished = await race(handle.waitForIdle(), stopped)
    if (finished.kind === "stopped") {
      await handle.abort().catch(() => undefined)
      return { kind: "failed", reason: finished.reason, model }
    }
    if (finished.kind === "rejected") return { kind: "failed", reason: describe(finished.error), model }
    const outcome = finished.value
    if (outcome.status === "error") return { kind: "failed", reason: `${outcome.failure.kind}: ${outcome.failure.message}`, model }
    if (outcome.status !== "completed") return { kind: "failed", reason: outcome.status, model }
    const text = handle.lastAssistantText()?.trim()
    if (text === undefined || text.length === 0) return { kind: "failed", reason: "empty", model }
    return { kind: "advice", text, model, ms: Date.now() - startedAt }
  } finally {
    await disposeQuietly(handle)
  }
}

type Raced<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "rejected"; readonly error: unknown }
  | { readonly kind: "stopped"; readonly reason: string; readonly pending: Promise<T> }

async function race<T>(work: Promise<T>, stopped: Promise<string>): Promise<Raced<T>> {
  const settled = work.then((value): Raced<T> => ({ kind: "value", value }), (error: unknown): Raced<T> => ({ kind: "rejected", error }))
  return Promise.race([settled, stopped.then((reason): Raced<T> => ({ kind: "stopped", reason, pending: work }))])
}

function stopSignal(timeoutMs: number, signal: AbortSignal | undefined): { readonly promise: Promise<string>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const promise = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs)
    timer.unref?.()
    if (signal === undefined) return
    if (signal.aborted) return resolve("session_shutdown")
    onAbort = () => resolve("session_shutdown")
    signal.addEventListener("abort", onAbort, { once: true })
  })
  return {
    promise,
    clear(): void {
      if (timer !== undefined) clearTimeout(timer)
      if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort)
    },
  }
}

async function disposeQuietly(handle: ChildHandle): Promise<void> {
  await Promise.resolve(handle.dispose()).catch(() => undefined)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
