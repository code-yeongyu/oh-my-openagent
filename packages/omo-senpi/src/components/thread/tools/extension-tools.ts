/**
 * The session tools of store extensions (omo-gateway todo 14): one tool per session-callable op
 * declared in the store (`extension_registrations`), named `ext_<extension>_<toolName>`. A tool resolves the
 * engine's caller (`ectx.sessionManager.getSessionId()`) to its durable id through the address book
 * and calls the op through the store's session channel, which stamps that caller into the op's args
 * inside the op's transaction. There is never an argument fallback for the caller.
 */
import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { ThreadToolResult } from "../contracts"
import type { DeclaredSessionOp, StoreExtensionResult } from "../gateway/store"
import { addressBook, hostView, type AnyTool } from "./internals"
import { UNKNOWN_CALLER, type ThreadHostView, type ThreadToolSurfaceOptions } from "./ports"

type ExtensionToolOutput = AgentToolResult<{ readonly result: StoreExtensionResult<unknown> }>

/**
 * The durable id of the engine's caller, the lookup `self` uses: the engine's `getSessionId()` IS the
 * session's durable id, so it resolves only to the address book entry with exactly that durable id.
 * A routing id (`rpc-<n>`, a per-process counter that repeats across hosts) never resolves, nor does
 * an absent or unknown identity: the caller fails closed as `caller_context_missing`.
 */
export function resolveCallerDurableId(options: Omit<ThreadToolSurfaceOptions, "store">, view: ThreadHostView, runtimeId: string): string | undefined {
  if (runtimeId.length === 0 || runtimeId === UNKNOWN_CALLER) return undefined
  return addressBook(options, view).find((entry) => entry.durable_id === runtimeId)?.durable_id
}

function runtimeIdOf(options: ThreadToolSurfaceOptions, ectx: unknown): string {
  return (ectx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.() ?? options.callerSessionId()
}

/** thread_create records its creator (the engine-resolved caller) once the host opened the session; a session op's `caller_created_target` reads it. */
export async function recordThreadCreator(options: ThreadToolSurfaceOptions, view: ThreadHostView, runtimeId: string, created: ThreadToolResult): Promise<ThreadToolResult> {
  const createdId = created.kind === "ok" ? (created as { readonly thread?: { readonly thread_id?: unknown } }).thread?.thread_id : undefined
  if (typeof createdId !== "string") return created
  const creator = resolveCallerDurableId(options, view, runtimeId)
  if (creator !== undefined && creator !== createdId) await options.store.recordThreadCreation({ creator_durable_id: creator, created_durable_id: createdId })
  return created
}

function output(result: StoreExtensionResult<unknown>): ExtensionToolOutput {
  return { content: [{ type: "text", text: JSON.stringify(result) }], details: { result } }
}

function extensionTool(options: ThreadToolSurfaceOptions, op: DeclaredSessionOp): AnyTool {
  return {
    name: op.registeredName,
    label: op.registeredName,
    description: op.description,
    parameters: op.parameters,
    execute: async (_id: string, args: unknown, _signal: unknown, _onUpdate: unknown, ectx: unknown) => {
      await options.ensureHost?.()
      const view = await hostView(options, { offline: true })
      const caller = resolveCallerDurableId(options, view, runtimeIdOf(options, ectx))
      if (caller === undefined) {
        return output({ kind: "refused", code: "caller_context_missing", message: "The calling session's durable id is not in the thread address book; the op was not run." })
      }
      return output(await options.store.extensionSessionAwait(op.extension, op.op, args, { callerDurableId: caller }))
    },
  }
}

/** One tool per declared session op; reads the store's declarations and imports no extension module. */
export async function buildExtensionTools(options: ThreadToolSurfaceOptions): Promise<AnyTool[]> {
  return (await options.store.sessionCallableOps()).map((op) => extensionTool(options, op))
}

export type ExtensionToolHost = {
  registerTool(tool: Record<string, unknown>): void
  on?(event: string, handler: () => void): void
  /** senpi's tool registry for the session (builtins and every extension's tools). */
  getAllTools?(): readonly { readonly name: string }[]
}

/**
 * At each `session_start` registers the declared session tools (none, and no store opened, while no
 * gateway store exists): a declaration made after a session started appears from that session's next
 * start. A tool never replaces one the session already has from elsewhere, and two declarations that
 * compose the same name (rows written past `register()`) register neither: each such name is skipped
 * and logged once per process. A wake hint that could not be written after a committed call is
 * logged once; the connector's backstop covers it.
 */
export function registerExtensionTools(pi: ExtensionToolHost & Required<Pick<ExtensionToolHost, "on">>, options: ThreadToolSurfaceOptions, log: (line: string) => void): void {
  options.store.onEvent((event) => {
    if (event.kind === "extension_error" && event.phase === "after_commit") log(`thread gateway: extension ${event.extension} committed, but an after-commit effect (its wake hint) failed: ${event.error}`)
  })
  const mine = new Set<string>()
  const reported = new Set<string>()
  const skip = (name: string, why: string): void => {
    if (reported.has(name)) return
    reported.add(name)
    log(`thread gateway: extension session tool ${name} was not registered: ${why}`)
  }
  pi.on("session_start", () => {
    void buildExtensionTools(options).then(
      (tools) => {
        const present = new Set((pi.getAllTools?.() ?? []).map((tool) => tool.name))
        const counts = new Map<string, number>()
        for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
        for (const tool of tools) {
          if ((counts.get(tool.name) ?? 0) > 1) skip(tool.name, "more than one extension declares it")
          else if (present.has(tool.name) && !mine.has(tool.name)) skip(tool.name, "the session already has a tool by that name")
          else {
            mine.add(tool.name)
            pi.registerTool({ ...tool })
          }
        }
      },
      (error: unknown) => log(`thread gateway: extension session tools were not registered: ${error instanceof Error ? error.message : String(error)}`),
    )
  })
}
