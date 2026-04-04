import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
  statSync,
  appendFileSync,
  renameSync,
} from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { spawn } from "bun" // Use bun spawn
import { captureTmuxPane, analyzePaneContent, sendToPane, isTmuxAvailable } from "./tmux"
import { lookupByMessageId, removeMessagesByPane, pruneStale } from "./session-registry"
import type { OpenClawConfig } from "./types"
import { normalizeReplyListenerConfig } from "./config"

const SECURE_FILE_MODE = 0o600
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024
const DAEMON_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "USER",
  "USERNAME",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMUX",
  "TMUX_PANE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_RUNTIME_DIR",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "SHELL",
  "NODE_ENV",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "COMSPEC",
]

const DEFAULT_STATE_DIR = join(homedir(), ".omx", "state")
const PID_FILE_PATH = join(DEFAULT_STATE_DIR, "reply-listener.pid")
const STATE_FILE_PATH = join(DEFAULT_STATE_DIR, "reply-listener-state.json")
const CONFIG_FILE_PATH = join(DEFAULT_STATE_DIR, "reply-listener-config.json")
const LOG_FILE_PATH = join(DEFAULT_STATE_DIR, "reply-listener.log")

export const DAEMON_IDENTITY_MARKER = "--openclaw-reply-listener-daemon"

function createMinimalDaemonEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of DAEMON_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key] as string
    }
  }
  return env
}

function ensureStateDir(): void {
  if (!existsSync(DEFAULT_STATE_DIR)) {
    mkdirSync(DEFAULT_STATE_DIR, { recursive: true, mode: 0o700 })
  }
}

function writeSecureFile(filePath: string, content: string): void {
  ensureStateDir()
  writeFileSync(filePath, content, { mode: SECURE_FILE_MODE })
  try {
    chmodSync(filePath, SECURE_FILE_MODE)
  } catch {
  }
}

function rotateLogIfNeeded(logPath: string): void {
  try {
    if (!existsSync(logPath)) return
    const stats = statSync(logPath)
    if (stats.size > MAX_LOG_SIZE_BYTES) {
      const backupPath = `${logPath}.old`
      if (existsSync(backupPath)) {
        unlinkSync(backupPath)
      }
      renameSync(logPath, backupPath)
    }
  } catch {
  }
}

function log(message: string): void {
  try {
    ensureStateDir()
    rotateLogIfNeeded(LOG_FILE_PATH)
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] ${message}\n`
    appendFileSync(LOG_FILE_PATH, logLine, { mode: SECURE_FILE_MODE })
  } catch {
  }
}

export function logReplyListenerMessage(message: string): void {
  log(message)
}

interface DaemonState {
  isRunning: boolean
  pid: number | null
  startedAt: string
  lastPollAt: string | null
  telegramLastUpdateId: number | null
  discordLastMessageId: string | null
  messagesInjected: number
  errors: number
  lastError?: string
}

interface TelegramMessage {
  message_id?: number
  chat?: { id?: number | string }
  text?: string
  reply_to_message?: { message_id?: number }
}

interface TelegramUpdate {
  update_id?: number
  message?: TelegramMessage
}

interface TelegramUpdatesResponse {
  result?: TelegramUpdate[]
}

function parseTelegramUpdatesResponse(body: unknown): TelegramUpdate[] {
  if (typeof body !== "object" || body === null) {
    return []
  }

  const result = (body as TelegramUpdatesResponse).result
  return Array.isArray(result) ? result : []
}

function readDaemonState(): DaemonState | null {
  try {
    if (!existsSync(STATE_FILE_PATH)) return null
    const content = readFileSync(STATE_FILE_PATH, "utf-8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

function writeDaemonState(state: DaemonState): void {
  writeSecureFile(STATE_FILE_PATH, JSON.stringify(state, null, 2))
}

function readDaemonConfig(): OpenClawConfig | null {
  try {
    if (!existsSync(CONFIG_FILE_PATH)) return null
    const content = readFileSync(CONFIG_FILE_PATH, "utf-8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

function writeDaemonConfig(config: OpenClawConfig): void {
  writeSecureFile(CONFIG_FILE_PATH, JSON.stringify(config, null, 2))
}

function readPidFile(): number | null {
  try {
    if (!existsSync(PID_FILE_PATH)) return null
    const content = readFileSync(PID_FILE_PATH, "utf-8")
    const pid = parseInt(content.trim(), 10)
    if (Number.isNaN(pid)) return null
    return pid
  } catch {
    return null
  }
}

function writePidFile(pid: number): void {
  writeSecureFile(PID_FILE_PATH, String(pid))
}

function removePidFile(): void {
  if (existsSync(PID_FILE_PATH)) {
    unlinkSync(PID_FILE_PATH)
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function isReplyListenerProcess(pid: number): Promise<boolean> {
  try {
    if (process.platform === "linux") {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8")
      return cmdline.includes(DAEMON_IDENTITY_MARKER)
    }
    const proc = spawn(["ps", "-p", String(pid), "-o", "args="], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const stdout = await new Response(proc.stdout).text()
    if (proc.exitCode !== 0) return false
    return stdout.includes(DAEMON_IDENTITY_MARKER)
  } catch {
    return false
  }
}

export async function isDaemonRunning(): Promise<boolean> {
  const pid = readPidFile()
  if (pid === null) return false
  if (!isProcessRunning(pid)) {
    removePidFile()
    return false
  }
  if (!(await isReplyListenerProcess(pid))) {
    removePidFile()
    return false
  }
  return true
}

export function sanitizeReplyInput(text: string): string {
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\(/g, "\\$(")
    .replace(/\$\{/g, "\\${")
    .trim()
}

class RateLimiter {
  maxPerMinute: number
  timestamps: number[] = []
  windowMs = 60 * 1000

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute
  }

  canProceed(): boolean {
    const now = Date.now()
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs)
    if (this.timestamps.length >= this.maxPerMinute) return false
    this.timestamps.push(now)
    return true
  }
}

async function injectReply(
  paneId: string,
  text: string,
  platform: string,
  config: OpenClawConfig,
): Promise<boolean> {
  const replyListener = config.replyListener
  const content = await captureTmuxPane(paneId, 15)
  const analysis = analyzePaneContent(content)

  if (analysis.confidence < 0.3) { // Lower threshold for simple check
    log(
      `WARN: Pane ${paneId} does not appear to be running OpenCode CLI (confidence: ${analysis.confidence}). Skipping injection, removing stale mapping.`,
    )
    removeMessagesByPane(paneId)
    return false
  }

  const prefix = replyListener?.includePrefix === false ? "" : `[reply:${platform}] `
  const sanitized = sanitizeReplyInput(prefix + text)
  const truncated = sanitized.slice(0, replyListener?.maxMessageLength ?? 500)
  const success = await sendToPane(paneId, truncated, true)

  if (success) {
    log(
      `Injected reply from ${platform} into pane ${paneId}: "${truncated.slice(0, 50)}${truncated.length > 50 ? "..." : ""}"`,
    )
  } else {
    log(`ERROR: Failed to inject reply into pane ${paneId}`)
  }
  return success
}

let discordBackoffUntil = 0

async function pollDiscord(
  config: OpenClawConfig,
  state: DaemonState,
  rateLimiter: RateLimiter,
): Promise<void> {
  const replyListener = config.replyListener
  if (!replyListener?.discordBotToken || !replyListener.discordChannelId) return
  if (
    !replyListener.authorizedDiscordUserIds
    || replyListener.authorizedDiscordUserIds.length === 0
  ) {
    return
  }
  if (Date.now() < discordBackoffUntil) return

  try {
    const after = state.discordLastMessageId
      ? `?after=${state.discordLastMessageId}&limit=10`
      : "?limit=10"
    const url = `https://discord.com/api/v10/channels/${replyListener.discordChannelId}/messages${after}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bot ${replyListener.discordBotToken}` },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const remaining = response.headers.get("x-ratelimit-remaining")
    const reset = response.headers.get("x-ratelimit-reset")

    if (remaining !== null && parseInt(remaining, 10) < 2) {
      const parsed = reset ? parseFloat(reset) : Number.NaN
      const resetTime = Number.isFinite(parsed) ? parsed * 1000 : Date.now() + 10000
      discordBackoffUntil = resetTime
      log(
        `WARN: Discord rate limit low (remaining: ${remaining}), backing off until ${new Date(resetTime).toISOString()}`,
      )
    }

    if (!response.ok) {
      log(`Discord API error: HTTP ${response.status}`)
      return
    }

    const messages = await response.json()
    if (!Array.isArray(messages) || messages.length === 0) return

    const sorted = [...messages].reverse()

    for (const msg of sorted) {
      if (!msg.message_reference?.message_id) {
        state.discordLastMessageId = msg.id
        writeDaemonState(state)
        continue
      }

      if (!replyListener.authorizedDiscordUserIds.includes(msg.author.id)) {
        state.discordLastMessageId = msg.id
        writeDaemonState(state)
        continue
      }

      const mapping = lookupByMessageId("discord-bot", msg.message_reference.message_id)
      if (!mapping) {
        state.discordLastMessageId = msg.id
        writeDaemonState(state)
        continue
      }

      if (!rateLimiter.canProceed()) {
        log(`WARN: Rate limit exceeded, dropping Discord message ${msg.id}`)
        state.discordLastMessageId = msg.id
        writeDaemonState(state)
        state.errors++
        continue
      }

      state.discordLastMessageId = msg.id
      writeDaemonState(state)

      const success = await injectReply(mapping.tmuxPaneId, msg.content, "discord", config)

      if (success) {
        state.messagesInjected++
        // Add reaction
        try {
          await fetch(
            `https://discord.com/api/v10/channels/${replyListener.discordChannelId}/messages/${msg.id}/reactions/%E2%9C%85/@me`,
            {
              method: "PUT",
              headers: { Authorization: `Bot ${replyListener.discordBotToken}` },
            },
          )
        } catch {
        }
      } else {
        state.errors++
      }
    }
  } catch (error) {
    state.errors++
    state.lastError = error instanceof Error ? error.message : String(error)
    log(`Discord polling error: ${state.lastError}`)
  }
}

async function pollTelegram(
  config: OpenClawConfig,
  state: DaemonState,
  rateLimiter: RateLimiter,
): Promise<void> {
  const replyListener = config.replyListener
  if (!replyListener?.telegramBotToken || !replyListener.telegramChatId) return

  try {
    const offset = state.telegramLastUpdateId ? state.telegramLastUpdateId + 1 : 0
    const url = `https://api.telegram.org/bot${replyListener.telegramBotToken}/getUpdates?offset=${offset}&timeout=0`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      log(`Telegram API error: HTTP ${response.status}`)
      return
    }

    const body = await response.json()
    const updates = parseTelegramUpdatesResponse(body)

    for (const update of updates) {
      const msg = update.message
      if (!msg) {
        state.telegramLastUpdateId = update.update_id ?? state.telegramLastUpdateId
        writeDaemonState(state)
        continue
      }
      
      if (msg.reply_to_message?.message_id === undefined) {
        state.telegramLastUpdateId = update.update_id ?? state.telegramLastUpdateId
        writeDaemonState(state)
        continue
      }

      if (String(msg.chat?.id) !== replyListener.telegramChatId) {
        state.telegramLastUpdateId = update.update_id ?? state.telegramLastUpdateId
        writeDaemonState(state)
        continue
      }

      const mapping = lookupByMessageId("telegram", String(msg.reply_to_message.message_id))
      if (!mapping) {
        state.telegramLastUpdateId = update.update_id ?? state.telegramLastUpdateId
        writeDaemonState(state)
        continue
      }

      const text = msg.text || ""
      if (!text) {
        state.telegramLastUpdateId = update.update_id ?? state.telegramLastUpdateId
        writeDaemonState(state)
        continue
      }

      if (!rateLimiter.canProceed()) {
        log(`WARN: Rate limit exceeded, dropping Telegram message ${msg.message_id}`)
        state.telegramLastUpdateId = update.update_id ?? state.telegramLastUpdateId
        writeDaemonState(state)
        state.errors++
        continue
      }

      state.telegramLastUpdateId = update.update_id ?? state.telegramLastUpdateId
      writeDaemonState(state)

      const success = await injectReply(mapping.tmuxPaneId, text, "telegram", config)

      if (success) {
        state.messagesInjected++
        try {
          await fetch(
            `https://api.telegram.org/bot${replyListener.telegramBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: replyListener.telegramChatId,
                text: "Injected into Codex CLI session.",
                reply_to_message_id: msg.message_id,
              }),
            },
          )
        } catch {
          // Ignore
        }
      } else {
        state.errors++
      }
    }
  } catch (error) {
    state.errors++
    state.lastError = error instanceof Error ? error.message : String(error)
    log(`Telegram polling error: ${state.lastError}`)
  }
}

const PRUNE_INTERVAL_MS = 60 * 60 * 1000

export async function pollLoop(): Promise<void> {
  log("Reply listener daemon starting poll loop")
  const config = readDaemonConfig()
  if (!config) {
    log("ERROR: No daemon config found, exiting")
    process.exit(1)
  }

  const state = readDaemonState() || {
    isRunning: true,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastPollAt: null,
    telegramLastUpdateId: null,
    discordLastMessageId: null,
    messagesInjected: 0,
    errors: 0,
  }

  state.isRunning = true
  state.pid = process.pid

  const rateLimiter = new RateLimiter(config.replyListener?.rateLimitPerMinute || 10)
  let lastPruneAt = Date.now()

  const shutdown = (): void => {
    log("Shutdown signal received")
    state.isRunning = false
    writeDaemonState(state)
    removePidFile()
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  try {
    pruneStale()
    log("Pruned stale registry entries")
  } catch (e) {
    log(`WARN: Failed to prune stale entries: ${e}`)
  }
  
  while (state.isRunning) {
    try {
      state.lastPollAt = new Date().toISOString()
      await pollDiscord(config, state, rateLimiter)
      await pollTelegram(config, state, rateLimiter)
      
      if (Date.now() - lastPruneAt > PRUNE_INTERVAL_MS) {
        try {
          pruneStale()
          lastPruneAt = Date.now()
          log("Pruned stale registry entries")
        } catch (e) {
          log(`WARN: Prune failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      writeDaemonState(state)
      await new Promise((resolve) =>
        setTimeout(resolve, config.replyListener?.pollIntervalMs || 3000),
      )
    } catch (error) {
      state.errors++
      state.lastError = error instanceof Error ? error.message : String(error)
      log(`Poll error: ${state.lastError}`)
      writeDaemonState(state)
      await new Promise((resolve) =>
        setTimeout(resolve, (config.replyListener?.pollIntervalMs || 3000) * 2),
      )
    }
  }
  log("Poll loop ended")
}

export async function startReplyListener(config: OpenClawConfig): Promise<{ success: boolean; message: string; state?: DaemonState; error?: string }> {
  if (await isDaemonRunning()) {
    const state = readDaemonState()
    return {
      success: true,
      message: "Reply listener daemon is already running",
      state: state || undefined,
    }
  }

  if (!(await isTmuxAvailable())) {
    return {
      success: false,
      message: "tmux not available - reply injection requires tmux",
    }
  }

  const normalizedConfig = normalizeReplyListenerConfig(config)
  const replyListener = normalizedConfig.replyListener
  if (!replyListener?.discordBotToken && !replyListener?.telegramBotToken) {
    return {
      success: false,
      message: "No enabled reply listener platforms configured (missing bot tokens/channels)",
    }
  }

  writeDaemonConfig(normalizedConfig)
  ensureStateDir()

  const currentFile = import.meta.url
  const isTs = currentFile.endsWith(".ts")
  const daemonScript = isTs
    ? join(dirname(new URL(currentFile).pathname), "daemon.ts")
    : join(dirname(new URL(currentFile).pathname), "daemon.js")

  try {
    const proc = spawn(["bun", "run", daemonScript, DAEMON_IDENTITY_MARKER], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      cwd: process.cwd(),
      env: createMinimalDaemonEnv(),
    })
    
    proc.unref()
    const pid = proc.pid
    
    if (pid) {
      writePidFile(pid)
      const state: DaemonState = {
        isRunning: true,
        pid,
        startedAt: new Date().toISOString(),
        lastPollAt: null,
        telegramLastUpdateId: null,
        discordLastMessageId: null,
        messagesInjected: 0,
        errors: 0,
      }
      writeDaemonState(state)
      log(`Reply listener daemon started with PID ${pid}`)
      return {
        success: true,
        message: `Reply listener daemon started with PID ${pid}`,
        state,
      }
    }
    
    return {
      success: false,
      message: "Failed to start daemon process",
    }
  } catch (error) {
    return {
      success: false,
      message: "Failed to start daemon",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function stopReplyListener(): Promise<{ success: boolean; message: string; state?: DaemonState; error?: string }> {
  const pid = readPidFile()
  if (pid === null) {
    return {
      success: true,
      message: "Reply listener daemon is not running",
    }
  }
  
  if (!isProcessRunning(pid)) {
    removePidFile()
    return {
      success: true,
      message: "Reply listener daemon was not running (cleaned up stale PID file)",
    }
  }
  
  if (!(await isReplyListenerProcess(pid))) {
    removePidFile()
    return {
      success: false,
      message: `Refusing to kill PID ${pid}: process identity does not match the reply listener daemon (stale or reused PID - removed PID file)`,
    }
  }
  
  try {
    process.kill(pid, "SIGTERM")
    removePidFile()
    const state = readDaemonState()
    if (state) {
      state.isRunning = false
      state.pid = null
      writeDaemonState(state)
    }
    log(`Reply listener daemon stopped (PID ${pid})`)
    return {
      success: true,
      message: `Reply listener daemon stopped (PID ${pid})`,
      state: state || undefined,
    }
  } catch (error) {
    return {
      success: false,
      message: "Failed to stop daemon",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
