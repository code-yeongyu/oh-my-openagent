import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { BackgroundManager } from "../../features/background-agent"
import type { DelegateTaskArgs } from "./types"
import type { CategoryConfig, CategoriesConfig, GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS, CATEGORY_DESCRIPTIONS, PLAN_AGENT_SYSTEM_PREPEND, isPlanAgent } from "./constants"
import { getTimingConfig } from "./timing"
import { findNearestMessageWithFields, findFirstMessageWithAgent, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { resolveMultipleSkillsAsync } from "../../features/opencode-skill-loader/skill-content"
import { discoverSkills } from "../../features/opencode-skill-loader"
import { getTaskToastManager } from "../../features/task-toast-manager"
import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import { subagentSessions, getSessionAgent } from "../../features/claude-code-session-state"
import { log, getAgentToolRestrictions, resolveModel, getOpenCodeConfigPaths, findByNameCaseInsensitive, equalsIgnoreCase, promptWithModelSuggestionRetry } from "../../shared"
import { fetchAvailableModels, isModelAvailable } from "../../shared/model-availability"
import { readConnectedProvidersCache } from "../../shared/connected-providers-cache"
import { resolveModelWithFallback } from "../../shared/model-resolver"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"

type OpencodeClient = PluginInput["client"]

const SISYPHUS_JUNIOR_AGENT = "sisyphus-junior"

function parseModelString(model: string): { providerID: string; modelID: string } | undefined {
  const parts = model.split("/")
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join("/") }
  }
  return undefined
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

function formatDuration(start: Date, end?: Date): string {
  const duration = (end ?? new Date()).getTime() - start.getTime()
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

interface ErrorContext {
  operation: string
  args?: DelegateTaskArgs
  sessionID?: string
  agent?: string
  category?: string
}

function formatDetailedError(error: unknown, ctx: ErrorContext): string {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  const lines: string[] = [
    `${ctx.operation} failed`,
    "",
    `**Error**: ${message}`,
  ]

  if (ctx.sessionID) {
    lines.push(`**Session ID**: ${ctx.sessionID}`)
  }

  if (ctx.agent) {
    lines.push(`**Agent**: ${ctx.agent}${ctx.category ? ` (category: ${ctx.category})` : ""}`)
  }

  if (ctx.args) {
    lines.push("", "**Arguments**:")
    lines.push(`- description: "${ctx.args.description}"`)
    lines.push(`- category: ${ctx.args.category ?? "(none)"}`)
    lines.push(`- subagent_type: ${ctx.args.subagent_type ?? "(none)"}`)
    lines.push(`- run_in_background: ${ctx.args.run_in_background}`)
    lines.push(`- load_skills: [${ctx.args.load_skills?.join(", ") ?? ""}]`)
    if (ctx.args.session_id) {
      lines.push(`- session_id: ${ctx.args.session_id}`)
    }
  }

  if (stack) {
    lines.push("", "**Stack Trace**:")
    lines.push("```")
    lines.push(stack.split("\n").slice(0, 10).join("\n"))
    lines.push("```")
  }

  return lines.join("\n")
}

type ToolContextWithMetadata = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
}

export function resolveCategoryConfig(
  categoryName: string,
  options: {
    userCategories?: CategoriesConfig
    inheritedModel?: string
    systemDefaultModel?: string
    availableModels?: Set<string>
  }
): { config: CategoryConfig; promptAppend: string; model: string | undefined } | null {
  const { userCategories, inheritedModel, systemDefaultModel, availableModels } = options

  // Check if category requires a specific model
  const categoryReq = CATEGORY_MODEL_REQUIREMENTS[categoryName]
  if (categoryReq?.requiresModel && availableModels) {
    if (!isModelAvailable(categoryReq.requiresModel, availableModels)) {
      log(`[resolveCategoryConfig] Category ${categoryName} requires ${categoryReq.requiresModel} but not available`)
      return null
    }
  }

  const defaultConfig = DEFAULT_CATEGORIES[categoryName]
  const userConfig = userCategories?.[categoryName]
  const defaultPromptAppend = CATEGORY_PROMPT_APPENDS[categoryName] ?? ""

  if (!defaultConfig && !userConfig) {
    return null
  }

  // Model priority for categories: user override > category default > system default
  // Categories have explicit models - no inheritance from parent session
  const model = resolveModel({
    userModel: userConfig?.model,
    inheritedModel: defaultConfig?.model, // Category's built-in model takes precedence over system default
    systemDefault: systemDefaultModel,
  })
  const config: CategoryConfig = {
    ...defaultConfig,
    ...userConfig,
    model,
    variant: userConfig?.variant ?? defaultConfig?.variant,
  }

  let promptAppend = defaultPromptAppend
  if (userConfig?.prompt_append) {
    promptAppend = defaultPromptAppend
      ? defaultPromptAppend + "\n\n" + userConfig.prompt_append
      : userConfig.prompt_append
  }

  return { config, promptAppend, model }
}

export interface SyncSessionCreatedEvent {
  sessionID: string
  parentID: string
  title: string
}

export interface DelegateTaskToolOptions {
  manager: BackgroundManager
  client: OpencodeClient
  directory: string
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
  sisyphusJuniorModel?: string
  browserProvider?: BrowserAutomationProvider
  onSyncSessionCreated?: (event: SyncSessionCreatedEvent) => Promise<void>
}

export interface BuildSystemContentInput {
  skillContent?: string
  categoryPromptAppend?: string
  agentName?: string
}

export function buildSystemContent(input: BuildSystemContentInput): string | undefined {
  const { skillContent, categoryPromptAppend, agentName } = input

  const planAgentPrepend = isPlanAgent(agentName) ? PLAN_AGENT_SYSTEM_PREPEND : ""

  if (!skillContent && !categoryPromptAppend && !planAgentPrepend) {
    return undefined
  }

  const parts: string[] = []

  if (planAgentPrepend) {
    parts.push(planAgentPrepend)
  }

  if (skillContent) {
    parts.push(skillContent)
  }

  if (categoryPromptAppend) {
    parts.push(categoryPromptAppend)
  }

  return parts.join("\n\n") || undefined
}

export function createDelegateTask(options: DelegateTaskToolOptions): ToolDefinition {
  const { manager, client, directory, userCategories, gitMasterConfig, sisyphusJuniorModel, browserProvider, onSyncSessionCreated } = options

  const allCategories = { ...DEFAULT_CATEGORIES, ...userCategories }
  const categoryNames = Object.keys(allCategories)
  const categoryExamples = categoryNames.map(k => `'${k}'`).join(", ")

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

      let skillContent: string | undefined
      if (args.load_skills.length > 0) {
        const { resolved, notFound } = await resolveMultipleSkillsAsync(args.load_skills, { gitMasterConfig, browserProvider })
        if (notFound.length > 0) {
          const allSkills = await discoverSkills({ includeClaudeCodePaths: true })
          const available = allSkills.map(s => s.name).join(", ")
          return `Skills not found: ${notFound.join(", ")}. Available: ${available}`
        }
        skillContent = Array.from(resolved.values()).join("\n\n")
      }

      const messageDir = getMessageDir(ctx.sessionID)
      const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
      const firstMessageAgent = messageDir ? findFirstMessageWithAgent(messageDir) : null
      const sessionAgent = getSessionAgent(ctx.sessionID)
      const parentAgent = ctx.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent

      log("[delegate_task] parentAgent resolution", {
        sessionID: ctx.sessionID,
        messageDir,
        ctxAgent: ctx.agent,
        sessionAgent,
        firstMessageAgent,
        prevMessageAgent: prevMessage?.agent,
        resolvedParentAgent: parentAgent,
      })
      const parentModel = prevMessage?.model?.providerID && prevMessage?.model?.modelID
        ? { 
            providerID: prevMessage.model.providerID, 
            modelID: prevMessage.model.modelID,
            ...(prevMessage.model.variant ? { variant: prevMessage.model.variant } : {})
          }
        : undefined

      if (args.session_id) {
        if (runInBackground) {
          try {
            const task = await manager.resume({
              sessionId: args.session_id,
              prompt: args.prompt,
              parentSessionID: ctx.sessionID,
              parentMessageID: ctx.messageID,
              parentModel,
              parentAgent,
            })

            ctx.metadata?.({
              title: `Continue: ${task.description}`,
              metadata: {
                prompt: args.prompt,
                agent: task.agent,
                load_skills: args.load_skills,
                description: args.description,
                run_in_background: args.run_in_background,
                sessionId: task.sessionID,
                command: args.command,
              },
            })

            return `Background task continued.

Task ID: ${task.id}
Session ID: ${task.sessionID}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

Agent continues with full previous context preserved.
Use \`background_output\` with task_id="${task.id}" to check progress.`
          } catch (error) {
            return formatDetailedError(error, {
              operation: "Continue background task",
              args,
              sessionID: args.session_id,
            })
          }
        }

        const toastManager = getTaskToastManager()
        const taskId = `resume_sync_${args.session_id.slice(0, 8)}`
        const startTime = new Date()

        if (toastManager) {
          toastManager.addTask({
            id: taskId,
            description: args.description,
            agent: "continue",
            isBackground: false,
          })
        }

        ctx.metadata?.({
          title: `Continue: ${args.description}`,
          metadata: {
            prompt: args.prompt,
            load_skills: args.load_skills,
            description: args.description,
            run_in_background: args.run_in_background,
            sessionId: args.session_id,
            sync: true,
            command: args.command,
          },
        })

        try {
          let resumeAgent: string | undefined
          let resumeModel: { providerID: string; modelID: string } | undefined

          try {
            const messagesResp = await client.session.messages({ path: { id: args.session_id } })
            const messages = (messagesResp.data ?? []) as Array<{
              info?: { agent?: string; model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
            }>
            for (let i = messages.length - 1; i >= 0; i--) {
              const info = messages[i].info
              if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
                resumeAgent = info.agent
                resumeModel = info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined)
                break
              }
            }
          } catch {
            const resumeMessageDir = getMessageDir(args.session_id)
            const resumeMessage = resumeMessageDir ? findNearestMessageWithFields(resumeMessageDir) : null
            resumeAgent = resumeMessage?.agent
            resumeModel = resumeMessage?.model?.providerID && resumeMessage?.model?.modelID
              ? { providerID: resumeMessage.model.providerID, modelID: resumeMessage.model.modelID }
              : undefined
          }

          await client.session.prompt({
            path: { id: args.session_id },
            body: {
              ...(resumeAgent !== undefined ? { agent: resumeAgent } : {}),
              ...(resumeModel !== undefined ? { model: resumeModel } : {}),
              tools: {
                ...(resumeAgent ? getAgentToolRestrictions(resumeAgent) : {}),
                task: false,
                delegate_task: false,
                call_omo_agent: true,
                question: false,
              },
              parts: [{ type: "text", text: args.prompt }],
            },
          })
        } catch (promptError) {
          if (toastManager) {
            toastManager.removeTask(taskId)
          }
          const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
          return `Failed to send continuation prompt: ${errorMessage}\n\nSession ID: ${args.session_id}`
        }

        // Wait for message stability after prompt completes
        const timing = getTimingConfig()
        const POLL_INTERVAL_MS = timing.POLL_INTERVAL_MS
        const MIN_STABILITY_TIME_MS = timing.SESSION_CONTINUATION_STABILITY_MS
        const STABILITY_POLLS_REQUIRED = timing.STABILITY_POLLS_REQUIRED
        const pollStart = Date.now()
        let lastMsgCount = 0
        let stablePolls = 0

        while (Date.now() - pollStart < 60000) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

          const elapsed = Date.now() - pollStart
          if (elapsed < MIN_STABILITY_TIME_MS) continue

          const messagesCheck = await client.session.messages({ path: { id: args.session_id } })
          const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
          const currentMsgCount = msgs.length

          if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
            stablePolls++
            if (stablePolls >= STABILITY_POLLS_REQUIRED) break
          } else {
            stablePolls = 0
            lastMsgCount = currentMsgCount
          }
        }

        const messagesResult = await client.session.messages({
          path: { id: args.session_id },
        })

        if (messagesResult.error) {
          if (toastManager) {
            toastManager.removeTask(taskId)
          }
          return `Error fetching result: ${messagesResult.error}\n\nSession ID: ${args.session_id}`
        }

        const messages = ((messagesResult as { data?: unknown }).data ?? messagesResult) as Array<{
          info?: { role?: string; time?: { created?: number } }
          parts?: Array<{ type?: string; text?: string }>
        }>

        const assistantMessages = messages
          .filter((m) => m.info?.role === "assistant")
          .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))
        const lastMessage = assistantMessages[0]

        if (toastManager) {
          toastManager.removeTask(taskId)
        }

        if (!lastMessage) {
          return `No assistant response found.\n\nSession ID: ${args.session_id}`
        }

        // Extract text from both "text" and "reasoning" parts (thinking models use "reasoning")
        const textParts = lastMessage?.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
        const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")

        const duration = formatDuration(startTime)

        return `Task continued and completed in ${duration}.

Session ID: ${args.session_id}

---

${textContent || "(No text output)"}

---
To continue this session: session_id="${args.session_id}"`
      }

      if (args.category && args.subagent_type) {
        return `Invalid arguments: Provide EITHER category OR subagent_type, not both.`
      }

      if (!args.category && !args.subagent_type) {
        return `Invalid arguments: Must provide either category or subagent_type.`
      }

       // Fetch OpenCode config at boundary to get system default model
       let systemDefaultModel: string | undefined
       try {
         const openCodeConfig = await client.config.get()
         systemDefaultModel = (openCodeConfig as { data?: { model?: string } })?.data?.model
       } catch {
         // Config fetch failed, proceed without system default
         systemDefaultModel = undefined
       }

       let agentToUse: string
       let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
       let categoryPromptAppend: string | undefined

       const inheritedModel = parentModel
         ? `${parentModel.providerID}/${parentModel.modelID}`
         : undefined

       let modelInfo: ModelFallbackInfo | undefined

       if (args.category) {
          const connectedProviders = readConnectedProvidersCache()
          const availableModels = await fetchAvailableModels(client, {
            connectedProviders: connectedProviders ?? undefined
          })

          const resolved = resolveCategoryConfig(args.category, {
            userCategories,
            inheritedModel,
            systemDefaultModel,
            availableModels,
          })
         if (!resolved) {
           return `Unknown category: "${args.category}". Available: ${Object.keys({ ...DEFAULT_CATEGORIES, ...userCategories }).join(", ")}`
         }

         const requirement = CATEGORY_MODEL_REQUIREMENTS[args.category]
         let actualModel: string | undefined

         if (!requirement) {
           actualModel = resolved.model
           if (actualModel) {
             modelInfo = { model: actualModel, type: "system-default", source: "system-default" }
           }
          } else {
          const resolution = resolveModelWithFallback({
              userModel: userCategories?.[args.category]?.model,
              categoryDefaultModel: resolved.model ?? sisyphusJuniorModel,
              fallbackChain: requirement.fallbackChain,
              availableModels,
              systemDefaultModel,
            })

           if (resolution) {
             const { model: resolvedModel, source, variant: resolvedVariant } = resolution
             actualModel = resolvedModel

             if (!parseModelString(actualModel)) {
               return `Invalid model format "${actualModel}". Expected "provider/model" format (e.g., "anthropic/claude-sonnet-4-5").`
             }

              let type: "user-defined" | "inherited" | "category-default" | "system-default"
              switch (source) {
                 case "override":
                   type = "user-defined"
                   break
                 case "category-default":
                 case "provider-fallback":
                   type = "category-default"
                   break
                 case "system-default":
                   type = "system-default"
                   break
              }

             modelInfo = { model: actualModel, type, source }
             
             const parsedModel = parseModelString(actualModel)
             const variantToUse = userCategories?.[args.category]?.variant ?? resolvedVariant ?? resolved.config.variant
             categoryModel = parsedModel
               ? (variantToUse ? { ...parsedModel, variant: variantToUse } : parsedModel)
               : undefined
           }
         }

         agentToUse = SISYPHUS_JUNIOR_AGENT
          if (!categoryModel && actualModel) {
            const parsedModel = parseModelString(actualModel)
            categoryModel = parsedModel ?? undefined
          }
          categoryPromptAppend = resolved.promptAppend || undefined

          if (!categoryModel && !actualModel) {
            const categoryNames = Object.keys({ ...DEFAULT_CATEGORIES, ...userCategories })
            return `Model not configured for category "${args.category}".

Configure in one of:
1. OpenCode: Set "model" in opencode.json
2. Oh-My-OpenCode: Set category model in oh-my-opencode.json
3. Provider: Connect a provider with available models

Current category: ${args.category}
Available categories: ${categoryNames.join(", ")}`
          }

          const isUnstableAgent = resolved.config.is_unstable_agent === true || (actualModel?.toLowerCase().includes("gemini") ?? false)
        // Handle both boolean false and string "false" due to potential serialization
        const isRunInBackgroundExplicitlyFalse = args.run_in_background === false || args.run_in_background === "false" as unknown as boolean

        log("[delegate_task] unstable agent detection", {
          category: args.category,
          actualModel,
          isUnstableAgent,
          run_in_background_value: args.run_in_background,
          run_in_background_type: typeof args.run_in_background,
          isRunInBackgroundExplicitlyFalse,
          willForceBackground: isUnstableAgent && isRunInBackgroundExplicitlyFalse,
        })

        if (isUnstableAgent && isRunInBackgroundExplicitlyFalse) {
          const systemContent = buildSystemContent({ skillContent, categoryPromptAppend, agentName: agentToUse })

          try {
            const task = await manager.launch({
              description: args.description,
              prompt: args.prompt,
              agent: agentToUse,
              parentSessionID: ctx.sessionID,
              parentMessageID: ctx.messageID,
              parentModel,
              parentAgent,
              model: categoryModel,
              skills: args.load_skills.length > 0 ? args.load_skills : undefined,
              skillContent: systemContent,
            })

            // Wait for sessionID to be set (task transitions from pending to running)
            // launch() returns immediately with status="pending", sessionID is set async in startTask()
            const WAIT_FOR_SESSION_INTERVAL_MS = 100
            const WAIT_FOR_SESSION_TIMEOUT_MS = 30000
            const waitStart = Date.now()
            while (!task.sessionID && Date.now() - waitStart < WAIT_FOR_SESSION_TIMEOUT_MS) {
              if (ctx.abort?.aborted) {
                return `Task aborted while waiting for session to start.\n\nTask ID: ${task.id}`
              }
              await new Promise(resolve => setTimeout(resolve, WAIT_FOR_SESSION_INTERVAL_MS))
            }

            const sessionID = task.sessionID
            if (!sessionID) {
              return formatDetailedError(new Error(`Task failed to start within timeout (30s). Task ID: ${task.id}, Status: ${task.status}`), {
                operation: "Launch monitored background task",
                args,
                agent: agentToUse,
                category: args.category,
              })
            }

            ctx.metadata?.({
              title: args.description,
              metadata: {
                prompt: args.prompt,
                agent: agentToUse,
                category: args.category,
                load_skills: args.load_skills,
                description: args.description,
                run_in_background: args.run_in_background,
                sessionId: sessionID,
                command: args.command,
              },
            })

            const startTime = new Date()

            // Poll for completion (same logic as sync mode)
            const timingCfg = getTimingConfig()
            const POLL_INTERVAL_MS = timingCfg.POLL_INTERVAL_MS
            const MAX_POLL_TIME_MS = timingCfg.MAX_POLL_TIME_MS
            const MIN_STABILITY_TIME_MS = timingCfg.MIN_STABILITY_TIME_MS
            const STABILITY_POLLS_REQUIRED = timingCfg.STABILITY_POLLS_REQUIRED
            const pollStart = Date.now()
            let lastMsgCount = 0
            let stablePolls = 0

            while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
              if (ctx.abort?.aborted) {
                return `Task aborted (was running in background mode).\n\nSession ID: ${sessionID}`
              }

              await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

              const statusResult = await client.session.status()
              const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
              const sessionStatus = allStatuses[sessionID]

              if (sessionStatus && sessionStatus.type !== "idle") {
                stablePolls = 0
                lastMsgCount = 0
                continue
              }

              if (Date.now() - pollStart < MIN_STABILITY_TIME_MS) continue

              const messagesCheck = await client.session.messages({ path: { id: sessionID } })
              const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
              const currentMsgCount = msgs.length

              if (currentMsgCount === lastMsgCount) {
                stablePolls++
                if (stablePolls >= STABILITY_POLLS_REQUIRED) break
              } else {
                stablePolls = 0
                lastMsgCount = currentMsgCount
              }
            }

            const messagesResult = await client.session.messages({ path: { id: sessionID } })
            const messages = ((messagesResult as { data?: unknown }).data ?? messagesResult) as Array<{
              info?: { role?: string; time?: { created?: number } }
              parts?: Array<{ type?: string; text?: string }>
            }>

            const assistantMessages = messages
              .filter((m) => m.info?.role === "assistant")
              .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))
            const lastMessage = assistantMessages[0]

            if (!lastMessage) {
              return `No assistant response found (task ran in background mode).\n\nSession ID: ${sessionID}`
            }

            const textParts = lastMessage?.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
            const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")
            const duration = formatDuration(startTime)

            return `SUPERVISED TASK COMPLETED SUCCESSFULLY

IMPORTANT: This model (${actualModel}) is marked as unstable/experimental.
Your run_in_background=false was automatically converted to background mode for reliability monitoring.

Duration: ${duration}
Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}
Session ID: ${sessionID}

MONITORING INSTRUCTIONS:
- The task was monitored and completed successfully
- If you observe this agent behaving erratically in future calls, actively monitor its progress
- Use background_cancel(task_id="...") to abort if the agent seems stuck or producing garbage output
- Do NOT retry automatically if you see this message - the task already succeeded

---

RESULT:

${textContent || "(No text output)"}

---
To continue this session: session_id="${sessionID}"`
          } catch (error) {
            return formatDetailedError(error, {
              operation: "Launch monitored background task",
              args,
              agent: agentToUse,
              category: args.category,
            })
          }
        }
      } else {
        if (!args.subagent_type?.trim()) {
          return `Agent name cannot be empty.`
        }
        const agentName = args.subagent_type.trim()

        if (equalsIgnoreCase(agentName, SISYPHUS_JUNIOR_AGENT)) {
          return `Cannot use subagent_type="${SISYPHUS_JUNIOR_AGENT}" directly. Use category parameter instead (e.g., ${categoryExamples}).

Sisyphus-Junior is spawned automatically when you specify a category. Pick the appropriate category for your task domain.`
        }

        if (isPlanAgent(agentName) && isPlanAgent(parentAgent)) {
          return `You are prometheus. You cannot delegate to prometheus via delegate_task.

Create the work plan directly - that's your job as the planning agent.`
        }

        agentToUse = agentName

        // Validate agent exists and is callable (not a primary agent)
        // Uses case-insensitive matching to allow "Oracle", "oracle", "ORACLE" etc.
        try {
          const agentsResult = await client.app.agents()
          type AgentInfo = { name: string; mode?: "subagent" | "primary" | "all"; model?: { providerID: string; modelID: string } }
          const agents = (agentsResult as { data?: AgentInfo[] }).data ?? agentsResult as unknown as AgentInfo[]

          const callableAgents = agents.filter((a) => a.mode !== "primary")

          const matchedAgent = findByNameCaseInsensitive(callableAgents, agentToUse)
          if (!matchedAgent) {
            const isPrimaryAgent = findByNameCaseInsensitive(
              agents.filter((a) => a.mode === "primary"),
              agentToUse
            )
            if (isPrimaryAgent) {
              return `Cannot call primary agent "${isPrimaryAgent.name}" via delegate_task. Primary agents are top-level orchestrators.`
            }

            const availableAgents = callableAgents
              .map((a) => a.name)
              .sort()
              .join(", ")
            return `Unknown agent: "${agentToUse}". Available agents: ${availableAgents}`
          }
          // Use the canonical agent name from registration
          agentToUse = matchedAgent.name

          // Extract registered agent's model to pass explicitly to session.prompt.
          // This ensures the model is always in the correct object format ({providerID, modelID})
          // regardless of how OpenCode handles string→object conversion for plugin-registered agents.
          // See: https://github.com/code-yeongyu/oh-my-opencode/issues/1225
          if (matchedAgent.model) {
            categoryModel = matchedAgent.model
          }
        } catch {
          // If we can't fetch agents, proceed anyway - the session.prompt will fail with a clearer error
        }

      }

      const systemContent = buildSystemContent({ skillContent, categoryPromptAppend, agentName: agentToUse })

      if (runInBackground) {
        try {
          const task = await manager.launch({
            description: args.description,
            prompt: args.prompt,
            agent: agentToUse,
            parentSessionID: ctx.sessionID,
            parentMessageID: ctx.messageID,
            parentModel,
            parentAgent,
            model: categoryModel,
            skills: args.load_skills.length > 0 ? args.load_skills : undefined,
            skillContent: systemContent,
          })

          ctx.metadata?.({
            title: args.description,
            metadata: {
              prompt: args.prompt,
              agent: task.agent,
              category: args.category,
              load_skills: args.load_skills,
              description: args.description,
              run_in_background: args.run_in_background,
              sessionId: task.sessionID,
              command: args.command,
            },
          })

          return `Background task launched.

Task ID: ${task.id}
Session ID: ${task.sessionID}
Description: ${task.description}
Agent: ${task.agent}${args.category ? ` (category: ${args.category})` : ""}
Status: ${task.status}

System notifies on completion. Use \`background_output\` with task_id="${task.id}" to check.
To continue this session: session_id="${task.sessionID}"`
        } catch (error) {
          return formatDetailedError(error, {
            operation: "Launch background task",
            args,
            agent: agentToUse,
            category: args.category,
          })
        }
      }

      const toastManager = getTaskToastManager()
      let taskId: string | undefined
      let syncSessionID: string | undefined

      try {
        const parentSession = client.session.get
          ? await client.session.get({ path: { id: ctx.sessionID } }).catch(() => null)
          : null
        const parentDirectory = parentSession?.data?.directory ?? directory

        const createResult = await client.session.create({
          body: {
            parentID: ctx.sessionID,
            title: `Task: ${args.description}`,
            permission: [
              { permission: "question", action: "deny" as const, pattern: "*" },
            ],
          } as any,
          query: {
            directory: parentDirectory,
          },
        })

        if (createResult.error) {
          return `Failed to create session: ${createResult.error}`
        }

        const sessionID = createResult.data.id
        syncSessionID = sessionID
        subagentSessions.add(sessionID)

        if (onSyncSessionCreated) {
          log("[delegate_task] Invoking onSyncSessionCreated callback", { sessionID, parentID: ctx.sessionID })
          await onSyncSessionCreated({
            sessionID,
            parentID: ctx.sessionID,
            title: args.description,
          }).catch((err) => {
            log("[delegate_task] onSyncSessionCreated callback failed", { error: String(err) })
          })
          await new Promise(r => setTimeout(r, 200))
        }

        taskId = `sync_${sessionID.slice(0, 8)}`
        const startTime = new Date()

        if (toastManager) {
          toastManager.addTask({
            id: taskId,
            description: args.description,
            agent: agentToUse,
            isBackground: false,
            category: args.category,
            skills: args.load_skills,
            modelInfo,
          })
        }

        ctx.metadata?.({
          title: args.description,
          metadata: {
            prompt: args.prompt,
            agent: agentToUse,
            category: args.category,
            load_skills: args.load_skills,
            description: args.description,
            run_in_background: args.run_in_background,
            sessionId: sessionID,
            sync: true,
            command: args.command,
          },
        })

        try {
          const allowDelegateTask = isPlanAgent(agentToUse)
          await promptWithModelSuggestionRetry(client, {
            path: { id: sessionID },
            body: {
              agent: agentToUse,
              system: systemContent,
              tools: {
                task: false,
                delegate_task: allowDelegateTask,
                call_omo_agent: true,
                question: false,
              },
              parts: [{ type: "text", text: args.prompt }],
              ...(categoryModel ? { model: { providerID: categoryModel.providerID, modelID: categoryModel.modelID } } : {}),
              ...(categoryModel?.variant ? { variant: categoryModel.variant } : {}),
            },
          })
        } catch (promptError) {
          if (toastManager && taskId !== undefined) {
            toastManager.removeTask(taskId)
          }
          const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
          if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
            return formatDetailedError(new Error(`Agent "${agentToUse}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`), {
              operation: "Send prompt to agent",
              args,
              sessionID,
              agent: agentToUse,
              category: args.category,
            })
          }
          return formatDetailedError(promptError, {
            operation: "Send prompt",
            args,
            sessionID,
            agent: agentToUse,
            category: args.category,
          })
        }

        // Poll for session completion with stability detection
        // The session may show as "idle" before messages appear, so we also check message stability
        const syncTiming = getTimingConfig()
        const POLL_INTERVAL_MS = syncTiming.POLL_INTERVAL_MS
        const MAX_POLL_TIME_MS = syncTiming.MAX_POLL_TIME_MS
        const MIN_STABILITY_TIME_MS = syncTiming.MIN_STABILITY_TIME_MS
        const STABILITY_POLLS_REQUIRED = syncTiming.STABILITY_POLLS_REQUIRED
        const pollStart = Date.now()
        let lastMsgCount = 0
        let stablePolls = 0
        let pollCount = 0

        log("[delegate_task] Starting poll loop", { sessionID, agentToUse })

        while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
          if (ctx.abort?.aborted) {
            log("[delegate_task] Aborted by user", { sessionID })
            if (toastManager && taskId) toastManager.removeTask(taskId)
            return `Task aborted.\n\nSession ID: ${sessionID}`
          }

          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
          pollCount++

          const statusResult = await client.session.status()
          const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
          const sessionStatus = allStatuses[sessionID]

          if (pollCount % 10 === 0) {
            log("[delegate_task] Poll status", {
              sessionID,
              pollCount,
              elapsed: Math.floor((Date.now() - pollStart) / 1000) + "s",
              sessionStatus: sessionStatus?.type ?? "not_in_status",
              stablePolls,
              lastMsgCount,
            })
          }

          if (sessionStatus && sessionStatus.type !== "idle") {
            stablePolls = 0
            lastMsgCount = 0
            continue
          }

          const elapsed = Date.now() - pollStart
          if (elapsed < MIN_STABILITY_TIME_MS) {
            continue
          }

          const messagesCheck = await client.session.messages({ path: { id: sessionID } })
          const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
          const currentMsgCount = msgs.length

          if (currentMsgCount === lastMsgCount) {
            stablePolls++
            if (stablePolls >= STABILITY_POLLS_REQUIRED) {
              log("[delegate_task] Poll complete - messages stable", { sessionID, pollCount, currentMsgCount })
              break
            }
          } else {
            stablePolls = 0
            lastMsgCount = currentMsgCount
          }
        }

        if (Date.now() - pollStart >= MAX_POLL_TIME_MS) {
          log("[delegate_task] Poll timeout reached", { sessionID, pollCount, lastMsgCount, stablePolls })
        }

        const messagesResult = await client.session.messages({
          path: { id: sessionID },
        })

        if (messagesResult.error) {
          return `Error fetching result: ${messagesResult.error}\n\nSession ID: ${sessionID}`
        }

        const messages = ((messagesResult as { data?: unknown }).data ?? messagesResult) as Array<{
          info?: { role?: string; time?: { created?: number } }
          parts?: Array<{ type?: string; text?: string }>
        }>

        const assistantMessages = messages
          .filter((m) => m.info?.role === "assistant")
          .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))
        const lastMessage = assistantMessages[0]

        if (!lastMessage) {
          return `No assistant response found.\n\nSession ID: ${sessionID}`
        }

        // Extract text from both "text" and "reasoning" parts (thinking models use "reasoning")
        const textParts = lastMessage?.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
        const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")

        const duration = formatDuration(startTime)

        if (toastManager) {
          toastManager.removeTask(taskId)
        }

        subagentSessions.delete(sessionID)

        return `Task completed in ${duration}.

Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}
Session ID: ${sessionID}

---

${textContent || "(No text output)"}

---
To continue this session: session_id="${sessionID}"`
      } catch (error) {
        if (toastManager && taskId !== undefined) {
          toastManager.removeTask(taskId)
        }
        if (syncSessionID) {
          subagentSessions.delete(syncSessionID)
        }
        return formatDetailedError(error, {
          operation: "Execute task",
          args,
          sessionID: syncSessionID,
          agent: agentToUse,
          category: args.category,
        })
      }
    },
  })
}
