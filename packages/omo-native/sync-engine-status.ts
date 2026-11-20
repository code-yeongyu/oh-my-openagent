import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { z } from "zod"

import { resolveTaskHostSocket } from "../senpi-task/src/runners/rpc-host/daemon-contract"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { resolveSenpi } from "./bin/lib/package-paths.js"

// `omo sync status` reads the running engine's memory-sync state through the same `omo.memory.sync.status` extension
// request the desktop and the TUI footer use (#14435). The engine answers it inside a session, so the read attaches to
// a session the engine already has open and detaches again; it never opens a new session and never writes.

const failureSchema = z.object({
  kind: z.string(),
  reason: z.string(),
  action: z.string(),
  sinceISO: z.string(),
  attempts: z.number(),
  keys: z.array(z.string()).optional(),
})

const syncSchema = z.object({
  state: z.enum(["never_synced", "synced", "paused", "failing", "unavailable"]),
  lastSyncedAtISO: z.string().optional(),
  appliedWhileOffline: z.number().optional(),
  failure: failureSchema.optional(),
})

export type EngineSync = z.infer<typeof syncSchema>

export type EngineSyncRead =
  /** No engine host listens on this machine's operator socket. */
  | { readonly kind: "no_engine" }
  /** An engine runs but has no open session to answer the request. */
  | { readonly kind: "no_session" }
  /** The engine answered; `sync` is absent while that engine does not sync this account's memory. */
  | { readonly kind: "read"; readonly sync: EngineSync | null }
  /** The engine could not be read; `reason` names why, never a secret. */
  | { readonly kind: "unreadable"; readonly reason: string }

/** The answer of `omo.memory.sync.status`, read at the boundary: only its `sync` part is used. */
export function parseEngineAnswer(answer: unknown): EngineSyncRead {
  const parsed = z.object({ sync: syncSchema.optional() }).safeParse(answer)
  if (!parsed.success) return { kind: "unreadable", reason: "the engine's answer did not match the expected shape" }
  return { kind: "read", sync: parsed.data.sync ?? null }
}

interface RpcClientLike {
  start(): Promise<void>
  stop(): Promise<void>
  listSessions(): Promise<ReadonlyArray<{ readonly sessionPath?: string; readonly status: string }>>
  openSession(options: { readonly sessionPath: string }): Promise<unknown>
  requestExtension(name: string, data: unknown): Promise<unknown>
}

const STEP_MS = 5_000

const bounded = <T>(work: Promise<T>, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not answer within ${STEP_MS / 1000}s`)), STEP_MS)
    work.then(resolve, reject).finally(() => clearTimeout(timer))
  })

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : "the request failed")

/** This machine's engine host, over its operator socket. */
export async function readEngineSyncStatus(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<EngineSyncRead> {
  const agentDir = canonicalAgentDir(env)
  const socket = resolveTaskHostSocket(env, agentDir)
  if (process.platform !== "win32" && !existsSync(socket)) return { kind: "no_engine" }
  let client: RpcClientLike
  try {
    const { packageRoot } = resolveSenpi()
    const url = pathToFileURL(join(packageRoot, "dist", "modes", "rpc", "rpc-client.js")).href
    const { RpcClient } = (await import(url)) as {
      RpcClient: new (options: { socketPath: string }) => RpcClientLike
    }
    client = new RpcClient({ socketPath: socket })
  } catch (error) {
    return { kind: "unreadable", reason: reasonOf(error) }
  }
  try {
    await bounded(client.start(), "the engine host")
  } catch {
    // A socket file nobody listens on: the engine stopped without removing it.
    return { kind: "no_engine" }
  }
  try {
    const open = (await bounded(client.listSessions(), "list_sessions")).find(
      (session) => session.status === "open" && session.sessionPath !== undefined,
    )
    if (open?.sessionPath === undefined) return { kind: "no_session" }
    await bounded(client.openSession({ sessionPath: open.sessionPath }), "attaching to a session")
    return parseEngineAnswer(await bounded(client.requestExtension("omo.memory.sync.status", {}), "sync status"))
  } catch (error) {
    return { kind: "unreadable", reason: reasonOf(error) }
  } finally {
    await client.stop().catch(() => undefined)
  }
}
