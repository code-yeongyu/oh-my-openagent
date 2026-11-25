// What every X1a driver is to the run: an operation of the scenario in, the surface's raw answer out. A driver reaches
// node built-ins, the scenario table and this directory only (sdk-proof.test.ts holds that line).
import type { Mapping, Op } from "../scenario.ts"

export type Call = { readonly op: Op; readonly input: Readonly<Record<string, string>> }

/** `answered`: the surface reported success in its own terms; `thread` is the thread string an open answered. */
export type Answer = {
  readonly call: string
  readonly raw: unknown
  readonly answered: boolean
  readonly thread?: string
}

export type Driver = {
  readonly mapping: Readonly<Record<Op, Mapping>>
  /** `signal` aborts when the step's deadline passes: a driver that started a process stops it. */
  readonly run: (call: Call, signal?: AbortSignal) => Promise<Answer>
  readonly close: () => Promise<void>
}

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A thread result's success, as the SDK, the tools and `--json` all shape it: only `kind: "ok"` is one. Anything else
 * (an error, an unknown kind, text, a thrown error, nothing) is not. */
export const succeeded = (raw: unknown): boolean => isRecord(raw) && raw["kind"] === "ok"

/** The thread string an open answered: the result's `thread`, or the opened row's own `thread`. */
export function threadOf(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined
  const thread = raw["thread"]
  if (typeof thread === "string") return thread
  return isRecord(thread) && typeof thread["thread"] === "string" ? thread["thread"] : undefined
}

export const call = (how: string): Mapping => ({ kind: "call", how })
