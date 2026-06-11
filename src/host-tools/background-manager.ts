export type TargetBackgroundTask = {
  id: string
  status: "running" | "completed" | "failed" | "cancelled"
  output?: string
}

export class TargetBackgroundManager {
  private readonly tasks = new Map<string, TargetBackgroundTask>()
  private readonly controllers = new Map<string, AbortController>()

  start(run: (signal: AbortSignal) => Promise<string>, onComplete?: (task: TargetBackgroundTask) => void | Promise<void>): TargetBackgroundTask {
    const task: TargetBackgroundTask = { id: `bg_${crypto.randomUUID()}`, status: "running" }
    const controller = new AbortController()
    this.tasks.set(task.id, task)
    this.controllers.set(task.id, controller)
    void run(controller.signal).then(
      async (output) => {
        task.status = controller.signal.aborted ? "cancelled" : "completed"
        task.output = output
        this.controllers.delete(task.id)
        await onComplete?.(task)
      },
      async (error) => {
        task.status = controller.signal.aborted ? "cancelled" : "failed"
        task.output = error instanceof Error ? error.message : String(error)
        this.controllers.delete(task.id)
        await onComplete?.(task)
      },
    )
    return task
  }

  get(id: string): TargetBackgroundTask | undefined {
    return this.tasks.get(id)
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id)
    if (!controller) return false
    controller.abort()
    return true
  }
}
