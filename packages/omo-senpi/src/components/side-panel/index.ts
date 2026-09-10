import { homedir } from "node:os"

import { resolveOmoSidePanelSettings, type OmoSidePanelSettings } from "@oh-my-opencode/omo-config-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { FILE_VISIBLE_ROWS, GIT_REFRESH_FLOOR_MS, LIVE_REFRESH_MS, SIDE_PANEL_FLAG, TOOL_VISIBLE_ROWS } from "./constants"
import { registerPanelCommands } from "./commands"
import { panelContextFrom } from "./context"
import { panelFactsFrom, type PanelHostFacts } from "./data/facts"
import { panelChildrenFromRecords, type PanelTaskRecord } from "./data/task-records"
import { readGitStatus, type PanelExec } from "./git/read"
import { findGitRoot, readGitBranch } from "./git/repo"
import { createPanelHostSurface } from "./host-surface"
import type { PanelGitStatus } from "./sections/files"
import { buildPanelRows } from "./rows"
import { createPanelStore } from "./store"
import type { PanelHostSurface, PanelTimerHandle, PanelTimers } from "./types"
import { resolvePanelWidth } from "./width"

export interface SidePanelComponentOptions {
  /** Injectable so tests decide the gate without depending on the developer's own omo.json. */
  readonly loadSettings?: (cwd: string) => OmoSidePanelSettings
  /** Injectable so tests can attach a renderer synchronously. */
  readonly defer?: (callback: () => void) => void
  /** Injectable so the live-refresh cadence is deterministic under test. */
  readonly timers?: PanelTimers
  readonly now?: () => number
  /** Delegated children come from the task engine's own store; injected here for tests. */
  readonly readTaskRecords?: (cwd: string) => readonly PanelTaskRecord[] | Promise<readonly PanelTaskRecord[]>
  /** Injectable so the git reads are exercised without spawning anything. */
  readonly exec?: PanelExec
  readonly findGitRoot?: (cwd: string) => string | undefined
  readonly readGitBranch?: (root: string) => string | undefined
}

const globalTimers: PanelTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
}

/**
 * The side panel: an opt-in right column carrying what the session is doing.
 *
 * Nothing is allocated until the toggle says yes, the host coupling lives entirely in
 * `host-surface.ts`, and every row is assembled by pure builders that never touch the host.
 */
export function createSidePanelComponent(options: SidePanelComponentOptions = {}): OmoSenpiComponent {
  const loadSettings = options.loadSettings ?? defaultLoadSettings
  const timers = options.timers ?? globalTimers
  const now = options.now ?? Date.now
  return {
    name: "side-panel",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      // No default on purpose: a registered default is what `getFlag` reports when the flag
      // was never passed, which would make `side_panel.enabled` unreachable. Note the host
      // sets a boolean extension flag to `true` whatever value follows it, and refuses a
      // `--no-` form outright, so the CLI can only force the panel ON; switching it off is
      // an omo.json edit. A `false` can still arrive through the SDK's `flagValues`, and it
      // is honored below.
      pi.registerFlag(SIDE_PANEL_FLAG, {
        type: "boolean",
        description: "Force the omo side panel on for this run; side_panel.enabled in omo.json is the persistent switch.",
      })

      const store = createPanelStore(now)
      const readTaskRecords = options.readTaskRecords ?? createRecordReader()
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

      // Registered unconditionally so `/side-panel-diff` exists whether or not the column is
      // mounted; with nothing read yet it reports "no changes" instead of going missing.
      registerPanelCommands(pi, { status: () => git, exec })
      let surface: PanelHostSurface | undefined
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
        const next = await readGitStatus(exec, gitRoot)
        if (next === undefined) return
        git = next
        surface?.requestRender()
      }

      const refreshChildren = async (): Promise<void> => {
        const sessionId = facts.sessionId
        if (sessionId === undefined) return
        let records: readonly PanelTaskRecord[] = []
        try {
          records = await readTaskRecords(cwd)
        } catch (error) {
          ctx.logger.debug?.("omo-senpi side panel: task records unreadable", { error: String(error) })
          return
        }
        let changed = false
        for (const update of panelChildrenFromRecords(records, sessionId)) {
          if (store.upsertChild(update)) changed = true
        }
        if (changed) {
          surface?.requestRender()
          scheduleLiveRefresh()
        }
      }

      const refresh = async (eventCtx: unknown): Promise<undefined> => {
        if (surface === undefined) return undefined
        facts = { ...facts, ...panelFactsFrom(eventCtx) }
        surface.requestRender()
        await Promise.all([refreshChildren(), refreshGit(false)])
        scheduleLiveRefresh()
        return undefined
      }

      const teardown = (): undefined => {
        stopLiveRefresh()
        surface?.dispose()
        surface = undefined
        return undefined
      }

      pi.on("session_start", async (_payload: unknown, eventCtx: unknown): Promise<undefined> => {
        if (surface !== undefined) return undefined
        const settings = loadSettings(cwd)
        if (!isPanelEnabled(settings, ctx)) return undefined
        const context = panelContextFrom(eventCtx)
        if (context === undefined) {
          ctx.logger.debug?.("omo-senpi side panel: host context carries no ui, staying dark")
          return undefined
        }
        facts = panelFactsFrom(eventCtx)
        startedAt = now()
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
                  home: homedir(),
                },
                width,
              ),
          },
          width: (terminalWidth) => resolvePanelWidth(settings.width, terminalWidth),
          minColumns: settings.min_columns,
          logger: ctx.logger,
          ...(options.defer === undefined ? {} : { defer: options.defer }),
        })
        gitRoot = locateGit(cwd)
        if (gitRoot !== undefined && exec === undefined) {
          ctx.logger.debug?.("omo-senpi side panel: host exposes no exec, the files section stays empty")
        }
        const kind = surface.mount()
        await Promise.all([refreshChildren(), refreshGit(true)])
        scheduleLiveRefresh()
        ctx.logger.debug?.("omo-senpi side panel mounted", { kind, width: settings.width })
        return undefined
      })

      // Turn boundaries carry fresh usage totals and child state; a tool start is the only
      // signal that says what the session is doing right now.
      pi.on("turn_end", (_payload: unknown, eventCtx: unknown) => refresh(eventCtx))
      pi.on("agent_settled", (_payload: unknown, eventCtx: unknown) => refresh(eventCtx))
      pi.on("message_end", (_payload: unknown, eventCtx: unknown) => refresh(eventCtx))

      pi.on("tool_execution_start", async (payload: unknown, eventCtx: unknown): Promise<undefined> => {
        if (surface === undefined) return undefined
        const call = toolCallFrom(payload, now())
        if (call !== undefined) store.recordTool(call)
        return await refresh(eventCtx)
      })

      // Tool activity is per-exchange context: the next user turn starts a fresh list.
      pi.on("input", (): undefined => {
        store.clearTools()
        return undefined
      })

      // A tool that mutated the tree is the signal that git has something new to say.
      pi.on("tool_execution_end", async (): Promise<undefined> => {
        await refreshGit(false)
        return undefined
      })

      pi.on("session_shutdown", teardown)
      pi.on("session_before_switch", teardown)
    },
  }
}

/** The CLI flag is an explicit override in both directions; absent, the config decides. */
function isPanelEnabled(settings: OmoSidePanelSettings, ctx: ComponentContext): boolean {
  const flag = ctx.config.getFlag(SIDE_PANEL_FLAG)
  if (flag === true) return true
  if (flag === false) return false
  return settings.enabled
}

function toolCallFrom(payload: unknown, at: number): { name: string; detail?: string; at: number } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  const record = payload as Record<string, unknown>
  const name = record["toolName"] ?? record["name"]
  if (typeof name !== "string" || name === "") return undefined
  const detail = toolDetail(record["args"] ?? record["input"])
  return { name, ...(detail === undefined ? {} : { detail }), at }
}

/** One short, recognisable argument: the path or command the call is about. */
function toolDetail(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined
  const record = args as Record<string, unknown>
  for (const key of ["file_path", "path", "command", "pattern", "query", "url"]) {
    const value = record[key]
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

function defaultLoadSettings(cwd: string): OmoSidePanelSettings {
  return resolveOmoSidePanelSettings(loadSenpiOmoConfig({ cwd }).config)
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

export { SIDE_PANEL_FLAG } from "./constants"
export { buildPanelRows } from "./rows"
export { resolvePanelWidth } from "./width"
