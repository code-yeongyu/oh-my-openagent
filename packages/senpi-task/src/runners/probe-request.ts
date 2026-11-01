import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { RpcRunnerSpec } from "./types"

export const PROBE_REQUEST_EVENT = "omo.task.provider_request_started"

/** Captures an early in-process request, even if the runner has not returned its handle yet. */
export function createProbeRequestSignal(now: () => number) {
  let first: number | undefined
  const listeners = new Set<(at: number) => void>()
  return {
    started: () => {
      if (first !== undefined) return
      first = now()
      for (const listener of listeners) listener(first)
    },
    subscribe: (listener: (at: number) => void) => {
      listeners.add(listener)
      if (first !== undefined) listener(first)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * A probe-only, parent-authored extension. Both RPC launch strategies load it, including DAG children
 * that intentionally omit omo's task component. It lives with the task and is removed by its normal TTL.
 */
export function withProbeRequestExtension(spec: RpcRunnerSpec): RpcRunnerSpec {
  if (spec.probeProviderRequest !== true) return spec
  mkdirSync(spec.state_dir, { recursive: true })
  const path = join(mkdtempSync(join(spec.state_dir, "probe-request-")), "request.mjs")
  writeFileSync(path, `export default function(pi) {
  let started = false
  pi.on("before_provider_request", () => {
    if (started) return
    started = true
    pi.rpc.emit("${PROBE_REQUEST_EVENT}", { at: Date.now() })
  })
}
`, { mode: 0o600 })
  return { ...spec, extensions: [...(spec.extensions ?? []), path] }
}
