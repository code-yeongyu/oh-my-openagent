import type { InFlightReads } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"

type MemoryHook = Parameters<SenpiExtensionAPI["on"]>[1]

// The shutdown drain waits on the tracked work, so a tracked session_shutdown handler would wait on itself.
const UNTRACKED_EVENTS: ReadonlySet<string> = new Set(["session_shutdown"])

/**
 * The extension API the memory component registers through: every hook handler it adds (session_shutdown aside) and
 * every tool execute has its returned promise tracked in `work`, which the session_shutdown drain awaits. On quit the
 * host runs that drain before it aborts a running tool, so a hook or tool still reading the identity repository is
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
  return new Proxy(pi, {
    get(target, key) {
      if (key === "on") return on
      if (key === "registerTool") return registerTool
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function trackedHook(handler: MemoryHook, work: InFlightReads): MemoryHook {
  return function trackedMemoryHook(payload, ctx, observer) {
    const result = handler(payload, ctx, observer)
    if (result instanceof Promise) void work.track(() => result)
    return result
  }
}
