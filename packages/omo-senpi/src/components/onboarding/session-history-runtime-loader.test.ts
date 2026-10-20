import { describe, expect, it } from "bun:test"

import type { SenpiExtensionAPI } from "../../extension/types"
import { OMO_SESSION_PROJECTS_RPC_METHOD, OMO_SESSION_THREADS_RPC_EVENT, OMO_SESSION_THREADS_RPC_METHOD, registerSessionHistoryRpc } from "./session-history-rpc"
import {
  createSessionHistoryRuntimeLoader,
  SESSION_HISTORY_RUNTIME_ARTIFACT,
  type SessionHistoryRuntimeModule,
} from "./session-history-runtime-loader"
import * as runtime from "./session-history/runtime"

type Handler = (data: unknown) => unknown

function rpcHost() {
  const handlers = new Map<string, Handler>()
  const emits: Array<{ name: string; data: unknown }> = []
  let onEmit = () => {}
  const pi = { rpc: { handle: (name: string, handler: Handler) => void handlers.set(name, handler), emit: (name: string, data: unknown) => { emits.push({ name, data }); onEmit() } } }
  const nextEmit = () => new Promise<void>((resolve) => { onEmit = resolve })
  return { pi: pi as unknown as SenpiExtensionAPI, handlers, emits, nextEmit }
}

const missingRuntime = () => createSessionHistoryRuntimeLoader(() => Promise.reject(new Error("Cannot find module '#omo-session-history-runtime'")))

describe("session-history runtime loader", () => {
  it("#given concurrent first scans #when the runtime is loaded #then it is imported once and shared", async () => {
    let imports = 0
    const load = createSessionHistoryRuntimeLoader(async () => { imports += 1; return runtime })
    const [first, second] = await Promise.all([load(), load()])
    expect(first).toBe(second)
    expect(imports).toBe(1)
  })

  it("#given a failed import #when the next scan loads #then the failure was not cached", async () => {
    let attempt = 0
    const load = createSessionHistoryRuntimeLoader(async (): Promise<SessionHistoryRuntimeModule> => {
      attempt += 1
      if (attempt === 1) throw new Error("transient")
      return runtime
    })
    await expect(load()).rejects.toThrow(SESSION_HISTORY_RUNTIME_ARTIFACT)
    expect(await load()).toBe(runtime)
  })

  it("#given a payload missing the sidecar #when the projects method is called #then it answers unavailable with the cause and the remedy", async () => {
    const host = rpcHost()
    registerSessionHistoryRpc(host.pi, { loadRuntime: missingRuntime() })
    const reply = await host.handlers.get(OMO_SESSION_PROJECTS_RPC_METHOD)?.({ homes: [], importedProjects: [], excludedDirectories: [], managedWorktreeDirectories: [] })
    expect(reply).toEqual({ kind: "unavailable", reason: expect.stringContaining("Cannot find module '#omo-session-history-runtime'") })
    expect(String((reply as { reason: string }).reason)).toContain("reinstall omo")
  })

  it("#given a payload missing the sidecar #when a sessions scan runs #then it ends with one failed event naming the artifact", async () => {
    const host = rpcHost()
    registerSessionHistoryRpc(host.pi, { loadRuntime: missingRuntime(), newScanId: () => "scan-1" })
    const emitted = host.nextEmit()
    const reply = await host.handlers.get(OMO_SESSION_THREADS_RPC_METHOD)?.({ workspaceRoot: "/w", homes: [], completed: [], excludedDirectories: [], managedWorktreeDirectories: [] })
    expect(reply).toEqual({ scanId: "scan-1" })
    await emitted
    expect(host.emits).toEqual([{ name: OMO_SESSION_THREADS_RPC_EVENT, data: { scanId: "scan-1", kind: "failed", reason: expect.stringContaining(SESSION_HISTORY_RUNTIME_ARTIFACT) } }])
  })
})
