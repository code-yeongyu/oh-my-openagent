// The diagnostics namespace's contract (#14959). The launcher loads the core as plain ESM with no build
// step, so the core is JavaScript checked against these types; test/diagnostics-contract.type-test.ts
// assigns every export to its signature here, and a drift fails typecheck.

export type DiagnosticLevel = "ok" | "notice" | "warn" | "fail"

/** One id per check; a check that reports several things (one line per stale engine) gives several findings. */
export type DiagnosticCheck =
  | "artifact.plugin-manifest"
  | "artifact.extension"
  | "artifact.lsp-daemon-runtime"
  | "engine.cli"
  | "engine.version"
  | "install.version"
  | "install.update"
  | "install.migration"
  | "settings.packages"
  | "config.diagnostics"
  | "config.directory"
  | "engines.stale"
  | "engines.retired-payload"
  | "memory.identities"
  | "memory.reflection-lock"
  | "memory.runtime"
  | "memory.sweep"
  | "launch-spec"
  | "keychain-helper"
  | "credential-store"
  | "daemon"
  | "engine.trust"
  | "computer-use"
  | "claude-code"
  | "task-categories"
  | "setup.credentials"

export type DiagnosticFinding = {
  readonly level: DiagnosticLevel
  readonly check: DiagnosticCheck
  /** Built by omo's own code; a renderer prints it after the level. */
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export type DiagnosticsReport = {
  readonly findings: readonly DiagnosticFinding[]
  /** True when a check whose failure fails `omo doctor` failed: an artifact, the engine, the launch spec, computer use. */
  readonly failed: boolean
}

/** One line of the sweep in print order: memory-core's own text verbatim, or a finding about the sweep. */
export type FixEntry =
  { readonly kind: "sweep_text"; readonly text: string } | ({ readonly kind: "finding" } & DiagnosticFinding)

export type FixReport = { readonly dry_run: boolean; readonly entries: readonly FixEntry[]; readonly failed: boolean }

export type ReapRefusalReason = "not_an_engine" | "managed_engine" | "live_session" | "signal_failed"

/** One requested pid, in request order; a refusal is decided before that pid could be signalled. */
export type ReapedEngine =
  | { readonly pid: number; readonly outcome: "reaped"; readonly age: string; readonly tty: string }
  | { readonly pid: number; readonly outcome: "not_found" }
  | {
      readonly pid: number
      readonly outcome: "refused"
      readonly reason: ReapRefusalReason
      readonly details?: Readonly<Record<string, unknown>>
    }

/** `complete` is false when any named pid was refused: the fact `omo doctor --reap` reports by exiting 1. */
export type ReapReport = { readonly engines: readonly ReapedEngine[]; readonly complete: boolean }

/** The resolver's own view, as `omo doctor --models --json` prints it. */
export type ModelChainView = import("../../category-coverage-entry").ModelChainsView

export type ReapFailureCode =
  "not_found" | "scope_denied" | "foreign_live_owner" | "internal_error" | "invalid_arguments"

export type DiagnosticsErrorCode = ReapFailureCode

export type DiagnosticsResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | {
      readonly kind: "error"
      readonly error: {
        readonly code: DiagnosticsErrorCode
        readonly message: string
        readonly next_action: string
        readonly details?: Readonly<Record<string, unknown>>
      }
    }

export type ProcessEntry = {
  readonly pid: number
  readonly ppid: number
  readonly elapsed: string
  readonly tty: string
  readonly command: string
}

type Env = Readonly<Record<string, string | undefined>>
type Findings = readonly DiagnosticFinding[]

export type Inventory = {
  readonly harnesses: readonly { readonly id: string; readonly installed?: boolean; readonly entryCount?: number }[]
}

export type DaemonEngine = {
  run(
    args: string[],
    options: { env: Record<string, string | undefined> },
  ): { exitCode: number; stdout: string; stderr: string }
}

/** The compiled binary's own sections, which only its build can load. */
export type CompiledSources = {
  readonly config: () => Findings
  readonly trust: () => Promise<Findings>
  readonly claudeCode: () => Findings
  readonly computerUse: () => Promise<Findings>
  readonly coverage: () => Promise<Findings>
  readonly memoryRuntime: () => Promise<Findings>
  readonly keychainHelper: () => Findings
}

export type DiagnosticsInstall =
  | { readonly kind: "npm" }
  | {
      readonly kind: "compiled"
      readonly execDir: string
      readonly version: string
      readonly versionText: string
      readonly updateCommand: string
      readonly sources: CompiledSources
    }

/** The low-level process port (a conformance run's fake): one spawn of `ps`, one signal per reaped pid. */
export type ProcessPort = {
  readonly spawn: (
    command: string,
    argv: readonly string[],
  ) => Promise<{ readonly exitCode: number; readonly stdout: string }>
  readonly signal: (pid: number, signal: string) => Promise<void>
}

/** The engine host's status (`host status --all --include-workers`): the endpoint list, or undefined when no host answers. */
export type HostStatusPort = {
  readonly status: (request: {
    readonly all: boolean
    readonly include_workers: boolean
  }) => Promise<{ readonly endpoints: readonly unknown[] } | undefined>
}

export type ProcessPorts = {
  readonly list?: () => readonly ProcessEntry[]
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void
  readonly process?: ProcessPort
}

export type RunPorts = ProcessPorts & {
  readonly install?: DiagnosticsInstall
  readonly inventory?: Inventory
  readonly env?: Env
  readonly homeDir?: string
  readonly cwd?: string
  readonly platform?: NodeJS.Platform
  readonly fetchDistTags?: () => unknown
  readonly now?: () => number
  readonly payloadMtimeMs?: (payloadDir: string) => number | undefined
  readonly listDirs?: (path: string) => string[] | undefined
  readonly hasRepo?: (identityRoot: string) => boolean
  readonly pluginRoot?: string
  readonly launchSpecIo?: Readonly<Record<string, unknown>>
  readonly daemonEngine?: DaemonEngine
  /** Construction-time only, like `process`: a conformance run's fake; absent, the engine CLI as `daemonEngine` runs it. */
  readonly host?: HostStatusPort
  readonly daemon?: () => Findings
  readonly keychainHelper?: () => Findings
  readonly configDiagnostics?: () => Promise<Findings>
  readonly reflectionLock?: () => Promise<Findings>
  readonly memoryRuntime?: () => Promise<Findings>
  readonly computerUse?: () => Promise<Findings>
  readonly categoryCoverage?: () => Promise<Findings>
}

export type ModelsPorts = {
  readonly agentDir?: string
  readonly cwd?: string
  readonly env?: Env
  readonly loadEngine?: () => Promise<unknown>
  readonly loadRuntime?: () => Promise<unknown>
}

export type FixPorts = {
  readonly env?: Env
  readonly home?: string
  readonly reflectionLockProbe?: Readonly<Record<string, unknown>>
  readonly memorySettings?: unknown
  readonly loadTaskConfig?: () => unknown
}

/** Native edition inputs; the OpenCode edition's `status`, `verbose` and `platform` arrive with slice OC1a. */
export type DiagnosticsRunInput = Readonly<Record<never, never>>

export type DiagnosticsCalls = {
  run(input?: DiagnosticsRunInput, ports?: RunPorts): Promise<DiagnosticsResult<DiagnosticsReport>>
  models(input?: DiagnosticsRunInput, ports?: ModelsPorts): Promise<DiagnosticsResult<ModelChainView>>
  fixReflectionLock(input?: { readonly dry_run?: boolean }, ports?: FixPorts): Promise<DiagnosticsResult<FixReport>>
  reapStaleEngines(
    input: { readonly pids: readonly number[] },
    ports?: ProcessPorts,
  ): Promise<DiagnosticsResult<ReapReport>>
}
