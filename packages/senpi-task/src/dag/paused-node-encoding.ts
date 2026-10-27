// The previous release knows no `paused` node state: its node counts index by state, so an unknown
// one turns every count into NaN. On disk a paused node is `running` plus `paused: true` (the same
// rule task records follow), and this build reads it back as `paused`.

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function encodePausedNodes<T extends object>(checkpoint: T): T {
  const nodes = (checkpoint as Json)["nodes"]
  if (!Array.isArray(nodes)) return checkpoint
  return { ...checkpoint, nodes: nodes.map(node => isRecord(node) && node["state"] === "paused" ? { ...node, state: "running", paused: true } : node) }
}

export function decodePausedNodes<T extends object>(checkpoint: T): T {
  const nodes = (checkpoint as Json)["nodes"]
  if (!Array.isArray(nodes)) return checkpoint
  return {
    ...checkpoint,
    nodes: nodes.map(node => {
      if (!isRecord(node) || node["paused"] !== true) return node
      const { paused: _paused, ...rest } = node
      return { ...rest, state: "paused" }
    }),
  }
}

export function encodePausedTransition<T extends object>(event: T): T {
  const value = event as Json
  if (value["type"] !== "dag.node.transitioned" || (value["from"] !== "paused" && value["to"] !== "paused")) return event
  return {
    ...event,
    ...(value["from"] === "paused" ? { from: "running", fromPaused: true } : {}),
    ...(value["to"] === "paused" ? { to: "running", toPaused: true } : {}),
  }
}

export function decodePausedTransition<T extends object>(event: T): T {
  const value = event as Json
  if (value["type"] !== "dag.node.transitioned" || (value["fromPaused"] !== true && value["toPaused"] !== true)) return event
  const { fromPaused, toPaused, ...rest } = value
  return { ...rest, ...(fromPaused === true ? { from: "paused" } : {}), ...(toPaused === true ? { to: "paused" } : {}) } as T
}
