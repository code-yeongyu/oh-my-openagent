import { TuiRenderer, color256, colorForStatus, bold, dim } from "../tui-renderer"
import { getGlobalActivityBus } from "../../features/activity-bus"
import { renderStatusSummary } from "../../features/activity-bus/renderers/task-indicator"

export async function statusWatchAction(): Promise<void> {
  const bus = getGlobalActivityBus()
  const renderer = new TuiRenderer(1000)

  const renderTable = () => {
    const snapshot = bus.getSnapshot()
    const allEvents = bus.getRecentEvents(undefined, 50)

    // Filter to task/agent events and take last 20
    const events = allEvents
      .filter((e) => e.kind.startsWith("task:") || e.kind.startsWith("agent:") || e.kind.startsWith("team:"))
      .slice(-20)

    const summary = renderStatusSummary(snapshot.running, snapshot.queued)

    // Build table header
    let content = bold(" Agent Activity Dashboard \u2014 Live Status\n\n")
    content += summary + "\n\n"
    content += dim(" Keys: q=quit | r=refresh\n\n")

    // Table header
    content += bold(" AGENT            STATUS      DURATION     TASK\n")
    content += dim(" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n")

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

      const line = ` ${color256(statusColor, agent.padEnd(16))} ${statusLabel.padEnd(12)} ${durationStr}`
      const taskInfo = taskId ? ` ${dim(taskId.slice(0, 20))}` : ""
      content += line + taskInfo + "\n"
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
    origStop()
  }
}
