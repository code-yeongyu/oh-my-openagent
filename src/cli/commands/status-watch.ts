import { TuiRenderer, color256, colorForStatus, bold, dim } from "../tui-renderer"
import { getGlobalActivityBus } from "../../features/activity-bus"
import type { ActivityEvent } from "../../features/activity-bus/types"
import { renderStatusSummary } from "../../features/activity-bus/renderers/task-indicator"
import { AnalyticsEngine } from "../../features/agent-analytics"

export async function statusWatchAction(): Promise<void> {
  const bus = getGlobalActivityBus()
  const renderer = new TuiRenderer(1000)
  const analytics = new AnalyticsEngine(bus)
  analytics.start()

  const renderTable = () => {
    const snapshot = bus.getSnapshot()
    const analyticsSnapshot = analytics.getSnapshot()
    const allEvents = bus.getRecentEvents(undefined, 50)

    // Filter to task/agent events and take last 20
    const events = allEvents
      .filter((e: ActivityEvent) => e.kind.startsWith("task:") || e.kind.startsWith("agent:") || e.kind.startsWith("team:"))
      .slice(-20)

    const summary = renderStatusSummary(snapshot.running, snapshot.queued)

    // Build table header
    let content = bold(" Agent Activity Dashboard \u2014 Live Status\n\n")
    content += summary + "\n\n"
    content += dim(" Keys: q=quit | r=refresh\n\n")

    // Table header
    content += bold(" AGENT            STATUS      DURATION     EFFICIENCY  TASK\n")
    content += dim(" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n")

    // Render recent task events
    for (const event of events) {
      const data = event.data as Record<string, unknown>
      const agent = (data.agent as string) ?? "?"
      const taskId = (data.taskId as string) ?? ""

      const statusLabel = event.kind.split(":")[1] ?? ""

      const statusColor = colorForStatus(
        event.kind.includes("error")
          ? "error"
          : event.kind.includes("completed")
            ? "completed"
            : event.kind.includes("progress") || event.kind === "task:created"
              ? "running"
              : "idle",
      )

      const durationStr =
        "duration" in data && typeof data.duration === "number"
          ? `${Math.floor(data.duration)}s`.padEnd(11)
          : "".padEnd(11)

      const agentStats = analyticsSnapshot.agentStats.find(s => s.agentName === agent)
      const efficiency = agentStats && agentStats.totalTasks > 0
        ? Math.round((agentStats.completedTasks / agentStats.totalTasks) * 100)
        : null
      const effStr = efficiency !== null
        ? (efficiency >= 80 ? color256(35, `${efficiency}%`.padEnd(11)) :
           efficiency >= 50 ? color256(220, `${efficiency}%`.padEnd(11)) :
           color256(124, `${efficiency}%`.padEnd(11)))
        : dim("\u2014".padEnd(11))

      const line = ` ${color256(statusColor, agent.padEnd(16))} ${statusLabel.padEnd(12)} ${durationStr} ${effStr}`
      const taskInfo = taskId ? ` ${dim(taskId.slice(0, 20))}` : ""
      content += line + taskInfo + "\n"
    }

    // Footer summary
    const allStats = analyticsSnapshot.agentStats
    if (allStats.length > 0) {
      const totalTasks = allStats.reduce((s, a) => s + a.completedTasks + a.failedTasks, 0)
      const totalCompleted = allStats.reduce((s, a) => s + a.completedTasks, 0)
      const totalFailed = allStats.reduce((s, a) => s + a.failedTasks, 0)
      const overallRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0
      content += dim(`\n ${"\u2500".repeat(58)}\n`)
      content += ` Total: ${totalTasks} tasks | \u2705 ${totalCompleted} success | \u274c ${totalFailed} failed | \ud83c\udfaf ${overallRate}% rate\n`
    }

    renderer.setContent(content)
    renderer.render()
  }

  renderer.setContent("Starting agent status dashboard...")
  renderer.start()
  renderTable()

  // Keep updating
  const interval = setInterval(renderTable, 2000)

  // Cleanup on stop
  const origStop = renderer.stop.bind(renderer)
  renderer.stop = () => {
    clearInterval(interval)
    analytics.stop()
    origStop()
  }
}
