// Dependency-free convenience wrapper around the `dag` tool, loaded by JavaScript eval cells from
// OMO_DAG_SDK_ROOT. It must stay import-free: the eval worker has no node_modules on its resolver
// path, so anything this file imports would break the cell at load time.
//
// Every call funnels through globalThis.tool.dag({ action, ... }), the proxy the JS kernel installs
// (senpi packages/senpi-codemode/src/kernels/js/worker-runtime.js). Python cells cannot import ESM
// and call tool.dag({...}) directly instead; there is no Python counterpart to this file.

// The dag tool reports a refusal in-band: it resolves with { details: { kind: "error", error: { code,
// message, ... } } } and no run_id (see packages/omo-senpi/src/components/task/dag-tool-contract.ts).
// Every action funnels through here so a refusal reaches the cell as the tool's own code and message
// rather than as a downstream symptom such as a missing run_id.
function throwIfToolError(action, response) {
  if (response?.details?.kind !== "error") return response
  const error = response.details.error
  const code = typeof error?.code === "string" && error.code !== "" ? error.code : undefined
  const message = typeof error?.message === "string" && error.message !== "" ? error.message : undefined
  const detail =
    code === undefined && message === undefined
      ? firstContentText(response) ?? "the dag tool reported an error with no details."
      : [code, message].filter((part) => part !== undefined).join(": ")
  throw new Error(`dag ${action} failed: ${detail}`)
}

function firstContentText(response) {
  const content = response?.content
  if (!Array.isArray(content)) return undefined
  for (const entry of content) {
    if (typeof entry?.text === "string" && entry.text !== "") return entry.text
  }
  return undefined
}

async function callDag(args) {
  const proxy = globalThis.tool
  if (proxy === undefined || proxy === null || typeof proxy.dag !== "function") {
    throw new Error("The dag sdk requires the eval kernel's global `tool` proxy; it is unavailable here.")
  }
  return throwIfToolError(args.action, await proxy.dag(args))
}

class DagDefinitionBuilder {
  constructor(key, name) {
    this.key = key
    this.name = name
    this.nodes = []
    this.ids = new Set()
  }

  // Rejects duplicates locally so a mistyped graph fails in the cell, before any host round-trip.
  node(input) {
    if (input === undefined || input === null || typeof input.id !== "string" || input.id === "") {
      throw new Error("A dag node needs a non-empty string id.")
    }
    if (this.ids.has(input.id)) {
      throw new Error(`Duplicate dag node id "${input.id}": every node id must be unique within a definition.`)
    }
    this.ids.add(input.id)
    this.nodes.push(input)
    return this
  }

  definition() {
    return this.name === undefined
      ? { key: this.key, nodes: this.nodes }
      : { key: this.key, name: this.name, nodes: this.nodes }
  }

  start() {
    return start(this.definition())
  }
}

export function define(input) {
  if (input === undefined || input === null || typeof input.key !== "string" || input.key === "") {
    throw new Error("define() needs a non-empty string key: it is the run's idempotency key.")
  }
  return new DagDefinitionBuilder(input.key, input.name ?? input.key)
}

function runHandle(response, runId) {
  return {
    ...response,
    run_id: runId,
    done: () => wait(runId),
    cancel: (reason) => cancel(runId, reason),
  }
}

export async function start(definition) {
  const response = await callDag({ action: "start", definition })
  const runId = response?.details?.run_id ?? response?.run_id
  if (typeof runId !== "string" || runId === "") {
    throw new Error("The dag start response did not include a run_id.")
  }
  return runHandle(response, runId)
}

export async function attach(runId) {
  const response = await callDag({ action: "attach", run_id: runId })
  return runHandle(response, runId)
}

export function snapshot(runId) {
  return callDag({ action: "snapshot", run_id: runId })
}

export function wait(runId) {
  return callDag({ action: "wait", run_id: runId })
}

export function cancel(runId, reason) {
  return reason === undefined
    ? callDag({ action: "cancel", run_id: runId })
    : callDag({ action: "cancel", run_id: runId, reason })
}

/**
 * Retry one or more failed/cancelled/skipped DAG nodes in place.
 *
 * @param {string} runId - The run id returned by start/attach.
 * @param {string | string[] | undefined} nodeIds - A single node id, an array of node ids, or omitted to retry all eligible nodes.
 * @param {{ prompt?: string } | undefined} opts - Optional per-node overrides. `prompt` is only meaningful for a single-node retry.
 * @returns {Promise<unknown>} The dag tool response.
 */
export function retry(runId, nodeIds, opts) {
  if (typeof runId !== "string" || runId === "") {
    throw new Error("retry() needs a non-empty string run_id.")
  }
  const payload = { action: "retry", run_id: runId }
  if (nodeIds !== undefined) {
    if (Array.isArray(nodeIds)) {
      payload.node_ids = nodeIds
    } else if (typeof nodeIds === "string") {
      payload.node_id = nodeIds
    } else {
      throw new Error("retry() nodeIds must be a string or string[] when provided.")
    }
  }
  if (opts !== undefined && opts !== null) {
    if (typeof opts.prompt === "string") {
      payload.prompt = opts.prompt
    } else if (opts.prompt !== undefined) {
      throw new Error("retry() opts.prompt must be a string when provided.")
    }
  }
  return callDag(payload)
}

/**
 * Send a steering message to a node's child task.
 *
 * @param {string} runId - The run id.
 * @param {string} nodeId - The target node id.
 * @param {string} message - The message to deliver to the child.
 * @returns {Promise<unknown>} The dag tool response.
 */
export function send(runId, nodeId, message) {
  if (typeof runId !== "string" || runId === "") {
    throw new Error("send() needs a non-empty string run_id.")
  }
  if (typeof nodeId !== "string" || nodeId === "") {
    throw new Error("send() needs a non-empty string node_id.")
  }
  if (typeof message !== "string" || message === "") {
    throw new Error("send() needs a non-empty string message.")
  }
  return callDag({ action: "send", run_id: runId, node_id: nodeId, message })
}

/**
 * Amend the definition of an existing run. Unchanged completed nodes are reused;
 * changed nodes and their transitive dependents are re-run.
 *
 * @param {string} runIdOrKeySelector - The run id of the run to amend. (The SDK accepts a run id; a key selector may be supported later.)
 * @param {Record<string, unknown>} definition - The new DAG definition, using the same schema as start().
 * @returns {Promise<unknown>} The dag tool response.
 */
export function amend(runIdOrKeySelector, definition) {
  if (typeof runIdOrKeySelector !== "string" || runIdOrKeySelector === "") {
    throw new Error("amend() needs a non-empty string run_id selector.")
  }
  if (definition === undefined || definition === null || typeof definition !== "object") {
    throw new Error("amend() needs a definition object.")
  }
  return callDag({ action: "amend", run_id: runIdOrKeySelector, definition })
}
