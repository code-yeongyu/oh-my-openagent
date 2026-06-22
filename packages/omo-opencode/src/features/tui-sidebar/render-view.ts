import { LABEL_MAX, ROSTER_LABEL_WIDTH } from "./constants"
import { box, spacer, text } from "./element-helpers"
import type { ViewNode } from "./element-helpers"
import { assertNever } from "./state-types"
import type {
  AgentsState,
  ConfigBanner,
  JobBoardState,
  LoopState,
  RosterState,
  SidebarView,
} from "./state-types"

type ThemeLike = {
  readonly error?: unknown
  readonly text?: unknown
  readonly textMuted?: unknown
  readonly warning?: unknown
  readonly success?: unknown
  readonly info?: unknown
  readonly accent?: unknown
  readonly borderSubtle?: unknown
  readonly backgroundPanel?: unknown
  readonly backgroundSelected?: unknown
}

const STATUS_DOTS: Record<string, string> = {
  running: "●",
  pending: "○",
  idle: "◌",
  completed: "✓",
  errored: "✗",
}

function statusDot(status: string): string {
  return STATUS_DOTS[status] ?? " "
}

function statusColor(status: string, theme: ThemeLike): unknown {
  switch (status) {
    case "running":
    case "busy":
      return theme.accent
    case "completed":
      return theme.success
    case "errored":
    case "error":
      return theme.error
    case "retry":
      return theme.warning
    case "idle":
    case "pending":
    case "cancelled":
      return theme.textMuted
    default:
      return theme.text
  }
}

function progressBar(done: number, total: number, width: number = 10): string {
  if (total <= 0) return "░".repeat(width)
  const filled = Math.round((done / total) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

function activeSummary(view: { readonly agents: AgentsState; readonly jobs: JobBoardState; readonly loop: LoopState }): string {
  const parts: string[] = []
  if (view.agents.kind === "list") parts.push(`${view.agents.agents.length} agents`)
  if (view.jobs.kind === "list") parts.push(`${view.jobs.jobs.length} jobs`)
  if (view.loop.kind === "live") parts.push(`${view.loop.goalsDone}/${view.loop.goalsTotal} goals`)
  return parts.join(" · ")
}

export function buildViewNodes(view: SidebarView, theme: ThemeLike): ViewNode[] {
  switch (view.kind) {
    case "active": {
      const sections: ViewNode[] = []
      const summary = activeSummary(view)
      if (summary) {
        sections.push(text({ fg: theme.textMuted, attributes: ["dim"] }, summary))
        sections.push(spacer())
      }
      sections.push(...configBannerNodes(view.configBanner, theme))
      if (view.loop.kind !== "none") {
        sections.push(...loopNodes(view.loop, theme))
        sections.push(spacer())
      }
      if (view.agents.kind !== "none") {
        sections.push(...agentNodes(view.agents, theme))
        sections.push(spacer())
      }
      sections.push(...jobNodes(view.jobs, theme))
      return [box({ flexDirection: "column", gap: 0 }, sections)]
    }
    case "broken":
      return brokenNodes(view.messages, theme)
    case "idle":
      return idleNodes(view.roster, theme)
    default:
      return assertNever(view)
  }
}

export function describeView(view: SidebarView): string {
  return linesForView(view).join("\n")
}

function linesForView(view: SidebarView): string[] {
  switch (view.kind) {
    case "active":
      return [
        ...configBannerLines(view.configBanner),
        ...loopLines(view.loop),
        ...agentLines(view.agents),
        ...jobLines(view.jobs),
      ]
    case "broken":
      return ["config invalid - run doctor", ...view.messages]
    case "idle":
      return rosterLines(view.roster)
    default:
      return assertNever(view)
  }
}

function configBannerNodes(banner: ConfigBanner, theme: ThemeLike): ViewNode[] {
  switch (banner.kind) {
    case "none":
      return []
    case "invalid":
      return [
        box({
          borderStyle: "single",
          borderColor: theme.warning,
          flexDirection: "column",
          paddingX: 1,
          paddingY: 0,
        }, [
          text({ fg: theme.warning, attributes: ["bold"] }, "⚠ config invalid"),
          text({ fg: theme.textMuted }, "  run `omo doctor` to fix"),
        ]),
        spacer(),
      ]
    default:
      return assertNever(banner)
  }
}

function configBannerLines(banner: ConfigBanner): string[] {
  switch (banner.kind) {
    case "none":
      return []
    case "invalid":
      return ["config invalid - run doctor"]
    default:
      return assertNever(banner)
  }
}

function loopNodes(loop: LoopState, theme: ThemeLike): ViewNode[] {
  switch (loop.kind) {
    case "none":
      return []
    case "live":
      return [
        box({
          borderStyle: "single",
          borderColor: theme.accent,
          flexDirection: "column",
          paddingX: 1,
          paddingY: 0,
        }, [
          text({ fg: theme.accent, attributes: ["bold"] }, "▸ ULW"),
          text({ fg: theme.text }, `${progressBar(loop.goalsDone, loop.goalsTotal)} ${loop.goalsDone}/${loop.goalsTotal}`),
          text({ fg: theme.text }, `✓${loop.pass}  ✗${loop.fail}  ○${loop.pending}  ◌${loop.blocked}`),
          text({ fg: theme.accent }, `▶ ${truncate(activeGoalLabel(loop.activeGoal))}`),
        ]),
      ]
    default:
      return assertNever(loop)
  }
}

function loopLines(loop: LoopState): string[] {
  switch (loop.kind) {
    case "none":
      return []
    case "live":
      return [
        "▸ ULW",
        `goals ${loop.goalsDone}/${loop.goalsTotal}`,
        `✓${loop.pass}  ✗${loop.fail}  ○${loop.pending}  ◌${loop.blocked}`,
        `▶ ${activeGoalLabel(loop.activeGoal)}`,
      ]
    default:
      return assertNever(loop)
  }
}

function agentNodes(agents: AgentsState, theme: ThemeLike): ViewNode[] {
  switch (agents.kind) {
    case "none":
      return []
    case "list": {
      const hasRunning = agents.agents.some((a) => a.status === "running" || a.status === "busy")
      return [
        box({
          borderStyle: "single",
          borderColor: hasRunning ? theme.accent : theme.borderSubtle,
          flexDirection: "column",
          paddingX: 1,
          paddingY: 0,
        }, [
          text({ fg: theme.info, attributes: ["bold"] }, `▸ Agents (${agents.agents.length})`),
          ...agents.agents.map((a) => {
            const rawStatus = a.status ?? ""
            const dot = statusDot(rawStatus)
            return text({ fg: statusColor(rawStatus, theme) }, `${dot} ${truncate(a.name)}`)
          }),
        ]),
      ]
    }
    default:
      return assertNever(agents)
  }
}

function agentLines(agents: AgentsState): string[] {
  switch (agents.kind) {
    case "none":
      return []
    case "list":
      return ["▸ Agents", ...agents.agents.map((agent) => `${agent.name} ${agent.status}`)]
    default:
      return assertNever(agents)
  }
}

function jobNodes(jobs: JobBoardState, theme: ThemeLike): ViewNode[] {
  switch (jobs.kind) {
    case "none":
      return []
    case "list": {
      const hasRunning = jobs.jobs.some((j) => j.status === "running")
      return [
        box({
          borderStyle: "single",
          borderColor: hasRunning ? theme.accent : theme.borderSubtle,
          flexDirection: "column",
          paddingX: 1,
          paddingY: 0,
        }, [
          text({ fg: theme.info, attributes: ["bold"] }, `▸ Jobs (${jobs.jobs.length})`),
          ...jobs.jobs.map((job) => {
            const dot = statusDot(job.status)
            const calls = job.toolCalls != null ? ` (${job.toolCalls})` : ""
            const tool = job.lastTool ? ` → ${job.lastTool}` : ""
            return text({ fg: statusColor(job.status, theme) }, `${dot} ${truncate(job.title)}${calls}${tool}`)
          }),
        ]),
      ]
    }
    default:
      return assertNever(jobs)
  }
}

function jobLines(jobs: JobBoardState): string[] {
  switch (jobs.kind) {
    case "none":
      return []
    case "list":
      return jobs.jobs.flatMap((job) => [
        "▸ Jobs",
        `${job.title} ${job.status} calls ${job.toolCalls ?? 0} last ${job.lastTool ?? "none"}`,
      ])
    default:
      return assertNever(jobs)
  }
}

function brokenNodes(messages: readonly string[], theme: ThemeLike): ViewNode[] {
  return [
    box({
      borderStyle: "single",
      borderColor: theme.error,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    }, [
      text({ fg: theme.error, attributes: ["bold"] }, "⚠ Config Error"),
      ...messages.map((message) => text({ fg: theme.textMuted }, `  ${truncate(message)}`)),
      spacer(),
      text({ fg: theme.textMuted, attributes: ["dim"] }, "  run `omo doctor` to fix"),
    ]),
  ]
}

function idleNodes(roster: RosterState, theme: ThemeLike): ViewNode[] {
  return [
    box({
      borderStyle: "single",
      borderColor: theme.borderSubtle,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    }, [
      text({ fg: theme.info, attributes: ["bold"] }, "▸ Models"),
      ...rosterLines(roster).map((line) => text({ fg: theme.text }, line)),
    ]),
  ]
}

function rosterLines(roster: RosterState): string[] {
  switch (roster.kind) {
    case "empty":
      return ["No configured models"]
    case "rows":
      return roster.rows.map((row) => `  ${row.label.padEnd(ROSTER_LABEL_WIDTH)} ${row.model}`)
    default:
      return assertNever(roster)
  }
}

function sectionCompact(title: string, theme: ThemeLike, children: readonly ViewNode[]): ViewNode {
  return box({
    borderStyle: "single",
    borderColor: theme.borderSubtle,
    flexDirection: "column",
    paddingX: 1,
    paddingY: 0,
  }, [
    text({ fg: theme.info, attributes: ["bold"] }, title),
    ...children,
  ])
}

function truncate(value: string): string {
  return value.length <= LABEL_MAX ? value : `${value.slice(0, LABEL_MAX - 3)}...`
}

function activeGoalLabel(activeGoal: string | null): string {
  return activeGoal ?? "private"
}
