import type { FactsExtractionRecord, FactsPeopleRouting } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import { loadOnboardingScanRuntime } from "../onboarding/scan-component"
import type { MemoryIdentityContext } from "./context"
import type { applyMemoryFacts } from "./facts-apply-runtime"
import { resolveFactsPeopleRouting } from "./facts-batch-apply"
import type { MemoryWiringOptions } from "./wiring-types"

/** Pull channel: an RPC client writes reviewed facts through the facts extractor's own apply. */
export const MEMORY_FACTS_APPLY_RPC_METHOD = "omo.memory.facts.apply"

export interface MemoryFactsApplyRequest {
  /** memory-core `record_fact` records; each is validated by `parseFactsExtractionRecord`. */
  readonly records: readonly unknown[]
  /**
   * Optional client-chosen batch id, so a retry after a timeout is idempotent: a batch already
   * committed is answered from its receipt (same sha) and never written twice. Default: a fresh UUID.
   */
  readonly batchId?: string
}

export type MemoryFactsApplyResponse =
  | { readonly outcome: "committed"; readonly sha: string; readonly affectedPaths: readonly string[]; readonly batchId: string }
  | { readonly outcome: "no_facts"; readonly affectedPaths: readonly [] }
  | { readonly outcome: "parent_dirty"; readonly batchId: string; readonly detail?: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string }

export type MemoryFactsApplier = (request: unknown, sessionId?: string) => Promise<MemoryFactsApplyResponse>

export interface FactsApplyCall {
  readonly batchId: string
  readonly records: readonly FactsExtractionRecord[]
  readonly people: FactsPeopleRouting
}

/** The applier the memory component owns: the session's bound identity and its configured people routing. */
export function createSessionFactsApplier(deps: {
  readonly resolveContext: (sessionId: string | undefined) => MemoryIdentityContext | undefined
  readonly people: (identity: string) => FactsPeopleRouting
  readonly logger?: ComponentLogger
  /** The validating apply; it ships in the lazy onboarding-scan sidecar, so omo.js carries only this shell. */
  readonly loadApply?: () => Promise<typeof applyMemoryFacts>
}): MemoryFactsApplier {
  const loadApply = deps.loadApply ?? (async () => (await loadOnboardingScanRuntime()).applyMemoryFacts)
  return async (request, sessionId) => {
    const context = deps.resolveContext(sessionId)
    if (context === undefined) return { kind: "unavailable", reason: "No bound memory session." }
    let applyMemoryFacts: Awaited<ReturnType<typeof loadApply>>
    try {
      applyMemoryFacts = await loadApply()
    } catch (error) {
      return { kind: "unavailable", reason: `The memory apply runtime could not load: ${describe(error)}` }
    }
    return applyMemoryFacts({
      context,
      people: deps.people(context.identity),
      request,
      ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    })
  }
}

/** The session applier with people routing read from the current omo config on every call. */
export function createConfiguredFactsApplier(
  options: Pick<MemoryWiringOptions, "loadConfig" | "cwd" | "logger">,
  resolveContext: (sessionId: string | undefined) => MemoryIdentityContext | undefined,
): MemoryFactsApplier {
  return createSessionFactsApplier({
    resolveContext,
    people: (identity) => resolveFactsPeopleRouting(options.loadConfig({ cwd: options.cwd() }).config, identity),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
}

// The onboarding component is registered before memory and cannot import its wiring, so the memory
// component publishes its one applier here, process-wide, like `sharedSessionArming`.
const APPLIER_KEY = Symbol.for("omo.memory.facts.applier")
const slot = globalThis as { [APPLIER_KEY]?: MemoryFactsApplier }

export function publishSessionFactsApplier(applier: MemoryFactsApplier | undefined): void {
  if (applier === undefined) Reflect.deleteProperty(slot, APPLIER_KEY)
  else slot[APPLIER_KEY] = applier
}

export function sessionFactsApplier(): MemoryFactsApplier | undefined {
  return slot[APPLIER_KEY]
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
