// The shard-cost driver's provider: task-host-e2e-mock-provider.mjs, with one routing rule.
//
// The base mock loads its script (and writes its request log) from `context.cwd ?? process.cwd()`.
// A pre-change engine hands the provider no `cwd`, so in ONE shared host every child - whichever
// project its parent runs in - reads the script of the project that happened to launch the host.
// The (d2) workload needs two projects on one host (A/B's children finish, C's child stays
// mid-turn), so a child whose prompt carries `[[mock-cwd:<dir>]]` is answered from <dir>'s script
// and logged there. Without the marker the base mock runs unchanged.
import registerTaskHostMock from "./task-host-e2e-mock-provider.mjs"

const MARKER = /\[\[mock-cwd:([^\]]+)\]\]/

export const mockCwdMarker = (cwd) => `[[mock-cwd:${cwd}]]`

function routedCwd(context) {
  for (const message of context.messages ?? []) {
    if (message.role !== "user") continue
    const text = typeof message.content === "string"
      ? message.content
      : (message.content ?? []).map((part) => part.text ?? "").join("")
    const hit = MARKER.exec(text)
    if (hit !== null) return hit[1]
  }
  return undefined
}

export default function registerShardCostMock(pi) {
  registerTaskHostMock(new Proxy(pi, {
    get(target, key) {
      if (key === "registerProvider") {
        return (id, provider) => target.registerProvider(id, {
          ...provider,
          streamSimple(model, context, options) {
            const cwd = routedCwd(context)
            return provider.streamSimple(model, cwd === undefined ? context : { ...context, cwd }, options)
          },
        })
      }
      const value = target[key]
      return typeof value === "function" ? value.bind(target) : value
    },
  }))
}
