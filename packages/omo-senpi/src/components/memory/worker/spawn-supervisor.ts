import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "@oh-my-opencode/memory-core/fs"
import { mkdir } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  readRunJson,
  runOutcomeMatchesLedger,
  writeRunJsonAtomic,
  type RunLaunchManifest,
  type RunOutcome,
} from "./run-artifacts"
import type { FactsQueuedKey } from "../facts-failure-recording"
import { requireRunMetadata } from "./spawn-metadata"
import { waitForRunCompletion } from "./run-sentinel"
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
// Publication can still be waiting for the terminal gate after the child deadline expires.
// Keep the parent alive for one additional default grace window so the durable outcome can land.
const OUTCOME_PUBLICATION_MARGIN_MS = 5_000

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
      ...(metadata.systemTokenBudget === undefined ? {} : { systemTokenBudget: metadata.systemTokenBudget }),
      ...(metadata.systemTokenTarget === undefined ? {} : { systemTokenTarget: metadata.systemTokenTarget }),
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
    readonly queued: readonly FactsQueuedKey[]
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
    stdio: "ignore",
    // win32 gives a detached child its own console, which flashes an empty terminal window on the
    // user's desktop for every reflection run. CREATE_NO_WINDOW keeps the detachment, drops the window.
    windowsHide: true,
  })
  supervisor.unref()
  const outcomePath = join(input.runDir, "outcome.json")
  const launchPath = join(input.runDir, "launch.json")
  const publishingPath = join(input.runDir, "publishing.json")
  const hasCompleteOutcome = () => {
    // Publication writes the outcome before launch cleanup; publishing.json proves that the
    // surviving launch marker is an in-flight publication, not an incomplete outcome.
    if (!existsSync(outcomePath) || (existsSync(launchPath) && !existsSync(publishingPath))) return false
    try {
      return runOutcomeMatchesLedger(ledger, JSON.parse(readFileSync(outcomePath, "utf8")) as RunOutcome)
    } catch {
      return false
    }
  }
  const outcomeWait = new AbortController()
  type RunCompletion =
    | { readonly kind: "error"; readonly error: Error }
    | { readonly kind: "close"; readonly exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } }
    | { readonly kind: "outcome"; readonly result: "present" | "timeout" }
  let settle: (completion: RunCompletion) => void = () => {}
  const completion = new Promise<RunCompletion>((resolve) => {
    let settled = false
    settle = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
  })
  const onError = (error: Error) => settle({ kind: "error", error })
  const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
    settle({ kind: "close", exit: { code, signal } })
  }
  supervisor.once("error", onError)
  supervisor.once("close", onClose)
  void waitForRunCompletion(
      outcomePath,
      launchPath,
      hasCompleteOutcome,
      input.hardDeadlineAt + input.terminationGraceMs + OUTCOME_PUBLICATION_MARGIN_MS,
      Date.now,
      outcomeWait.signal,
    ).then((result) => settle({ kind: "outcome", result }))
  const result = await completion.finally(() => {
    outcomeWait.abort()
    supervisor.off("error", onError)
    supervisor.off("close", onClose)
  })
  if (result.kind === "error" && !hasCompleteOutcome()) throw result.error
  if (result.kind === "close" && !hasCompleteOutcome()) {
    throw new Error(`memory run supervisor exited with ${result.exit.code ?? result.exit.signal ?? "unknown status"}`)
  }
  if (result.kind === "outcome" && result.result === "timeout") {
    throw new Error("memory run supervisor did not publish an outcome before its deadline")
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
