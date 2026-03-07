import type { BackgroundManager } from "../../features/background-agent"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import {
  clearCompactionAgentConfigCheckpoint,
  getCompactionAgentConfigCheckpoint,
  setCompactionAgentConfigCheckpoint,
} from "../../shared/compaction-agent-config-checkpoint"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { setSessionModel } from "../../shared/session-model-state"
import { setSessionTools } from "../../shared/session-tools-store"
import {
  createSystemDirective,
  SystemDirectiveTypes,
} from "../../shared/system-directive"
import {
  resolveLatestSessionPromptConfig,
  resolveSessionPromptConfig,
} from "./session-prompt-config-resolver"

const HOOK_NAME = "compaction-context-injector"
const AGENT_RECOVERY_PROMPT = "[restore checkpointed session agent configuration after compaction]"
const NO_TEXT_TAIL_THRESHOLD = 5
const RECOVERY_COOLDOWN_MS = 60_000
const RECENT_COMPACTION_WINDOW_MS = 10 * 60 * 1000

type CompactionContextClient = {
  client: {
    session: {
      messages: (input: { path: { id: string } }) => Promise<unknown>
      promptAsync: (input: {
        path: { id: string }
        body: {
          noReply?: boolean
          agent?: string
          model?: { providerID: string; modelID: string }
          tools?: Record<string, boolean>
          parts: Array<{ type: "text"; text: string }>
        }
        query?: { directory: string }
      }) => Promise<unknown>
    }
  }
  directory: string
}

type TailMonitorState = {
  currentMessageID?: string
  currentHasText: boolean
  consecutiveNoTextMessages: number
  lastCompactedAt?: number
  lastRecoveryAt?: number
}

export interface CompactionContextInjector {
  capture: (sessionID: string) => Promise<void>
  inject: (sessionID?: string) => string
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
}

function isCompactionAgent(agent: string | undefined): boolean {
  return agent?.trim().toLowerCase() === "compaction"
}

function resolveSessionID(props?: Record<string, unknown>): string | undefined {
  return (props?.sessionID ??
    (props?.info as { id?: string } | undefined)?.id) as string | undefined
}

function finalizeTrackedAssistantMessage(state: TailMonitorState): number {
  if (!state.currentMessageID) {
    return state.consecutiveNoTextMessages
  }

  state.consecutiveNoTextMessages = state.currentHasText
    ? 0
    : state.consecutiveNoTextMessages + 1
  state.currentMessageID = undefined
  state.currentHasText = false

  return state.consecutiveNoTextMessages
}

function trackAssistantText(state: TailMonitorState, messageID?: string): void {
  if (messageID && !state.currentMessageID) {
    state.currentMessageID = messageID
  }

  state.currentHasText = true
  state.consecutiveNoTextMessages = 0
}

const COMPACTION_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, you MUST include the following sections in your summary:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. Active Working Context (For Seamless Continuation)
- **Files**: Paths of files currently being edited or frequently referenced
- **Code in Progress**: Key code snippets, function signatures, or data structures under active development
- **External References**: Documentation URLs, library APIs, or external resources being consulted
- **State & Variables**: Important variable names, configuration values, or runtime state relevant to ongoing work

## 6. Explicit Constraints (Verbatim Only)
- Include ONLY constraints explicitly stated by the user or in existing AGENTS.md context
- Quote constraints verbatim (do not paraphrase)
- Do NOT invent, add, or modify constraints
- If no explicit constraints exist, write "None"

## 7. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running (momus, oracle, etc.)
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

This section is CRITICAL for reviewer agents (momus, oracle) to maintain continuity.

## 8. Delegated Agent Sessions
- List ALL background agent tasks spawned during this session
- For each: agent name, category, status, description, and **session_id**
- **RESUME, DON'T RESTART.** Each listed session retains full context. After compaction, use \`session_id\` to continue existing agent sessions instead of spawning new ones. This saves tokens, preserves learned context, and prevents duplicate work.

This context is critical for maintaining continuity after compaction.
`

export function createCompactionContextInjector(options?: {
  ctx?: CompactionContextClient
  backgroundManager?: BackgroundManager
}): CompactionContextInjector {
  const ctx = options?.ctx
  const backgroundManager = options?.backgroundManager
  const tailStates = new Map<string, TailMonitorState>()

  const getTailState = (sessionID: string): TailMonitorState => {
    const existing = tailStates.get(sessionID)
    if (existing) {
      return existing
    }

    const created: TailMonitorState = {
      currentHasText: false,
      consecutiveNoTextMessages: 0,
    }
    tailStates.set(sessionID, created)
    return created
  }

  const recoverCheckpointedAgentConfig = async (
    sessionID: string,
    reason: "session.compacted" | "no-text-tail",
  ): Promise<boolean> => {
    if (!ctx) {
      return false
    }

    const checkpoint = getCompactionAgentConfigCheckpoint(sessionID)
    if (!checkpoint?.agent) {
      return false
    }

    const tailState = getTailState(sessionID)
    const now = Date.now()
    if (tailState.lastRecoveryAt && now - tailState.lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
      return false
    }

    if (reason === "session.compacted") {
      const latestPromptConfig = await resolveLatestSessionPromptConfig(ctx, sessionID)
      const latestAgentMatchesCheckpoint =
        typeof latestPromptConfig.agent === "string" &&
        latestPromptConfig.agent.toLowerCase() === checkpoint.agent.toLowerCase() &&
        !isCompactionAgent(latestPromptConfig.agent)

      if (latestAgentMatchesCheckpoint && latestPromptConfig.model) {
        return false
      }
    }

    const currentPromptConfig = await resolveSessionPromptConfig(ctx, sessionID)
    const model = checkpoint.model ?? currentPromptConfig.model
    const tools = checkpoint.tools ?? currentPromptConfig.tools

    try {
      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: {
          noReply: true,
          agent: checkpoint.agent,
          ...(model ? { model } : {}),
          ...(tools ? { tools } : {}),
          parts: [createInternalAgentTextPart(AGENT_RECOVERY_PROMPT)],
        },
        query: { directory: ctx.directory },
      })

      updateSessionAgent(sessionID, checkpoint.agent)
      if (model) {
        setSessionModel(sessionID, model)
      }
      if (tools) {
        setSessionTools(sessionID, tools)
      }

      tailState.lastRecoveryAt = now
      tailState.consecutiveNoTextMessages = 0

      log(`[${HOOK_NAME}] Re-injected checkpointed agent config`, {
        sessionID,
        reason,
        agent: checkpoint.agent,
        model,
      })

      return true
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to re-inject checkpointed agent config`, {
        sessionID,
        reason,
        error: String(error),
      })
      return false
    }
  }

  const maybeWarnAboutNoTextTail = async (sessionID: string): Promise<void> => {
    const tailState = getTailState(sessionID)
    if (tailState.consecutiveNoTextMessages < NO_TEXT_TAIL_THRESHOLD) {
      return
    }

    const recentlyCompacted =
      tailState.lastCompactedAt !== undefined &&
      Date.now() - tailState.lastCompactedAt < RECENT_COMPACTION_WINDOW_MS

    log(`[${HOOK_NAME}] Detected consecutive assistant messages with no text`, {
      sessionID,
      consecutiveNoTextMessages: tailState.consecutiveNoTextMessages,
      recentlyCompacted,
    })

    if (recentlyCompacted) {
      await recoverCheckpointedAgentConfig(sessionID, "no-text-tail")
    }
  }

  const capture = async (sessionID: string): Promise<void> => {
    if (!ctx || !sessionID) {
      return
    }

    const promptConfig = await resolveSessionPromptConfig(ctx, sessionID)
    if (!promptConfig.agent && !promptConfig.model && !promptConfig.tools) {
      return
    }

    setCompactionAgentConfigCheckpoint(sessionID, promptConfig)
    log(`[${HOOK_NAME}] Captured agent checkpoint before compaction`, {
      sessionID,
      agent: promptConfig.agent,
      model: promptConfig.model,
      hasTools: !!promptConfig.tools,
    })
  }

  const inject = (sessionID?: string): string => {
    let prompt = COMPACTION_CONTEXT_PROMPT

    if (backgroundManager && sessionID) {
      const history = backgroundManager.taskHistory.formatForCompaction(sessionID)
      if (history) {
        prompt += `\n### Active/Recent Delegated Sessions\n${history}\n`
      }
    }

    return prompt
  }

  const event = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionID(props)
      if (sessionID) {
        clearCompactionAgentConfigCheckpoint(sessionID)
        tailStates.delete(sessionID)
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = resolveSessionID(props)
      if (!sessionID) {
        return
      }

      const noTextCount = finalizeTrackedAssistantMessage(getTailState(sessionID))
      if (noTextCount > 0) {
        await maybeWarnAboutNoTextTail(sessionID)
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionID(props)
      if (!sessionID) {
        return
      }

      const tailState = getTailState(sessionID)
      finalizeTrackedAssistantMessage(tailState)
      tailState.lastCompactedAt = Date.now()
      await maybeWarnAboutNoTextTail(sessionID)
      await recoverCheckpointedAgentConfig(sessionID, "session.compacted")
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        id?: string
        role?: string
        sessionID?: string
      } | undefined

      if (!info?.sessionID || info.role !== "assistant" || !info.id) {
        return
      }

      const tailState = getTailState(info.sessionID)
      if (tailState.currentMessageID && tailState.currentMessageID !== info.id) {
        finalizeTrackedAssistantMessage(tailState)
        await maybeWarnAboutNoTextTail(info.sessionID)
      }

      if (tailState.currentMessageID !== info.id) {
        tailState.currentMessageID = info.id
        tailState.currentHasText = false
      }
      return
    }

    if (event.type === "message.part.delta") {
      const sessionID = props?.sessionID as string | undefined
      const messageID = props?.messageID as string | undefined
      const field = props?.field as string | undefined
      const delta = props?.delta as string | undefined

      if (!sessionID || field !== "text" || !delta?.trim()) {
        return
      }

      trackAssistantText(getTailState(sessionID), messageID)
      return
    }

    if (event.type === "message.part.updated") {
      const part = props?.part as {
        messageID?: string
        sessionID?: string
        type?: string
        text?: string
      } | undefined

      if (!part?.sessionID || part.type !== "text" || !part.text?.trim()) {
        return
      }

      trackAssistantText(getTailState(part.sessionID), part.messageID)
    }
  }

  return { capture, inject, event }
}
