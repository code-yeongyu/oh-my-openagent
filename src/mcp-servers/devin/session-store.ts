import { mkdir, stat, readdir, unlink } from "node:fs/promises"
import { existsSync, openSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { DevinSession, DevinSessionSnapshot } from "./types"

const LOG_DIR = join(tmpdir(), "oh-my-opencode-devin-mcp")
const TAIL_BYTES_DEFAULT = 8192
const TAIL_BYTES_MAX = 262144
const MAX_CONCURRENT_SESSIONS = 50
const LOG_RETENTION_MS = 24 * 60 * 60 * 1000 // 24 hours
const KILL_GRACE_PERIOD_MS = 5000

const sessions = new Map<string, DevinSession>()

export type StartOptions = {
  prompt: string
  cwd?: string
  model?: string
  resume?: string
  permissionMode?: "auto" | "dangerous"
  extraArgs?: string[]
}

// Allowed Devin CLI arguments to prevent arbitrary flag injection
const ALLOWED_EXTRA_ARG_PREFIXES = ["--env", "--no-", "--yes", "--wait"]

function validateModel(model: string | undefined): void {
  if (!model) return
  // Devin model IDs are alphanumeric with hyphens and dots
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) {
    throw new Error(`Invalid model identifier: ${model}`)
  }
}

function validateResumeId(resumeId: string | undefined): void {
  if (!resumeId) return
  // Resume IDs are UUIDs or alphanumeric session identifiers
  if (!/^[a-zA-Z0-9_-]+$/.test(resumeId) || resumeId.length > 128) {
    throw new Error(`Invalid resume identifier: ${resumeId}`)
  }
}

function validateExtraArgs(extraArgs: string[] | undefined): string[] {
  if (!extraArgs?.length) return []
  const validated: string[] = []
  for (const arg of extraArgs) {
    // Reject args that look like path injection attempts
    if (arg.includes("../") || arg.includes("..\\") || arg.startsWith("/") || arg.startsWith("\\")) {
      throw new Error(`Invalid extra argument (path injection attempt): ${arg}`)
    }
    // Only allow known-safe prefixes or simple key=value pairs
    const isAllowed = ALLOWED_EXTRA_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix)) ||
      /^--[a-z][a-z0-9-]+(=.+)?$/.test(arg)
    if (!isAllowed) {
      throw new Error(`Disallowed extra argument: ${arg}. Only allowlisted flags are permitted.`)
    }
    validated.push(arg)
  }
  return validated
}

function validateCwd(cwd: string | undefined): string {
  const resolved = cwd ?? process.cwd()
  if (!existsSync(resolved)) {
    throw new Error(`Working directory does not exist: ${resolved}`)
  }
  return resolved
}

async function cleanupOldLogs(): Promise<void> {
  try {
    const entries = await readdir(LOG_DIR)
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.endsWith(".log")) continue
      const logPath = join(LOG_DIR, entry)
      try {
        const st = await stat(logPath)
        if (now - st.mtimeMs > LOG_RETENTION_MS) {
          await unlink(logPath)
        }
      } catch {
        // Ignore per-file errors during cleanup
      }
    }
  } catch {
    // Directory may not exist yet
  }
}

function enforceSessionLimit(): void {
  const runningCount = [...sessions.values()].filter((s) => s.status === "running").length
  if (runningCount >= MAX_CONCURRENT_SESSIONS) {
    throw new Error(
      `Maximum concurrent Devin sessions (${MAX_CONCURRENT_SESSIONS}) reached. ` +
        `Cancel existing sessions before creating new ones.`,
    )
  }
}

export async function startDevinSession(options: StartOptions): Promise<DevinSession> {
  enforceSessionLimit()

  // Validate all user inputs before spawning
  validateModel(options.model)
  validateResumeId(options.resume)
  const validatedExtraArgs = validateExtraArgs(options.extraArgs)
  const resolvedCwd = validateCwd(options.cwd)

  await mkdir(LOG_DIR, { recursive: true })
  await cleanupOldLogs()

  const id = randomUUID()
  const logPath = join(LOG_DIR, `${id}.log`)
  const fd = openSync(logPath, "a")

  const args: string[] = []
  if (options.resume) {
    args.push("-r", options.resume)
  }
  args.push("-p", options.prompt)
  args.push("--permission-mode", options.permissionMode ?? "auto")
  if (options.model) args.push("--model", options.model)
  if (validatedExtraArgs.length) args.push(...validatedExtraArgs)

  const proc = Bun.spawn(["devin", ...args], {
    cwd: resolvedCwd,
    stdout: fd,
    stderr: fd,
    stdin: "ignore",
  })

  const session: DevinSession = {
    id,
    proc,
    logPath,
    startedAt: Date.now(),
    cwd: resolvedCwd,
    prompt: options.prompt,
    model: options.model,
    status: "running",
    resumeId: options.resume,
  }

  sessions.set(id, session)

  proc.exited
    .then((exitCode) => {
      session.exitCode = exitCode
      session.endedAt = Date.now()
      session.status = exitCode === 0 ? "completed" : session.status === "cancelled" ? "cancelled" : "error"
    })
    .catch((err) => {
      session.endedAt = Date.now()
      session.status = "error"
      console.error(`[devin-mcp] Session ${id} process error:`, err)
    })

  return session
}

export function getDevinSession(id: string): DevinSession | undefined {
  return sessions.get(id)
}

export function listDevinSessions(): DevinSession[] {
  return [...sessions.values()].sort((a, b) => b.startedAt - a.startedAt)
}

export async function snapshotDevinSession(
  session: DevinSession,
  tailBytes = TAIL_BYTES_DEFAULT,
): Promise<DevinSessionSnapshot> {
  const limit = Math.max(0, Math.min(tailBytes, TAIL_BYTES_MAX))
  let output = ""
  let outputBytes = 0
  if (existsSync(session.logPath)) {
    const st = await stat(session.logPath)
    outputBytes = st.size
    if (limit > 0) {
      const start = Math.max(0, outputBytes - limit)
      const file = Bun.file(session.logPath)
      const slice = file.slice(start, outputBytes)
      output = await slice.text()
      if (start > 0) output = `... [${start} earlier bytes truncated]\n` + output
    }
  }
  const endedAt = session.endedAt ?? Date.now()
  return {
    id: session.id,
    logPath: session.logPath,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    cwd: session.cwd,
    prompt: session.prompt,
    model: session.model,
    status: session.status,
    exitCode: session.exitCode,
    resumeId: session.resumeId,
    output,
    outputBytes,
    durationMs: endedAt - session.startedAt,
    running: session.status === "running",
  }
}

async function killWithGracefulFallback(proc: DevinSession["proc"], sessionId: string): Promise<void> {
  try {
    proc.kill("SIGTERM")
  } catch (err) {
    console.error(`[devin-mcp] Failed to send SIGTERM to session ${sessionId}:`, err)
  }

  // Wait for graceful shutdown with timeout, then SIGKILL
  const graceTimeout = new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch (err) {
        console.error(`[devin-mcp] Failed to send SIGKILL to session ${sessionId}:`, err)
      }
      resolve()
    }, KILL_GRACE_PERIOD_MS)

    proc.exited
      .then(() => {
        clearTimeout(timeoutId)
        resolve()
      })
      .catch(() => {
        clearTimeout(timeoutId)
        resolve()
      })
  })

  await graceTimeout
}

export async function cancelDevinSession(id: string): Promise<DevinSession | undefined> {
  const session = sessions.get(id)
  if (!session) return undefined
  if (session.status === "running") {
    session.status = "cancelled"
    await killWithGracefulFallback(session.proc, id)
  }
  return session
}

export async function readSessionLog(id: string, tailBytes = TAIL_BYTES_DEFAULT): Promise<string> {
  const session = sessions.get(id)
  if (!session) throw new Error(`unknown devin session: ${id}`)
  const snap = await snapshotDevinSession(session, tailBytes)
  return snap.output
}

export async function shutdownAllSessions(): Promise<void> {
  const pending: Promise<unknown>[] = []
  for (const session of sessions.values()) {
    if (session.status === "running") {
      session.status = "cancelled"
      pending.push(killWithGracefulFallback(session.proc, session.id))
    }
  }
  await Promise.all(pending)
}
