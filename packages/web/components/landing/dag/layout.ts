import type { DagEdge, DagNode, DagRun } from "./types"

/**
 * Port of the desktop app's workflowGraphLayout: declared wave columns, barycenter
 * row ordering, fanned ports and one cubic rule shared by edges and travelling lights.
 */
export const NODE_WIDTH = 200
export const NODE_HEIGHT = 88
export const COLUMN_GAP = 44
export const ROW_GAP = 12
export const WAVE_HEADER_HEIGHT = 48

const PORT_FAN_STEP = 8
const MIN_CONTROL_OFFSET = 32
const MAX_CONTROL_OFFSET = 96
const SWEEP_COUNT = 4

export interface LayoutPoint {
  readonly x: number
  readonly y: number
}

export interface LayoutNode {
  readonly node: DagNode
  readonly x: number
  readonly y: number
  readonly waveIndex: number
}

export interface LayoutEdge {
  readonly key: string
  readonly from: LayoutPoint
  readonly to: LayoutPoint
}

export interface DagLayout {
  readonly width: number
  readonly height: number
  readonly nodes: readonly LayoutNode[]
  readonly edges: readonly LayoutEdge[]
}

interface EdgeEndpoints {
  readonly key: string
  readonly fromId: string
  readonly toId: string
  readonly sourceX: number
  readonly sourceY: number
  readonly targetX: number
  readonly targetY: number
}

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`
}

function declaredColumns(run: DagRun): readonly (readonly string[])[] {
  const known = new Set(run.nodes.map((node) => node.id))
  const placed = new Set<string>()
  return [...run.waves]
    .sort((left, right) => left.index - right.index)
    .map((wave) =>
      wave.nodeIds.filter((nodeId) => {
        if (!known.has(nodeId) || placed.has(nodeId)) return false
        placed.add(nodeId)
        return true
      }),
    )
}

function positionsOf(column: readonly string[]): ReadonlyMap<string, number> {
  return new Map(column.map((nodeId, index) => [nodeId, index]))
}

function sortColumn(
  column: readonly string[],
  fixed: ReadonlyMap<string, number>,
  neighbors: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const barycenters = new Map<string, number>()
  column.forEach((nodeId, index) => {
    const adjacent = (neighbors.get(nodeId) ?? []).flatMap((neighbor) => {
      const position = fixed.get(neighbor)
      return position === undefined ? [] : [position]
    })
    barycenters.set(
      nodeId,
      adjacent.length === 0 ? index : adjacent.reduce((sum, p) => sum + p, 0) / adjacent.length,
    )
  })
  return [...column].sort((left, right) => {
    const byCenter = (barycenters.get(left) ?? 0) - (barycenters.get(right) ?? 0)
    return byCenter !== 0 ? byCenter : left.localeCompare(right)
  })
}

function orderColumns(
  columns: readonly (readonly string[])[],
  edges: readonly DagEdge[],
): readonly (readonly string[])[] {
  const upstream = new Map<string, string[]>()
  const downstream = new Map<string, string[]>()
  for (const edge of edges) {
    upstream.set(edge.to, [...(upstream.get(edge.to) ?? []), edge.from])
    downstream.set(edge.from, [...(downstream.get(edge.from) ?? []), edge.to])
  }
  const ordered = columns.map((column) => [...column])
  for (let sweep = 0; sweep < SWEEP_COUNT; sweep += 1) {
    if (sweep % 2 === 0) {
      for (let i = 1; i < ordered.length; i += 1) {
        ordered[i] = [...sortColumn(ordered[i] ?? [], positionsOf(ordered[i - 1] ?? []), upstream)]
      }
    } else {
      for (let i = ordered.length - 2; i >= 0; i -= 1) {
        ordered[i] = [
          ...sortColumn(ordered[i] ?? [], positionsOf(ordered[i + 1] ?? []), downstream),
        ]
      }
    }
  }
  return ordered
}

function portOffsets(
  edges: readonly EdgeEndpoints[],
  portOf: (edge: EdgeEndpoints) => string,
  oppositeY: (edge: EdgeEndpoints) => number,
): ReadonlyMap<string, number> {
  const byPort = new Map<string, EdgeEndpoints[]>()
  for (const edge of edges) {
    byPort.set(portOf(edge), [...(byPort.get(portOf(edge)) ?? []), edge])
  }
  const offsets = new Map<string, number>()
  for (const group of byPort.values()) {
    const sorted = [...group].sort(
      (l, r) => oppositeY(l) - oppositeY(r) || l.key.localeCompare(r.key),
    )
    sorted.forEach((edge, index) => {
      offsets.set(edge.key, (index - (sorted.length - 1) / 2) * PORT_FAN_STEP)
    })
  }
  return offsets
}

function routeEdges(run: DagRun, placements: ReadonlyMap<string, LayoutNode>): LayoutEdge[] {
  const seen = new Set<string>()
  const endpoints: EdgeEndpoints[] = []
  for (const edge of run.edges) {
    const key = edgeKey(edge.from, edge.to)
    const from = placements.get(edge.from)
    const to = placements.get(edge.to)
    if (seen.has(key) || from === undefined || to === undefined) continue
    seen.add(key)
    endpoints.push({
      key,
      fromId: edge.from,
      toId: edge.to,
      sourceX: from.x + NODE_WIDTH,
      sourceY: from.y + NODE_HEIGHT / 2,
      targetX: to.x,
      targetY: to.y + NODE_HEIGHT / 2,
    })
  }
  const sourceOffsets = portOffsets(
    endpoints,
    (e) => e.fromId,
    (e) => e.targetY,
  )
  const targetOffsets = portOffsets(
    endpoints,
    (e) => e.toId,
    (e) => e.sourceY,
  )
  return endpoints.map((edge) => ({
    key: edge.key,
    from: { x: edge.sourceX, y: edge.sourceY + (sourceOffsets.get(edge.key) ?? 0) },
    to: { x: edge.targetX, y: edge.targetY + (targetOffsets.get(edge.key) ?? 0) },
  }))
}

function controlOffset(from: LayoutPoint, to: LayoutPoint): number {
  return Math.min(Math.max((to.x - from.x) / 2, MIN_CONTROL_OFFSET), MAX_CONTROL_OFFSET)
}

export function edgePath(from: LayoutPoint, to: LayoutPoint): string {
  const offset = controlOffset(from, to)
  return `M ${from.x} ${from.y} C ${from.x + offset} ${from.y}, ${to.x - offset} ${to.y}, ${to.x} ${to.y}`
}

/** Points on the SAME cubic as {@link edgePath}, so lights never drift off their edge. */
export function sampleEdgePoints(
  from: LayoutPoint,
  to: LayoutPoint,
  count: number,
  ease: (t: number) => number = (t) => t,
): readonly LayoutPoint[] {
  if (count < 2) return [from, to]
  const offset = controlOffset(from, to)
  const c1 = { x: from.x + offset, y: from.y }
  const c2 = { x: to.x - offset, y: to.y }
  return Array.from({ length: count }, (_, index) => {
    const t = ease(index / (count - 1))
    const inv = 1 - t
    const a = inv * inv * inv
    const b = 3 * inv * inv * t
    const c = 3 * inv * t * t
    const d = t * t * t
    return {
      x: a * from.x + b * c1.x + c * c2.x + d * to.x,
      y: a * from.y + b * c1.y + c * c2.y + d * to.y,
    }
  })
}

/** Every node on a dependency path THROUGH `nodeId` — transitive both ways. */
export function connectedNodeIds(edges: readonly DagEdge[], nodeId: string): ReadonlySet<string> {
  const downstream = new Map<string, string[]>()
  const upstream = new Map<string, string[]>()
  for (const edge of edges) {
    downstream.set(edge.from, [...(downstream.get(edge.from) ?? []), edge.to])
    upstream.set(edge.to, [...(upstream.get(edge.to) ?? []), edge.from])
  }
  const connected = new Set<string>([nodeId])
  const walk = (adjacency: ReadonlyMap<string, string[]>) => {
    const queue = [nodeId]
    while (queue.length > 0) {
      const current = queue.pop()
      if (current === undefined) break
      for (const next of adjacency.get(current) ?? []) {
        if (connected.has(next)) continue
        connected.add(next)
        queue.push(next)
      }
    }
  }
  walk(downstream)
  walk(upstream)
  return connected
}

export function computeDagLayout(run: DagRun): DagLayout {
  const ordered = orderColumns(declaredColumns(run), run.edges)
  const nodeById = new Map(run.nodes.map((node) => [node.id, node]))
  const nodes: LayoutNode[] = []
  ordered.forEach((column, waveIndex) => {
    column.forEach((nodeId, row) => {
      const node = nodeById.get(nodeId)
      if (node !== undefined) {
        nodes.push({
          node,
          waveIndex,
          x: waveIndex * (NODE_WIDTH + COLUMN_GAP),
          y: WAVE_HEADER_HEIGHT + row * (NODE_HEIGHT + ROW_GAP),
        })
      }
    })
  })
  const rowCount = Math.max(0, ...ordered.map((column) => column.length))
  const placements = new Map(nodes.map((placement) => [placement.node.id, placement]))
  return {
    width: ordered.length === 0 ? 0 : ordered.length * (NODE_WIDTH + COLUMN_GAP) - COLUMN_GAP,
    height:
      nodes.length === 0
        ? 0
        : WAVE_HEADER_HEIGHT + rowCount * NODE_HEIGHT + (rowCount - 1) * ROW_GAP,
    nodes,
    edges: routeEdges(run, placements),
  }
}
