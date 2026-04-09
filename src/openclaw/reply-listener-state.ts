import { existsSync, readFileSync, unlinkSync } from "fs"
import type { OpenClawConfig } from "./types"
import { writeSecureReplyListenerFile } from "./reply-listener-log"
import {
  getReplyListenerConfigFilePath,
  getReplyListenerPidFilePath,
  getReplyListenerStateFilePath,
} from "./reply-listener-paths"

export const REPLY_LISTENER_STARTUP_TOKEN_ENV = "OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TOKEN"

export interface ReplyListenerDaemonState {
  isRunning: boolean
  pid: number | null
  startedAt: string
  startupToken: string | null
  configSignature: string | null
  lastPollAt: string | null
  telegramLastUpdateId: number | null
  discordLastMessageId: string | null
  lastDiscordMessageId: string | null
  messagesSeen: number
  messagesInjected: number
  errors: number
  lastError?: string
}

function createDefaultReplyListenerState(): ReplyListenerDaemonState {
  return {
    isRunning: false,
    pid: null,
    startedAt: new Date().toISOString(),
    startupToken: null,
    configSignature: null,
    lastPollAt: null,
    telegramLastUpdateId: null,
    discordLastMessageId: null,
    lastDiscordMessageId: null,
    messagesSeen: 0,
    messagesInjected: 0,
    errors: 0,
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function normalizeReplyListenerState(raw: unknown): ReplyListenerDaemonState {
  const defaults = createDefaultReplyListenerState()

  if (typeof raw !== "object" || raw === null) {
    return defaults
  }

  const state = raw as Partial<ReplyListenerDaemonState>
  return {
    isRunning: state.isRunning === true,
    pid: isNumber(state.pid) ? state.pid : null,
    startedAt: typeof state.startedAt === "string" ? state.startedAt : defaults.startedAt,
    startupToken: typeof state.startupToken === "string" ? state.startupToken : null,
    configSignature: typeof state.configSignature === "string" ? state.configSignature : null,
    lastPollAt: typeof state.lastPollAt === "string" ? state.lastPollAt : null,
    telegramLastUpdateId: isNumber(state.telegramLastUpdateId) ? state.telegramLastUpdateId : null,
    discordLastMessageId: getDiscordMessageId(state),
    lastDiscordMessageId: getDiscordMessageId(state),
    messagesSeen: isNumber(state.messagesSeen) ? state.messagesSeen : 0,
    messagesInjected: isNumber(state.messagesInjected) ? state.messagesInjected : 0,
    errors: isNumber(state.errors) ? state.errors : 0,
    ...(typeof state.lastError === "string" ? { lastError: state.lastError } : {}),
  }
}

function getDiscordMessageId(state: Partial<ReplyListenerDaemonState>): string | null {
  if (typeof state.lastDiscordMessageId === "string") {
    return state.lastDiscordMessageId
  }

  if (typeof state.discordLastMessageId === "string") {
    return state.discordLastMessageId
  }

  return null
}

export function createPendingReplyListenerState(startupToken: string): ReplyListenerDaemonState {
  return {
    ...createDefaultReplyListenerState(),
    startedAt: new Date().toISOString(),
    startupToken,
  }
}

export function readReplyListenerDaemonState(): ReplyListenerDaemonState | null {
  try {
    const stateFilePath = getReplyListenerStateFilePath()
    if (!existsSync(stateFilePath)) return null
    return normalizeReplyListenerState(JSON.parse(readFileSync(stateFilePath, "utf-8")))
  } catch {
    return null
  }
}

export function writeReplyListenerDaemonState(state: ReplyListenerDaemonState): void {
  writeSecureReplyListenerFile(
    getReplyListenerStateFilePath(),
    JSON.stringify(
      {
        ...state,
        lastDiscordMessageId: state.lastDiscordMessageId ?? state.discordLastMessageId,
        discordLastMessageId: state.discordLastMessageId ?? state.lastDiscordMessageId,
      },
      null,
      2,
    ),
  )
}

export function readReplyListenerDaemonConfig(): OpenClawConfig | null {
  try {
    const configFilePath = getReplyListenerConfigFilePath()
    if (!existsSync(configFilePath)) return null
    return JSON.parse(readFileSync(configFilePath, "utf-8")) as OpenClawConfig
  } catch {
    return null
  }
}

export function writeReplyListenerDaemonConfig(config: OpenClawConfig): void {
  writeSecureReplyListenerFile(getReplyListenerConfigFilePath(), JSON.stringify(config, null, 2))
}

export function readReplyListenerPid(): number | null {
  try {
    const pidFilePath = getReplyListenerPidFilePath()
    if (!existsSync(pidFilePath)) return null
    const pid = Number.parseInt(readFileSync(pidFilePath, "utf-8").trim(), 10)
    return Number.isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

export function writeReplyListenerPid(pid: number): void {
  writeSecureReplyListenerFile(getReplyListenerPidFilePath(), String(pid))
}

export function removeReplyListenerPid(): void {
  const pidFilePath = getReplyListenerPidFilePath()
  if (existsSync(pidFilePath)) {
    unlinkSync(pidFilePath)
  }
}

export function getReplyListenerStartupTokenFromEnv(): string | null {
  const token = process.env[REPLY_LISTENER_STARTUP_TOKEN_ENV]
  return token && token.length > 0 ? token : null
}

export function recordReplyListenerPoll(state: ReplyListenerDaemonState, pid: number): void {
  state.isRunning = true
  state.pid = pid
  state.lastPollAt = new Date().toISOString()
}

export function recordSeenDiscordMessage(
  state: ReplyListenerDaemonState,
  messageId: string,
): void {
  state.discordLastMessageId = messageId
  state.lastDiscordMessageId = messageId
  state.messagesSeen += 1
}

export function markReplyListenerStopped(
  state: ReplyListenerDaemonState | null,
  error?: string,
): ReplyListenerDaemonState {
  const nextState = state ?? createDefaultReplyListenerState()
  nextState.isRunning = false
  nextState.pid = null
  nextState.startupToken = null
  if (error) {
    nextState.lastError = error
  }
  return nextState
}
