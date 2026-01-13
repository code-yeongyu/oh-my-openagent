import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { BackgroundManager } from "../../features/background-agent"
import type { SisyphusTaskArgs } from "./types"
import type { CategoryConfig, CategoriesConfig, GitMasterConfig } from "../../config/schema"
import { SISYPHUS_TASK_DESCRIPTION, DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS } from "./constants"
import { findNearestMessageWithFields, findFirstMessageWithAgent, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { resolveMultipleSkills } from "../../features/opencode-skill-loader/skill-content"
import { createBuiltinSkills } from "../../features/builtin-skills/skills"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { subagentSessions, getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"

type OpencodeClient = PluginInput["client"]

const SISYPHUS_JUNIOR_AGENT = "Sisyphus-Junior"
const CATEGORY_EXAMPLES = Object.keys(DEFAULT_CATEGORIES).map(k => `'${k}'`).join(", ")

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

type ToolContextWithMetadata = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
}

function resolveCategoryConfig(
  categoryName: string,
  userCategories?: CategoriesConfig
): { config: CategoryConfig; promptAppend: string } | null {
  const defaultConfig = DEFAULT_CATEGORIES[categoryName]
  const userConfig = userCategories?.[categoryName]
  const defaultPromptAppend = CATEGORY_PROMPT_APPENDS[categoryName] ?? ""

  if (!defaultConfig && !userConfig) {
    return null
  }

  const config: CategoryConfig = {
    ...defaultConfig,
    ...userConfig,
    model: userConfig?.model ?? defaultConfig?.model ?? "anthropic/claude-sonnet-4-5",
  }

  let promptAppend = defaultPromptAppend
  if (userConfig?.prompt_append) {
    promptAppend = defaultPromptAppend
      ? defaultPromptAppend + "\n\n" + userConfig.prompt_append
      : userConfig.prompt_append
  }

  return { config, promptAppend }
}

export interface SisyphusTaskToolOptions {
  manager: BackgroundManager
  client: OpencodeClient
  directory: string
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
}

export interface BuildSystemContentInput {
  skillContent?: string
  categoryPromptAppend?: string
}

export function buildSystemContent(input: BuildSystemContentInput): string | undefined {
  const { skillContent, categoryPromptAppend } = input

  if (!skillContent && !categoryPromptAppend) {
    return undefined
  }

  if (skillContent && categoryPromptAppend) {
    return `${skillContent}\n\n${categoryPromptAppend}`
  }

  return skillContent || categoryPromptAppend
}

export function createSisyphusTask(options: SisyphusTaskToolOptions): ToolDefinition {
  const { manager, client, directory, userCategories, gitMasterConfig } = options

  return tool({
    description: SISYPHUS_TASK_DESCRIPTION,
    args: {
      description: tool.schema.string().describe("Short task description"),
      prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
      category: tool.schema.string().optional().describe(`Category name (e.g., ${CATEGORY_EXAMPLES}). Mutually exclusive with subagent_type.`),
      subagent_type: tool.schema.string().optional().describe("Agent name directly (e.g., 'oracle', 'explore'). Mutually exclusive with category."),
      run_in_background: tool.schema.boolean().describe("Run in background. MUST be explicitly set. Use false for task delegation, true only for parallel exploration."),
      resume: tool.schema.string().optional().describe("Session ID to resume - continues previous agent session with full context"),
      skills: tool.schema.array(tool.schema.string()).describe("Array of skill names to prepend to the prompt. Use [] if no skills needed."),
    },
    async execute(args: SisyphusTaskArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata
      if (args.run_in_background === undefined) {
        return `❌ Invalid arguments: 'run_in_background' parameter is REQUIRED. Use run_in_background=false for task delegation, run_in_background=true only for parallel exploration.`
      }
      if (args.skills === undefined) {
        return `❌ Invalid arguments: 'skills' parameter is REQUIRED. Use skills=[] if no skills needed.`
      }
      const runInBackground = args.run_in_background === true

      let skillContent: string | undefined
      if (args.skills.length > 0) {
        const { resolved, notFound } = resolveMultipleSkills(args.skills, { gitMasterConfig })
        if (notFound.length > 0) {
          const available = createBuiltinSkills().map(s => s.name).join(", ")
          return `❌ Skills not found: ${notFound.join(", ")}. Available: ${available}`
        }
        skillContent = Array.from(resolved.values()).join("\n\n")
      }

      const messageDir = getMessageDir(ctx.sessionID)
      const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
      const firstMessageAgent = messageDir ? findFirstMessageWithAgent(messageDir) : null
      const sessionAgent = getSessionAgent(ctx.sessionID)
      const parentAgent = ctx.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent
      
      log("[sisyphus_task] parentAgent resolution", {
        sessionID: ctx.sessionID,
        messageDir,
        ctxAgent: ctx.agent,
        sessionAgent,
        firstMessageAgent,
        prevMessageAgent: prevMessage?.agent,
        resolvedParentAgent: parentAgent,
      })
      const parentModel = prevMessage?.model?.providerID && prevMessage?.model?.modelID
        ? { providerID: prevMessage.model.providerID, modelID: prevMessage.model.modelID }
        : undefined

      if (args.resume) {
        if (runInBackground) {
          try {
            const task = await manager.resume({
              sessionId: args.resume,
              prompt: args.prompt,
              parentSessionID: ctx.sessionID,
              parentMessageID: ctx.messageID,
              parentModel,
              parentAgent,
            })

            ctx.metadata?.({
              title: `Resume: ${task.description}`,
              metadata: { sessionId: task.sessionID },
            })

            return `Background task resumed.

Task ID: ${task.id}
Session ID: ${task.sessionID}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

Agent continues with full previous context preserved.
Use \`background_output\` with task_id="${task.id}" to check progress.`
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `❌ Failed to resume task: ${message}`
          }
        }

        const toastManager = getTaskToastManager()
        const taskId = `resume_sync_${args.resume.slice(0, 8)}`
        const startTime = new Date()

        if (toastManager) {
          toastManager.addTask({
            id: taskId,
            description: args.description,
            agent: "resume",
            isBackground: false,
          })
        }

        ctx.metadata?.({
          title: `Resume: ${args.description}`,
          metadata: { sessionId: args.resume, sync: true },
        })

        try {
          await client.session.prompt({
            path: { id: args.resume },
            body: {
              tools: {
                task: false,
                sisyphus_task: false,
                call_omo_agent: true,
              },
              parts: [{ type: "text", text: args.prompt }],
            },
          })
        } catch (promptError) {
          if (toastManager) {
            toastManager.removeTask(taskId)
          }
          const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
          return `❌ Failed to send resume prompt: ${errorMessage}\n\nSession ID: ${args.resume}`
        }

        // Wait for message stability after prompt completes
        const POLL_INTERVAL_MS = 500
        const MIN_STABILITY_TIME_MS = 5000
        const STABILITY_POLLS_REQUIRED = 3
        const pollStart = Date.now()
        let lastMsgCount = 0
        let stablePolls = 0

        while (Date.now() - pollStart < 60000) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
          
          const elapsed = Date.now() - pollStart
          if (elapsed < MIN_STABILITY_TIME_MS) continue

          const messagesCheck = await client.session.messages({ path: { id: args.resume } })
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
          path: { id: args.resume },
        })

        if (messagesResult.error) {
          if (toastManager) {
            toastManager.removeTask(taskId)
          }
          return `❌ Error fetching result: ${messagesResult.error}\n\nSession ID: ${args.resume}`
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
          return `❌ No assistant response found.\n\nSession ID: ${args.resume}`
        }

        // Extract text from both "text" and "reasoning" parts (thinking models use "reasoning")
        const textParts = lastMessage?.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
        const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")

        const duration = formatDuration(startTime)

        return `Task resumed and completed in ${duration}.

Session ID: ${args.resume}

---

${textContent || "(No text output)"}`
      }

      if (args.category && args.subagent_type) {
        return `❌ Invalid arguments: Provide EITHER category OR subagent_type, not both.`
      }

      if (!args.category && !args.subagent_type) {
        return `❌ Invalid arguments: Must provide either category or subagent_type.`
      }

      let agentToUse: string
      let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
      let categoryPromptAppend: string | undefined

      if (args.category) {
        const resolved = resolveCategoryConfig(args.category, userCategories)
        if (!resolved) {
          return `❌ Unknown category: "${args.category}". Available: ${Object.keys({ ...DEFAULT_CATEGORIES, ...userCategories }).join(", ")}`
        }

        agentToUse = SISYPHUS_JUNIOR_AGENT
        const parsedModel = parseModelString(resolved.config.model)
        categoryModel = parsedModel
          ? (resolved.config.variant
            ? { ...parsedModel, variant: resolved.config.variant }
            : parsedModel)
          : undefined
        categoryPromptAppend = resolved.promptAppend || undefined
      } else {
        agentToUse = args.subagent_type!.trim()
        if (!agentToUse) {
          return `❌ Agent name cannot be empty.`
        }

        // Validate agent exists and is callable (not a primary agent)
        try {
          const agentsResult = await client.app.agents()
          type AgentInfo = { name: string; mode?: "subagent" | "primary" | "all" }
          const agents = (agentsResult as { data?: AgentInfo[] }).data ?? agentsResult as unknown as AgentInfo[]

          const callableAgents = agents.filter((a) => a.mode !== "primary")
          const callableNames = callableAgents.map((a) => a.name)

          if (!callableNames.includes(agentToUse)) {
            const isPrimaryAgent = agents.some((a) => a.name === agentToUse && a.mode === "primary")
            if (isPrimaryAgent) {
              return `❌ Cannot call primary agent "${agentToUse}" via sisyphus_task. Primary agents are top-level orchestrators.`
            }

            const availableAgents = callableNames
              .sort()
              .join(", ")
            return `❌ Unknown agent: "${agentToUse}". Available agents: ${availableAgents}`
          }
        } catch {
          // If we can't fetch agents, proceed anyway - the session.prompt will fail with a clearer error
        }
      }

      const systemContent = buildSystemContent({ skillContent, categoryPromptAppend })

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
            skills: args.skills,
            skillContent: systemContent,
          })

          ctx.metadata?.({
            title: args.description,
            metadata: { sessionId: task.sessionID, category: args.category },
          })

          return `Background task launched.

Task ID: ${task.id}
Session ID: ${task.sessionID}
Description: ${task.description}
Agent: ${task.agent}${args.category ? ` (category: ${args.category})` : ""}
Status: ${task.status}

System notifies on completion. Use \`background_output\` with task_id="${task.id}" to check.`
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return `❌ Failed to launch task: ${message}`
        }
      }

      const toastManager = getTaskToastManager()
      let taskId: string | undefined
      let syncSessionID: string | undefined

      try {
        const parentSession = await client.session.get({
          path: { id: ctx.sessionID },
        }).catch(() => null)
        const parentDirectory = parentSession?.data?.directory ?? directory

        const createResult = await client.session.create({
          body: {
            parentID: ctx.sessionID,
            title: `Task: ${args.description}`,
          },
          query: {
            directory: parentDirectory,
          },
        })

        if (createResult.error) {
          return `❌ Failed to create session: ${createResult.error}`
        }

        const sessionID = createResult.data.id
        syncSessionID = sessionID
        subagentSessions.add(sessionID)
        taskId = `sync_${sessionID.slice(0, 8)}`
        const startTime = new Date()

        if (toastManager) {
          toastManager.addTask({
            id: taskId,
            description: args.description,
            agent: agentToUse,
            isBackground: false,
            skills: args.skills,
          })
        }

        ctx.metadata?.({
          title: args.description,
          metadata: { sessionId: sessionID, category: args.category, sync: true },
        })

        try {
          await client.session.prompt({
            path: { id: sessionID },
            body: {
              agent: agentToUse,
              system: systemContent,
              tools: {
                task: false,
                sisyphus_task: false,
                call_omo_agent: true,
              },
              parts: [{ type: "text", text: args.prompt }],
              ...(categoryModel ? { model: categoryModel } : {}),
            },
          })
        } catch (promptError) {
          if (toastManager && taskId !== undefined) {
            toastManager.removeTask(taskId)
          }
          const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
          if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
            return `❌ Agent "${agentToUse}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.\n\nSession ID: ${sessionID}`
          }
          return `❌ Failed to send prompt: ${errorMessage}\n\nSession ID: ${sessionID}`
        }

        // Poll for session completion with stability detection
        // The session may show as "idle" before messages appear, so we also check message stability
        const POLL_INTERVAL_MS = 500
        const MAX_POLL_TIME_MS = 10 * 60 * 1000
        const MIN_STABILITY_TIME_MS = 10000  // Minimum 10s before accepting completion
        const STABILITY_POLLS_REQUIRED = 3
        const pollStart = Date.now()
        let lastMsgCount = 0
        let stablePolls = 0
        let pollCount = 0

        log("[sisyphus_task] Starting poll loop", { sessionID, agentToUse })

        while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
          if (ctx.abort?.aborted) {
            log("[sisyphus_task] Aborted by user", { sessionID })
            if (toastManager && taskId) toastManager.removeTask(taskId)
            return `Task aborted.\n\nSession ID: ${sessionID}`
          }

          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
          pollCount++

          const statusResult = await client.session.status()
          const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
          const sessionStatus = allStatuses[sessionID]

          if (pollCount % 10 === 0) {
            log("[sisyphus_task] Poll status", {
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
              log("[sisyphus_task] Poll complete - messages stable", { sessionID, pollCount, currentMsgCount })
              break
            }
          } else {
            stablePolls = 0
            lastMsgCount = currentMsgCount
          }
        }

        if (Date.now() - pollStart >= MAX_POLL_TIME_MS) {
          log("[sisyphus_task] Poll timeout reached", { sessionID, pollCount, lastMsgCount, stablePolls })
        }

        const messagesResult = await client.session.messages({
          path: { id: sessionID },
        })

        if (messagesResult.error) {
          return `❌ Error fetching result: ${messagesResult.error}\n\nSession ID: ${sessionID}`
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
          return `❌ No assistant response found.\n\nSession ID: ${sessionID}`
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

${textContent || "(No text output)"}`
      } catch (error) {
        if (toastManager && taskId !== undefined) {
          toastManager.removeTask(taskId)
        }
        if (syncSessionID) {
          subagentSessions.delete(syncSessionID)
        }
        const message = error instanceof Error ? error.message : String(error)
        return `❌ Task failed: ${message}`
      }
    },
  })
}
