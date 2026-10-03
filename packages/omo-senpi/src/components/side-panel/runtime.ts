import { homedir } from "node:os"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"
import type { OmoSidePanelSettings } from "@oh-my-opencode/omo-config-core"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import {
  FILE_VISIBLE_ROWS,
  GIT_REFRESH_FLOOR_MS,
  GOAL_OBJECTIVE_COLUMNS,
  LIVE_REFRESH_MS,
  MEMORY_REFRESH_FLOOR_MS,
  TOOL_VISIBLE_ROWS,
} from "./constants"
import { openFileDiff, runDiffCommand, type PanelCommandContext } from "./commands"
import { panelContextFrom } from "./context"
import { asRecord } from "./guards"
import { panelFactsFrom, type PanelHostFacts } from "./data/facts"
import { childOutputRows } from "./data/child-output"
import { createPanelGoalReader } from "./data/goal"
import { createPanelMemoryReader } from "./data/memory"
import { panelChildrenFromRecords, type PanelTaskRecord } from "./data/task-records"
import { readGitStatus, type PanelExec } from "./git/read"
import { wrapVisible } from "./format/truncate"
import { findGitRoot, readGitBranch } from "./git/repo"
import { createPanelHostSurface } from "./host-surface"
import type { PanelAction } from "./links"
import { openPanelViewer } from "./popups/open"
import { buildAgentCardRows } from "./sections/agents"
import { buildMemoryDetailRows } from "./sections/memory"
import type { PanelGitStatus } from "./sections/files"
import { buildPanelRows } from "./rows"
import { createPanelStore } from "./store"
import type {
  PanelGoal,
  PanelHostSurface,
  PanelMemory,
  PanelMemoryIdentity,
  PanelRow,
  PanelTimerHandle,
  PanelTimers,
  PanelUi,
} from "./types"
import { createCredentialReader } from "./usage/credentials"
import { createUsageFetch, type UsageFetch } from "./usage/http"
import { createUsagePoller, type UsageCredentialSource, type UsagePoller } from "./usage/poller"
import { usageCachePath } from "./usage/cache"
import { resolvePanelWidth } from "./width"

export interface SidePanelRuntimeOptions {
  /** Injectable so tests can attach a renderer synchronously. */
  readonly defer?: (callback: () => void) => void
  /** Injectable so the live-refresh cadence is deterministic under test. */
  readonly timers?: PanelTimers
  readonly now?: () => number
  /** Delegated children come from the task engine's own store; injected here for tests. */
  readonly readTaskRecords?: (cwd: string) => readonly PanelTaskRecord[] | Promise<readonly PanelTaskRecord[]>
  /** The session's goal, read from the host's store path; injected so tests never read a disk. */
  readonly readGoal?: (path: string | undefined) => PanelGoal | undefined
  /** Which memory identity this session writes to; injected so tests never probe a memory root. */
  readonly resolveMemory?: (cwd: string) => PanelMemoryIdentity | undefined
  /** What memory is holding for this session; injected so tests never read a disk. */
  readonly readMemory?: (
    identity: PanelMemoryIdentity | undefined,
    sessionId: string | undefined,
  ) => Promise<PanelMemory | undefined>
  /** A clicked child shows its own work; injected so tests never read a state dir. */
  readonly readChildOutput?: (cwd: string, taskId: string) => Promise<readonly PanelRow[]>
  /** Injectable so the git reads are exercised without spawning anything. */
  readonly exec?: PanelExec
  readonly findGitRoot?: (cwd: string) => string | undefined
  readonly readGitBranch?: (root: string) => string | undefined
  /** Ports for the one section that talks to the network, so tests never do. */
  readonly usage?: {
    readonly fetch?: UsageFetch
    readonly readCredentials?: () => UsageCredentialSource
    readonly cachePath?: string
  }
}

const globalTimers: PanelTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
}

/** What the registration shell in `index.ts` hands each event to, once the panel is on. */
export interface SidePanelController {
  sessionStart(settings: OmoSidePanelSettings, eventCtx: unknown): Promise<undefined>
  refresh(eventCtx: unknown): Promise<undefined>
  toolStart(payload: unknown, eventCtx: unknown): Promise<undefined>
  toolEnd(): Promise<undefined>
  input(): undefined
  teardown(): undefined
  runDiffCommand(commandCtx: PanelCommandContext): Promise<void>
}

/**
 * The side panel: an opt-in right column carrying what the session is doing.
 *
 * This module is the panel's implementation and ships as its own bundle (`omo-side-panel.js`):
 * `index.ts` imports it on the first session that has the panel on, so a session without the
 * panel never loads a byte of it. The host coupling lives entirely in `host-surface.ts`, and every
 * row is assembled by pure builders that never touch the host.
 */
export function createSidePanelController(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  options: SidePanelRuntimeOptions = {},
): SidePanelController {
  const timers = options.timers ?? globalTimers
  const now = options.now ?? Date.now
  const store = createPanelStore(now)
  const readTaskRecords = options.readTaskRecords ?? createRecordReader()
  const readChildOutput = options.readChildOutput ?? createChildOutputReader()
  const readGoal = options.readGoal ?? createPanelGoalReader()
  const resolveMemory = options.resolveMemory ?? defaultResolveMemory
  const readMemory = options.readMemory ?? createPanelMemoryReader()
  const locateGit = options.findGitRoot ?? findGitRoot
  const branchOf = options.readGitBranch ?? readGitBranch
  // Bound to the host so the method keeps its own receiver, the way the memory palace
  // command reaches `ctx.exec`.
  const hostExec = pi.exec
  const exec: PanelExec | undefined =
    options.exec ??
    (hostExec === undefined
      ? undefined
      : (command, args, execOptions) => hostExec.call(pi, command, args, execOptions))
  let git: PanelGitStatus | undefined
  let gitRoot: string | undefined
  let branch: string | undefined
  let gitReadAt = 0
  let active: OmoSidePanelSettings | undefined
  // Bumped on teardown: a read that started for one session must not land in the next.
  let epoch = 0

  let surface: PanelHostSurface | undefined
  let usage: UsagePoller | undefined
  let hostUi: PanelUi | undefined
  let goal: PanelGoal | undefined
  let memory: PanelMemory | undefined
  let memoryIdentity: PanelMemoryIdentity | undefined
  let memoryReadAt = 0
  let facts: PanelHostFacts = {}
  let startedAt: number | undefined
  let liveTimer: PanelTimerHandle | undefined
  const cwd = pi.cwd ?? process.cwd()

  const anyChildRunning = (): boolean =>
    store.state().children.some((child) => child.status === "running" || child.status === "queued")

  const stopLiveRefresh = (): void => {
    if (liveTimer === undefined) return
    timers.clear(liveTimer)
    liveTimer = undefined
  }

  // A running child's elapsed time has to tick without an event to hang it on; when nothing
  // is running the timer stops, so an idle session costs no wakeups.
  const scheduleLiveRefresh = (): void => {
    if (liveTimer !== undefined || surface === undefined || !anyChildRunning()) return
    liveTimer = timers.set(() => {
      liveTimer = undefined
      surface?.requestRender()
      scheduleLiveRefresh()
    }, LIVE_REFRESH_MS)
  }

  /**
   * Git is read on a floor rather than a watcher: a burst of edits inside one turn would
   * otherwise spawn a process per tool call, and a recursive fs watch burns the machine's
   * scarce inotify instances for a section that only needs to be right within a second.
   */
  const refreshGit = async (force: boolean): Promise<void> => {
    if (gitRoot === undefined || exec === undefined) return
    const at = now()
    if (!force && at - gitReadAt < GIT_REFRESH_FLOOR_MS) return
    gitReadAt = at
    branch = branchOf(gitRoot)
    const started = epoch
    const next = await readGitStatus(exec, gitRoot)
    if (next === undefined || started !== epoch) return
    git = next
    surface?.requestRender()
  }

  /**
   * Memory sits on a floor for the same reason git does: the block costs the park read plus a
   * directory listing of the facts queue, and neither a park transition (three failed
   * reflection runs) nor the backlog can move between two tool calls of one turn.
   */
  const refreshMemory = async (force: boolean): Promise<void> => {
    if (memoryIdentity === undefined) return
    const at = now()
    if (!force && at - memoryReadAt < MEMORY_REFRESH_FLOOR_MS) return
    memoryReadAt = at
    const started = epoch
    const next = await readMemory(memoryIdentity, facts.sessionId)
    if (next === undefined || started !== epoch) return
    memory = next
    surface?.requestRender()
  }

  const refreshChildren = async (): Promise<void> => {
    const sessionId = facts.sessionId
    // Children feed the agents block and the session's child spend; with both off, nothing reads them.
    if (sessionId === undefined || active === undefined || !(active.sections.agents || active.sections.session)) return
    const started = epoch
    let records: readonly PanelTaskRecord[] = []
    try {
      records = await readTaskRecords(cwd)
    } catch (error) {
      ctx.logger.debug?.("omo-senpi side panel: task records unreadable", { error: String(error) })
      return
    }
    if (started !== epoch) return
    let changed = false
    for (const update of panelChildrenFromRecords(records, sessionId)) {
      if (store.upsertChild(update)) changed = true
    }
    if (changed) {
      surface?.requestRender()
      scheduleLiveRefresh()
    }
  }

  /**
   * What an activated row opens. A clicked row and `/side-panel-diff` land in the same
   * viewer, so there is exactly one place that knows what a row means.
   */
  const openAction = async (action: PanelAction): Promise<void> => {
    const ui = hostUi
    if (ui === undefined) return
    if (action.kind === "file") {
      const status = git
      if (status === undefined || exec === undefined) return
      const file = status.files.find((entry) => entry.path === action.path)
      if (file === undefined) {
        // The column can be a moment behind the tree: a file may have been committed since.
        ui.notify(`${action.path} is no longer listed as changed.`, "info")
        return
      }
      await openFileDiff(ui, exec, status, file)
      return
    }
    if (action.kind === "memory") {
      if (memory === undefined) return
      await openPanelViewer(ui, "memory", buildMemoryDetailRows(memory, now()))
      return
    }
    if (action.kind === "goal") {
      if (goal === undefined) return
      await openPanelViewer(
        ui,
        "goal",
        wrapVisible(goal.objective, GOAL_OBJECTIVE_COLUMNS).map((text) => ({ text })),
      )
      return
    }
    const child = store.state().children.find((entry) => entry.id === action.id)
    if (child === undefined) return
    // The card is the header; what the child actually did is the body, and the point.
    const output = await readChildOutput(cwd, child.id)
    const rows: readonly PanelRow[] = [...buildAgentCardRows(child, now()), { text: "" }, ...output]
    await openPanelViewer(ui, `${child.name}  (agent)`, rows)
  }

  const refresh = async (eventCtx: unknown): Promise<undefined> => {
    if (surface === undefined) return undefined
    facts = { ...facts, ...panelFactsFrom(eventCtx) }
    // senpi publishes no goal event an extension can subscribe to, so the store is re-read on
    // the ordinary refresh; an unchanged file costs one stat and nothing more.
    if (active?.sections.goal === true) goal = readGoal(facts.goalStoreFile)
    surface.requestRender()
    // A credential-pool rotation must not sit behind the poll interval: the numbers on screen
    // would keep naming the account the session just moved off. This pass is self-gating - it
    // reaches the network only when the entry is stale or the serving account changed - so it
    // costs two small file reads on an ordinary turn.
    void usage?.pollOnce()
    await Promise.all([refreshChildren(), refreshGit(false), refreshMemory(false)])
    scheduleLiveRefresh()
    return undefined
  }

  const teardown = (): undefined => {
    epoch += 1
    stopLiveRefresh()
    usage?.stop()
    usage = undefined
    surface?.dispose()
    surface = undefined
    hostUi = undefined
    goal = undefined
    memory = undefined
    memoryIdentity = undefined
    memoryReadAt = 0
    // Everything below belongs to the session being left; the next one starts from nothing.
    store.reset()
    git = undefined
    gitRoot = undefined
    branch = undefined
    gitReadAt = 0
    facts = {}
    startedAt = undefined
    active = undefined
    return undefined
  }

  const sessionStart = async (settings: OmoSidePanelSettings, eventCtx: unknown): Promise<undefined> => {
    if (surface !== undefined) return undefined
    const context = panelContextFrom(eventCtx)
    if (context === undefined) {
      ctx.logger.debug?.("omo-senpi side panel: host context carries no ui, staying dark")
      return undefined
    }
    facts = panelFactsFrom(eventCtx)
    active = settings
    if (settings.sections.goal) goal = readGoal(facts.goalStoreFile)
    startedAt = now()
    hostUi = context.ui
    surface = createPanelHostSurface({
      context,
      source: {
        rows: (width) =>
          buildPanelRows(
            {
              sections: settings.sections,
              facts,
              state: store.state(),
              location: { cwd, ...(branch === undefined ? {} : { branch }) },
              ...(startedAt === undefined ? {} : { startedAt }),
              now: now(),
              toolRows: TOOL_VISIBLE_ROWS,
              fileRows: FILE_VISIBLE_ROWS,
              ...(git === undefined ? {} : { git }),
              ...(goal === undefined ? {} : { goal }),
              ...(memory === undefined ? {} : { memory }),
              ...(usage === undefined ? {} : { usage: usage.snapshot() }),
              home: homedir(),
            },
            width,
          ),
      },
      width: (terminalWidth) => resolvePanelWidth(settings.width, terminalWidth),
      minColumns: settings.min_columns,
      logger: ctx.logger,
      clickable: settings.clickable,
      onAction: (action) => {
        void openAction(action).catch((error: unknown) => {
          ctx.logger.debug?.("omo-senpi side panel: row action failed", { error: String(error) })
        })
      },
      ...(options.defer === undefined ? {} : { defer: options.defer }),
    })
    // git runs three processes per refresh, so a files section that is off never finds a root.
    gitRoot = settings.sections.files ? locateGit(cwd) : undefined
    if (gitRoot !== undefined && exec === undefined) {
      ctx.logger.debug?.("omo-senpi side panel: host exposes no exec, the files section stays empty")
    }
    // Nothing reaches the network unless the section that shows it is on.
    if (settings.sections.usage) {
      usage = createUsagePoller({
        fetch: options.usage?.fetch ?? createUsageFetch(),
        readCredentials: options.usage?.readCredentials ?? createCredentialReader(),
        cachePath: options.usage?.cachePath ?? usageCachePath(),
        pollMs: settings.usage_poll_seconds * 1_000,
        now,
        timers,
        onChange: () => surface?.requestRender(),
        logger: ctx.logger,
      })
      usage.start()
    }
    // Resolving an identity probes the memory root, so it happens only for a section that is on.
    if (settings.sections.memory) memoryIdentity = resolveMemory(cwd)
    const kind = surface.mount()
    await Promise.all([refreshChildren(), refreshGit(true), refreshMemory(true)])
    scheduleLiveRefresh()
    ctx.logger.debug?.("omo-senpi side panel mounted", { kind, width: settings.width })
    return undefined
  }

  return {
    sessionStart,
    // Turn boundaries carry fresh usage totals and child state.
    refresh,
    // A tool start is the only signal that says what the session is doing right now.
    async toolStart(payload: unknown, eventCtx: unknown): Promise<undefined> {
      if (surface === undefined) return undefined
      const call = toolCallFrom(payload, now())
      if (call !== undefined) store.recordTool(call)
      return await refresh(eventCtx)
    },
    // A tool that mutated the tree is the signal that git has something new to say.
    async toolEnd(): Promise<undefined> {
      await refreshGit(false)
      return undefined
    },
    // Tool activity is per-exchange context: the next user turn starts a fresh list.
    input(): undefined {
      store.clearTools()
      return undefined
    },
    teardown,
    runDiffCommand: (commandCtx) =>
      runDiffCommand({ status: () => git, exec, mounted: () => surface !== undefined }, commandCtx),
  }
}

function toolCallFrom(payload: unknown, at: number): { name: string; detail?: string; at: number } | undefined {
  const record = asRecord(payload)
  if (record === undefined) return undefined
  const name = record["toolName"] ?? record["name"]
  if (typeof name !== "string" || name === "") return undefined
  const detail = toolDetail(record["args"] ?? record["input"])
  return { name, ...(detail === undefined ? {} : { detail }), at }
}

/** One short, recognisable argument: the path or command the call is about. */
function toolDetail(args: unknown): string | undefined {
  const record = asRecord(args)
  if (record === undefined) return undefined
  for (const key of ["file_path", "path", "command", "pattern", "query", "url"]) {
    const value = record[key]
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

/**
 * The memory identity this session writes to, resolved exactly the way the memory component
 * resolves it (`resolveMemoryIdentity(memory.agent, cwd, env)`): a column naming a different
 * identity than the one being written to would be worse than no column at all. The resolver is
 * pure apart from two `exists` probes that keep a legacy directory attached, so it runs once on
 * mount rather than on the refresh path.
 */
function defaultResolveMemory(cwd: string): PanelMemoryIdentity | undefined {
  try {
    const settings = loadSenpiOmoConfig({ cwd }).config.memory
    if (settings?.enabled === false) return undefined
    const identity = resolveMemoryIdentity(settings?.agent, cwd, process.env)
    return {
      id: identity.id,
      reflectionDir: identity.paths.reflection,
      recallDir: identity.paths.recall,
      factsQueueDir: identity.paths.factsQueue,
      recallLedgerDir: identity.paths.recallLedger,
      recallPendingDir: identity.paths.recallPending,
    }
  } catch {
    // An unreadable config or an identity that will not resolve means a silent block, never a
    // dead frame - the same contract every other data seam in this component keeps.
    return undefined
  }
}

/**
 * Reads the task engine's own durable records. The store is built once per session and kept,
 * because it caches record parses by mtime - rebuilding it per refresh would re-read every file.
 * The state dir follows `task.state_dir` when the project configures one.
 */
function createRecordReader(): (cwd: string) => Promise<readonly PanelTaskRecord[]> {
  let store: { list: () => { records: readonly PanelTaskRecord[] } } | undefined
  let storeCwd: string | undefined
  return async (cwd) => {
    if (store === undefined || storeCwd !== cwd) {
      // Imported through the task runtime alias, which the build keeps external: a static
      // import would pull the whole task module graph into the extension entry bundle.
      const runtime = await import("#omo-task-runtime")
      const loaded = loadSenpiOmoConfig({ cwd }).config
      store = runtime.createTaskRecordStore({
        project_dir: cwd,
        ...(loaded.task === undefined ? {} : { task: loaded.task }),
      })
      storeCwd = cwd
    }
    return store.list().records
  }
}

/**
 * Reads a child's transcript through the task runtime alias, which the build keeps external, so
 * the entry bundle does not gain the task module graph for one viewer.
 */
function createChildOutputReader(): (cwd: string, taskId: string) => Promise<readonly PanelRow[]> {
  return async (cwd, taskId) => {
    const runtime = await import("#omo-task-runtime")
    const loaded = loadSenpiOmoConfig({ cwd }).config
    const stateDir = runtime.resolveStateDir({
      project_dir: cwd,
      ...(loaded.task === undefined ? {} : { task: loaded.task }),
    })
    const result = runtime.defaultTranscriptReader({ taskId, stateDir })
    // "full" on purpose: a click asks for the whole thing, not the tail a tool call would take.
    const rendered = runtime.renderTranscript(result.entries, { mode: "full", tailLines: 0 })
    return childOutputRows(rendered.text, rendered.truncated)
  }
}
