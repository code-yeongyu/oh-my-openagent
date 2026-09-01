import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"

import { writeFileAtomically } from "@oh-my-opencode/utils/atomic-write"

import type { ThreadToolName } from "./contracts"

export const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type ReceiptInput = {
  readonly caller_session_id: string
  readonly tool: ThreadToolName
  readonly args: unknown
  readonly idempotency_key?: string
  readonly tool_call_id?: string
}

export type PreparedReceipt = {
  readonly version: 1
  readonly caller_session_id: string
  readonly tool: ThreadToolName
  readonly effective_key: string
  readonly args_hash: string
  readonly operation_id: string
  readonly status: "prepared"
  readonly owner_instance_id: string
  readonly created_at: string
  readonly updated_at: string
  readonly expires_at: string
}

export type CompletedReceipt = Omit<PreparedReceipt, "status"> & {
  readonly status: "completed"
  readonly result: unknown
}

export type UncertainReceipt = Omit<PreparedReceipt, "status"> & {
  readonly status: "uncertain"
  /** Why the operation became undecidable, when a failing side effect named a cause. */
  readonly error_note?: string
}

export type DurableReceipt = PreparedReceipt | CompletedReceipt | UncertainReceipt

export type ReceiptAccepted = {
  readonly kind: "accepted"
  readonly operation_id: string
  readonly caller_session_id: string
  readonly tool: ThreadToolName
  readonly effective_key: string
  readonly args_hash: string
}

export type ReceiptBeginResult =
  | ReceiptAccepted
  | { readonly kind: "replay"; readonly deduplicated: true; readonly result: unknown }
  | { readonly kind: "conflict"; readonly code: "idempotency_conflict" }
  | { readonly kind: "in_progress"; readonly code: "idempotency_in_progress" }
  | { readonly kind: "uncertain"; readonly code: "idempotency_uncertain" }

export type ReceiptExecuteResult =
  | { readonly kind: "completed"; readonly deduplicated: false; readonly result: unknown }
  | Exclude<ReceiptBeginResult, ReceiptAccepted>

export type ReceiptStoreOptions = {
  /** Component-owned state directory. Receipt files live below its receipts/ child. */
  readonly directory: string
  readonly now?: () => number
  readonly instance_id?: string
  /** Test/QA fault seam: throw after the native operation accepts and before receipt commit. */
  readonly crash_after_accept?: boolean
}

export type ReceiptStore = {
  readonly directory: string
  readonly instance_id: string
  readonly begin: (input: ReceiptInput) => ReceiptBeginResult
  readonly complete: (admission: ReceiptBeginResult, result: unknown) => void
  /** Mark an accepted operation undecidable: the effect may or may not have landed. */
  readonly abandon: (admission: ReceiptBeginResult, errorNote: string) => void
  readonly execute: (input: ReceiptInput, sideEffect: (operationId: string) => Promise<unknown>) => Promise<ReceiptExecuteResult>
  readonly list: () => readonly DurableReceipt[]
  readonly prune: () => number
}

export function deriveEffectiveKey(input: ReceiptInput): string {
  const explicit = input.idempotency_key?.trim()
  if (explicit !== undefined && explicit.length > 0) return explicit
  const callId = input.tool_call_id?.trim()
  if (callId === undefined || callId.length === 0) {
    throw new Error("An idempotency_key or tool_call_id is required for a durable receipt.")
  }
  return `${input.caller_session_id}:${callId}`
}

export function createReceiptStore(options: ReceiptStoreOptions): ReceiptStore {
  const receiptsDir = join(options.directory, "receipts")
  const locksDir = join(receiptsDir, ".locks")
  const now = options.now ?? Date.now
  const instanceId = options.instance_id ?? randomUUID()
  mkdirSync(locksDir, { recursive: true, mode: 0o700 })

  function begin(input: ReceiptInput): ReceiptBeginResult {
    validateInput(input)
    const effectiveKey = deriveEffectiveKey(input)
    const argsHash = fingerprint(input.args)
    const path = receiptPath(receiptsDir, input.caller_session_id, input.tool, effectiveKey)
    const lockPath = `${pathKey(input.caller_session_id, input.tool, effectiveKey)}.lock`
    const acquired = acquireLock(locksDir, lockPath)
    if (!acquired) {
      const observed = readReceipt(path)
      return observed === null ? { kind: "in_progress", code: "idempotency_in_progress" } : classify(observed, argsHash, instanceId, path, now)
    }

    try {
      const observed = readReceipt(path)
      if (observed !== null) {
        if (Date.parse(observed.expires_at) > now()) return classify(observed, argsHash, instanceId, path, now)
        rmSync(path, { force: true })
      }

      const timestamp = now()
      const receipt: PreparedReceipt = {
        version: 1,
        caller_session_id: input.caller_session_id,
        tool: input.tool,
        effective_key: effectiveKey,
        args_hash: argsHash,
        operation_id: randomUUID(),
        status: "prepared",
        owner_instance_id: instanceId,
        created_at: new Date(timestamp).toISOString(),
        updated_at: new Date(timestamp).toISOString(),
        expires_at: new Date(timestamp + RECEIPT_RETENTION_MS).toISOString(),
      }
      atomicWrite(path, receipt)
      return admissionFrom(receipt)
    } finally {
      rmSync(join(locksDir, lockPath), { recursive: true, force: true })
    }
  }

  function complete(admission: ReceiptBeginResult, result: unknown): void {
    if (admission.kind !== "accepted") return
    const path = receiptPath(receiptsDir, admission.caller_session_id, admission.tool, admission.effective_key)
    const lockName = `${pathKey(admission.caller_session_id, admission.tool, admission.effective_key)}.lock`
    if (!acquireLock(locksDir, lockName)) throw new Error("Receipt completion is already in progress.")
    try {
      const current = readReceipt(path)
      if (
        current === null ||
        current.status !== "prepared" ||
        current.owner_instance_id !== instanceId ||
        current.operation_id !== admission.operation_id ||
        current.args_hash !== admission.args_hash
      ) {
        throw new Error("Prepared receipt is no longer owned by this store instance.")
      }
      const completed: CompletedReceipt = {
        ...current,
        status: "completed",
        result,
        updated_at: new Date(now()).toISOString(),
      }
      atomicWrite(path, completed)
    } finally {
      rmSync(join(locksDir, lockName), { recursive: true, force: true })
    }
  }

  async function execute(
    input: ReceiptInput,
    sideEffect: (operationId: string) => Promise<unknown>,
  ): Promise<ReceiptExecuteResult> {
    const admission = begin(input)
    if (admission.kind !== "accepted") return admission
    let result: unknown
    try {
      result = await sideEffect(admission.operation_id)
    } catch (error) {
      // A thrown side effect is genuinely undecidable: it may have landed before it threw.
      // Deleting the receipt would license a silent double delivery on retry, and leaving it
      // prepared strands this key on idempotency_in_progress for the whole retention window
      // (no owner will ever complete it). Recording uncertain is the only honest verdict, and
      // it matches the never-auto-retry contract the post-restart path already enforces.
      abandon(admission, describeError(error))
      throw error
    }
    if (options.crash_after_accept === true) throw new Error("receipt crash injection after native accept")
    complete(admission, result)
    return { kind: "completed", deduplicated: false, result }
  }

  function list(): readonly DurableReceipt[] {
    prune()
    return readdirSync(receiptsDir)
      .filter((entry) => entry.endsWith(".json"))
      .toSorted()
      .flatMap((entry) => {
        const receipt = readReceipt(join(receiptsDir, entry))
        return receipt === null ? [] : [receipt]
      })
  }

  function prune(): number {
    let removed = 0
    for (const entry of readdirSync(receiptsDir)) {
      if (!entry.endsWith(".json")) continue
      const path = join(receiptsDir, entry)
      const receipt = readReceipt(path)
      if (receipt !== null && Date.parse(receipt.expires_at) <= now()) {
        rmSync(path, { force: true })
        removed++
      }
    }
    return removed
  }

  /**
   * Transition this instance's prepared receipt to uncertain. Ownership is re-verified under
   * the same lock `complete` uses; a receipt this instance no longer owns is left untouched
   * so a concurrent restart's verdict is never overwritten.
   */
  function abandon(admission: ReceiptBeginResult, errorNote: string): void {
    if (admission.kind !== "accepted") return
    const path = receiptPath(receiptsDir, admission.caller_session_id, admission.tool, admission.effective_key)
    const lockName = `${pathKey(admission.caller_session_id, admission.tool, admission.effective_key)}.lock`
    if (!acquireLock(locksDir, lockName)) return
    try {
      const current = readReceipt(path)
      if (
        current === null ||
        current.status !== "prepared" ||
        current.owner_instance_id !== instanceId ||
        current.operation_id !== admission.operation_id
      ) {
        return
      }
      const uncertain: UncertainReceipt = {
        ...current,
        status: "uncertain",
        error_note: errorNote,
        updated_at: new Date(now()).toISOString(),
      }
      atomicWrite(path, uncertain)
    } finally {
      rmSync(join(locksDir, lockName), { recursive: true, force: true })
    }
  }

  return { directory: receiptsDir, instance_id: instanceId, begin, complete, abandon, execute, list, prune }
}

function classify(
  receipt: DurableReceipt,
  argsHash: string,
  instanceId: string,
  path: string,
  now: () => number,
): ReceiptBeginResult {
  if (receipt.args_hash !== argsHash) return { kind: "conflict", code: "idempotency_conflict" }
  if (receipt.status === "completed") return { kind: "replay", deduplicated: true, result: receipt.result }
  if (receipt.status === "uncertain") return { kind: "uncertain", code: "idempotency_uncertain" }
  if (receipt.owner_instance_id === instanceId) return { kind: "in_progress", code: "idempotency_in_progress" }

  const uncertain: UncertainReceipt = {
    ...receipt,
    status: "uncertain",
    updated_at: new Date(now()).toISOString(),
  }
  atomicWrite(path, uncertain)
  return { kind: "uncertain", code: "idempotency_uncertain" }
}

function admissionFrom(receipt: PreparedReceipt): ReceiptAccepted {
  return {
    kind: "accepted",
    operation_id: receipt.operation_id,
    caller_session_id: receipt.caller_session_id,
    tool: receipt.tool,
    effective_key: receipt.effective_key,
    args_hash: receipt.args_hash,
  }
}

function validateInput(input: ReceiptInput): void {
  if (input.caller_session_id.trim().length === 0) throw new Error("caller_session_id is required")
  if (input.tool.trim().length === 0) throw new Error("tool is required")
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Receipt arguments must contain finite numbers.")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
  }
  throw new Error("Receipt arguments must be JSON-serializable.")
}

function pathKey(callerSessionId: string, tool: string, effectiveKey: string): string {
  return createHash("sha256").update(`${callerSessionId}\0${tool}\0${effectiveKey}`).digest("hex")
}

function receiptPath(directory: string, callerSessionId: string, tool: string, effectiveKey: string): string {
  return join(directory, `${pathKey(callerSessionId, tool, effectiveKey)}.json`)
}

function acquireLock(directory: string, name: string): boolean {
  try {
    mkdirSync(join(directory, name), { mode: 0o700 })
    return true
  } catch (error) {
    if (isCode(error, "EEXIST")) return false
    throw error
  }
}

function atomicWrite(path: string, receipt: DurableReceipt): void {
  writeFileAtomically(path, JSON.stringify(receipt))
}

function readReceipt(path: string): DurableReceipt | null {
  if (!existsSync(path)) return null
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isReceipt(parsed)) throw new Error(`Invalid durable receipt: ${path}`)
  return parsed
}

function isReceipt(value: unknown): value is DurableReceipt {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return record.version === 1 &&
    typeof record.caller_session_id === "string" &&
    typeof record.tool === "string" &&
    typeof record.effective_key === "string" &&
    typeof record.args_hash === "string" &&
    typeof record.operation_id === "string" &&
    typeof record.owner_instance_id === "string" &&
    typeof record.created_at === "string" &&
    typeof record.updated_at === "string" &&
    typeof record.expires_at === "string" &&
    (record.status === "prepared" || record.status === "completed" || record.status === "uncertain")
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}
