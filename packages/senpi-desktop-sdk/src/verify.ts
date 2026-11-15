import { ComputerError, refusal } from "./errors"
import type { Link } from "./link"
import { matchesSelector } from "./select"
import type { Bounds, Expectation, Verdict, VerifyOptions, WindowSelector, WindowSummary } from "./types"
import { parseAttributes, parseAxNode, parseList, parseWindow } from "./validate"

const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_INTERVAL_MS = 100
const MIN_INTERVAL_MS = 10

const TRUE_ATTRIBUTE = new Set(["1", "true", "yes"])

async function windowsMatching(link: Link, selector: WindowSelector): Promise<readonly WindowSummary[]> {
  const windows = await link.read("windows", {}, (value) => parseList(value, parseWindow))
  return windows.filter((window) => matchesSelector(window, selector))
}

function boundsMatch(actual: Bounds, wanted: Partial<Bounds>, tolerance: number): boolean {
  return (["x", "y", "width", "height"] as const).every((field) => {
    const value = wanted[field]
    return value === undefined || Math.abs(actual[field] - value) <= tolerance
  })
}

/** One READ of the state `expectation` names: `true` when it holds now. Throws when the read fails. */
async function holds(link: Link, expectation: Expectation): Promise<boolean> {
  switch (expectation.kind) {
    case "elementExists":
      try {
        await link.read("ax.node", { ref: expectation.ref }, parseAxNode)
        return expectation.exists ?? true
      } catch (error) {
        // A ref the engine no longer resolves is an answer (the element is gone), not a failed read.
        if (error instanceof ComputerError && error.code === "StaleRef") return !(expectation.exists ?? true)
        throw error
      }
    case "elementValue":
      return (await link.read("ax.node", { ref: expectation.ref }, parseAxNode)).value === expectation.value
    case "elementEnabled":
      return (
        (await link.read("ax.node", { ref: expectation.ref }, parseAxNode)).enabled === (expectation.enabled ?? true)
      )
    case "elementSelected": {
      const attributes = await link.read("ax.attributes", { ref: expectation.ref }, parseAttributes)
      const selected = TRUE_ATTRIBUTE.has((attributes.AXSelected ?? "").toLowerCase())
      return selected === (expectation.selected ?? true)
    }
    case "windowExists":
      return (await windowsMatching(link, expectation.window)).length > 0
    case "windowGone":
      return (await windowsMatching(link, expectation.window)).length === 0
    case "windowBounds": {
      const found = await windowsMatching(link, expectation.window)
      if (found.length > 1) {
        throw refusal("InvalidTarget", "verify windowBounds matches more than one window", "ambiguous", {
          candidates: found,
        })
      }
      const [window] = found
      return window !== undefined && boundsMatch(window.bounds, expectation.bounds, expectation.tolerance ?? 0)
    }
  }
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal?.reason)
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort)
    resolve()
  }, ms)
  signal?.addEventListener("abort", onAbort, { once: true })
  return promise
}

/**
 * Deadline-bounded poll of READ calls. The last read happens at or after the deadline, so `unsatisfied` means the
 * state was read at the deadline and still did not hold; no wait ever runs past the deadline.
 */
export async function verify(link: Link, expectation: Expectation, options: VerifyOptions = {}): Promise<Verdict> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw refusal("InvalidTarget", "verify timeoutMs must be a finite, non-negative number", "invalid_timeout")
  }
  const interval = Math.max(options.intervalMs ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS)
  const { signal } = options
  const started = Date.now()
  const deadline = started + timeoutMs
  let reads = 0
  for (;;) {
    if (signal?.aborted) throw refusal("Cancelled", "verify was cancelled", "aborted")
    let satisfied: boolean
    try {
      reads += 1
      satisfied = await holds(link, expectation)
    } catch (cause) {
      return { status: "unknown", reads, elapsedMs: Date.now() - started, cause }
    }
    const now = Date.now()
    if (satisfied) return { status: "satisfied", reads, elapsedMs: now - started }
    if (now >= deadline) return { status: "unsatisfied", reads, elapsedMs: now - started }
    try {
      await pause(Math.min(interval, deadline - now), signal)
    } catch (cause) {
      throw refusal("Cancelled", "verify was cancelled", "aborted", { cause })
    }
  }
}
