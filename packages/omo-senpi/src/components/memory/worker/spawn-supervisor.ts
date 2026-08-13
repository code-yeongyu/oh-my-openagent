import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import {
  readRunJson,
  runOutcomeMatchesLedger,
  writeRunJsonAtomic,
  type RunLaunchManifest,
  type RunOutcome,
} from "./run-artifacts"
import { requireRunMetadata } from "./spawn-metadata"
import {
  defaultSupervisorPath,
  definedEnvironment,
  isNodeSignal,
  readTail,
} from "./spawn-supervisor-support"
import type {
  FactsRunLedgerEnvelope,
  FactsSandbox,
  FactsSpawnArgs,
  ReflectionChildResult,
  ReflectionSandbox,
  ReflectionSpawnArgs,
} from "./spawn-types"

const DEFAULT_GRACE_MS = 5_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024

export async function runReflectionChild(
  spawnArgs: ReflectionSpawnArgs,
  options: {
    readonly terminationGraceMs?: number
    readonly maxOutputBytes?: number
    readonly sandbox?: ReflectionSandbox
    readonly supervisorPath?: string
    readonly now?: () => number
  },
): Promise<ReflectionChildResult> {
  const graceMs = options.terminationGraceMs ?? DEFAULT_GRACE_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  if (graceMs < 0 || maxOutputBytes <= 0) throw new TypeError("reflection spawn limits are invalid")

  const prepared = await (options.sandbox ?? passthroughSandbox)(spawnArgs)
  const metadata = requireRunMetadata(prepared)
  const launchedAt = (options.now ?? Date.now)()
  if (!Number.isFinite(prepared.hardDeadlineAt) || prepared.hardDeadlineAt <= 0) {
    throw new TypeError("reflection deadline must be positive")
  }
  return runSupervisedChild({
    runDir: prepared.paths.sessionDir,
    runId: metadata.runId,
    kind: metadata.kind,
    command: prepared.command,
    args: prepared.args,
    cwd: prepared.cwd,
    env: prepared.env,
    attempt: prepared.attempt,
    model: prepared.model,
    thinking: prepared.thinking,
    nextAttempt: prepared.nextAttempt,
    hardDeadlineAt: prepared.hardDeadlineAt,
    terminationGraceMs: graceMs,
    maxOutputBytes,
    supervisorPath: options.supervisorPath,
    ledger: {
      version: 1,
      runId: metadata.runId,
      kind: metadata.kind,
      category: prepared.category,
      conversationIds: prepared.conversationIds,
      trigger: metadata.trigger,
      ...(metadata.kind === "dream" ? { origin: metadata.origin } : {}),
      startedAt: new Date(launchedAt).toISOString(),
      attempt: prepared.attempt,
      model: prepared.model,
      ...(prepared.thinking === undefined ? {} : { thinking: prepared.thinking }),
      hardDeadlineAt: prepared.hardDeadlineAt,
      terminationGraceMs: graceMs,
      deadlineAt: prepared.hardDeadlineAt + graceMs,
      mergePolicy: metadata.mergePolicy,
      ...(metadata.targetDoc === undefined ? {} : { targetDoc: metadata.targetDoc }),
      worktreeDir: metadata.worktree.dir,
      worktreeBranch: metadata.worktree.branch,
      baseSha: metadata.worktree.baseSha,
      gitFilePath: metadata.worktree.gitFilePath,
      gitFileSnapshot: metadata.worktree.gitFileSnapshot,
      commonConfigPath: metadata.worktree.commonConfigPath,
      commonConfigSnapshot: metadata.worktree.commonConfigSnapshot,
    },
  })
}

export async function runFactsChild(
  spawnArgs: FactsSpawnArgs,
  options: {
    readonly terminationGraceMs?: number
    readonly maxOutputBytes?: number
    readonly sandbox?: FactsSandbox
    readonly supervisorPath?: string
    readonly now?: () => number
    readonly batchId: string
    readonly queued: readonly { readonly conversationId: string; readonly end_message_id: string }[]
  },
): Promise<ReflectionChildResult> {
  const graceMs = options.terminationGraceMs ?? DEFAULT_GRACE_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  if (graceMs < 0 || maxOutputBytes <= 0) throw new TypeError("facts spawn limits are invalid")
  const prepared = await (options.sandbox ?? passthroughFactsSandbox)(spawnArgs)
  const launchedAt = (options.now ?? Date.now)()
  // The absolute deadline anchors to the enforcing supervisor's wall clock, never to the
  // parent's logical clock: an injected now() may sit arbitrarily in the past, which would
  // make the supervisor fire the deadline at spawn and always report a timeout.
  if (!Number.isFinite(prepared.hardDeadlineAt) || prepared.hardDeadlineAt <= 0) {
    throw new TypeError("facts deadline must be positive")
  }
  return runSupervisedChild({
    runDir: prepared.paths.runDir,
    runId: prepared.runId,
    kind: "facts",
    command: prepared.command,
    args: prepared.args,
    cwd: prepared.cwd,
    env: prepared.env,
    attempt: prepared.attempt,
    model: prepared.model,
    thinking: prepared.thinking,
    nextAttempt: prepared.nextAttempt,
    hardDeadlineAt: prepared.hardDeadlineAt,
    terminationGraceMs: graceMs,
    maxOutputBytes,
    supervisorPath: options.supervisorPath,
    ledger: {
      version: 1,
      runId: prepared.runId,
      kind: "facts",
      startedAt: new Date(launchedAt).toISOString(),
      attempt: prepared.attempt,
      model: prepared.model,
      ...(prepared.thinking === undefined ? {} : { thinking: prepared.thinking }),
      hardDeadlineAt: prepared.hardDeadlineAt,
      terminationGraceMs: graceMs,
      deadlineAt: prepared.hardDeadlineAt + graceMs,
      batchId: options.batchId,
      queued: options.queued,
    } satisfies FactsRunLedgerEnvelope,
  })
}

async function runSupervisedChild(input: {
  readonly runDir: string
  readonly runId: string
  readonly attempt: number
  readonly model: string
  readonly thinking?: string
  readonly nextAttempt?: RunLaunchManifest["nextAttempt"]
  readonly kind: "reflection" | "dream" | "facts"
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly hardDeadlineAt: number
  readonly terminationGraceMs: number
  readonly maxOutputBytes: number
  readonly supervisorPath?: string
  readonly ledger: Readonly<Record<string, unknown>>
}): Promise<ReflectionChildResult> {
  await mkdir(input.runDir, { recursive: true, mode: 0o700 })
  const stdoutPath = join(input.runDir, "child-stdout.log")
  const stderrPath = join(input.runDir, "child-stderr.log")
  const launch: RunLaunchManifest = {
    version: 1,
    runId: input.runId,
    attempt: input.attempt,
    nextAttempt: input.nextAttempt,
    kind: input.kind,
    command: input.command,
    args: [...input.args],
    cwd: input.cwd,
    env: definedEnvironment(input.env),
    hardDeadlineAt: input.hardDeadlineAt,
    terminationGraceMs: input.terminationGraceMs,
    maxOutputBytes: input.maxOutputBytes,
    stdoutPath,
    stderrPath,
  }
  const ledger = {
    ...input.ledger,
    attempt: input.attempt,
    model: input.model,
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    launching: true,
    hardDeadlineAt: input.hardDeadlineAt,
    deadlineAt: input.hardDeadlineAt + input.terminationGraceMs,
  }
  await writeRunJsonAtomic(join(input.runDir, "ledger.json"), ledger)
  await writeRunJsonAtomic(join(input.runDir, "launch.json"), launch)

  const supervisor = spawn(process.execPath, [input.supervisorPath ?? defaultSupervisorPath(), input.runDir], {
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
  })
  console.error(`[facts-runner-trace] supervisor:spawned pid=${supervisor.pid ?? "unknown"}`)
  supervisor.unref()
  const supervisorExit = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve, reject) => {
    let settled = false
    supervisor.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    supervisor.once("exit", (code, signal) => {
      console.error(`[facts-runner-trace] supervisor:exit code=${code ?? "null"} signal=${signal ?? "null"}`)
    })
    supervisor.once("close", (code, signal) => {
      console.error(`[facts-runner-trace] supervisor:close code=${code ?? "null"} signal=${signal ?? "null"}`)
      if (settled) return
      settled = true
      resolve({ code, signal })
    })
  })
  const outcomePath = join(input.runDir, "outcome.json")
  if (!existsSync(outcomePath) && (supervisorExit.code !== 0 || supervisorExit.signal !== null)) {
    throw new Error(`memory run supervisor exited with ${supervisorExit.code ?? supervisorExit.signal ?? "unknown status"}`)
  }
  const outcome = await readRunJson<RunOutcome>(outcomePath)
  if (!runOutcomeMatchesLedger(ledger, outcome)) {
    throw new Error(`memory run outcome attempt ${outcome.attempt ?? "legacy"} does not match attempt ${input.attempt}`)
  }
  return {
    code: outcome.childExit.code,
    signal: isNodeSignal(outcome.childExit.signal) ? outcome.childExit.signal : null,
    stdout: readTail(stdoutPath, input.maxOutputBytes),
    stderr: readTail(stderrPath, input.maxOutputBytes),
    timedOut: outcome.timedOut,
  }
}

function passthroughSandbox(spawnArgs: ReflectionSpawnArgs): ReflectionSpawnArgs {
  return spawnArgs
}

function passthroughFactsSandbox(spawnArgs: FactsSpawnArgs): FactsSpawnArgs {
  return spawnArgs
}
