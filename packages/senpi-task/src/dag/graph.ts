import {
  DAG_SETTINGS_DEFAULTS,
  type DagBottleneck,
  type DagDiagnostic,
  type DagEdge,
  type DagNode,
  type DagNodeId,
  type DagNodeTargetInput,
  type DagRoute,
  type DagSettings,
  type DagWave,
} from "./types"

// Scheduling-only dependency graph input. dependsOn orders execution and nothing else: no prompt
// templating, no substitution of an upstream result into a downstream prompt.
export type DagNodeInput = DagNodeTargetInput & {
  readonly id: string
  readonly label?: string
  readonly dependsOn?: readonly string[]
  readonly task_summary?: string
  readonly description?: string
  readonly load_skills?: readonly string[]
}

export type DagDefinition = {
  readonly key: string
  readonly name: string
  readonly nodes: readonly DagNodeInput[]
}

export const DAG_COMPILE_ERROR_CODES = [
  "duplicate_node_id",
  "unknown_dependency",
  "self_dependency",
  "cycle",
  "node_count_exceeded",
  "prompt_bytes_exceeded",
  "dependency_fanout_exceeded",
  "empty_graph",
] as const

export type DagCompileErrorCode = (typeof DAG_COMPILE_ERROR_CODES)[number]

// Every compile error is fatal: when errors is non-empty no graph is produced and no run is created.
export type DagCompileError = {
  readonly code: DagCompileErrorCode
  readonly message: string
  readonly nodeIds: readonly DagNodeId[]
}

export type DagCompileResult = {
  readonly ok: boolean
  readonly nodes: readonly DagNode[]
  readonly edges: readonly DagEdge[]
  readonly waves: readonly DagWave[]
  readonly criticalPath: readonly DagNodeId[]
  readonly bottlenecks: readonly DagBottleneck[]
  readonly diagnostics: readonly DagDiagnostic[]
  readonly errors: readonly DagCompileError[]
}

// `at` is caller-supplied so compilation stays pure: no clock, no fs, no randomness.
export type DagCompileOptions = {
  readonly at?: string
  readonly settings?: Partial<DagSettings>
}

const EMPTY_AT = "1970-01-01T00:00:00.000Z"

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function compareSequences(a: readonly DagNodeId[], b: readonly DagNodeId[]): number {
  if (a.length !== b.length) {
    return b.length - a.length
  }
  for (let index = 0; index < a.length; index += 1) {
    const compared = byId(a[index] as string, b[index] as string)
    if (compared !== 0) {
      return compared
    }
  }
  return 0
}

function routeOf(input: DagNodeInput): DagRoute {
  return input.category !== undefined
    ? { kind: "category", category: input.category }
    : { kind: "agent", agent: input.subagent_type, ...(input.model === undefined ? {} : { model: input.model }) }
}

function failure(errors: readonly DagCompileError[], at: string): DagCompileResult {
  const diagnostics = errors.map((error): DagDiagnostic => {
    const [nodeId] = error.nodeIds
    return error.nodeIds.length === 1 && nodeId !== undefined
      ? { kind: "node_flag", nodeId, message: error.message, at }
      : { kind: "run_flag", message: error.message, at }
  })
  return { ok: false, nodes: [], edges: [], waves: [], criticalPath: [], bottlenecks: [], diagnostics, errors }
}

// Deterministic cycle listing: walk from the lexicographically smallest member of each strongly
// entangled region, always stepping to the smallest dependency that re-enters the region.
function findCycles(ids: readonly DagNodeId[], dependencies: ReadonlyMap<DagNodeId, readonly DagNodeId[]>): DagNodeId[][] {
  const remaining = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...remaining]) {
      const deps = dependencies.get(id) ?? []
      if (deps.every((dep) => !remaining.has(dep))) {
        remaining.delete(id)
        changed = true
      }
    }
  }
  const cycles: DagNodeId[][] = []
  const consumed = new Set<DagNodeId>()
  for (const start of [...remaining].sort(byId)) {
    if (consumed.has(start)) {
      continue
    }
    const path: DagNodeId[] = [start]
    const seen = new Map<DagNodeId, number>([[start, 0]])
    let current = start
    for (;;) {
      const next = (dependencies.get(current) ?? []).filter((dep) => remaining.has(dep)).sort(byId)[0]
      if (next === undefined) {
        break
      }
      const seenAt = seen.get(next)
      if (seenAt !== undefined) {
        const members = path.slice(seenAt)
        for (const member of members) {
          consumed.add(member)
        }
        // path follows dependency edges backwards; report it in execution order, closed on itself.
        const ordered = [members[0] as DagNodeId, ...members.slice(1).reverse()]
        cycles.push([...ordered, ordered[0] as DagNodeId])
        break
      }
      seen.set(next, path.length)
      path.push(next)
      current = next
    }
  }
  return cycles
}

export function compileDag(definition: DagDefinition, options?: DagCompileOptions): DagCompileResult {
  const at = options?.at ?? EMPTY_AT
  const settings: DagSettings = { ...DAG_SETTINGS_DEFAULTS, ...options?.settings }
  const errors: DagCompileError[] = []

  if (definition.nodes.length === 0) {
    errors.push({
      code: "empty_graph",
      message: "dag has no nodes; a run needs at least one node",
      nodeIds: [],
    })
  }

  if (definition.nodes.length > settings.max_nodes_per_run) {
    errors.push({
      code: "node_count_exceeded",
      message: `dag has ${definition.nodes.length} nodes, exceeding max_nodes_per_run ${settings.max_nodes_per_run}`,
      nodeIds: [],
    })
  }

  const declarationIndex = new Map<DagNodeId, number>()
  const seenIds = new Set<string>()
  const duplicates: DagNodeId[] = []
  for (const [index, input] of definition.nodes.entries()) {
    const id = input.id as DagNodeId
    if (seenIds.has(input.id)) {
      if (!duplicates.includes(id)) {
        duplicates.push(id)
      }
      continue
    }
    seenIds.add(input.id)
    declarationIndex.set(id, index)
  }
  for (const duplicate of duplicates) {
    errors.push({
      code: "duplicate_node_id",
      message: `duplicate node id "${duplicate}"`,
      nodeIds: [duplicate],
    })
  }

  for (const input of definition.nodes) {
    const id = input.id as DagNodeId
    const bytes = Buffer.byteLength(input.prompt, "utf8")
    if (bytes > settings.max_prompt_bytes) {
      errors.push({
        code: "prompt_bytes_exceeded",
        message: `node "${id}" prompt is ${bytes} bytes, exceeding max_prompt_bytes ${settings.max_prompt_bytes}`,
        nodeIds: [id],
      })
    }
    const deps = input.dependsOn ?? []
    if (deps.length > settings.max_nodes_per_run) {
      errors.push({
        code: "dependency_fanout_exceeded",
        message: `node "${id}" depends on ${deps.length} nodes, exceeding max_nodes_per_run ${settings.max_nodes_per_run}`,
        nodeIds: [id],
      })
    }
    for (const dep of deps) {
      if (dep === input.id) {
        errors.push({ code: "self_dependency", message: `node "${id}" depends on itself`, nodeIds: [id] })
        continue
      }
      if (!seenIds.has(dep)) {
        errors.push({
          code: "unknown_dependency",
          message: `node "${id}" depends on unknown node "${dep}"`,
          nodeIds: [id, dep as DagNodeId],
        })
      }
    }
  }

  const uniqueInputs = definition.nodes.filter((input) => declarationIndex.get(input.id as DagNodeId) !== undefined)
  const ids = uniqueInputs.map((input) => input.id as DagNodeId)
  const dependencies = new Map<DagNodeId, readonly DagNodeId[]>()
  for (const input of uniqueInputs) {
    const id = input.id as DagNodeId
    const deps = (input.dependsOn ?? []).filter((dep) => dep !== input.id && seenIds.has(dep)) as DagNodeId[]
    dependencies.set(id, [...new Set(deps)])
  }

  if (errors.length === 0) {
    for (const cycle of findCycles(ids, dependencies)) {
      errors.push({
        code: "cycle",
        message: `dependency cycle detected: ${cycle.join(" -> ")}`,
        nodeIds: cycle,
      })
    }
  }

  if (errors.length > 0) {
    return failure(errors, at)
  }

  const nodes: DagNode[] = uniqueInputs.map((input): DagNode => {
    const id = input.id as DagNodeId
    return {
      id,
      ...(input.label === undefined ? {} : { label: input.label }),
      prompt: input.prompt,
      route: routeOf(input),
      dependsOn: dependencies.get(id) ?? [],
      state: "pending",
      attempt: 0,
      createdAt: at,
    }
  })

  const edges: DagEdge[] = []
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      edges.push({ from: dep, to: node.id })
    }
  }
  edges.sort((a, b) => {
    const byTo = (declarationIndex.get(a.to) ?? 0) - (declarationIndex.get(b.to) ?? 0)
    return byTo !== 0 ? byTo : (declarationIndex.get(a.from) ?? 0) - (declarationIndex.get(b.from) ?? 0)
  })

  const depth = new Map<DagNodeId, number>()
  const resolveDepth = (id: DagNodeId): number => {
    const known = depth.get(id)
    if (known !== undefined) {
      return known
    }
    const deps = dependencies.get(id) ?? []
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(resolveDepth))
    depth.set(id, value)
    return value
  }
  for (const id of ids) {
    resolveDepth(id)
  }

  const waveIndexes = [...new Set(ids.map((id) => depth.get(id) ?? 0))].sort((a, b) => a - b)
  const waves: DagWave[] = waveIndexes.map((index) => ({
    index,
    nodeIds: ids
      .filter((id) => depth.get(id) === index)
      .sort((a, b) => {
        const declared = (declarationIndex.get(a) ?? 0) - (declarationIndex.get(b) ?? 0)
        return declared !== 0 ? declared : byId(a, b)
      }),
  }))

  const dependents = new Map<DagNodeId, DagNodeId[]>(ids.map((id) => [id, []]))
  for (const edge of edges) {
    dependents.get(edge.from)?.push(edge.to)
  }

  const longest = new Map<DagNodeId, readonly DagNodeId[]>()
  const resolveLongest = (id: DagNodeId): readonly DagNodeId[] => {
    const known = longest.get(id)
    if (known !== undefined) {
      return known
    }
    const successors = [...(dependents.get(id) ?? [])].sort(byId)
    let best: readonly DagNodeId[] = []
    for (const successor of successors) {
      const candidate = resolveLongest(successor)
      if (best.length === 0 || compareSequences(candidate, best) < 0) {
        best = candidate
      }
    }
    const path = [id, ...best]
    longest.set(id, path)
    return path
  }
  let criticalPath: readonly DagNodeId[] = []
  for (const id of [...ids].sort(byId)) {
    const candidate = resolveLongest(id)
    if (criticalPath.length === 0 || compareSequences(candidate, criticalPath) < 0) {
      criticalPath = candidate
    }
  }

  const descendants = new Map<DagNodeId, ReadonlySet<DagNodeId>>()
  const resolveDescendants = (id: DagNodeId): ReadonlySet<DagNodeId> => {
    const known = descendants.get(id)
    if (known !== undefined) {
      return known
    }
    const collected = new Set<DagNodeId>()
    for (const successor of dependents.get(id) ?? []) {
      collected.add(successor)
      for (const transitive of resolveDescendants(successor)) {
        collected.add(transitive)
      }
    }
    descendants.set(id, collected)
    return collected
  }
  const bottlenecks: DagBottleneck[] = ids
    .map((id) => ({ nodeId: id, blockedCount: resolveDescendants(id).size }))
    .sort((a, b) => (b.blockedCount !== a.blockedCount ? b.blockedCount - a.blockedCount : byId(a.nodeId, b.nodeId)))

  return { ok: true, nodes, edges, waves, criticalPath, bottlenecks, diagnostics: [], errors: [] }
}
