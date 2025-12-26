import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type {
  MetaLearningExtractorConfig,
  HookState,
  MetaLearningTrigger,
  ExtractorInput,
} from "./types"
import { DEFAULT_CONFIG } from "./types"
import { computeSignalScore, formatSignalReport } from "./signal-scorer"
import { redactSecrets } from "../../features/context-learning/secret-redactor"
import { log } from "../../shared/logger"

interface MessageInfo {
  role: "user" | "assistant"
  content?: unknown
  toolCalls?: Array<{
    tool: string
    args: Record<string, unknown>
    result?: string
  }>
}

interface MessageWrapper {
  info: MessageInfo
}

interface EventInput {
  event: {
    type: string
    properties?: Record<string, unknown>
  }
}

function createHookState(): HookState {
  return {
    sessions: new Map(),
    dailySpendUsd: 0,
    lastResetDate: new Date().toISOString().split("T")[0],
  }
}

export function createMetaLearningExtractorHook(
  ctx: PluginInput,
  backgroundManager: BackgroundManager,
  userConfig?: Partial<MetaLearningExtractorConfig>
) {
  const config: MetaLearningExtractorConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const state = createHookState()
  const idleDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const resetDailyBudgetIfNeeded = () => {
    const today = new Date().toISOString().split("T")[0]
    if (today !== state.lastResetDate) {
      state.dailySpendUsd = 0
      state.lastResetDate = today
    }
  }

  const canAffordExtraction = (): boolean => {
    resetDailyBudgetIfNeeded()
    return state.dailySpendUsd < config.dailyBudgetUsd
  }

  const isInCooldown = (sessionId: string): boolean => {
    const sessionState = state.sessions.get(sessionId)
    if (!sessionState?.lastExtractTime) return false

    const cooldownMs = config.cooldownMinutes * 60 * 1000
    const elapsed = Date.now() - sessionState.lastExtractTime.getTime()
    return elapsed < cooldownMs
  }

  const getSessionMessages = async (sessionId: string): Promise<MessageWrapper[]> => {
    try {
      const response = await ctx.client.session.messages({
        path: { id: sessionId },
      })
      return (response.data ?? response) as MessageWrapper[]
    } catch (error) {
      log("[meta-learning-extractor] Failed to get session messages:", error)
      return []
    }
  }

  const extractFilesAndTools = (messages: MessageWrapper[]): { files: string[]; tools: string[] } => {
    const files = new Set<string>()
    const tools = new Set<string>()

    for (const msg of messages) {
      if (msg.info.toolCalls) {
        for (const call of msg.info.toolCalls) {
          tools.add(call.tool)
          const args = call.args as Record<string, unknown>
          if (typeof args.filePath === "string") files.add(args.filePath)
          if (typeof args.path === "string") files.add(args.path)
        }
      }
    }

    return { files: Array.from(files), tools: Array.from(tools) }
  }

  const serializeContext = (messages: MessageWrapper[]): ExtractorInput["messages"] => {
    return messages.map((m) => {
      const content =
        typeof m.info.content === "string"
          ? redactSecrets(m.info.content).redacted
          : JSON.stringify(m.info.content ?? "")

      return {
        role: m.info.role,
        content: content.slice(0, 5000),
        toolCalls: m.info.toolCalls?.map((tc) => ({
          tool: tc.tool,
          args: tc.args,
          result: tc.result?.slice(0, 500),
        })),
      }
    })
  }

  const triggerExtraction = async (
    sessionId: string,
    trigger: MetaLearningTrigger,
    messageId?: string
  ): Promise<void> => {
    if (!config.enabled) return
    if (!canAffordExtraction()) {
      log("[meta-learning-extractor] Daily budget exhausted, skipping extraction")
      return
    }
    if (isInCooldown(sessionId)) {
      log("[meta-learning-extractor] Session in cooldown, skipping")
      return
    }

    const sessionState = state.sessions.get(sessionId)
    if (sessionState?.inFlight) {
      log("[meta-learning-extractor] Extraction already in flight")
      return
    }

    const messages = await getSessionMessages(sessionId)
    if (messages.length < 5) {
      log("[meta-learning-extractor] Not enough messages for extraction")
      return
    }

    const { files, tools } = extractFilesAndTools(messages)
    const serializedMessages = serializeContext(messages)

    const scoring = computeSignalScore(
      serializedMessages.map((m) => ({ role: m.role, content: m.content })),
      files,
      tools
    )

    if (!scoring.shouldTrigger && trigger !== "manual") {
      log(
        `[meta-learning-extractor] Signal score ${scoring.totalScore} below threshold ${scoring.threshold}`
      )
      return
    }

    state.sessions.set(sessionId, {
      inFlight: true,
      lastExtractedHash: "",
      lastExtractTime: new Date(),
    })

    const prompt = buildExtractionPrompt(sessionId, trigger, serializedMessages, files, tools, scoring)

    try {
      await backgroundManager.launch({
        description: `Extract meta-learnings from session ${sessionId.slice(0, 8)}`,
        prompt,
        agent: "context-learner",
        parentSessionID: sessionId,
        parentMessageID: messageId || `meta-learning-${Date.now()}`,
      })

      log(`[meta-learning-extractor] Started extraction for session ${sessionId.slice(0, 8)}`)
    } catch (error) {
      log("[meta-learning-extractor] Failed to start extraction:", error)
      state.sessions.set(sessionId, {
        inFlight: false,
        lastExtractedHash: "",
        lastExtractTime: new Date(),
      })
    }
  }

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties ?? {}

    if (event.type === "session.deleted") {
      const sessionInfo = props.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        state.sessions.delete(sessionInfo.id)
        const timer = idleDebounceTimers.get(sessionInfo.id)
        if (timer) {
          clearTimeout(timer)
          idleDebounceTimers.delete(sessionInfo.id)
        }
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionId = props.sessionID as string | undefined
      if (!sessionId) return

      const existingTimer = idleDebounceTimers.get(sessionId)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      const timer = setTimeout(async () => {
        idleDebounceTimers.delete(sessionId)
        await triggerExtraction(sessionId, "idle")
      }, config.idleDebounceMs)
      
      idleDebounceTimers.set(sessionId, timer)
      return
    }

    if (event.type === "experimental.session.compacting") {
      const sessionId = (props as { sessionID?: string }).sessionID
      if (!sessionId) return

      await triggerExtraction(sessionId, "pre_compaction")
      return
    }
  }

  const manualExtract = async (sessionId: string): Promise<void> => {
    await triggerExtraction(sessionId, "manual")
  }

  return {
    event: eventHandler,
    manualExtract,
    getState: () => state,
  }
}

function buildExtractionPrompt(
  sessionId: string,
  trigger: MetaLearningTrigger,
  messages: ExtractorInput["messages"],
  filesModified: string[],
  toolsUsed: string[],
  scoring: ReturnType<typeof computeSignalScore>
): string {
  const signalReport = formatSignalReport(scoring)
  const timestamp = new Date().toISOString()

  const conversationSummary = messages
    .slice(-20)
    .map((m, i) => {
      const toolInfo = m.toolCalls?.map((tc) => `[${tc.tool}]`).join(", ") || ""
      const contentPreview = m.content.slice(0, 300)
      return `[${i + 1}] ${m.role.toUpperCase()}${toolInfo ? ` ${toolInfo}` : ""}: ${contentPreview}...`
    })
    .join("\n\n")

  return `TASK: Extract meta-learnings from this session to improve OmO orchestration.

SESSION METADATA:
- Session ID: ${sessionId}
- Trigger: ${trigger}
- Timestamp: ${timestamp}
- Files Modified: ${filesModified.length > 0 ? filesModified.join(", ") : "none"}
- Tools Used: ${toolsUsed.length > 0 ? toolsUsed.join(", ") : "none"}

SIGNAL ANALYSIS:
${signalReport}

RECENT CONVERSATION (last 20 messages):
${conversationSummary}

INSTRUCTIONS:
1. Analyze this session for opportunities to improve OmO orchestration
2. Focus on these categories:
   - agent_instructions: Improvements to agent prompts, roles, capabilities
   - commands: Improvements to slash command behavior, workflows
   - orchestration: Improvements to delegation patterns, agent selection
   - context_handling: Improvements to memory management, compaction
   - tool_usage: Improvements to tool selection, efficiency

3. For each candidate learning:
   - Provide a clear, actionable claim
   - Include specific evidence from the conversation
   - Suggest concrete improvement with affected files
   - Assign confidence score (0-1)

4. Quality guidelines:
   - Max 3 candidates per extraction
   - Minimum confidence: 0.5
   - Evidence-based only, no speculation
   - Specific improvements, not vague suggestions

5. Output format:
   Write results to: context/learnings/${sessionId.slice(0, 8)}_${timestamp.split("T")[0]}.md

   Use this structure:
   \`\`\`markdown
   # Meta-Learning Candidates
   
   ## Metadata
   - Session: ${sessionId.slice(0, 8)}
   - Trigger: ${trigger}
   - Timestamp: ${timestamp}
   - Signal Score: ${scoring.totalScore}
   
   ## Candidates
   
   ### 1. [Title]
   - **Category**: [category]
   - **Claim**: [what should change]
   - **Confidence**: [0-1]
   - **Scope**: [when this applies]
   - **Evidence**: [conversation excerpts]
   - **Suggested Improvement**: [actionable change]
    - **Affected Files**: [file paths]
    
    ## Extraction Notes
    - Total Candidates: [count]
    - High Confidence (>0.8): [count]
    - Medium Confidence (0.5-0.8): [count]  
    - Low Confidence (<0.5): [count]
    - Estimated Cost: ~$0.01 (Gemini 2.5 Flash)
    \`\`\`

Execute now. Use the memory tools to write the output file.`
}

export type { MetaLearningExtractorConfig } from "./types"
