import type { InFlightReads } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"

type MemoryHook = Parameters<SenpiExtensionAPI["on"]>[1]
type MemoryRpc = NonNullable<SenpiExtensionAPI["rpc"]>
type MemoryRpcHandler = Parameters<NonNullable<MemoryRpc["handle"]>>[1]

// The shutdown drain waits on the tracked work, so a tracked session_shutdown handler would wait on itself.
const UNTRACKED_EVENTS: ReadonlySet<string> = new Set(["session_shutdown"])

/**
 * The extension API the memory component registers through: every hook handler it adds (session_shutdown aside) and
 * every tool execute and rpc handler has its returned promise tracked in `work`, which the session_shutdown drain awaits. On quit the
 * host runs that drain before it aborts a running tool, so a hook, tool or rpc request (a sync enable, join or approve,
 * the status snapshot) still reading the identity repository is
 * waited on instead of leaving a git child in that directory (#11135). Commands are not wrapped: their context can
 * replace the session (newSession, fork, navigateTree), and a command awaiting that replacement's shutdown would make
 * the drain wait on itself.
 */
export function trackMemoryHooks<Api extends SenpiExtensionAPI>(pi: Api, work: InFlightReads): Api {
  const on: SenpiExtensionAPI["on"] = (event, handler, options) => {
    pi.on(event, UNTRACKED_EVENTS.has(event) ? handler : trackedHook(handler, work), options)
  }
  const registerTool: SenpiExtensionAPI["registerTool"] = (tool) => {
    const execute = tool.execute
    if (typeof execute !== "function") return pi.registerTool(tool)
    pi.registerTool({
      ...tool,
      execute: function trackedMemoryTool(this: unknown, ...args: unknown[]): unknown {
        const result: unknown = Reflect.apply(execute, this, args)
        if (result instanceof Promise) void work.track(() => result)
        return result
      },
    })
  }
  // One wrapper per host rpc object, so repeated `pi.rpc` reads stay identical.
  const rpcWrappers = new WeakMap<MemoryRpc, MemoryRpc>()
  const trackedRpcFor = (rpc: MemoryRpc): MemoryRpc => {
    const existing = rpcWrappers.get(rpc)
    if (existing !== undefined) return existing
    const wrapped = trackedRpc(rpc, work)
    rpcWrappers.set(rpc, wrapped)
    return wrapped
  }
  return new Proxy(pi, {
    get(target, key) {
      if (key === "on") return on
      if (key === "registerTool") return registerTool
      if (key === "rpc") return target.rpc === undefined ? undefined : trackedRpcFor(target.rpc)
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

// Callers read `handle` off `pi.rpc` and call it unbound, so the wrapper binds the host's rpc object itself.
function trackedRpc(rpc: MemoryRpc, work: InFlightReads): MemoryRpc {
  const handle = rpc.handle
  if (handle === undefined) return rpc
  const trackedHandle: NonNullable<MemoryRpc["handle"]> = (name, handler) => {
    handle.call(rpc, name, trackedRpcHandler(handler, work))
  }
  return new Proxy(rpc, {
    get(target, key) {
      if (key === "handle") return trackedHandle
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function trackedRpcHandler(handler: MemoryRpcHandler, work: InFlightReads): MemoryRpcHandler {
  return function trackedMemoryRpc(this: unknown, ...args: Parameters<MemoryRpcHandler>): unknown {
    const result: unknown = Reflect.apply(handler, this, args)
    if (result instanceof Promise) void work.track(() => result)
    return result
  }
}

function trackedHook(handler: MemoryHook, work: InFlightReads): MemoryHook {
  return function trackedMemoryHook(payload, ctx, observer) {
    const result = handler(payload, ctx, observer)
    if (result instanceof Promise) void work.track(() => result)
    return result
  }
}
