import { tool, type PluginInput } from "@opencode-ai/plugin"
import { ALLOWED_AGENTS, TASK_TOOL_DESCRIPTION_TEMPLATE } from "./constants"
import type { OmoTaskArgs } from "./types"
import { log } from "../../shared/logger"

export function createOmoTask(ctx: PluginInput) {
  const agentDescriptions = ALLOWED_AGENTS.map((name) => `- ${name}: Specialized agent for ${name} tasks`).join(
    "\n"
  )
  const description = TASK_TOOL_DESCRIPTION_TEMPLATE.replace("{agents}", agentDescriptions)

  return tool({
    description,
    args: {
      description: tool.schema.string().describe("A short (3-5 words) description of the task"),
      prompt: tool.schema.string().describe("The task for the agent to perform"),
      subagent_type: tool.schema
        .enum(ALLOWED_AGENTS)
        .describe("The type of specialized agent to use for this task (explore or librarian only)"),
      session_id: tool.schema.string().describe("Existing Task session to continue").optional(),
    },
    async execute(args: OmoTaskArgs, toolContext) {
      log(`[omo_task] Starting with agent: ${args.subagent_type}`)

      if (!ALLOWED_AGENTS.includes(args.subagent_type as any)) {
        return `Error: Invalid agent type "${args.subagent_type}". Only ${ALLOWED_AGENTS.join(", ")} are allowed.`
      }

      let sessionID: string

      if (args.session_id) {
        log(`[omo_task] Using existing session: ${args.session_id}`)
        const sessionResult = await ctx.client.session.get({
          path: { id: args.session_id },
        })
        if (sessionResult.error) {
          log(`[omo_task] Session get error:`, sessionResult.error)
          return `Error: Failed to get existing session: ${sessionResult.error}`
        }
        sessionID = args.session_id
      } else {
        log(`[omo_task] Creating new session with parent: ${toolContext.sessionID}`)
        const createResult = await ctx.client.session.create({
          body: {
            parentID: toolContext.sessionID,
            title: `${args.description} (@${args.subagent_type} subagent)`,
          },
        })

        if (createResult.error) {
          log(`[omo_task] Session create error:`, createResult.error)
          return `Error: Failed to create session: ${createResult.error}`
        }

        sessionID = createResult.data.id
        log(`[omo_task] Created session: ${sessionID}`)
      }

      log(`[omo_task] Sending prompt to session ${sessionID}`)
      log(`[omo_task] Prompt text:`, args.prompt.substring(0, 100))
      
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: args.subagent_type,
          tools: {
            task: false,
            omo_task: false,
          },
          parts: [{ type: "text", text: args.prompt }],
        },
      })

      log(`[omo_task] Prompt sent, fetching messages...`)

      const messagesResult = await ctx.client.session.messages({
        path: { id: sessionID },
      })

      if (messagesResult.error) {
        log(`[omo_task] Messages error:`, messagesResult.error)
        return `Error: Failed to get messages: ${messagesResult.error}`
      }

      const messages = messagesResult.data
      log(`[omo_task] Got ${messages.length} messages`)

      const lastAssistantMessage = messages
        .filter((m: any) => m.info.role === "assistant")
        .sort((a: any, b: any) => (b.info.time?.created || 0) - (a.info.time?.created || 0))[0]

      if (!lastAssistantMessage) {
        log(`[omo_task] No assistant message found`)
        log(`[omo_task] All messages:`, JSON.stringify(messages, null, 2))
        return `Error: No assistant response found\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
      }

      log(`[omo_task] Found assistant message with ${lastAssistantMessage.parts.length} parts`)

      const textParts = lastAssistantMessage.parts.filter((p: any) => p.type === "text")
      const responseText = textParts.map((p: any) => p.text).join("\n")

      log(`[omo_task] Got response, length: ${responseText.length}`)

      const output =
        responseText + "\n\n" + ["<task_metadata>", `session_id: ${sessionID}`, "</task_metadata>"].join("\n")

      return output
    },
  })
}
