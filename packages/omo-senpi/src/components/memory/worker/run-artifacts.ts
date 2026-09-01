import { randomUUID } from "node:crypto"
import { open, readFile, rename, unlink } from "@oh-my-opencode/memory-core/fs"
import { dirname } from "node:path"

export interface RunLaunchManifest {
  readonly version: 1
  readonly runId: string
  readonly attempt: number
  readonly nextAttempt?: RunAttempt
  readonly kind: "reflection" | "dream" | "facts"
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly hardDeadlineAt: number
  readonly terminationGraceMs: number
  readonly maxOutputBytes: number
  readonly stdoutPath: string
  readonly stderrPath: string
}

export interface RunAttempt {
  readonly attempt: number
  readonly model: string
  readonly thinking?: string
}

export interface RunPrelaunchArtifact {
  readonly version: 1
  readonly runId: string
  readonly worktreeDir: string
  readonly worktreeBranch: string
}

export interface RunOutcome {
  readonly version: 1
  readonly runId: string
  readonly attempt?: number
  readonly finishedAt: string
  readonly childExit: {
    readonly code: number | null
    readonly signal: string | null
  }
  readonly timedOut: boolean
}

export function runOutcomeMatchesLedger(
  ledger: { readonly attempt?: number },
  outcome: RunOutcome,
): boolean {
  return ledger.attempt === outcome.attempt
}

export async function readRunJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

export async function writeRunJsonAtomic(path: string, value: unknown, mode = 0o600): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
  const file = await open(temporary, "wx", mode)
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporary, path)
  await syncDirectory(dirname(path))
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const directory = await open(path, "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (process.platform !== "win32" || !["EISDIR", "EPERM"].includes(String(code))) throw error
  }
}

export async function readRunTextTail(path: string, maxBytes: number): Promise<string> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new TypeError("run output limit must be positive")
  let file
  try {
    file = await open(path, "r")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  }
  try {
    const size = (await file.stat()).size
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, Math.max(0, size - length))
    const text = buffer.toString("utf8")
    return size > maxBytes ? `[truncated to last ${maxBytes} bytes]\n${text}` : text
  } finally {
    await file.close()
  }
}

export async function updateRunLedger(path: string, fields: Readonly<Record<string, unknown>>): Promise<void> {
  const current = await readRunJson<Record<string, unknown>>(path)
  await writeRunJsonAtomic(path, { ...current, ...fields })
}

export async function unlinkRunArtifact(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }
}

export function parseRunPrelaunchArtifact(value: unknown): RunPrelaunchArtifact {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.runId !== "string"
    || typeof value.worktreeDir !== "string"
    || typeof value.worktreeBranch !== "string") {
    throw new TypeError("Invalid reflection prelaunch artifact")
  }
  return {
    version: 1,
    runId: value.runId,
    worktreeDir: value.worktreeDir,
    worktreeBranch: value.worktreeBranch,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
