import type { PortError } from "./ports.ts"

export type Settled<Target, Value> =
  | { readonly kind: "fulfilled"; readonly target: Target; readonly value: Value }
  | { readonly kind: "rejected"; readonly target: Target; readonly error: PortError }
  | { readonly kind: "skipped"; readonly target: Target; readonly reason: string }

export type BatchResult<Target, Value> = {
  readonly outcomes: readonly Settled<Target, Value>[]
  readonly fulfilled: readonly Extract<Settled<Target, Value>, { kind: "fulfilled" }>[]
  readonly rejected: readonly Extract<Settled<Target, Value>, { kind: "rejected" }>[]
  readonly skipped: readonly Extract<Settled<Target, Value>, { kind: "skipped" }>[]
  readonly ok: boolean
}

export type BatchOptions = { readonly concurrency?: number }

const CALLBACK_NEXT_ACTION = "the callback failed on this target only; read the message, then rerun it for this target"

export function batchOf<Target, Value>(outcomes: readonly Settled<Target, Value>[]): BatchResult<Target, Value> {
  const fulfilled: Extract<Settled<Target, Value>, { kind: "fulfilled" }>[] = []
  const rejected: Extract<Settled<Target, Value>, { kind: "rejected" }>[] = []
  const skipped: Extract<Settled<Target, Value>, { kind: "skipped" }>[] = []
  for (const outcome of outcomes) {
    if (outcome.kind === "fulfilled") fulfilled.push(outcome)
    else if (outcome.kind === "rejected") rejected.push(outcome)
    else skipped.push(outcome)
  }
  return { outcomes, fulfilled, rejected, skipped, ok: rejected.length === 0 && skipped.length === 0 }
}

function stringField(value: object, key: string): string | undefined {
  const field: unknown = Reflect.get(value, key)
  return typeof field === "string" && field.length > 0 ? field : undefined
}

/** Reads `{ code, message, next_action, uncertain }` off anything a callback or the fleet client threw. */
export function portErrorOf(thrown: unknown): PortError {
  if (typeof thrown !== "object" || thrown === null) {
    return { code: "callback_failed", message: String(thrown), next_action: CALLBACK_NEXT_ACTION }
  }
  const message = stringField(thrown, "message") ?? String(thrown)
  const uncertain = Reflect.get(thrown, "uncertain") === true
  return {
    code: stringField(thrown, "code") ?? "callback_failed",
    message,
    next_action: stringField(thrown, "next_action") ?? CALLBACK_NEXT_ACTION,
    ...(uncertain ? { uncertain } : {}),
  }
}

/**
 * Runs `task` for every item with at most `concurrency` in flight (unbounded when omitted, as the fleet
 * client's own default is) and keeps input order. Callers pass tasks that settle to data and never reject.
 */
export async function settleEach<Item, Result>(
  items: readonly Item[],
  task: (item: Item) => Promise<Result>,
  concurrency: number | undefined,
): Promise<Result[]> {
  if (concurrency === undefined) return Promise.all(items.map(task))
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`)
  }
  const results = new Array<Result>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item !== undefined) results[index] = await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}
