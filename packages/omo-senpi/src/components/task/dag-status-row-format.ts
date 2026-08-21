import { excerptRendererText, normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"

const MAX_NODE_ROWS = 12
const ACTIVITY_MAX = 40
const LABEL_MAX = 32

// Structural mirrors of the dag domain contract (senpi-task/src/dag/types.ts). Declared locally so
// the widget stays a read-only consumer of whatever DagManager instance the extension wires in.
export type DagStatusRoute =
  | { readonly kind: "category"; readonly category: string }
  | { readonly kind: "agent"; readonly agent: string; readonly model?: string }

export interface DagStatusNode {
  readonly id: string
  readonly label?: string
  readonly state: string
  readonly route: DagStatusRoute
  readonly dependsOn: readonly string[]
  // Display attempt; absent on legacy records, 1 for a node that ran exactly once.
  readonly attempt?: number
}

export interface DagStatusWave {
  readonly index: number
  readonly nodeIds: readonly string[]
}

export interface DagStatusRunSnapshot {
  readonly runId: string
  readonly name: string
  readonly status: string
  readonly nodes: readonly DagStatusNode[]
  readonly waves: readonly DagStatusWave[]
}

const TERMINAL_NODE_STATES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "skipped"])

const NODE_ICONS: Readonly<Record<string, string>> = {
  running: "▶",
  completed: "✓",
  failed: "✗",
  skipped: "⊘",
  cancelled: "⊘",
  paused: "⏸",
}

export function runRows(run: DagStatusRunSnapshot, activity: ReadonlyMap<string, string> | undefined): string[] {
  const rows = [runHeaderRow(run)]
  const shown = run.nodes.slice(0, MAX_NODE_ROWS)
  for (const node of shown) rows.push(nodeRow(node, activity))
  const overflow = run.nodes.length - shown.length
  if (overflow > 0) rows.push(`  +${overflow} more`)
  return rows
}

function runHeaderRow(run: DagStatusRunSnapshot): string {
  const icon = NODE_ICONS[run.status] ?? "○"
  const name = excerptRendererText(normalizeRendererText(run.name), LABEL_MAX)
  return `${icon} ${name} ${normalizeRendererText(run.status)} ${waveLabel(run)} ${countsLabel(run)}`
}

// Current wave = the first wave still holding a nonterminal node; a fully settled run reads y/y.
function waveLabel(run: DagStatusRunSnapshot): string {
  const total = run.waves.length
  if (total === 0) return "wave 0/0"
  const states = new Map(run.nodes.map((node) => [node.id, node.state] as const))
  const openIndex = run.waves.findIndex((wave) =>
    wave.nodeIds.some((nodeId) => !TERMINAL_NODE_STATES.has(states.get(nodeId) ?? "pending")),
  )
  const current = openIndex === -1 ? total : openIndex + 1
  return `wave ${current}/${total}`
}

function countsLabel(run: DagStatusRunSnapshot): string {
  let completed = 0
  let running = 0
  let failed = 0
  for (const node of run.nodes) {
    if (node.state === "completed") completed += 1
    else if (node.state === "running") running += 1
    else if (node.state === "failed") failed += 1
  }
  const tokens = [`${completed}/${run.nodes.length} done`]
  if (running > 0) tokens.push(`${running} running`)
  if (failed > 0) tokens.push(`${failed} failed`)
  return tokens.join(", ")
}

function nodeRow(node: DagStatusNode, activity: ReadonlyMap<string, string> | undefined): string {
  const icon = NODE_ICONS[node.state] ?? "○"
  const label = excerptRendererText(normalizeRendererText(node.label ?? node.id), LABEL_MAX)
  const parts = [`  ${icon}`, label, routeLabel(node.route)]
  // A re-run node is the exception worth a badge; a first attempt stays unmarked.
  if ((node.attempt ?? 1) > 1) parts.push(`x${node.attempt}`)
  // Activity is live telemetry: it belongs to a running node only, never to a settled one.
  const live = node.state === "running" ? activity?.get(node.id) : undefined
  if (live !== undefined) parts.push(excerptRendererText(normalizeRendererText(live), ACTIVITY_MAX))
  return parts.join(" ")
}

function routeLabel(route: DagStatusRoute): string {
  if (route.kind === "agent") {
    const agent = normalizeRendererText(route.agent)
    return route.model === undefined ? `agent:${agent}` : `agent:${agent}(${normalizeRendererText(route.model)})`
  }
  return `category:${normalizeRendererText(route.category)}`
}
