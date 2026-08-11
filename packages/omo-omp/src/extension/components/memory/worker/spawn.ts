import { spawn } from "node:child_process"
import { closeSync, openSync, readFileSync } from "node:fs"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import {
  loadReflectionPersona,
  type ReflectionWorktree,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"
import { detectBunBinary, resolveSenpiExecutable } from "@oh-my-opencode/senpi-task"

const DEFAULT_GRACE_MS = 5_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024

export interface ReflectionSpawnPaths {
  readonly sessionDir: string
  readonly worktree: string
  readonly gitCommonDir: string
  readonly transcript: string
  readonly persona: string
  readonly prompt: string
}

export interface ReflectionSpawnArgs {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly detached: true
  readonly paths: ReflectionSpawnPaths
}

export type ReflectionSandbox = (
  spawnArgs: ReflectionSpawnArgs,
) => ReflectionSpawnArgs | Promise<ReflectionSpawnArgs>

export interface ReflectionChildResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export async function prepareReflectionSpawn(input: {
  readonly run: ReservedRun
  readonly worktree: ReflectionWorktree
  readonly reflectionSessionsDir: string
  readonly model: string
  readonly thinking?: string
  readonly env: NodeJS.ProcessEnv
  readonly senpiCommand?: string
}): Promise<ReflectionSpawnArgs> {
  const sessionDir = join(input.reflectionSessionsDir, safeRunId(input.run.runId))
  await mkdir(sessionDir, { recursive: true, mode: 0o700 })
  const transcript = join(sessionDir, "transcript-payload.json")
  const persona = join(sessionDir, "reflection-persona.md")
  const prompt = join(sessionDir, "reflection-task.md")
  // Payload files are chmod 0400 after writing, so a reused run directory (retry with the same
  // runId) must relax the mode before rewriting or the open() fails with EACCES.
  await Promise.all([transcript, persona, prompt].map(async (path) => {
    try {
      await chmod(path, 0o600)
    } catch {
      // First run for this runId: nothing to relax.
    }
  }))
  await Promise.all([
    writeFile(transcript, `${JSON.stringify({ schemaVersion: 1, runId: input.run.runId, request: input.run.request }, null, 2)}\n`, "utf8"),
    writeFile(persona, loadReflectionPersona().markdown, "utf8"),
    writeFile(prompt, buildTaskPrompt(input.run, input.worktree.dir, transcript), "utf8"),
  ])
  await Promise.all([transcript, persona, prompt].map((path) => chmod(path, 0o400)))

  const paths = {
    sessionDir,
    worktree: input.worktree.dir,
    gitCommonDir: dirname(input.worktree.commonConfigPath),
    transcript,
    persona,
    prompt,
  }
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    MEMORY_DIR: input.worktree.dir,
    TRANSCRIPT_PATH: transcript,
    SENPI_MEMORY_REFLECTION: "1",
    // A detached child has no controlling terminal, so senpi's PTY-backed bash session fails with
    // "Native PTY session handle is missing write()" and the child could never git-commit its
    // reflection. pi-pty's documented non-interactive override selects the pipe session backend.
    SENPI_PTY_FORCE_PIPE: "1",
  }
  // Verified against senpi packages/coding-agent/src/cli/args.ts and cli/file-processor.ts:
  // -p selects print mode; --system-prompt reads a file path; --tools is a comma allowlist;
  // --no-extensions/--no-skills/--no-prompt-templates/--no-context-files disable discovery;
  // --session-dir isolates JSONL storage; --model/--thinking select the category result; @file
  // loads the mechanics prompt as the initial non-interactive message.
  const args = [
    "-p",
    "--system-prompt", persona,
    "--tools", "bash,edit",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--session-dir", sessionDir,
    "--model", input.model,
    ...(input.thinking === undefined ? [] : ["--thinking", input.thinking]),
    `@${prompt}`,
  ]
  return {
    command: input.senpiCommand ?? resolveDefaultSenpiCommand(input.env),
    args,
    cwd: input.worktree.dir,
    env,
    detached: true,
    paths,
  }
}

export async function runReflectionChild(
  spawnArgs: ReflectionSpawnArgs,
  options: {
    readonly deadlineMs: number
    readonly terminationGraceMs?: number
    readonly maxOutputBytes?: number
    readonly sandbox?: ReflectionSandbox
  },
): Promise<ReflectionChildResult> {
  if (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0) {
    throw new TypeError("reflection deadline must be positive")
  }
  const graceMs = options.terminationGraceMs ?? DEFAULT_GRACE_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  if (graceMs < 0 || maxOutputBytes <= 0) throw new TypeError("reflection spawn limits are invalid")

  const prepared = await (options.sandbox ?? passthroughSandbox)(spawnArgs)
  await mkdir(prepared.paths.sessionDir, { recursive: true, mode: 0o700 })
  // Child output goes to per-run log files instead of pipes back into the parent: a piped child
  // with listeners holds the parent's event loop open until the child exits, which would tie the
  // session's lifetime to the detached reflection run.
  const stdoutPath = join(prepared.paths.sessionDir, "child-stdout.log")
  const stderrPath = join(prepared.paths.sessionDir, "child-stderr.log")
  const stdoutFd = openSync(stdoutPath, "w")
  const stderrFd = openSync(stderrPath, "w")
  let fdsClosed = false
  const closeFds = () => {
    if (fdsClosed) return
    fdsClosed = true
    closeSync(stdoutFd)
    closeSync(stderrFd)
  }
  const child = spawn(prepared.command, [...prepared.args], {
    cwd: prepared.cwd,
    env: prepared.env,
    detached: prepared.detached,
    stdio: ["ignore", stdoutFd, stderrFd],
  })
  child.unref()

  let timedOut = false
  let escalation: ReturnType<typeof setTimeout> | undefined
  const deadline = setTimeout(() => {
    timedOut = true
    signalProcessGroup(child.pid, "SIGTERM", child.kill.bind(child))
    escalation = setTimeout(() => {
      signalProcessGroup(child.pid, "SIGKILL", child.kill.bind(child))
    }, graceMs)
  }, options.deadlineMs)

  const result = await new Promise<ReflectionChildResult>((resolve, reject) => {
    let settled = false
    child.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once("close", (code, signal) => {
      if (settled) return
      settled = true
      closeFds()
      resolve({ code, signal, stdout: readTail(stdoutPath, maxOutputBytes), stderr: readTail(stderrPath, maxOutputBytes), timedOut })
    })
  }).finally(() => {
    clearTimeout(deadline)
    if (escalation !== undefined) clearTimeout(escalation)
    closeFds()
  })

  return result
}

function passthroughSandbox(spawnArgs: ReflectionSpawnArgs): ReflectionSpawnArgs {
  return spawnArgs
}

function buildTaskPrompt(run: ReservedRun, worktree: string, transcript: string): string {
  const focus = run.request.focus ? `\nFocus: ${run.request.focus}` : ""
  return [
    "# Reflection mechanics",
    `MEMORY_DIR=${worktree}`,
    `TRANSCRIPT_PATH=${transcript}`,
    "Read the transcript payload, update only files under MEMORY_DIR, and commit every intended memory change.",
    "Do not modify Git administration files. Finish with a clean worktree.",
    `Trigger: ${run.request.trigger}${focus}`,
  ].join("\n")
}

function resolveDefaultSenpiCommand(env: NodeJS.ProcessEnv): string {
  return resolveSenpiExecutable({
    isBunBinary: detectBunBinary(import.meta.url),
    execPath: process.execPath,
    platform: process.platform,
    parentEnv: env,
    resolveRpcEntry: () => "",
  }) ?? "senpi"
}

function safeRunId(runId: string): string {
  const safe = basename(runId.trim()).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!safe || safe === "." || safe === "..") throw new TypeError("runId must contain a safe identifier")
  return safe.slice(0, 80)
}

function signalProcessGroup(
  pid: number | undefined,
  signal: NodeJS.Signals,
  fallback: (signal: NodeJS.Signals) => boolean,
): void {
  if (pid === undefined) return
  try {
    if (process.platform === "win32") fallback(signal)
    else process.kill(-pid, signal)
  } catch (error) {
    if (errorCode(error) !== "ESRCH") fallback(signal)
  }
}

function readTail(path: string, maxBytes: number): string {
  try {
    const content = readFileSync(path, "utf8")
    if (Buffer.byteLength(content, "utf8") <= maxBytes) return content
    return `[truncated to last ${maxBytes} bytes]\n${content.slice(-maxBytes)}`
  } catch (error) {
    return error instanceof Error ? `[failed to read child output: ${error.message}]` : "[failed to read child output]"
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
