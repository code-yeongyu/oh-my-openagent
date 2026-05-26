import { TuiRenderer, color256, bold, dim } from "../tui-renderer"
import { getGlobalActivityBus } from "../../features/activity-bus"
import type { ActivityEvent } from "../../features/activity-bus/types"

export async function taskTreeAction(): Promise<void> {
  const bus = getGlobalActivityBus()
  const renderer = new TuiRenderer(2000)

  const renderTree = () => {
    const allEvents = bus.getRecentEvents(undefined, 100)

    // Build tree from task-prefixed events
    const tasks = new Map<
      string,
      { id: string; parentId?: string; agent: string; desc: string; status: string }
    >()
    for (const event of allEvents) {
      if (!event.kind.startsWith("task:")) continue
      const data = event.data as Record<string, unknown>
      if (event.kind === "task:created" && data.taskId) {
        if (!tasks.has(data.taskId as string)) {
          tasks.set(data.taskId as string, {
            id: data.taskId as string,
            parentId: data.parentId as string | undefined,
            agent: data.agent as string,
            desc: String(data.description ?? "").substring(0, 40),
            status: "created",
          })
        }
      } else if (event.kind === "task:completed" && data.taskId) {
        const task = tasks.get(data.taskId as string)
        if (task) task.status = "completed"
      } else if (event.kind === "task:error" && data.taskId) {
        const task = tasks.get(data.taskId as string)
        if (task) task.status = "error"
      }
    }

    let content = bold(" Task Tree — Hierarchical View\n\n")
    content += dim(" Keys: q=quit | r=refresh\n\n")

    const renderTask = (task: any, depth: number): string => {
      const prefix = "  ".repeat(depth)
      const statusColor =
        task.status === "completed" ? 39 : task.status === "error" ? 124 : 35
      const statusIcon =
        task.status === "completed" ? "✓" : task.status === "error" ? "✗" : "○"
      const agent = task.agent ? `[${task.agent}]` : ""
      return `${prefix}${color256(statusColor, statusIcon)} ${agent} ${task.desc}\n`
    }

    // Only show root tasks (no parent) or standalone tasks
    for (const task of tasks.values()) {
      if (!task.parentId) {
        content += renderTask(task, 0)
        // Find children
        for (const child of tasks.values()) {
          if (child.parentId === task.id) {
            content += renderTask(child, 1)
          }
        }
      }
    }

    if (tasks.size === 0) {
      content += dim(" No active tasks found.\n")
    }

    content += `\n${dim(` Total tasks: ${tasks.size}`)}\n`

    renderer.setContent(content)
    renderer.render()
  }

  renderer.start()
  renderTree()

  const interval = setInterval(renderTree, 3000)
  const origStop = renderer.stop.bind(renderer)
  renderer.stop = () => {
    clearInterval(interval)
    origStop()
  }
}
