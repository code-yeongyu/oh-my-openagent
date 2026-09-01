import { formatDurationHuman } from "@oh-my-opencode/utils"
import { excerptRendererText, normalizeRendererText, rendererVisibleWidth } from "@oh-my-opencode/senpi-task/renderer-text"

const MAX_NODE_ROWS = 12
const LABEL_MIN = 16
const LABEL_MAX = 32
const ROUTE_MIN = 12
const ACTIVITY_MIN = 8
// Below this width the activity segment is dropped entirely so a narrow terminal still reads
// icon + label + route + elapsed, mirroring the task widget's LIVE_*_MIN collapse philosophy.
const NARROW_ROW_WIDTH = 60
// Ceiling when no terminal width is known; matches the task widget's LIVE_WIDGET_LINE_MAX.
const NODE_ROW_WIDTH_MAX = 220
const SEPARATOR = " · "

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
  // Enqueue time, always written by the engine (dag/types.ts). Drives the waiting clock for a node
  // that has not started yet; absent only on legacy records, which simply show no waiting token.
  readonly createdAt?: string
  readonly startedAt?: string
  readonly completedAt?: string
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
  // Resume lease owner, written by the dag recovery claim and cleared on shutdown pause. A paused
  // run still carrying a LIVE pid is mid-resume, not idle; absent on legacy records.
  readonly leaseHolderPid?: number
}

export interface DagRunRowsOptions {
  // Visible terminal width; unknown or non-finite falls back to NODE_ROW_WIDTH_MAX.
  readonly maxWidth?: number
  // Rendering time for live elapsed labels; defaults to Date.now().
  readonly now?: number
  // Liveness probe for the resume lease holder; defaults to a signal-0 existence check.
  readonly isProcessAlive?: (pid: number) => boolean
}

const TERMINAL_NODE_STATES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "skipped"])

// Display priority: what is executing now leads, then what is waiting, then how it settled
// (newest first so a late failure or completion is never pushed off screen by old history).
const NODE_STATE_RANKS: Readonly<Record<string, number>> = {
  running: 0,
  scheduled: 1,
  pending: 1,
  blocked: 1,
  paused: 1,
  failed: 2,
  completed: 3,
  skipped: 4,
  cancelled: 4,
}

const NODE_ICONS: Readonly<Record<string, string>> = {
  running: "▶",
  // The pre-running states are visually distinct on purpose: collapsing them into one fallback
  // glyph is what made a booting graph read as a dead one.
  pending: "◌",
  scheduled: "◔",
  blocked: "⊟",
  completed: "✓",
  failed: "✗",
  skipped: "⊘",
  cancelled: "⊘",
  paused: "⏸",
}

// The run-level pause family is deliberately neutral: a ⏸ beside a lane rendering ▶ reads as a
// contradiction during the resume-reconcile window, so the header claims nothing about motion.
const PAUSED_RUN_ICON = "·"

export function runRows(run: DagStatusRunSnapshot, activity: ReadonlyMap<string, string> | undefined, options?: DagRunRowsOptions): string[] {
  const renderedAt = options?.now ?? Date.now()
  const maxWidth = boundedRowWidth(options?.maxWidth)
  const rows = [runHeaderRow(run, options?.isProcessAlive ?? isProcessAlive)]
  const shown = selectNodeRows(run.nodes)
  for (const node of shown) rows.push(nodeRow(node, activity, renderedAt, maxWidth))
  const overflow = run.nodes.length - shown.length
  if (overflow > 0) rows.push(`  +${overflow} more`)
  return rows
}

function boundedRowWidth(maxWidth: number | undefined): number {
  if (maxWidth === undefined || !Number.isFinite(maxWidth) || maxWidth <= 0) return NODE_ROW_WIDTH_MAX
  return Math.min(NODE_ROW_WIDTH_MAX, Math.floor(maxWidth))
}

function nodeDisplayRank(node: DagStatusNode): number {
  return NODE_STATE_RANKS[node.state] ?? 1
}

function startedAtMs(node: DagStatusNode): number {
  const parsed = node.startedAt === undefined ? Number.NaN : Date.parse(node.startedAt)
  // An untimestamped running node sorts after timed siblings rather than masquerading as oldest.
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function recencyMs(node: DagStatusNode): number {
  const stamp = node.completedAt ?? node.startedAt
  const parsed = stamp === undefined ? Number.NaN : Date.parse(stamp)
  return Number.isFinite(parsed) ? parsed : 0
}

// Running nodes are exempt from the row budget: with dozens executing at once, the screen must
// tell that story. The budget then caps the remaining buckets, declaration-stable within a rank.
function selectNodeRows(nodes: readonly DagStatusNode[]): readonly DagStatusNode[] {
  const ordered = nodes.toSorted((a, b) => {
    const rankDelta = nodeDisplayRank(a) - nodeDisplayRank(b)
    if (rankDelta !== 0) return rankDelta
    if (nodeDisplayRank(a) === 0) return startedAtMs(a) - startedAtMs(b)
    return recencyMs(b) - recencyMs(a)
  })
  const runningCount = ordered.reduce((count, node) => count + (nodeDisplayRank(node) === 0 ? 1 : 0), 0)
  return ordered.slice(0, Math.max(MAX_NODE_ROWS, runningCount))
}

function runHeaderRow(run: DagStatusRunSnapshot, isAlive: (pid: number) => boolean): string {
  const paused = run.status === "paused"
  const icon = paused ? PAUSED_RUN_ICON : (NODE_ICONS[run.status] ?? "○")
  const name = excerptRendererText(normalizeRendererText(run.name), LABEL_MAX)
  const status = paused ? pausedStatusText(run, isAlive) : normalizeRendererText(run.status)
  return `${icon} ${name} ${status} ${waveLabel(run)} ${countsLabel(run)}`
}

// Priority is deliberate. A live lease means another process already claimed this run and is
// reconciling it, so "paused" would be stale by the time it is painted. Without that lease, nodes
// still recorded as running are stranded work the header must own rather than hide behind "paused".
function pausedStatusText(run: DagStatusRunSnapshot, isAlive: (pid: number) => boolean): string {
  if (run.leaseHolderPid !== undefined && isAlive(run.leaseHolderPid)) return "resuming"
  const running = run.nodes.reduce((count, node) => count + (node.state === "running" ? 1 : 0), 0)
  return running > 0 ? `suspended · ${running} active` : "paused"
}

// Signal 0 probes existence without delivering anything. ESRCH is the only "gone" answer: EPERM
// means the pid exists under another uid, which still counts as a live lease holder.
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
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

// Live nodes tick against the render clock; settled nodes freeze at their completedAt so a late
// repaint never rewrites history. A node that has not started yet falls back to a WAITING clock
// measured from its enqueue time, so a graph whose children are still booting still visibly moves —
// a byte-identical row across repaints is what makes users conclude the run died.
function elapsedLabel(node: DagStatusNode, now: number): string | undefined {
  const started = node.startedAt === undefined ? Number.NaN : Date.parse(node.startedAt)
  if (!Number.isFinite(started)) return waitingLabel(node, now)
  let end: number = now
  if (TERMINAL_NODE_STATES.has(node.state) && node.completedAt !== undefined) {
    const completed = Date.parse(node.completedAt)
    if (Number.isFinite(completed)) end = completed
  }
  return formatDurationHuman(Math.max(0, end - started))
}

// A node still waiting to run reports how long it has been waiting. Terminal states are excluded:
// a skipped or cancelled node never started and must not appear to be accruing time.
function waitingLabel(node: DagStatusNode, now: number): string | undefined {
  if (TERMINAL_NODE_STATES.has(node.state)) return undefined
  const created = node.createdAt === undefined ? Number.NaN : Date.parse(node.createdAt)
  if (!Number.isFinite(created)) return undefined
  return `waiting ${formatDurationHuman(Math.max(0, now - created))}`
}

// Assembles `  <icon> <label> · <route> · [xN] · [<activity>] · [<elapsed>]` within maxWidth,
// mirroring the task widget's formatLiveBackgroundRow budget: every part keeps a floor, the
// activity absorbs the slack (the plan's point: long latest-activity lines get the room), then
// route, then label up to LABEL_MAX.
function nodeRow(node: DagStatusNode, activity: ReadonlyMap<string, string> | undefined, now: number, maxWidth: number): string {
  const icon = NODE_ICONS[node.state] ?? "○"
  const head = `  ${icon} `
  const label = normalizeRendererText(node.label ?? node.id)
  const route = routeLabel(node.route)
  // A re-run node is the exception worth a badge; a first attempt stays unmarked.
  const attempt = (node.attempt ?? 1) > 1 ? `x${node.attempt}` : undefined
  const elapsed = elapsedLabel(node, now)
  // Activity is live telemetry: any node that has not settled may carry it, including one still
  // spawning its child. Settled nodes never do — their story is told by the terminal icon.
  const live = TERMINAL_NODE_STATES.has(node.state) ? undefined : activity?.get(node.id)
  const activityText = live === undefined ? undefined : normalizeRendererText(live)
  const showActivity = activityText !== undefined && maxWidth >= NARROW_ROW_WIDTH

  const floorParts = [
    excerptRendererText(label, LABEL_MIN),
    excerptRendererText(route, ROUTE_MIN),
    ...(attempt === undefined ? [] : [attempt]),
    ...(showActivity ? [excerptRendererText(activityText, ACTIVITY_MIN)] : []),
    ...(elapsed === undefined ? [] : [elapsed]),
  ]
  let remaining = Math.max(0, maxWidth - rendererVisibleWidth(head + floorParts.join(SEPARATOR)))
  let activityWidth = 0
  if (showActivity) {
    activityWidth = Math.min(rendererVisibleWidth(activityText), ACTIVITY_MIN + remaining)
    remaining -= Math.max(0, activityWidth - ACTIVITY_MIN)
  }
  const routeWidth = Math.min(rendererVisibleWidth(route), ROUTE_MIN + remaining)
  remaining -= Math.max(0, routeWidth - ROUTE_MIN)
  const labelWidth = Math.min(LABEL_MAX, LABEL_MIN + remaining)
  const parts = [
    excerptRendererText(label, labelWidth),
    excerptRendererText(route, routeWidth),
    ...(attempt === undefined ? [] : [attempt]),
    ...(showActivity ? [excerptRendererText(activityText, activityWidth)] : []),
    ...(elapsed === undefined ? [] : [elapsed]),
  ]
  // The head stays outside the excerpt clamp: normalizing the whole row would eat the indent.
  const contentWidth = Math.max(0, maxWidth - rendererVisibleWidth(head))
  return head + excerptRendererText(parts.join(SEPARATOR), contentWidth)
}

function routeLabel(route: DagStatusRoute): string {
  if (route.kind === "agent") {
    const agent = normalizeRendererText(route.agent)
    return route.model === undefined ? `agent:${agent}` : `agent:${agent}(${normalizeRendererText(route.model)})`
  }
  return `category:${normalizeRendererText(route.category)}`
}
