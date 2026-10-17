/**
 * The session channel of store extensions (worker side). A session-callable op is reached only
 * here: the caller is the engine-resolved durable id the session's tool passed, stamped into the
 * op's args inside the op's own transaction, with `caller_created_target: true` only when that
 * caller thread_create'd the op's target (omitted otherwise, never false). Args that already name a
 * caller are refused before validation, and a committed success touches the declared wake file.
 */
import { randomUUID } from "node:crypto"
import { rmSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Value } from "typebox/value"

import { AWAIT_REQUEST_ID, RESERVED_CALLER_KEYS, isToolSessionOp } from "./extension-registrations"
import { gatewayDatabasePath } from "./paths"
import type { StoreExtensions } from "./store-extension-ops"
import { transaction, type StoreContext } from "./store-ops"
import type { StoreExtensionRefusal, StoreExtensionResult } from "./store-extensions"
import { UNKNOWN_CALLER } from "../tools/ports"

export type SessionCallRequest = {
  readonly name: string
  /** The declared op (`SessionCallableOp.op`); `phase` picks it or its await's statusOp/expireOp. */
  readonly op: string
  readonly phase: "op" | "status" | "expire"
  readonly args: unknown
  readonly caller: string
  readonly now: number
}

/** The op's result, and for a declared await the facade's wait parameters. */
export type SessionCallReply = {
  readonly result: StoreExtensionResult<unknown>
  readonly await?: { readonly timeout_ms: number; readonly wake_dir: string }
}

const refused = (code: StoreExtensionRefusal["code"], message: string): SessionCallReply => ({ result: { kind: "refused", code, message } })

/** The wake hint after a committed call: a temp file in the same dir renamed over it. The connector creates the dir; this never does. */
function touchWake(agentDir: string, wakeDir: string, wake: string): void {
  const marker = join(dirname(gatewayDatabasePath(agentDir)), wakeDir, wake)
  const temporary = `${marker}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify({ written_at: new Date().toISOString() }), { mode: 0o600 })
  try {
    renameSync(temporary, marker)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function createdBy(ctx: StoreContext, creator: string, created: string): boolean {
  return ctx.sql.one(["n"], "SELECT 1 AS n FROM thread_creations WHERE creator_durable_id = ? AND created_durable_id = ?", [creator, created]) !== undefined
}

export async function recordThreadCreation(ctx: StoreContext, request: { readonly now: number; readonly creator_durable_id: string; readonly created_durable_id: string }): Promise<void> {
  await transaction(ctx, "record_thread_creation", () => {
    ctx.sql.run("INSERT OR IGNORE INTO thread_creations (creator_durable_id, created_durable_id, created_at) VALUES (?, ?, ?)", [request.creator_durable_id, request.created_durable_id, request.now])
  })
}

export async function sessionCall(ctx: StoreContext, extensions: StoreExtensions, request: SessionCallRequest): Promise<SessionCallReply> {
  const { name, caller, phase } = request
  if (typeof caller !== "string" || caller.length === 0 || caller === UNKNOWN_CALLER) {
    return refused("caller_context_missing", "A session-callable op needs the calling session's engine-resolved durable id.")
  }
  const loaded = await extensions.load(name)
  if ("kind" in loaded) return { result: loaded }
  const { descriptor } = loaded
  const entry = descriptor.sessionCallable?.find((candidate) => candidate.op === request.op)
  if (entry === undefined) return refused("extension_unknown_op", `Extension ${name} declares no session-callable op ${request.op}.`)
  const args = request.args
  if (typeof args !== "object" || args === null || Array.isArray(args)) return refused("invalid_arguments", "Session op arguments must be an object.")
  // A caller field in args is a forgery attempt whatever its value: refused before validation.
  const forged = RESERVED_CALLER_KEYS.find((key) => Object.hasOwn(args, key))
  if (forged !== undefined) return refused("invalid_arguments", `${forged} is stamped by the store from the engine's caller and cannot be passed.`)
  let op = entry.op
  const awaited = isToolSessionOp(entry) ? entry.await : undefined
  if (phase === "op") {
    let valid: boolean
    try {
      valid = Value.Check(entry.parameters, args)
    } catch (error) {
      // A schema typebox only rejects once a value reaches the bad part (an invalid pattern).
      return refused("invalid_arguments", `${name}.${entry.op} declares parameters that cannot be checked: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!valid) {
      const [first] = Value.Errors(entry.parameters, args)
      return refused("invalid_arguments", `Parameter validation failed at ${first?.instancePath || "/"}: ${first?.message ?? "invalid value"}`)
    }
  } else if (phase === "status" || phase === "expire") {
    const id = (args as { readonly await_request_id?: unknown }).await_request_id
    if (awaited === undefined) return refused("extension_unknown_op", `${name}.${entry.op} declares no await.`)
    if (typeof id !== "string" || !AWAIT_REQUEST_ID.test(id)) return refused("invalid_arguments", `await_request_id must match ${AWAIT_REQUEST_ID.source}.`)
    op = phase === "status" ? awaited.statusOp : awaited.expireOp
  } else {
    return refused("invalid_arguments", `Unknown session call phase ${String(phase)}.`)
  }
  const target = entry.targetArg === undefined ? undefined : (args as Record<string, unknown>)[entry.targetArg]
  const stamped = () => ({
    ...(phase === "op" ? args : { await_request_id: (args as { readonly await_request_id: string }).await_request_id }),
    caller_session_durable_id: caller,
    ...(phase === "op" && typeof target === "string" && createdBy(ctx, caller, target) ? { caller_created_target: true } : {}),
  })
  const { wakeDir } = descriptor
  const wake = isToolSessionOp(entry) ? entry.wake : undefined
  const effects = phase === "op" && wake !== undefined && wakeDir !== undefined ? [() => touchWake(ctx.config.agent_dir, wakeDir, wake)] : []
  const result = await extensions.run({ name, descriptor, module: loaded.module, op, args: stamped, effects }, request.now)
  return phase === "op" && awaited !== undefined && wakeDir !== undefined ? { result, await: { timeout_ms: awaited.timeoutMs, wake_dir: wakeDir } } : { result }
}
