import { LABEL_MAX } from "./constants"
import { box, text } from "./element-helpers"
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
}

export function buildViewNodes(view: SidebarView, theme: ThemeLike): ViewNode[] {
  switch (view.kind) {
    case "active":
      return [
        box({ flexDirection: "column", gap: 1 }, [
          ...configBannerNodes(view.configBanner, theme),
          ...loopNodes(view.loop, theme),
          ...agentNodes(view.agents, theme),
          ...jobNodes(view.jobs, theme),
        ]),
      ]
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
      return [text({ fg: theme.warning }, "config invalid - run doctor")]
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
        section("ULW", theme, [
          text({ fg: theme.text }, `goals ${loop.goalsDone}/${loop.goalsTotal}`),
          text({ fg: theme.success }, `pass ${loop.pass}`),
          text({ fg: theme.error }, `fail ${loop.fail}`),
          text({ fg: theme.textMuted }, `pending ${loop.pending} blocked ${loop.blocked}`),
          text({ fg: theme.accent }, `active ${truncate(loop.activeGoal ?? "none")}`),
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
        "ULW",
        `goals ${loop.goalsDone}/${loop.goalsTotal}`,
        `pass ${loop.pass}`,
        `fail ${loop.fail}`,
        `pending ${loop.pending} blocked ${loop.blocked}`,
        `active ${loop.activeGoal ?? "none"}`,
      ]
    default:
      return assertNever(loop)
  }
}

function agentNodes(agents: AgentsState, theme: ThemeLike): ViewNode[] {
  switch (agents.kind) {
    case "none":
      return []
    case "list":
      return [
        section(
          "Agents",
          theme,
          agents.agents.map((agent) => text({ fg: theme.text }, `${truncate(agent.name)} ${agent.status}`)),
        ),
      ]
    default:
      return assertNever(agents)
  }
}

function agentLines(agents: AgentsState): string[] {
  switch (agents.kind) {
    case "none":
      return []
    case "list":
      return ["Agents", ...agents.agents.map((agent) => `${agent.name} ${agent.status}`)]
    default:
      return assertNever(agents)
  }
}

function jobNodes(jobs: JobBoardState, theme: ThemeLike): ViewNode[] {
  switch (jobs.kind) {
    case "none":
      return []
    case "list":
      return [
        section(
          "Jobs",
          theme,
          jobs.jobs.map((job) =>
            text({ fg: theme.text }, `${truncate(job.title)} ${job.status} ${job.toolCalls ?? 0} ${job.lastTool ?? "none"}`),
          ),
        ),
      ]
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
        "Jobs",
        `${job.title} ${job.status} calls ${job.toolCalls ?? 0} last ${job.lastTool ?? "none"}`,
      ])
    default:
      return assertNever(jobs)
  }
}

function brokenNodes(messages: readonly string[], theme: ThemeLike): ViewNode[] {
  return [
    section("Config", theme, [
      text({ fg: theme.error }, "config invalid - run doctor"),
      ...messages.map((message) => text({ fg: theme.textMuted }, truncate(message))),
    ]),
  ]
}

function idleNodes(roster: RosterState, theme: ThemeLike): ViewNode[] {
  return [section("Models", theme, rosterLines(roster).map((line) => text({ fg: theme.text }, line)))]
}

function rosterLines(roster: RosterState): string[] {
  switch (roster.kind) {
    case "empty":
      return ["No configured models"]
    case "rows":
      return roster.rows.map((row) => `${row.label} ${row.model}`)
    default:
      return assertNever(roster)
  }
}

function section(title: string, theme: ThemeLike, children: readonly ViewNode[]): ViewNode {
  return box({ borderStyle: "single", borderColor: theme.borderSubtle, flexDirection: "column", padding: 1 }, [
    text({ fg: theme.info }, title),
    ...children,
  ])
}

function truncate(value: string): string {
  return value.length <= LABEL_MAX ? value : `${value.slice(0, LABEL_MAX - 3)}...`
}
