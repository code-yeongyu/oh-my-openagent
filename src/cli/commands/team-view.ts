import { TuiRenderer, color256, bold, dim, colorForStatus } from "../tui-renderer"
import { getGlobalActivityBus } from "../../features/activity-bus"

export async function teamViewAction(): Promise<void> {
  const bus = getGlobalActivityBus()
  const renderer = new TuiRenderer(2000)

  const renderTeamView = () => {
    const events = bus.getRecentEvents("team:", 100)

    // Extract unique teams and their members
    const teams = new Map<string, { name: string; members: Map<string, string>; completed: number; total: number }>()

    for (const event of events) {
      const data = event.data as any
      if (event.kind === "team:created") {
        teams.set(data.teamId, {
          name: data.name,
          members: new Map((data.members ?? []).map((m: string) => [m, "idle"])),
          completed: 0,
          total: 0,
        })
      } else if (event.kind === "team:member:status") {
        const team = teams.get(data.teamId)
        if (team) team.members.set(data.member, data.status)
      } else if (event.kind === "team:task:progress") {
        const team = teams.get(data.teamId)
        if (team) { team.completed = data.completed; team.total = data.total }
      }
    }

    let content = bold(" Teams — Member Status & Task Progress\n\n")
    content += dim(" Keys: q=quit | r=refresh\n\n")

    if (teams.size === 0) {
      content += dim(" No active teams.\n")
    }

    for (const [teamId, team] of teams) {
      content += bold(` 🤖 ${team.name}\n`)
      content += dim(` ─────────────────────────────────────────\n`)

      // Progress bar
      if (team.total > 0) {
        const pct = Math.round((team.completed / team.total) * 100)
        const barW = 20
        const filled = Math.round((pct / 100) * barW)
        const bar = "█".repeat(filled) + "░".repeat(barW - filled)
        content += `  Tasks: ${bar} ${team.completed}/${team.total} (${pct}%)\n`
      }

      // Members
      for (const [member, status] of team.members) {
        const color = colorForStatus(status)
        const statusIcon = status === "running" ? "●" : status === "idle" ? "○" : status === "error" ? "✗" : "●"
        content += `  ${color256(color, statusIcon)} ${member}\n`
      }
      content += "\n"
    }

    renderer.setContent(content)
    renderer.render()
  }

  renderer.start()
  renderTeamView()

  const interval = setInterval(renderTeamView, 3000)
  const origStop = renderer.stop.bind(renderer)
  renderer.stop = () => {
    clearInterval(interval)
    origStop()
  }
}
