import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { DelegateTaskToolOptions, ToolContextWithMetadata } from "../delegate-task/types"
import type { ExecutorContext } from "../delegate-task/executor-types"
import { resolveParentContext } from "../delegate-task/parent-context-resolver"
import { DagScheduler, type DagTask } from "../../features/dag-scheduler/dag-scheduler"
import { log } from "../../shared/logger"

const dagTaskSchema = tool.schema.object({
  id: tool.schema.string().describe("Unique task ID in the DAG"),
  agent: tool.schema.string().describe("Subagent type/name (e.g. coder, research)"),
  prompt: tool.schema.string().describe("Detailed task prompt"),
  dependencies: tool.schema.array(tool.schema.string()).describe("List of task IDs this task depends on (e.g., ['task1', 'task2'])"),
})

const delegateTaskDagArgsSchema = {
  tasks: tool.schema.array(dagTaskSchema).describe("List of tasks in the DAG to execute concurrently based on dependencies"),
}

export function createDelegateTaskDag(options: DelegateTaskToolOptions): ToolDefinition {
  return tool({
    description: "Execute a directed acyclic graph (DAG) of subagent tasks concurrently based on their dependencies.",
    args: delegateTaskDagArgsSchema,
    async execute(args, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata
      log(`[delegate_task_dag] Execution started. Total tasks: ${args.tasks.length}`)

      const executorCtx: ExecutorContext = {
        manager: options.manager,
        client: options.client,
        directory: options.directory,
        userCategories: options.userCategories,
        gitMasterConfig: options.gitMasterConfig,
        sisyphusJuniorModel: options.sisyphusJuniorModel,
        browserProvider: options.browserProvider,
        agentOverrides: options.agentOverrides,
        sisyphusAgentConfig: options.sisyphusAgentConfig,
        modelFallbackControllerAccessor: options.modelFallbackControllerAccessor,
      }

      let parentContext
      try {
        parentContext = await resolveParentContext(ctx, options.client)
      } catch (err) {
        log(`[delegate_task_dag] Failed to resolve parent context:`, err)
        return `Error: Failed to resolve parent context: ${err instanceof Error ? err.message : String(err)}`
      }

      const scheduler = new DagScheduler({
        tasks: args.tasks as DagTask[],
        executorCtx,
        toolCtx: ctx,
        parentContext,
      })

      try {
        const report = await scheduler.run()
        log(`[delegate_task_dag] Execution completed successfully.`)
        return report
      } catch (err) {
        log(`[delegate_task_dag] Scheduler run encountered exception:`, err)
        return `Error executing DAG: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}
