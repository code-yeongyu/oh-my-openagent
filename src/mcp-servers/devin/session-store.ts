import { mkdir, stat } from "node:fs/promises"
import { existsSync, openSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { DevinSession, DevinSessionSnapshot } from "./types"

const LOG_DIR = join(tmpdir(), "oh-my-opencode-devin-mcp")
const TAIL_BYTES_DEFAULT = 8192
const TAIL_BYTES_MAX = 262144

const sessions = new Map<string, DevinSession>()

export type StartOptions = {
  prompt: string
  cwd?: string
  model?: string
  resume?: string
  permissionMode?: "auto" | "dangerous"
  extraArgs?: string[]
}

export async function startDevinSession(options: StartOptions): Promise<DevinSession> {
  await mkdir(LOG_DIR, { recursive: true })

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
  if (options.extraArgs?.length) args.push(...options.extraArgs)

  const proc = Bun.spawn(["devin", ...args], {
    cwd: options.cwd ?? process.cwd(),
    stdout: fd,
    stderr: fd,
    stdin: "ignore",
  })

  const session: DevinSession = {
    id,
    proc,
    logPath,
    startedAt: Date.now(),
    cwd: options.cwd ?? process.cwd(),
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
    .catch(() => {
      session.endedAt = Date.now()
      session.status = "error"
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

export async function cancelDevinSession(id: string): Promise<DevinSession | undefined> {
  const session = sessions.get(id)
  if (!session) return undefined
  if (session.status === "running") {
    session.status = "cancelled"
    try {
      session.proc.kill()
    } catch {
      // proc may have exited between status check and kill — fine
    }
    await session.proc.exited.catch(() => undefined)
  }
  return session
}

export async function readSessionLog(id: string, tailBytes = TAIL_BYTES_DEFAULT): Promise<string> {
  const session = sessions.get(id)
  if (!session) throw new Error(`unknown devin session: ${id}`)
  const snap = await snapshotDevinSession(session, tailBytes)
  return snap.output
}

export function shutdownAllSessions(): Promise<void> {
  const pending: Promise<unknown>[] = []
  for (const session of sessions.values()) {
    if (session.status === "running") {
      session.status = "cancelled"
      try {
        session.proc.kill()
      } catch {
        // process already exited
      }
      pending.push(session.proc.exited.catch(() => undefined))
    }
  }
  return Promise.all(pending).then(() => undefined)
}
