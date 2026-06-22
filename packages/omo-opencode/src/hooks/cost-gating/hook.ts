import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import { log } from "../../shared/logger"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { isRecord } from "@oh-my-opencode/utils"
import { selectSessionInTui } from "../ralph-loop/session-reset-strategy"

export function createCostGatingHook(ctx: PluginInput, pluginConfig: OhMyOpenCodeConfig) {
  const sessionTokens = new Map<string, number>()
  const rolloverInProgress = new Set<string>()

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined
    const sessionID = resolveSessionEventID(props) || (props?.sessionID as string) || (props?.info as Record<string, unknown>)?.sessionID as string
    
    if (event.type === "session.deleted") {
      if (sessionID) {
        sessionTokens.delete(sessionID)
        rolloverInProgress.delete(sessionID)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        id?: string
        role?: string
        sessionID?: string
        tokens?: { input?: number; cache?: { read?: number }; output?: number }
      } | undefined

      const currentSessionID = sessionID || info?.sessionID
      if (!currentSessionID || !info || info.role !== "assistant" || rolloverInProgress.has(currentSessionID)) {
        return
      }

      const inputTokens = (info.tokens?.input ?? 0) + (info.tokens?.cache?.read ?? 0)
      const outputTokens = info.tokens?.output ?? 0
      const totalSessionTokens = inputTokens + outputTokens
      
      if (totalSessionTokens > 0) {
        sessionTokens.set(currentSessionID, totalSessionTokens)
      }

      const threshold = pluginConfig.cost_gating_threshold_tokens ?? 200_000
      if (totalSessionTokens >= threshold) {
        rolloverInProgress.add(currentSessionID)
        
        // Run the rollover asynchronously to not block the event processing loop
        void runSessionRollover(ctx, currentSessionID, totalSessionTokens, pluginConfig).finally(() => {
          rolloverInProgress.delete(currentSessionID)
        })
      }
    }
  }

  return {
    event: eventHandler,
  }
}

async function runSessionRollover(
  ctx: PluginInput,
  sessionID: string,
  totalTokens: number,
  pluginConfig: OhMyOpenCodeConfig
): Promise<void> {
  log("[cost-gating] Triggering session rollover", { sessionID, totalTokens })
  
  try {
    // 1. Get previous session info
    const session = await ctx.client.session.get({ path: { id: sessionID } }).catch(() => null)
    if (!session || !isRecord(session) || !isRecord(session.data)) {
      log("[cost-gating] Failed to fetch session info for rollover", { sessionID })
      return
    }
    const directory = (session.data.directory as string) ?? ctx.directory
    const title = (session.data.title as string) ?? "Omo Session"

    // 2. Fetch last few messages to construct a summary/pre-thought chain
    let summary = ""
    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { limit: 15 },
      })
      
      const messages = Array.isArray(messagesResp)
        ? messagesResp
        : (typeof messagesResp === "object" && messagesResp !== null && "data" in messagesResp && Array.isArray((messagesResp as any).data))
          ? (messagesResp as any).data
          : []

      const messageSummaries: string[] = []
      for (const msg of messages) {
        if (!isRecord(msg) || !isRecord(msg.info)) continue
        const role = msg.info.role
        if (role !== "assistant" && role !== "user") continue
        
        const parts = Array.isArray(msg.parts) ? msg.parts : []
        const textParts = parts
          .filter((p: any) => isRecord(p) && (p.type === "text" || p.type === "thinking") && typeof p.text === "string")
          .map((p: any) => p.text)
          .join(" ")
        
        if (textParts.trim().length > 0) {
          const preview = textParts.length > 300 ? textParts.slice(0, 300) + "..." : textParts
          messageSummaries.push(`**${role.toUpperCase()}**: ${preview}`)
        }
      }
      summary = messageSummaries.slice(-5).join("\n\n")
    } catch (err) {
      log("[cost-gating] Failed to fetch messages for rollover summary", { error: String(err) })
      summary = "Could not fetch detailed message history due to error."
    }

    // 3. Create a new session with current session as parent
    const rolloverTitle = title.includes("(Rollover)") ? title : `${title} (Rollover)`
    const createResult = await ctx.client.session.create({
      body: {
        parentID: sessionID,
        title: rolloverTitle,
        permission: "allow",
      },
      query: { directory },
    })

    if (createResult.error || !createResult.data?.id) {
      log("[cost-gating] Failed to create rollover session", { error: createResult.error })
      return
    }

    const newSessionID = createResult.data.id

    // 4. Construct pre-thought chain/prompt to seed the new session
    const rolloverPrompt = `[Session Roll-over Context]
This session has been automatically created because the previous session (${sessionID}) reached the token budget threshold (${totalTokens} tokens).
The previous session's context is rolled over below.

### Previous Session Summary & Thinking Chain:
${summary}

### Instructions:
1. Please review the pre-thought chain above.
2. Check your task/todo list (e.g., in task.md or implementation_plan.md) to determine the next steps.
3. Continue executing the tasks in this fresh session (which has a clean 0-token history for cost efficiency).
`
    // 5. Send initial message/prompt to the new session
    await ctx.client.session.promptAsync({
      path: { id: newSessionID },
      body: {
        parts: [{ type: "text", text: rolloverPrompt }],
      },
      query: { directory },
    })

    // 6. Switch the TUI to the new session
    await selectSessionInTui(ctx.client, newSessionID)

    // 7. Abort the old session
    await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})

    // 8. Show TUI Toast
    if (ctx.client.tui?.showToast) {
      ctx.client.tui.showToast({
        body: {
          title: "SESSION ROLLOVER",
          message: `Context exceeded 200k tokens. A new session has been created, and the thinking chain was rolled over.`,
          variant: "success",
          duration: 5000,
        }
      }).catch(() => {})
    }
    
  } catch (error) {
    log("[cost-gating] Rollover failed with error", { error: String(error) })
  }
}
