import {
  type AtomicConformance,
  type AtomicMemoryCreated,
  AtomicMemoryCreatedSchema,
  type AtomicMemoryKind,
  type AtomicVaultContext,
  AtomicVaultContextSchema,
  parseConformance,
  parseJsonContract,
} from "./contracts"
import {
  ATOMIC_VAULT_MUTATION_TIMEOUT_MS,
  type AtomicCallOptions,
  type AtomicCommand,
  type AtomicRunner,
  requireRepositoryRelativePath,
} from "./client-runner"
import { AtomicError } from "./errors"

const ATOMIC_CONTEXT_OUTPUT_LIMIT_BYTES = 128 * 1024
const ATOMIC_CONTEXT_TIMEOUT_MS = 1000

export type AtomicVaultContextRequest = AtomicCallOptions & {
  readonly query?: readonly string[]
  readonly intentId?: string
  readonly files?: readonly string[]
  readonly limit?: number
  readonly budgetChars?: number
  readonly candidatesOnly?: boolean
  readonly timeoutMs?: number
}

export type AtomicMemoryRequest = AtomicCallOptions & {
  readonly kind: AtomicMemoryKind
  readonly text: string
  readonly derivedFrom?: readonly string[]
  readonly about?: readonly string[]
}

export type AtomicVaultOperations = {
  vaultContext(call: AtomicVaultContextRequest): Promise<AtomicVaultContext>
  vaultSync(call: AtomicCallOptions): Promise<void>
  memoryNew(call: AtomicMemoryRequest): Promise<AtomicMemoryCreated>
  memoryValidate(call: AtomicCallOptions & { readonly id: string }): Promise<AtomicConformance>
  memoryAttest(call: AtomicCallOptions & { readonly id: string }): Promise<AtomicConformance>
}

export async function runConformance(
  run: AtomicRunner,
  command: AtomicCommand,
  call: AtomicCallOptions,
): Promise<AtomicConformance> {
  const conformance = parseConformance(await run(command, call))
  if (conformance === undefined) {
    throw new AtomicError("invalid_response", {
      operation: command.operation,
      sideEffectsPossible: command.mutation,
      message: `atomic ${command.operation} printed no conformance verdict`,
    })
  }
  return conformance
}

function contextArgs(call: AtomicVaultContextRequest): readonly string[] {
  const files = (call.files ?? []).map((file) => `--files=${requireRepositoryRelativePath(file, "vault context")}`)
  return [
    "vault",
    "context",
    "--json",
    ...(call.intentId === undefined ? [] : [`--intent=${call.intentId}`]),
    ...files,
    ...(call.limit === undefined ? [] : [`--limit=${call.limit}`]),
    ...(call.budgetChars === undefined ? [] : [`--budget-chars=${call.budgetChars}`]),
    ...(call.candidatesOnly === true ? ["--candidates-only"] : []),
    ...(call.query === undefined || call.query.length === 0 ? [] : ["--", ...call.query]),
  ]
}

function listFlag(flag: string, values: readonly string[] | undefined): readonly string[] {
  return values === undefined || values.length === 0 ? [] : [`${flag}=${values.join(",")}`]
}

export function createVaultOperations(run: AtomicRunner): AtomicVaultOperations {
  return {
    async vaultContext(call) {
      const command = {
        operation: "vault context",
        args: contextArgs(call),
        mutation: false,
        timeoutMs: call.timeoutMs ?? ATOMIC_CONTEXT_TIMEOUT_MS,
        outputLimitBytes: ATOMIC_CONTEXT_OUTPUT_LIMIT_BYTES,
      }
      const stdout = await run(command, call)
      return parseJsonContract(AtomicVaultContextSchema, stdout, { operation: "vault context", sideEffectsPossible: false })
    },
    async vaultSync(call) {
      const command = { operation: "vault sync", args: ["vault", "sync"], mutation: true }
      await run({ ...command, timeoutMs: ATOMIC_VAULT_MUTATION_TIMEOUT_MS }, call)
    },
    async memoryNew(call) {
      const args = [
        "memory",
        "new",
        `--kind=${call.kind}`,
        `--text=${call.text}`,
        ...listFlag("--derived-from", call.derivedFrom),
        ...listFlag("--about", call.about),
        "--json",
      ]
      const command = { operation: "memory new", args, mutation: true, timeoutMs: ATOMIC_VAULT_MUTATION_TIMEOUT_MS }
      const stdout = await run(command, call)
      return parseJsonContract(AtomicMemoryCreatedSchema, stdout, { operation: "memory new", sideEffectsPossible: true })
    },
    memoryValidate(call) {
      return runConformance(run, { operation: "memory validate", args: ["memory", "validate", "--", call.id], mutation: false }, call)
    },
    memoryAttest(call) {
      const args = ["memory", "attest", "--", call.id]
      return runConformance(run, { operation: "memory attest", args, mutation: true, timeoutMs: ATOMIC_VAULT_MUTATION_TIMEOUT_MS }, call)
    },
  }
}
