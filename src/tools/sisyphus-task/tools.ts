import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { BackgroundManager } from "../../features/background-agent"
import type { SisyphusTaskArgs } from "./types"
import type { CategoryConfig, CategoriesConfig } from "../../config/schema"
import { SISYPHUS_TASK_DESCRIPTION, DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS } from "./constants"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { resolveMultipleSkills } from "../../features/opencode-skill-loader/skill-content"
import { createBuiltinSkills } from "../../features/builtin-skills/skills"

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
  userCategories?: CategoriesConfig
}

export function createSisyphusTask(options: SisyphusTaskToolOptions): ToolDefinition {
  const { manager, client, userCategories } = options

  return tool({
    description: SISYPHUS_TASK_DESCRIPTION,
    args: {
      description: tool.schema.string().describe("Short task description"),
      prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
      category: tool.schema.string().optional().describe(`Category name (e.g., ${CATEGORY_EXAMPLES}). Mutually exclusive with agent.`),
      agent: tool.schema.string().optional().describe("Agent name directly (e.g., 'oracle', 'explore'). Mutually exclusive with category."),
      background: tool.schema.boolean().describe("Run in background. MUST be explicitly set. Use false for task delegation, true only for parallel exploration."),
      resume: tool.schema.string().optional().describe("Session ID to resume - continues previous agent session with full context"),
      skills: tool.schema.array(tool.schema.string()).optional().describe("Array of skill names to prepend to the prompt. Skills will be resolved and their content prepended with a separator."),
    },
    async execute(args: SisyphusTaskArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata
      if (args.background === undefined) {
        return `❌ Invalid arguments: 'background' parameter is REQUIRED. Use background=false for task delegation, background=true only for parallel exploration.`
      }
      const runInBackground = args.background === true

      // Handle skills - resolve and prepend to prompt
      if (args.skills && args.skills.length > 0) {
        const { resolved, notFound } = resolveMultipleSkills(args.skills)
        if (notFound.length > 0) {
          const available = createBuiltinSkills().map(s => s.name).join(", ")
          return `❌ Skills not found: ${notFound.join(", ")}. Available: ${available}`
        }
        const skillContent = Array.from(resolved.values()).join("\n\n")
        args.prompt = skillContent + "\n\n---\n\n" + args.prompt
      }

      const messageDir = getMessageDir(ctx.sessionID)
      const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
      const parentModel = prevMessage?.model?.providerID && prevMessage?.model?.modelID
        ? { providerID: prevMessage.model.providerID, modelID: prevMessage.model.modelID }
        : undefined

      // Handle resume case first
      if (args.resume) {
        try {
          const task = await manager.resume({
            sessionId: args.resume,
            prompt: args.prompt,
            parentSessionID: ctx.sessionID,
            parentMessageID: ctx.messageID,
            parentModel,
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

      if (args.category && args.agent) {
        return `❌ Invalid arguments: Provide EITHER category OR agent, not both.`
      }

      if (!args.category && !args.agent) {
        return `❌ Invalid arguments: Must provide either category or agent.`
      }

      let agentToUse: string

      let categoryModel: { providerID: string; modelID: string } | undefined

      if (args.category) {
        const resolved = resolveCategoryConfig(args.category, userCategories)
        if (!resolved) {
          return `❌ Unknown category: "${args.category}". Available: ${Object.keys({ ...DEFAULT_CATEGORIES, ...userCategories }).join(", ")}`
        }

        agentToUse = SISYPHUS_JUNIOR_AGENT
        categoryModel = parseModelString(resolved.config.model)
      } else {
        agentToUse = args.agent!.trim()
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

      if (runInBackground) {
        try {
          const task = await manager.launch({
            description: args.description,
            prompt: args.prompt,
            agent: agentToUse,
            parentSessionID: ctx.sessionID,
            parentMessageID: ctx.messageID,
            parentModel,
            model: categoryModel,
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

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tuiClient = client as any
        if (tuiClient.tui?.showToast) {
          tuiClient.tui.showToast({
            body: {
              title: "Task Started",
              message: `"${args.description}" running with ${agentToUse}`,
              variant: "info",
              duration: 3000,
            },
          }).catch(() => {})
        }

        const createResult = await client.session.create({
          body: {
            parentID: ctx.sessionID,
            title: `Task: ${args.description}`,
          },
        })

        if (createResult.error) {
          return `❌ Failed to create session: ${createResult.error}`
        }

        const sessionID = createResult.data.id
        const startTime = new Date()

        ctx.metadata?.({
          title: args.description,
          metadata: { sessionId: sessionID, category: args.category, sync: true },
        })

        await client.session.prompt({
          path: { id: sessionID },
          body: {
            agent: agentToUse,
            model: categoryModel,
            tools: {
              task: false,
              sisyphus_task: false,
            },
            parts: [{ type: "text", text: args.prompt }],
          },
        })

        const messagesResult = await client.session.messages({
          path: { id: sessionID },
        })

        if (messagesResult.error) {
          return `❌ Error fetching result: ${messagesResult.error}`
        }

        const messages = ((messagesResult as { data?: unknown }).data ?? messagesResult) as Array<{
          info?: { role?: string }
          parts?: Array<{ type?: string; text?: string }>
        }>

        const assistantMessages = messages.filter((m) => m.info?.role === "assistant")
        const lastMessage = assistantMessages[assistantMessages.length - 1]
        const textParts = lastMessage?.parts?.filter((p) => p.type === "text") ?? []
        const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")

        const duration = formatDuration(startTime)

        return `Task completed in ${duration}.

Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}
Session ID: ${sessionID}

---

${textContent || "(No text output)"}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `❌ Task failed: ${message}`
      }
    },
  })
}
