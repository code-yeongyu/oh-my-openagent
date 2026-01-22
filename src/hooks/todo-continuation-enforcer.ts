import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import type { BackgroundManager } from "../features/background-agent"
import { readBoulderState } from "../features/boulder-state"
import { readPlanProgress } from "../features/plan-progress-reader"
import { getMainSessionID, subagentSessions } from "../features/claude-code-session-state"
import {
    findNearestMessageWithFields,
    MESSAGE_STORAGE,
    type ToolPermission,
} from "../features/hook-message-injector"
import { log } from "../shared/logger"
import { createSystemDirective, SystemDirectiveTypes } from "../shared/system-directive"
import { isInCompactionCooldown, getCompactionCooldownRemaining, clearCompactionState } from "./compaction-state"

const HOOK_NAME = "todo-continuation-enforcer"

const DEFAULT_SKIP_AGENTS = ["prometheus", "compaction"]

export interface TodoContinuationEnforcerOptions {
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
}

export interface TodoContinuationEnforcer {
  handler: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
}

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

interface SessionState {
  countdownTimer?: ReturnType<typeof setTimeout>
  countdownInterval?: ReturnType<typeof setInterval>
  isRecovering?: boolean
  countdownStartedAt?: number
  abortDetectedAt?: number
  /** Checkbox enforcement state */
  checkboxEnforcement?: {
    /** Last git diff hash (to detect code changes) */
    lastCodeDiffHash?: string
    /** Last tasks.md mtime */
    lastTasksMtime?: number
    /** Consecutive reminder count */
    reminderCount: number
  }
}

const CONTINUATION_PROMPT = `${createSystemDirective(SystemDirectiveTypes.TODO_CONTINUATION)}

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

const COUNTDOWN_SECONDS = 2
const TOAST_DURATION_MS = 900
const COUNTDOWN_GRACE_PERIOD_MS = 500

/**
 * Keywords that indicate user is making a git/publish decision.
 * When detected in the last user message, auto-continuation is suppressed.
 * This prevents the enforcer from interrupting git strategy selection flow.
 */
const GIT_PUBLISH_KEYWORDS = [
  // Git operations (English)
  "merge", "pr", "pull request", "push", "commit", "keep", "discard",
  "rebase", "squash", "cherry-pick", "checkout", "branch", "tag",
  // Git operations (Chinese)
  "合并", "推送", "提交", "保留", "丢弃", "放弃", "变基",
  // Publish/Deploy (English)
  "upload", "publish", "deploy", "release", "ship", "npm publish",
  // Publish/Deploy (Chinese)
  "上传", "发布", "部署", "发版", "发行",
  // Options selection (when Phase 3 presents numbered choices)
  "option 1", "option 2", "option 3", "option 4",
  "选项1", "选项2", "选项3", "选项4",
  "选择1", "选择2", "选择3", "选择4",
]

/**
 * Check if message content contains git/publish decision keywords.
 * Case-insensitive matching.
 */
function containsGitPublishKeywords(content: string): boolean {
  if (!content) return false
  const lowerContent = content.toLowerCase()
  return GIT_PUBLISH_KEYWORDS.some(keyword => lowerContent.includes(keyword.toLowerCase()))
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

function getIncompleteCount(todos: Todo[]): number {
  return todos.filter(t => t.status !== "completed" && t.status !== "cancelled").length
}

interface MessageInfo {
  id?: string
  role?: string
  error?: { name?: string; data?: unknown }
}

function isLastAssistantMessageAborted(messages: Array<{ info?: MessageInfo }>): boolean {
  if (!messages || messages.length === 0) return false

  const assistantMessages = messages.filter(m => m.info?.role === "assistant")
  if (assistantMessages.length === 0) return false

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  const errorName = lastAssistant.info?.error?.name

  if (!errorName) return false

  return errorName === "MessageAbortedError" || errorName === "AbortError"
}

export function createTodoContinuationEnforcer(
  ctx: PluginInput,
  options: TodoContinuationEnforcerOptions = {}
): TodoContinuationEnforcer {
  const { backgroundManager, skipAgents = DEFAULT_SKIP_AGENTS } = options
  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  function cancelCountdown(sessionID: string): void {
    const state = sessions.get(sessionID)
    if (!state) return

    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }
    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }
    state.countdownStartedAt = undefined
  }

  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }

  const markRecovering = (sessionID: string): void => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID)
    log(`[${HOOK_NAME}] Session marked as recovering`, { sessionID })
  }

  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.isRecovering = false
      log(`[${HOOK_NAME}] Session recovery complete`, { sessionID })
    }
  }

  async function showCountdownToast(seconds: number, incompleteCount: number): Promise<void> {
    await ctx.client.tui.showToast({
      body: {
        title: "Todo Continuation",
        message: `Resuming in ${seconds}s... (${incompleteCount} tasks remaining)`,
        variant: "warning" as const,
        duration: TOAST_DURATION_MS,
      },
    }).catch(() => {})
  }

  interface ResolvedMessageInfo {
    agent?: string
    model?: { providerID: string; modelID: string }
    tools?: Record<string, ToolPermission>
  }

  async function injectContinuation(
    sessionID: string,
    incompleteCount: number,
    total: number,
    resolvedInfo?: ResolvedMessageInfo
  ): Promise<void> {
    const state = sessions.get(sessionID)

    if (state?.isRecovering) {
      log(`[${HOOK_NAME}] Skipped injection: in recovery`, { sessionID })
      return
    }

    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
      return
    }

    let todos: Todo[] = []
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      todos = (response.data ?? response) as Todo[]
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to fetch todos`, { sessionID, error: String(err) })
      return
    }

    const freshIncompleteCount = getIncompleteCount(todos)
    if (freshIncompleteCount === 0) {
      log(`[${HOOK_NAME}] Skipped injection: no incomplete todos`, { sessionID })
      return
    }

    let agentName = resolvedInfo?.agent
    let model = resolvedInfo?.model
    let tools = resolvedInfo?.tools

    if (!agentName || !model) {
      const messageDir = getMessageDir(sessionID)
      const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
      agentName = agentName ?? prevMessage?.agent
      model = model ?? (prevMessage?.model?.providerID && prevMessage?.model?.modelID
        ? { providerID: prevMessage.model.providerID, modelID: prevMessage.model.modelID }
        : undefined)
      tools = tools ?? prevMessage?.tools
    }

    if (agentName && skipAgents.includes(agentName)) {
      log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: agentName })
      return
    }

    const editPermission = tools?.edit
    const writePermission = tools?.write
    const hasWritePermission = !tools ||
      ((editPermission !== false && editPermission !== "deny") &&
       (writePermission !== false && writePermission !== "deny"))
    if (!hasWritePermission) {
      log(`[${HOOK_NAME}] Skipped: agent lacks write permission`, { sessionID, agent: agentName })
      return
    }

    const prompt = `${CONTINUATION_PROMPT}\n\n[Status: ${todos.length - freshIncompleteCount}/${todos.length} completed, ${freshIncompleteCount} remaining]`

    try {
      log(`[${HOOK_NAME}] Injecting continuation`, { sessionID, agent: agentName, model, incompleteCount: freshIncompleteCount })

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: agentName,
          ...(model !== undefined ? { model } : {}),
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })

      log(`[${HOOK_NAME}] Injection successful`, { sessionID })
    } catch (err) {
      log(`[${HOOK_NAME}] Injection failed`, { sessionID, error: String(err) })
    }
  }

  function startCountdown(
    sessionID: string,
    incompleteCount: number,
    total: number,
    resolvedInfo?: ResolvedMessageInfo
  ): void {
    const state = getState(sessionID)
    cancelCountdown(sessionID)

    let secondsRemaining = COUNTDOWN_SECONDS
    showCountdownToast(secondsRemaining, incompleteCount)
    state.countdownStartedAt = Date.now()

    state.countdownInterval = setInterval(() => {
      secondsRemaining--
      if (secondsRemaining > 0) {
        showCountdownToast(secondsRemaining, incompleteCount)
      }
    }, 1000)

    state.countdownTimer = setTimeout(() => {
      cancelCountdown(sessionID)
      injectContinuation(sessionID, incompleteCount, total, resolvedInfo)
    }, COUNTDOWN_SECONDS * 1000)

    log(`[${HOOK_NAME}] Countdown started`, { sessionID, seconds: COUNTDOWN_SECONDS, incompleteCount })
  }

  const handler = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const error = props?.error as { name?: string; message?: string } | undefined
      if (error?.name === "MessageAbortedError" || error?.name === "AbortError") {
        const state = getState(sessionID)
        state.abortDetectedAt = Date.now()
        log(`[${HOOK_NAME}] Abort detected via session.error`, { sessionID, errorName: error.name })
      }
      
      // Detect context limit errors which trigger compaction
      // Note: This is a fallback - the main compaction detection is via onSummarize hook
      // in compaction-context-injector which uses shared compaction-state
      const errorStr = JSON.stringify(error ?? {}).toLowerCase()
      if (errorStr.includes("prompt is too long") || 
          errorStr.includes("context limit") || 
          errorStr.includes("server-side context limit") ||
          errorStr.includes("token") && errorStr.includes("limit")) {
        cancelCountdown(sessionID)
        log(`[${HOOK_NAME}] Context limit error detected`, { sessionID, errorStr: errorStr.slice(0, 200) })
      }

      cancelCountdown(sessionID)
      log(`[${HOOK_NAME}] session.error`, { sessionID })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle`, { sessionID })

      const mainSessionID = getMainSessionID()
      const isMainSession = sessionID === mainSessionID
      const isBackgroundTaskSession = subagentSessions.has(sessionID)

      if (mainSessionID && !isMainSession && !isBackgroundTaskSession) {
        log(`[${HOOK_NAME}] Skipped: not main or background task session`, { sessionID })
        return
      }

      const state = getState(sessionID)

      if (state.isRecovering) {
        log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
        return
      }

      // Check 1: Event-based abort detection (primary, most reliable)
      if (state.abortDetectedAt) {
        const timeSinceAbort = Date.now() - state.abortDetectedAt
        const ABORT_WINDOW_MS = 3000
        if (timeSinceAbort < ABORT_WINDOW_MS) {
          log(`[${HOOK_NAME}] Skipped: abort detected via event ${timeSinceAbort}ms ago`, { sessionID })
          state.abortDetectedAt = undefined
          return
        }
        state.abortDetectedAt = undefined
      }

      // Check 1.5: Post-compact cooldown (1 minute after compact, don't remind)
      // Uses shared state from compaction-context-injector via onSummarize hook
      if (isInCompactionCooldown(sessionID)) {
        log(`[${HOOK_NAME}] Skipped: post-compact cooldown active`, { sessionID, cooldownRemaining: getCompactionCooldownRemaining(sessionID) })
        return
      }

      // Check 1.6: Boulder state - don't auto-continue when awaiting user input or completed
      // This prevents todo-continuation from interfering with Phase 3 git strategy selection
      const boulderState = readBoulderState(ctx.directory)
      if (boulderState?.phase === "awaiting_user" || boulderState?.phase === "completed") {
        log(`[${HOOK_NAME}] Skipped: boulder in terminal state (${boulderState.phase})`, { sessionID, plan: boulderState.plan_name })
        return
      }

      // Check 1.7: Plan progress check (File is Source of Truth)
      // Priority: boulder.phase === "completed" > tasks.md > OpenCode todos
      const planProgress = readPlanProgress(ctx.directory)
      if (planProgress) {
        // tasks.md exists - use it as source of truth (ignore OpenCode todos)
        const checkboxesComplete = planProgress.completed === planProgress.total || planProgress.total === 0
        const phasesComplete = !planProgress.phases || planProgress.phases.length === 0 || 
          planProgress.phases.every(p => p.status === "complete")
        
        if (checkboxesComplete && phasesComplete) {
          log(`[${HOOK_NAME}] Skipped: plan complete (tasks.md is source of truth)`, { 
            sessionID, 
            planPath: planProgress.planPath,
            checkboxes: `${planProgress.completed}/${planProgress.total}`,
            phases: planProgress.phases?.length ?? 0
          })
          return
        }
        
        // Plan not complete - will inject continuation below
        log(`[${HOOK_NAME}] Plan incomplete (tasks.md)`, {
          sessionID,
          checkboxes: `${planProgress.completed}/${planProgress.total}`,
          phasesComplete,
          incompleteTasks: planProgress.total - planProgress.completed
        })

        // Check 1.8: Checkbox update enforcement (3-strike system)
        // Detect code changes without tasks.md update
        const state = getState(sessionID)
        if (!state.checkboxEnforcement) {
          state.checkboxEnforcement = { reminderCount: 0 }
        }
        const enforcement = state.checkboxEnforcement

        try {
          // Get current tasks.md mtime
          const currentTasksMtime = existsSync(planProgress.planPath) 
            ? statSync(planProgress.planPath).mtimeMs 
            : 0

          // Get git diff hash for code files (excluding .md files)
          let currentDiffHash = ""
          try {
            const diffOutput = execSync("git diff --name-only", { 
              cwd: ctx.directory, 
              encoding: "utf-8",
              timeout: 5000
            }).trim()
            // Filter to code files only (exclude .md)
            const codeFiles = diffOutput.split("\n").filter(f => f && !f.endsWith(".md"))
            currentDiffHash = codeFiles.join(",")
          } catch {
            // Git not available or not a repo - skip enforcement
            currentDiffHash = ""
          }

          // Check if code changed but tasks.md didn't
          const codeChanged = currentDiffHash && currentDiffHash !== enforcement.lastCodeDiffHash
          const tasksUpdated = currentTasksMtime !== enforcement.lastTasksMtime

          if (codeChanged && !tasksUpdated && enforcement.lastTasksMtime !== undefined) {
            enforcement.reminderCount++
            log(`[${HOOK_NAME}] Code changed but tasks.md not updated`, {
              sessionID,
              reminderCount: enforcement.reminderCount,
              codeFiles: currentDiffHash.slice(0, 100)
            })

            if (enforcement.reminderCount >= 3) {
              // 3rd strike - refuse auto-continuation
              log(`[${HOOK_NAME}] Checkbox enforcement: 3-strike limit reached, refusing auto-continue`, { sessionID })
              await ctx.client.tui.showToast({
                body: {
                  title: "Tasks.md Update Required",
                  message: "Code changed 3+ times without updating tasks.md. Please update manually.",
                  variant: "error" as const,
                  duration: 5000,
                },
              }).catch(() => {})
              return
            }
          } else if (tasksUpdated) {
            // tasks.md updated - reset counter
            enforcement.reminderCount = 0
          }

          // Update tracking state
          enforcement.lastCodeDiffHash = currentDiffHash
          enforcement.lastTasksMtime = currentTasksMtime
        } catch (err) {
          log(`[${HOOK_NAME}] Checkbox enforcement check failed`, { sessionID, error: String(err) })
        }
      }

      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
        return
      }

      // Check 2: API-based abort detection (fallback, for cases where event was missed)
      // Also check for git/publish keywords in last assistant message
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })
        const messages = (messagesResp as { data?: Array<{ info?: MessageInfo; parts?: Array<{ type: string; text?: string }> }> }).data ?? []

        if (isLastAssistantMessageAborted(messages)) {
          log(`[${HOOK_NAME}] Skipped: last assistant message was aborted (API fallback)`, { sessionID })
          return
        }

        // Check 2.5: Git/publish keyword detection in last assistant message
        // When AI presents git strategy options or asks about publish/deploy, stop auto-continuation
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i] as { info?: { role?: string }; parts?: Array<{ type: string; text?: string }> }
          if (msg.info?.role === "assistant" && msg.parts) {
            const textParts = msg.parts.filter(p => p.type === "text" && p.text)
            const assistantContent = textParts.map(p => p.text).join(" ")
            if (containsGitPublishKeywords(assistantContent)) {
              log(`[${HOOK_NAME}] Skipped: git/publish keywords detected in last assistant message`, { sessionID, preview: assistantContent.slice(0, 100) })
              return
            }
            break // Only check the last assistant message
          }
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Messages fetch failed, continuing`, { sessionID, error: String(err) })
      }

      let todos: Todo[] = []
      try {
        const response = await ctx.client.session.todo({ path: { id: sessionID } })
        todos = (response.data ?? response) as Todo[]
      } catch (err) {
        log(`[${HOOK_NAME}] Todo fetch failed`, { sessionID, error: String(err) })
        return
      }

      if (!todos || todos.length === 0) {
        log(`[${HOOK_NAME}] No todos`, { sessionID })
        return
      }

      const incompleteCount = getIncompleteCount(todos)
      if (incompleteCount === 0) {
        log(`[${HOOK_NAME}] All todos complete`, { sessionID, total: todos.length })
        return
      }

      let resolvedInfo: ResolvedMessageInfo | undefined
      let hasCompactionMessage = false
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
        })
        const messages = (messagesResp.data ?? []) as Array<{
          info?: {
            agent?: string
            model?: { providerID: string; modelID: string }
            modelID?: string
            providerID?: string
            tools?: Record<string, ToolPermission>
          }
        }>
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i].info
          if (info?.agent === "compaction") {
            hasCompactionMessage = true
            continue
          }
          if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
            resolvedInfo = {
              agent: info.agent,
              model: info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined),
              tools: info.tools,
            }
            break
          }
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to fetch messages for agent check`, { sessionID, error: String(err) })
      }

      log(`[${HOOK_NAME}] Agent check`, { sessionID, agentName: resolvedInfo?.agent, skipAgents, hasCompactionMessage })
      if (resolvedInfo?.agent && skipAgents.includes(resolvedInfo.agent)) {
        log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: resolvedInfo.agent })
        return
      }
      if (hasCompactionMessage && !resolvedInfo?.agent) {
        log(`[${HOOK_NAME}] Skipped: compaction occurred but no agent info resolved`, { sessionID })
        return
      }

      startCountdown(sessionID, incompleteCount, todos.length, resolvedInfo)
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined
      const agent = info?.agent as string | undefined

      if (!sessionID) return

      // Detect compaction agent - trigger cooldown to prevent todo-reminder conflict
      if (agent === "compaction") {
        const { markCompaction } = await import("./compaction-state")
        markCompaction(sessionID)
        cancelCountdown(sessionID)
        log(`[${HOOK_NAME}] Compaction agent detected, starting 1-minute cooldown`, { sessionID })
        return
      }

      if (role === "user") {
        const state = sessions.get(sessionID)
        if (state?.countdownStartedAt) {
          const elapsed = Date.now() - state.countdownStartedAt
          if (elapsed < COUNTDOWN_GRACE_PERIOD_MS) {
            log(`[${HOOK_NAME}] Ignoring user message in grace period`, { sessionID, elapsed })
            return
          }
        }
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }

      if (role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        cleanup(sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
      return
    }

    // Note: Compaction is now tracked via shared compaction-state module
    // which is updated by compaction-context-injector's onSummarize hook
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
  }
}
