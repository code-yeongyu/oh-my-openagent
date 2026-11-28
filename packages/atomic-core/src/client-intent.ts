import {
  type AtomicConformance,
  type AtomicIntentDocument,
  AtomicIntentDocumentSchema,
  type AtomicIntentKind,
  AtomicIntentListSchema,
  type AtomicIntentStatus,
  type AtomicIntentSummary,
  parseCreatedIntentId,
  parseJsonContract,
} from "./contracts"
import { ATOMIC_VAULT_MUTATION_TIMEOUT_MS, type AtomicCallOptions, type AtomicRunner } from "./client-runner"
import { runConformance } from "./client-vault"
import { AtomicError } from "./errors"

/** `--session-id` is accepted only together with `in_progress` and must name a session Atomic already knows. */
export type AtomicIntentStatusChange =
  | { readonly id: string; readonly status: "in_progress"; readonly sessionId?: string }
  | { readonly id: string; readonly status: Exclude<AtomicIntentStatus, "in_progress">; readonly sessionId?: never }

export type AtomicIntentOperations = {
  intentList(call: AtomicCallOptions): Promise<readonly AtomicIntentSummary[]>
  intentShow(call: AtomicCallOptions & { readonly id: string }): Promise<AtomicIntentDocument>
  intentNew(call: AtomicCallOptions & { readonly title: string; readonly kind?: AtomicIntentKind }): Promise<AtomicIntentSummary>
  intentValidate(call: AtomicCallOptions & { readonly id: string }): Promise<AtomicConformance>
  intentAttest(call: AtomicCallOptions & { readonly id: string }): Promise<AtomicConformance>
  intentUpdateStatus(call: AtomicCallOptions & AtomicIntentStatusChange): Promise<AtomicIntentSummary>
}

function indeterminate(operation: string, message: string): AtomicError {
  return new AtomicError("operation_indeterminate", { operation, sideEffectsPossible: true, message })
}

export function createIntentOperations(run: AtomicRunner): AtomicIntentOperations {
  const intentList = async (call: AtomicCallOptions): Promise<readonly AtomicIntentSummary[]> => {
    const stdout = await run({ operation: "intent list", args: ["intent", "list", "--json"], mutation: false }, call)
    return parseJsonContract(AtomicIntentListSchema, stdout, { operation: "intent list", sideEffectsPossible: false })
  }

  return {
    intentList,
    async intentShow(call) {
      const args = ["intent", "show", "--json", "--", call.id]
      const stdout = await run({ operation: "intent show", args, mutation: false }, call)
      return parseJsonContract(AtomicIntentDocumentSchema, stdout, { operation: "intent show", sideEffectsPossible: false })
    },
    async intentNew(call) {
      const kind = call.kind === undefined ? [] : [`--kind=${call.kind}`]
      const args = ["intent", "new", ...kind, "--", call.title]
      const stdout = await run({ operation: "intent new", args, mutation: true, timeoutMs: ATOMIC_VAULT_MUTATION_TIMEOUT_MS }, call)
      const id = parseCreatedIntentId(stdout)
      if (id === undefined) throw indeterminate("intent new", "atomic intent new did not report the allocated intent id")
      const created = (await intentList(call)).find((intent) => intent.id === id)
      if (created === undefined) throw indeterminate("intent new", `intent ${id} is missing from the intent list`)
      return created
    },
    intentValidate(call) {
      return runConformance(run, { operation: "intent validate", args: ["intent", "validate", "--", call.id], mutation: false }, call)
    },
    intentAttest(call) {
      const args = ["intent", "attest", "--", call.id]
      return runConformance(run, { operation: "intent attest", args, mutation: true, timeoutMs: ATOMIC_VAULT_MUTATION_TIMEOUT_MS }, call)
    },
    async intentUpdateStatus(call) {
      const session = call.sessionId === undefined ? [] : [`--session-id=${call.sessionId}`]
      const args = ["intent", "update", `--status=${call.status}`, ...session, "--", call.id]
      await run({ operation: "intent update", args, mutation: true, timeoutMs: ATOMIC_VAULT_MUTATION_TIMEOUT_MS }, call)
      const updated = (await intentList(call)).find((intent) => intent.id === call.id)
      if (updated?.status !== call.status) {
        throw indeterminate("intent update", `intent ${call.id} does not read back with status ${call.status}`)
      }
      return updated
    },
  }
}
