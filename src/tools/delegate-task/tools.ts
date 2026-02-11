import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { DelegateTaskArgs, ToolContextWithMetadata, DelegateTaskToolOptions } from "./types"
import { CATEGORY_DESCRIPTIONS } from "./constants"
import { mergeCategories } from "../../shared/merge-categories"
import { log } from "../../shared/logger"
import { buildSystemContent } from "./prompt-builder"
import type {
  AvailableCategory,
  AvailableSkill,
} from "../../agents/dynamic-agent-prompt-builder"
import {
  resolveSkillContent,
  resolveParentContext,
  executeBackgroundContinuation,
  executeSyncContinuation,
  resolveCategoryExecution,
  resolveSubagentExecution,
  executeUnstableAgentTask,
  executeBackgroundTask,
  executeSyncTask,
} from "./executor"

export { resolveCategoryConfig } from "./categories"
export type { SyncSessionCreatedEvent, DelegateTaskToolOptions, BuildSystemContentInput } from "./types"
export { buildSystemContent } from "./prompt-builder"

export function createDelegateTask(options: DelegateTaskToolOptions): ToolDefinition {
  const { userCategories } = options

  const allCategories = mergeCategories(userCategories)
  const categoryNames = Object.keys(allCategories)
  const categoryExamples = categoryNames.map(k => `'${k}'`).join(", ")

  const availableCategories: AvailableCategory[] = options.availableCategories
    ?? Object.entries(allCategories).map(([name, categoryConfig]) => {
      const userDesc = userCategories?.[name]?.description
      const builtinDesc = CATEGORY_DESCRIPTIONS[name]
      const description = userDesc || builtinDesc || "General tasks"
      return {
        name,
        description,
        model: categoryConfig.model,
      }
    })

  const availableSkills: AvailableSkill[] = options.availableSkills ?? []

  const categoryList = categoryNames.map(name => {
    const userDesc = userCategories?.[name]?.description
    const builtinDesc = CATEGORY_DESCRIPTIONS[name]
    const desc = userDesc || builtinDesc
    return desc ? `  - ${name}: ${desc}` : `  - ${name}`
  }).join("\n")

  const description = `Spawn agent task with category-based or direct agent selection.

MUTUALLY EXCLUSIVE: Provide EITHER category OR subagent_type, not both (unless continuing a session).

- load_skills: ALWAYS REQUIRED. Pass at least one skill name (e.g., ["playwright"], ["git-master", "frontend-ui-ux"]).
- category: Use predefined category → Spawns Sisyphus-Junior with category config
  Available categories:
${categoryList}
- subagent_type: Use specific agent directly (e.g., "oracle", "explore")
- run_in_background: true=async (returns task_id), false=sync (waits for result). Default: false. Use background=true ONLY for parallel exploration with 5+ independent queries.
- session_id: Existing Task session to continue (from previous task output). Continues agent with FULL CONTEXT PRESERVED - saves tokens, maintains continuity.
- command: The command that triggered this task (optional, for slash command tracking).

**WHEN TO USE session_id:**
- Task failed/incomplete → session_id with "fix: [specific issue]"
- Need follow-up on previous result → session_id with additional question
- Multi-turn conversation with same agent → always session_id instead of new task

Prompts MUST be in English.`

  return tool({
    description,
    args: {
      load_skills: tool.schema.array(tool.schema.string()).describe("Skill names to inject. REQUIRED - pass [] if no skills needed, but IT IS HIGHLY RECOMMENDED to pass proper skills like [\"playwright\"], [\"git-master\"] for best results."),
      description: tool.schema.string().describe("Short task description (3-5 words)"),
      prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
      run_in_background: tool.schema.boolean().describe("true=async (returns task_id), false=sync (waits). Default: false"),
      category: tool.schema.string().optional().describe(`Category (e.g., ${categoryExamples}). Mutually exclusive with subagent_type.`),
      subagent_type: tool.schema.string().optional().describe("Agent name (e.g., 'oracle', 'explore'). Mutually exclusive with category."),
      session_id: tool.schema.string().optional().describe("Existing Task session to continue"),
      command: tool.schema.string().optional().describe("The command that triggered this task"),
    },
    async execute(args: DelegateTaskArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata

      if (args.category) {
        if (args.subagent_type && args.subagent_type !== "sisyphus-junior") {
          log("[task] category provided - overriding subagent_type to sisyphus-junior", {
            category: args.category,
            subagent_type: args.subagent_type,
          })
        }
        args.subagent_type = "sisyphus-junior"
      }
      await ctx.metadata?.({
        title: args.description,
      })

      if (args.run_in_background === undefined) {
        throw new Error(`Invalid arguments: 'run_in_background' parameter is REQUIRED. Use run_in_background=false for task delegation, run_in_background=true only for parallel exploration.`)
      }
      if (args.load_skills === undefined) {
        throw new Error(`Invalid arguments: 'load_skills' parameter is REQUIRED. Pass [] if no skills needed, but IT IS HIGHLY RECOMMENDED to pass proper skills like ["playwright"], ["git-master"] for best results.`)
      }
      if (args.load_skills === null) {
        throw new Error(`Invalid arguments: load_skills=null is not allowed. Pass [] if no skills needed, but IT IS HIGHLY RECOMMENDED to pass proper skills.`)
      }

      const runInBackground = args.run_in_background === true

      const { content: skillContent, error: skillError } = await resolveSkillContent(args.load_skills, {
        gitMasterConfig: options.gitMasterConfig,
        browserProvider: options.browserProvider,
        disabledSkills: options.disabledSkills,
      })
      if (skillError) {
        return skillError
      }

      const parentContext = resolveParentContext(ctx)

      if (args.session_id) {
        if (runInBackground) {
          return executeBackgroundContinuation(args, ctx, options, parentContext)
        }
        return executeSyncContinuation(args, ctx, options)
      }

      if (!args.category && !args.subagent_type) {
        return `Invalid arguments: Must provide either category or subagent_type.`
      }

      let systemDefaultModel: string | undefined
      try {
        const openCodeConfig = await options.client.config.get()
        systemDefaultModel = (openCodeConfig as { data?: { model?: string } })?.data?.model
      } catch {
        systemDefaultModel = undefined
      }

      const inheritedModel = parentContext.model
        ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
        : undefined

      let agentToUse: string
      let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
      let categoryPromptAppend: string | undefined
      let modelInfo: import("../../features/task-toast-manager/types").ModelFallbackInfo | undefined
      let actualModel: string | undefined
      let isUnstableAgent = false

      if (args.category) {
        const resolution = await resolveCategoryExecution(args, options, inheritedModel, systemDefaultModel)
        if (resolution.error) {
          return resolution.error
        }
        agentToUse = resolution.agentToUse
        categoryModel = resolution.categoryModel
        categoryPromptAppend = resolution.categoryPromptAppend
        modelInfo = resolution.modelInfo
        actualModel = resolution.actualModel
        isUnstableAgent = resolution.isUnstableAgent

        const isRunInBackgroundExplicitlyFalse = args.run_in_background === false || args.run_in_background === "false" as unknown as boolean

        log("[task] unstable agent detection", {
          category: args.category,
          actualModel,
          isUnstableAgent,
          run_in_background_value: args.run_in_background,
          run_in_background_type: typeof args.run_in_background,
          isRunInBackgroundExplicitlyFalse,
          willForceBackground: isUnstableAgent && isRunInBackgroundExplicitlyFalse,
        })

        if (isUnstableAgent && isRunInBackgroundExplicitlyFalse) {
          const systemContent = buildSystemContent({
            skillContent,
            categoryPromptAppend,
            agentName: agentToUse,
            availableCategories,
            availableSkills,
          })
          return executeUnstableAgentTask(args, ctx, options, parentContext, agentToUse, categoryModel, systemContent, actualModel)
        }
      } else {
        const resolution = await resolveSubagentExecution(args, options, parentContext.agent, categoryExamples)
        if (resolution.error) {
          return resolution.error
        }
        agentToUse = resolution.agentToUse
        categoryModel = resolution.categoryModel
      }

      const systemContent = buildSystemContent({
        skillContent,
        categoryPromptAppend,
        agentName: agentToUse,
        availableCategories,
        availableSkills,
      })

      if (runInBackground) {
        return executeBackgroundTask(args, ctx, options, parentContext, agentToUse, categoryModel, systemContent)
      }

      return executeSyncTask(args, ctx, options, parentContext, agentToUse, categoryModel, systemContent, modelInfo)
    },
  })
}
