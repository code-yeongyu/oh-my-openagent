import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import { resolveOmoContextHandoffSettings } from "@oh-my-opencode/omo-config-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { readAgentEndOutcome } from "../ulw-execute-continuation/agent-end-eligibility"
import {
  buildFallbackHandoff,
  buildFreshSessionSeed,
  buildHandoffRequest,
  CONTEXT_HANDOFF_REQUEST_OPEN_TAG,
  SEED_GENERATION_PREFIX,
  SEED_OPEN_TAG,
  type CompactionFailure,
} from "./prompts"

export const CONTEXT_HANDOFF_COMMAND = "omo-context-handoff"
export const CONTEXT_HANDOFF_REQUEST_TYPE = "omo-senpi:context-handoff"
const HANDOFF_DIR = join(".omo", "handoffs")
// Settled runs to wait for the handoff file after asking for it; a goal or ulw continuation may
// take a run of its own before the agent gets to the request.
const HANDOFF_WAIT_RUNS = 3
// A session seeded by this many chained handoffs no longer hands off on its own, so a session that
// fails again right after every switch cannot replace itself forever.
export const MAX_CHAINED_HANDOFFS = 3
// Opening with O_NOFOLLOW fails when the last path component is a symlink. Windows has no such flag;
// the lstat check right before opening is the guard there.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0

// Provider wording for a request rejected because the prompt no longer fits the model's window.
const CONTEXT_OVERFLOW_PATTERN =
  /context[ _-]?(?:length|window|overflow)|prompt is too long|maximum context|too many tokens|exceeds? (?:the )?(?:context|token limit)|context_length_exceeded/i
const RECENT_USER_MESSAGES = 5
// senpi `CompactionRejectionCause` values that mean compaction cannot shrink this session; a cancel by
// an extension, a provider-owned compaction, and a stale revision are not failures of the context.
const FAILED_REJECTION_CAUSES: ReadonlySet<string> = new Set(["would-overflow", "circuit-breaker", "per-turn-cap"])

export interface ContextHandoffSettings {
  readonly enabled: boolean
  readonly thresholdPercent: number
  readonly repeatLimit: number
  readonly repeatWindowMs: number
}

export interface ContextHandoffComponentOptions {
  readonly loadSettings?: (cwd: string) => ContextHandoffSettings
  readonly now?: () => number
}

type Phase = "watching" | "requested" | "switching" | "finished"

interface SessionState {
  phase: Phase
  lastRun: unknown
  generation?: number
  chainCapNotified?: boolean
  sawBelowThreshold: boolean
  pendingFailure?: CompactionFailure
  failure?: CompactionFailure
  compactionTimesMs: number[]
  requestRunError?: string
  handoffPath?: string
  requestedAtMs?: number
  waitedRuns: number
}

interface NotifyUi {
  notify(message: string, level?: "info" | "warning" | "error"): void
}

interface SessionManagerLike {
  getSessionId(): string
  getEntries?(): unknown
  getSessionFile?(): string | undefined
  getSessionDir?(): string
}

interface ReplacedSessionLike {
  readonly ui?: NotifyUi
  sendUserMessage(content: string): Promise<void>
}

interface CommandContextLike {
  readonly cwd?: string
  readonly ui?: NotifyUi
  readonly sessionManager?: SessionManagerLike
  getContextUsage?(): { readonly percent: number | null } | undefined
  waitForIdle?(): Promise<void>
  newSession(options: {
    parentSession?: string
    withSession?: (ctx: ReplacedSessionLike) => Promise<void>
  }): Promise<{ cancelled: boolean }>
}

export function createContextHandoffComponent(options: ContextHandoffComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "context-handoff",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const loadSettings = options.loadSettings ?? defaultLoadSettings
      const now = options.now ?? Date.now
      const settingsByCwd = new Map<string, ContextHandoffSettings>()
      const sessions = new Map<string, SessionState>()

      const settingsFor = (cwd: string): ContextHandoffSettings => {
        const cached = settingsByCwd.get(cwd)
        if (cached !== undefined) return cached
        let settings: ContextHandoffSettings
        try {
          settings = loadSettings(cwd)
        } catch (error) {
          ctx.logger.warn("omo-senpi context-handoff disabled: config unreadable", { error: errorMessage(error) })
          settings = { enabled: false, thresholdPercent: 85, repeatLimit: 3, repeatWindowMs: 600_000 }
        }
        settingsByCwd.set(cwd, settings)
        return settings
      }

      // OFF means nothing is registered: no event hook and no command.
      if (!settingsFor(pi.cwd ?? process.cwd()).enabled) return

      const stateFor = (sessionId: string): SessionState => {
        let state = sessions.get(sessionId)
        if (state === undefined) {
          state = { phase: "watching", lastRun: undefined, waitedRuns: 0, sawBelowThreshold: false, compactionTimesMs: [] }
          sessions.set(sessionId, state)
        }
        return state
      }

      const enabledState = (eventCtx: unknown): { state: SessionState; settings: ContextHandoffSettings } | undefined => {
        const sessionId = sessionIdOf(eventCtx)
        if (sessionId === undefined) return undefined
        const settings = settingsFor(cwdOf(pi, eventCtx))
        return settings.enabled ? { state: stateFor(sessionId), settings } : undefined
      }

      const noteFailure = (state: SessionState, failure: CompactionFailure, sessionId: string | undefined): void => {
        if (state.phase !== "watching" || state.pendingFailure !== undefined) return
        state.pendingFailure = failure
        ctx.logger.info("omo-senpi context-handoff compaction failure observed", { sessionId, ...failure })
      }

      const cancelPending = (state: SessionState): void => {
        state.phase = "watching"
        state.pendingFailure = undefined
        state.failure = undefined
        state.handoffPath = undefined
        state.requestedAtMs = undefined
        state.requestRunError = undefined
        state.waitedRuns = 0
        state.compactionTimesMs = []
      }

      pi.on("session_compact_failed", (payload, eventCtx) => {
        const tracked = enabledState(eventCtx)
        if (tracked === undefined || !isRecord(payload) || payload["aborted"] === true) return
        const detail = typeof payload["errorMessage"] === "string" ? payload["errorMessage"] : "compaction failed"
        noteFailure(tracked.state, { kind: "compaction_error", detail }, sessionIdOf(eventCtx))
      })

      pi.on("session_compact", (payload, eventCtx) => {
        const tracked = enabledState(eventCtx)
        if (tracked === undefined || !isRecord(payload)) return
        const { state, settings } = tracked
        if (payload["accepted"] !== true) {
          const cause = payload["rejectionCause"]
          if (typeof cause === "string" && FAILED_REJECTION_CAUSES.has(cause)) {
            noteFailure(state, { kind: "compaction_rejected", detail: cause }, sessionIdOf(eventCtx))
          }
          return
        }
        const nowMs = now()
        state.compactionTimesMs = [...state.compactionTimesMs.filter((at) => nowMs - at < settings.repeatWindowMs), nowMs]
        if (state.compactionTimesMs.length >= settings.repeatLimit) {
          noteFailure(state, {
            kind: "repeated_compaction",
            detail: `${state.compactionTimesMs.length} compactions within ${Math.round(settings.repeatWindowMs / 60_000)} min`,
          }, sessionIdOf(eventCtx))
          return
        }
        const percent = contextPercentOf(eventCtx)
        if (percent === null) return
        if (percent < settings.thresholdPercent) {
          state.sawBelowThreshold = true
          // senpi recovered on its own: a failure recorded earlier no longer warrants a fresh session.
          if (state.pendingFailure !== undefined || state.phase === "requested") {
            ctx.logger.info("omo-senpi context-handoff cleared: a later compaction brought usage under the limit", {
              sessionId: sessionIdOf(eventCtx),
              percent,
              failure: state.pendingFailure ?? state.failure,
            })
            if (state.phase === "requested") {
              uiOf(eventCtx)?.notify("Context compaction recovered; the pending handoff was cancelled and this session continues.", "info")
            }
            cancelPending(state)
          }
          return
        }
        noteFailure(state, {
          kind: "over_limit_after_compaction",
          detail: `${Math.round(percent)}% after compaction (limit ${settings.thresholdPercent}%)`,
        }, sessionIdOf(eventCtx))
      })

      pi.on("agent_end", (payload, eventCtx) => {
        const tracked = enabledState(eventCtx)
        if (tracked === undefined) return
        const { state } = tracked
        state.lastRun = payload
        const error = runErrorOf(payload)
        if (error === undefined) return
        if (state.phase === "requested") {
          state.requestRunError = error
          return
        }
        if (CONTEXT_OVERFLOW_PATTERN.test(error)) noteFailure(state, { kind: "context_overflow", detail: error }, sessionIdOf(eventCtx))
      })

      pi.on("agent_settled", (_payload, eventCtx) => {
        const sessionId = sessionIdOf(eventCtx)
        if (sessionId === undefined) return
        const cwd = cwdOf(pi, eventCtx)
        const settings = settingsFor(cwd)
        if (!settings.enabled) return
        const state = stateFor(sessionId)
        const run = state.lastRun
        state.lastRun = undefined
        const percent = contextPercentOf(eventCtx)
        if (percent !== null && percent < settings.thresholdPercent) state.sawBelowThreshold = true

        if (state.phase === "watching") {
          const failure = state.pendingFailure
          if (failure === undefined) return
          if (readAgentEndOutcome(run).aborted) return
          if (isCompacting(eventCtx)) return
          state.pendingFailure = undefined
          state.generation ??= seedGenerationOf(eventCtx)
          if (state.generation >= MAX_CHAINED_HANDOFFS) {
            ctx.logger.warn("omo-senpi context-handoff skipped: chained handoff limit reached", { sessionId, generation: state.generation, ...failure })
            if (state.chainCapNotified !== true) {
              state.chainCapNotified = true
              uiOf(eventCtx)?.notify(
                `Context compaction failed (${failure.detail}), but this session already continues ${state.generation} chained handoffs; omo will not start another. Run /${CONTEXT_HANDOFF_COMMAND} yourself to switch anyway.`,
                "warning",
              )
            }
            return
          }
          if (state.generation > 0 && !state.sawBelowThreshold) {
            ctx.logger.info("omo-senpi context-handoff skipped: seeded session never dropped below threshold", { sessionId, ...failure })
            return
          }
          try {
            ensureHandoffDir(cwd, true)
          } catch (error) {
            state.phase = "finished"
            ctx.logger.error("omo-senpi context-handoff refused: unsafe handoff directory", { sessionId, error: errorMessage(error) })
            uiOf(eventCtx)?.notify(`Context compaction failed, but no handoff was requested: ${errorMessage(error)}`, "error")
            return
          }
          const handoffPath = handoffPathFor(cwd, sessionId)
          state.phase = "requested"
          state.failure = failure
          state.handoffPath = handoffPath
          state.requestedAtMs = now()
          state.waitedRuns = 0
          state.requestRunError = undefined
          ctx.logger.info("omo-senpi context-handoff requested", { sessionId, percent, handoffPath, ...failure })
          uiOf(eventCtx)?.notify(
            `Context compaction failed (${failure.detail}). Asking the agent to write a handoff to ${handoffPath}; omo will then continue in a fresh session.`,
            "warning",
          )
          pi.sendMessage(
            {
              customType: CONTEXT_HANDOFF_REQUEST_TYPE,
              content: buildHandoffRequest({ failure, handoffPath }),
              display: true,
            },
            { triggerTurn: true, deliverAs: "followUp" },
          )
          return
        }

        if (state.phase !== "requested" || state.handoffPath === undefined) return
        if (readAgentEndOutcome(run).aborted) {
          ctx.logger.info("omo-senpi context-handoff cancelled: the user aborted the run", { sessionId, handoffPath: state.handoffPath })
          cancelPending(state)
          uiOf(eventCtx)?.notify("Context handoff cancelled because the run was aborted; staying in this session.", "info")
          return
        }
        if (!handoffWritten(cwd, state.handoffPath, state.requestedAtMs ?? 0)) {
          state.waitedRuns += 1
          if (state.requestRunError === undefined && state.waitedRuns < HANDOFF_WAIT_RUNS) return
          if (!writeFallbackHandoff(cwd, state.handoffPath, eventCtx, state, ctx)) {
            state.phase = "finished"
            uiOf(eventCtx)?.notify(`omo could not write a handoff to ${state.handoffPath}; staying in this session.`, "error")
            return
          }
          uiOf(eventCtx)?.notify(
            `The agent could not write a handoff${state.requestRunError === undefined ? "" : ` (${state.requestRunError})`}; omo wrote one from the session record to ${state.handoffPath}.`,
            "warning",
          )
        }
        state.phase = "switching"
        ctx.logger.info("omo-senpi context-handoff switching", { sessionId, handoffPath: state.handoffPath })
        pi.sendUserMessage(`/${CONTEXT_HANDOFF_COMMAND} ${state.handoffPath}`, { expandPromptTemplates: true })
      })

      pi.registerCommand(CONTEXT_HANDOFF_COMMAND, {
        description: "Continue in a fresh session seeded with a handoff file (default .omo/handoffs/<session-id>.md)",
        handler: async (args: unknown, commandCtx: unknown) => {
          await continueInFreshSession(pi, ctx, typeof args === "string" ? args : "", commandCtx as CommandContextLike, sessions)
        },
      })

      pi.on("session_shutdown", (_payload, eventCtx) => {
        const sessionId = sessionIdOf(eventCtx)
        if (sessionId !== undefined) sessions.delete(sessionId)
      })
    },
  }
}

async function continueInFreshSession(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  args: string,
  commandCtx: CommandContextLike,
  sessions: Map<string, SessionState>,
): Promise<void> {
  const cwd = commandCtx.cwd ?? pi.cwd ?? process.cwd()
  const sessionManager = commandCtx.sessionManager
  const sessionId = sessionManager?.getSessionId()
  const requested = args.trim()
  if (requested === "" && sessionId === undefined) {
    commandCtx.ui?.notify(`Usage: /${CONTEXT_HANDOFF_COMMAND} <handoff-file>`, "error")
    return
  }
  const handoffPath = requested === "" ? handoffPathFor(cwd, sessionId as string) : confinedHandoffPath(cwd, requested)
  if (handoffPath === undefined) {
    commandCtx.ui?.notify(`Handoff files must be directly inside ${resolve(cwd, HANDOFF_DIR)}; refused ${requested}.`, "error")
    return
  }
  let handoff: string
  try {
    handoff = readHandoffFile(cwd, handoffPath)
  } catch (error) {
    commandCtx.ui?.notify(`Cannot read handoff ${handoffPath}: ${errorMessage(error)}`, "error")
    if (sessionId !== undefined) markFinished(sessions, sessionId)
    return
  }
  if (handoff.trim() === "") {
    commandCtx.ui?.notify(`Handoff ${handoffPath} is empty; staying in this session.`, "error")
    if (sessionId !== undefined) markFinished(sessions, sessionId)
    return
  }

  const previousSessionFile = sessionManager?.getSessionFile?.()
  const seed = buildFreshSessionSeed({
    handoff,
    handoffPath,
    previousSessionFile,
    failure: sessionId === undefined ? undefined : sessions.get(sessionId)?.failure,
    goalObjective: sessionManager === undefined ? undefined : readOpenGoalObjective(sessionManager),
    generation: seedGenerationOf({ sessionManager }) + 1,
  })
  await commandCtx.waitForIdle?.()
  ctx.logger.info("omo-senpi context-handoff starting fresh session", { sessionId, handoffPath })
  const result = await commandCtx.newSession({
    ...(previousSessionFile === undefined ? {} : { parentSession: previousSessionFile }),
    withSession: async (fresh) => {
      fresh.ui?.notify(`Continuing in a fresh session from handoff ${handoffPath}.`, "info")
      fresh.sendUserMessage(seed).catch((error: unknown) => {
        ctx.logger.error("omo-senpi context-handoff seed delivery failed", { handoffPath, error: errorMessage(error) })
      })
    },
  })
  if (sessionId !== undefined) markFinished(sessions, sessionId)
  if (result.cancelled) commandCtx.ui?.notify("Fresh session was cancelled; staying in this session.", "warning")
}

function writeFallbackHandoff(cwd: string, path: string, eventCtx: unknown, state: SessionState, ctx: ComponentContext): boolean {
  const sessionManager = isRecord(eventCtx) && isRecord(eventCtx["sessionManager"]) ? eventCtx["sessionManager"] : undefined
  const getSessionFile = sessionManager?.["getSessionFile"]
  const sessionFile: unknown = typeof getSessionFile === "function" ? getSessionFile.call(sessionManager) : undefined
  const content = buildFallbackHandoff({
    failure: state.failure ?? { kind: "compaction_error", detail: "unknown" },
    agentError: state.requestRunError,
    previousSessionFile: typeof sessionFile === "string" ? sessionFile : undefined,
    recentUserMessages: recentUserMessages(eventCtx),
  })
  try {
    writeHandoffFile(cwd, path, content)
    return true
  } catch (error) {
    ctx.logger.error("omo-senpi context-handoff fallback handoff write failed", { path, error: errorMessage(error) })
    return false
  }
}

// Walks <cwd>/.omo/handoffs one component at a time, creating missing directories when asked, and
// refuses any component that is a symlink or not a directory, so a handoff is never read from or
// written to a place outside the project.
function ensureHandoffDir(cwd: string, create: boolean): string {
  let current = resolve(cwd)
  for (const part of [".omo", "handoffs"]) {
    current = join(current, part)
    let stats
    try {
      stats = lstatSync(current)
    } catch (error) {
      if (!create || errorCode(error) !== "ENOENT") throw error
      mkdirSync(current)
      continue
    }
    if (stats.isSymbolicLink()) throw new Error(`${current} is a symlink`)
    if (!stats.isDirectory()) throw new Error(`${current} is not a directory`)
  }
  return current
}

// Only a file directly inside <cwd>/.omo/handoffs is accepted; `..` and absolute paths elsewhere are not.
function confinedHandoffPath(cwd: string, requested: string): string | undefined {
  const path = resolve(cwd, requested)
  return dirname(path) === resolve(cwd, HANDOFF_DIR) ? path : undefined
}

function readHandoffFile(cwd: string, path: string): string {
  ensureHandoffDir(cwd, false)
  if (lstatSync(path).isSymbolicLink()) throw new Error(`${path} is a symlink`)
  const fd = openSync(path, constants.O_RDONLY | O_NOFOLLOW)
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`${path} is not a regular file`)
    return readFileSync(fd, "utf8")
  } finally {
    closeSync(fd)
  }
}

// Written to a fresh temp file (`wx` fails if anything already sits there) and renamed over the target;
// rename replaces a symlink at the target instead of following it.
function writeHandoffFile(cwd: string, path: string, content: string): void {
  const dir = ensureHandoffDir(cwd, true)
  const temp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(temp, content, { flag: "wx" })
  try {
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

function recentUserMessages(eventCtx: unknown): string[] {
  if (!isRecord(eventCtx) || !isRecord(eventCtx["sessionManager"])) return []
  const getEntries = eventCtx["sessionManager"]["getEntries"]
  if (typeof getEntries !== "function") return []
  const entries: unknown = getEntries.call(eventCtx["sessionManager"])
  if (!Array.isArray(entries)) return []
  const texts: string[] = []
  for (const entry of entries) {
    if (!isRecord(entry) || entry["type"] !== "message" || !isRecord(entry["message"])) continue
    if (entry["message"]["role"] !== "user") continue
    const text = messageText(entry["message"]["content"]).trim()
    if (text === "" || text.startsWith(CONTEXT_HANDOFF_REQUEST_OPEN_TAG)) continue
    texts.push(text)
  }
  return texts.slice(-RECENT_USER_MESSAGES)
}

function runErrorOf(payload: unknown): string | undefined {
  if (!isRecord(payload) || payload["willRetry"] === true || !Array.isArray(payload["messages"])) return undefined
  const messages = payload["messages"] as unknown[]
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message["role"] !== "assistant") continue
    if (message["stopReason"] !== "error") return undefined
    return typeof message["errorMessage"] === "string" && message["errorMessage"] !== "" ? message["errorMessage"] : "provider error"
  }
  return undefined
}

function isCompacting(eventCtx: unknown): boolean {
  if (!isRecord(eventCtx) || typeof eventCtx["isCompacting"] !== "function") return false
  return (eventCtx["isCompacting"] as () => unknown).call(eventCtx) === true
}

function markFinished(sessions: Map<string, SessionState>, sessionId: string): void {
  const state = sessions.get(sessionId)
  if (state !== undefined) state.phase = "finished"
}

// The built-in goal extension keeps one store per session at
// `<session dir>/extensions/goal/<session id>.json` (senpi `goal/store-ref.js`). A goal that is not
// complete is carried into the seed so the fresh session can register it again.
function readOpenGoalObjective(sessionManager: SessionManagerLike): string | undefined {
  const sessionDir = sessionManager.getSessionDir?.()
  if (sessionDir === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(sessionDir, "extensions", "goal", `${sessionManager.getSessionId()}.json`), "utf8"),
    )
    const goal = isRecord(parsed) ? parsed["goal"] : undefined
    if (!isRecord(goal) || typeof goal["objective"] !== "string" || goal["status"] === "complete") return undefined
    return goal["objective"]
  } catch {
    return undefined
  }
}

function defaultLoadSettings(cwd: string): ContextHandoffSettings {
  return resolveOmoContextHandoffSettings(loadSenpiOmoConfig({ cwd }).config)
}

export function handoffPathFor(cwd: string, sessionId: string): string {
  return join(cwd, HANDOFF_DIR, `${sessionId.replace(/[^A-Za-z0-9._-]+/g, "-")}.md`)
}

function handoffWritten(cwd: string, path: string, sinceMs: number): boolean {
  try {
    ensureHandoffDir(cwd, false)
    const stats = lstatSync(path)
    return stats.isFile() && stats.size > 0 && stats.mtimeMs >= sinceMs - 1000
  } catch {
    return false
  }
}

// How many chained handoffs produced this session: 0 when its first user message is not a handoff seed.
// A fresh session that starts at or above the threshold (an oversized handoff, a very low threshold)
// would otherwise hand off again on its first run and loop.
function seedGenerationOf(eventCtx: unknown): number {
  if (!isRecord(eventCtx) || !isRecord(eventCtx["sessionManager"])) return 0
  const getEntries = eventCtx["sessionManager"]["getEntries"]
  if (typeof getEntries !== "function") return 0
  const entries: unknown = getEntries.call(eventCtx["sessionManager"])
  if (!Array.isArray(entries)) return 0
  for (const entry of entries) {
    if (!isRecord(entry) || entry["type"] !== "message" || !isRecord(entry["message"])) continue
    if (entry["message"]["role"] !== "user") continue
    const text = messageText(entry["message"]["content"]).trimStart()
    if (!text.startsWith(SEED_OPEN_TAG)) return 0
    const line = text.split("\n").find((candidate) => candidate.startsWith(SEED_GENERATION_PREFIX))
    const generation = line === undefined ? Number.NaN : Number(line.slice(SEED_GENERATION_PREFIX.length))
    return Number.isInteger(generation) && generation > 0 ? generation : 1
  }
  return 0
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part: unknown) => (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string" ? part["text"] : ""))
    .join("")
}

function contextPercentOf(eventCtx: unknown): number | null {
  if (!isRecord(eventCtx) || typeof eventCtx["getContextUsage"] !== "function") return null
  const usage: unknown = (eventCtx["getContextUsage"] as () => unknown).call(eventCtx)
  if (!isRecord(usage) || typeof usage["percent"] !== "number" || !Number.isFinite(usage["percent"])) return null
  return usage["percent"]
}

function sessionIdOf(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx["sessionManager"])) return undefined
  const getSessionId = eventCtx["sessionManager"]["getSessionId"]
  if (typeof getSessionId !== "function") return undefined
  const id: unknown = getSessionId.call(eventCtx["sessionManager"])
  return typeof id === "string" && id.length > 0 ? id : undefined
}

function cwdOf(pi: SenpiExtensionAPI, eventCtx: unknown): string {
  if (isRecord(eventCtx) && typeof eventCtx["cwd"] === "string") return eventCtx["cwd"]
  return pi.cwd ?? process.cwd()
}

function uiOf(eventCtx: unknown): NotifyUi | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx["ui"])) return undefined
  const ui = eventCtx["ui"]
  return typeof ui["notify"] === "function" ? (ui as unknown as NotifyUi) : undefined
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error["code"] : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
