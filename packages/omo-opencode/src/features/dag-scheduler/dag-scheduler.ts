import type { PluginInput } from "@opencode-ai/plugin"
import type { ExecutorContext, ParentContext } from "../../tools/delegate-task/executor-types"
import type { DelegateTaskArgs, ToolContextWithMetadata, DelegatedModelConfig } from "../../tools/delegate-task/types"
import { executeBackgroundTask } from "../../tools/delegate-task/background-task"
import { formatTaskResult } from "../../tools/background-task/task-result-format"
import { log } from "../../shared/logger"

export interface DagTask {
  id: string
  agent: string
  prompt: string
  dependencies: string[]
}

export interface DagSchedulerOptions {
  tasks: DagTask[]
  executorCtx: ExecutorContext
  toolCtx: ToolContextWithMetadata
  parentContext: ParentContext
  systemContent?: string
  categoryModel?: DelegatedModelConfig
}

export class DagScheduler {
  private tasks: DagTask[]
  private executorCtx: ExecutorContext
  private toolCtx: ToolContextWithMetadata
  private parentContext: ParentContext
  private systemContent?: string
  private categoryModel?: DelegatedModelConfig

  private statuses = new Map<string, "pending" | "running" | "completed" | "failed">()
  private bgTaskIds = new Map<string, string>() // maps DagTask.id to bg_task_id
  private results = new Map<string, string>() // maps DagTask.id to formatted result / error

  constructor(options: DagSchedulerOptions) {
    this.tasks = options.tasks
    this.executorCtx = options.executorCtx
    this.toolCtx = options.toolCtx
    this.parentContext = options.parentContext
    this.systemContent = options.systemContent
    this.categoryModel = options.categoryModel

    for (const t of this.tasks) {
      this.statuses.set(t.id, "pending")
    }
  }

  public hasCycles(): boolean {
    const adj = new Map<string, string[]>()
    for (const t of this.tasks) {
      adj.set(t.id, t.dependencies || [])
    }
    const visited = new Set<string>()
    const recStack = new Set<string>()

    const dfs = (node: string): boolean => {
      if (recStack.has(node)) return true
      if (visited.has(node)) return false
      visited.add(node)
      recStack.add(node)
      const deps = adj.get(node) || []
      for (const dep of deps) {
        if (dfs(dep)) return true
      }
      recStack.delete(node)
      return false
    }

    for (const t of this.tasks) {
      if (dfs(t.id)) return true
    }
    return false
  }

  public async run(): Promise<string> {
    if (this.hasCycles()) {
      return "Error: Cycle detected in task DAG. Cannot schedule."
    }

    log(`[dag-scheduler] Starting DAG execution with ${this.tasks.length} tasks.`)

    while (this.hasUnfinishedTasks()) {
      const readyTasks = this.getReadyTasks()

      if (readyTasks.length === 0 && this.hasRunningTasks()) {
        // Wait for running tasks to finish
        await new Promise((resolve) => setTimeout(resolve, 500))
        await this.pollRunningTasks()
        continue
      }

      if (readyTasks.length === 0 && !this.hasRunningTasks()) {
        // Deadlock or finished
        break
      }

      // Launch ready tasks concurrently
      const promises = readyTasks.map((t) => this.launchTask(t))
      await Promise.all(promises)
    }

    return this.generateReport()
  }

  private hasUnfinishedTasks(): boolean {
    for (const status of this.statuses.values()) {
      if (status === "pending" || status === "running") {
        return true
      }
    }
    return false
  }

  private hasRunningTasks(): boolean {
    for (const status of this.statuses.values()) {
      if (status === "running") {
        return true
      }
    }
    return false
  }

  private getReadyTasks(): DagTask[] {
    const ready: DagTask[] = []
    for (const t of this.tasks) {
      if (this.statuses.get(t.id) !== "pending") continue

      const deps = t.dependencies || []
      const allDepsCompleted = deps.every((depId) => this.statuses.get(depId) === "completed")
      if (allDepsCompleted) {
        ready.push(t)
      }
    }
    return ready
  }

  private async launchTask(task: DagTask): Promise<void> {
    this.statuses.set(task.id, "running")
    log(`[dag-scheduler] Launching task ${task.id} (${task.agent}).`)

    // 1. Context propagation: prepend results of dependencies to prompt
    let contextPrefix = ""
    const deps = task.dependencies || []
    for (const depId of deps) {
      const depResult = this.results.get(depId) || ""
      contextPrefix += `### Deliverable from preceding task '${depId}':\n${depResult}\n\n`
    }

    const finalPrompt = contextPrefix
      ? `${contextPrefix}---\n\n### Current Task Prompt:\n${task.prompt}`
      : task.prompt

    const args: DelegateTaskArgs = {
      load_skills: [],
      description: `${task.agent} task ${task.id}`,
      prompt: finalPrompt,
      run_in_background: true,
      subagent_type: task.agent,
    }

    try {
      const launchOutput = await executeBackgroundTask(
        args,
        this.toolCtx,
        this.executorCtx,
        this.parentContext,
        task.agent,
        this.categoryModel,
        this.systemContent
      )

      const match = launchOutput.match(/Background Task ID:\s*(bg_[^\s\n]+)/)
      const bgTaskId = match ? match[1] : undefined

      if (!bgTaskId) {
        this.statuses.set(task.id, "failed")
        this.results.set(task.id, `Failed to launch background task. Output: ${launchOutput}`)
        log(`[dag-scheduler] Task ${task.id} failed to launch.`)
      } else {
        this.bgTaskIds.set(task.id, bgTaskId)
        log(`[dag-scheduler] Task ${task.id} mapped to background task ID ${bgTaskId}.`)
      }
    } catch (err) {
      this.statuses.set(task.id, "failed")
      this.results.set(task.id, `Exception during launch: ${err instanceof Error ? err.message : String(err)}`)
      log(`[dag-scheduler] Exception launching task ${task.id}:`, err)
    }
  }

  private async pollRunningTasks(): Promise<void> {
    for (const [taskId, bgTaskId] of this.bgTaskIds.entries()) {
      if (this.statuses.get(taskId) !== "running") continue

      const taskRecord = this.executorCtx.manager.getTask(bgTaskId)
      if (!taskRecord) {
        this.statuses.set(taskId, "failed")
        this.results.set(taskId, `Background task record not found for ${bgTaskId}`)
        continue
      }

      if (taskRecord.status === "completed") {
        try {
          const resultText = await formatTaskResult(taskRecord, this.executorCtx.client as any)
          this.statuses.set(taskId, "completed")
          this.results.set(taskId, resultText)
          log(`[dag-scheduler] Task ${taskId} completed.`)
        } catch (err) {
          this.statuses.set(taskId, "failed")
          this.results.set(taskId, `Failed to retrieve result: ${err instanceof Error ? err.message : String(err)}`)
          log(`[dag-scheduler] Failed to retrieve result for task ${taskId}:`, err)
        }
      } else if (["error", "cancelled", "interrupt"].includes(taskRecord.status)) {
        this.statuses.set(taskId, "failed")
        this.results.set(taskId, `Background task finished with status: ${taskRecord.status}. Error: ${taskRecord.error || "none"}`)
        log(`[dag-scheduler] Task ${taskId} failed with status ${taskRecord.status}.`)
      }
    }
  }

  private generateReport(): string {
    let report = "## DAG Task Execution Report\n\n"
    for (const task of this.tasks) {
      const status = this.statuses.get(task.id)
      const bgId = this.bgTaskIds.get(task.id) || "N/A"
      report += `### Task: ${task.id} (Agent: ${task.agent}, Status: ${status}, Background ID: ${bgId})\n`
      if (status === "completed") {
        report += `**Result:**\n\`\`\`\n${this.results.get(task.id) || "(No output)"}\n\`\`\`\n\n`
      } else {
        report += `**Error/Details:**\n${this.results.get(task.id) || "N/A"}\n\n`
      }
    }
    return report
  }
}
