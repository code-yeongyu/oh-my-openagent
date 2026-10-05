// Lazy boundary for the @code-yeongyu/senpi engine barrel.
//
// The barrel (dist/index.js) aggregates the whole engine - importing it statically from the
// omo-task.js/omo-member.js blobs makes it 89-90% of each blob's module graph, so every fresh
// process that loads those blobs (notably spawned rpc children at boot) pays the full barrel
// evaluation cost before any task runs. All senpi-task value imports are function-scoped, so the
// barrel is only actually needed once a child session, a curated bash execution, or a skill
// discovery runs. This module converts that static edge into a memoized first-use load:
//
// - Async entry points on the child-spawn/execute paths await loadSenpiBarrel() before touching
//   barrel values.
// - Synchronous helpers that only run downstream of those entry points use senpiBarrel().
//
// The loaded promise (including a rejected one) is memoized, matching static-import semantics:
// if the barrel fails to load, the failure is permanent for the process and every caller that
// awaited it observes the same error, exactly as a static import would have failed at load time.
export type SenpiBarrelModule = typeof import("@code-yeongyu/senpi")

// The plugin ships senpi-task inside several bundles (omo.js, omo-task.js, omo-member.js), each
// with its own copy of this module. The warm-up state lives on globalThis under a process-wide
// symbol so awaiting loadSenpiBarrel() through one bundle copy also satisfies senpiBarrel()
// readers compiled into another copy - the same cross-bundle split that stranded the pi-tui
// boundary cold in omo-task.js (see ./pi-tui.ts).
interface SenpiBarrelSharedState {
  module: SenpiBarrelModule | undefined
  promise: Promise<SenpiBarrelModule> | undefined
  exports: Readonly<Record<string, unknown>> | undefined
}

const SHARED_STATE_KEY = Symbol.for("omo.senpi-task.senpiBarrel")

function sharedState(): SenpiBarrelSharedState {
  const holder = globalThis as typeof globalThis & { [SHARED_STATE_KEY]?: SenpiBarrelSharedState }
  holder[SHARED_STATE_KEY] ??= { module: undefined, promise: undefined, exports: undefined }
  return holder[SHARED_STATE_KEY]
}

export function loadSenpiBarrel(): Promise<SenpiBarrelModule> {
  const state = sharedState()
  state.promise ??= import("@code-yeongyu/senpi").then((loaded) => {
    state.module = loaded
    return loaded
  })
  return state.promise
}

/**
 * Synchronous access to the loaded senpi barrel namespace. Only valid after an async entry point
 * on the same code path awaited loadSenpiBarrel(); the throw below marks a missed warm-up, which
 * is a programming error rather than a runtime condition to handle.
 */
export function senpiBarrel(): SenpiBarrelModule {
  const loaded = sharedState().module
  if (loaded === undefined) {
    throw new Error(
      "The @code-yeongyu/senpi barrel was accessed before it was loaded. Await loadSenpiBarrel() at the async entry point that leads here before reading barrel values synchronously.",
    )
  }
  return loaded
}

// ---------------------------------------------------------------------------
// The shared-daemon host surface.
//
// The engine owns every protocol decision (senpi `host-decision.ts`, `host-ensure.ts`, the
// `senpi host` CLI); omo only calls it. These shapes are omo's OWN structural view of that
// surface, for the same reason `kernel-tools/contract.ts` duck-types the JS kernel capability:
// the pinned engine can predate the release that exports them, and the pinned `EnsureHostOptions`
// still keeps `hostArgs`/`env`/`upgrade` under `_test`. Each accessor therefore fails CLOSED with
// a typed error naming the symbol, and nothing here imports a senpi type it cannot rely on.
// ---------------------------------------------------------------------------

/** How a client wants an engine difference resolved when it attaches to the daemon. */
export type HostEnginePolicy = "upgrade" | "fallback" | "never"

/** CalVer build identity: `ordinal` is `[year, month, day, postRelease, buildEpoch]`. */
export interface EngineBuildIdentity {
  readonly text: string
  readonly ordinal: readonly number[]
  readonly scheme: "epoch" | "nodef"
}

/** The `get_protocol_info` reply a running host answers with. */
export interface SenpiHostProtocolInfo {
  readonly protocolVersion: number
  readonly instanceId: string
  readonly generation: number
  readonly engineVersion: string
  readonly engineOrdinal: readonly number[]
  readonly capabilities: readonly string[]
  readonly launch_profile?: { readonly profile_id: string; readonly core?: unknown }
  readonly pid?: number
  readonly platform?: string
}

export interface HostDecisionClient {
  readonly protocolVersion: number
  readonly requiredCapabilities: readonly string[]
  readonly identity: EngineBuildIdentity
  readonly launchProfileId?: string
  readonly startedByUs: boolean
}

export type HostAction = "start" | "reuse" | "handoff" | "refuse" | "fallback"

export interface HostDecision {
  readonly action: HostAction
  readonly reason: string
  readonly upgradeable: boolean
}

export interface EnsureHostInput {
  readonly socket: string
  readonly agentDir?: string
  readonly hostArgs?: readonly string[]
  readonly env?: Readonly<Record<string, string | null>>
  readonly upgrade?: "never" | "if-engine-differs"
  readonly policy?: { readonly coldStart?: "transient" | "persistent"; readonly idleExitMs?: number }
}

export interface EnsuredSenpiHost {
  readonly pid: number
  readonly socket: string
  readonly reused: boolean
  readonly instanceId?: string
  readonly generation?: number
  readonly engineVersion?: string
  /**
   * Ends the ensure's attach hold (senpi #2242): until then the host counts the ensuring process as an
   * attached client and a transient host never starts its idle window. Absent on engine pins that
   * predate the hold, so callers release it when present.
   */
  readonly release?: () => void
}

export type ProbeHostFn = (input: { readonly socket: string }) => Promise<SenpiHostProtocolInfo | undefined>
export type EnsureHostFn = (input: EnsureHostInput) => Promise<EnsuredSenpiHost>
export type StopHostFn = (input: {
  readonly socket: string
  readonly agentDir?: string
  readonly drain?: boolean
  readonly force?: boolean
}) => Promise<HostDecision>
export type HandoffHostFn = (input: {
  readonly socket: string
  readonly agentDir?: string
  readonly hostArgs?: readonly string[]
  readonly env?: Readonly<Record<string, string | null>>
}) => Promise<HostDecision>
export type DecideHostActionFn = (
  client: HostDecisionClient,
  host: SenpiHostProtocolInfo | undefined,
  policy: HostEnginePolicy,
) => HostDecision
export type EngineBuildIdentityFn = () => EngineBuildIdentity

/** The seam `ensureTaskDaemon` needs; the daemon never stops or hands off a host on its own. */
export interface TaskDaemonHostPort {
  readonly probeHost: ProbeHostFn
  readonly decideHostAction: DecideHostActionFn
  readonly ensureHost: EnsureHostFn
  readonly engineBuildIdentity: EngineBuildIdentityFn
}

/** The engine pin predates the symbol the caller needs; the daemon path fails closed on it. */
export class SenpiHostSymbolMissingError extends Error {
  override readonly name = "SenpiHostSymbolMissingError"
  readonly symbol: string

  constructor(symbol: string) {
    super(
      `The pinned @code-yeongyu/senpi engine does not export \`${symbol}\`. The shared task daemon needs an engine release carrying the host CLI surface.`,
    )
    this.symbol = symbol
  }
}

function barrelExports(): Readonly<Record<string, unknown>> {
  const state = sharedState()
  state.exports ??= { ...senpiBarrel() }
  return state.exports
}

/** The duck-type at the engine-pin boundary: the export exists and is callable, or it is absent. */
function isHostSymbol<Symbol>(value: unknown): value is Symbol {
  return typeof value === "function"
}

function requireHostSymbol<Symbol>(name: string): Symbol {
  const value = barrelExports()[name]
  if (!isHostSymbol<Symbol>(value)) throw new SenpiHostSymbolMissingError(name)
  return value
}

export function senpiEnsureHost(): EnsureHostFn {
  return requireHostSymbol<EnsureHostFn>("ensureHost")
}

export function senpiProbeHost(): ProbeHostFn {
  return requireHostSymbol<ProbeHostFn>("probeHost")
}

export function senpiStopHost(): StopHostFn {
  return requireHostSymbol<StopHostFn>("stopHost")
}

export function senpiHandoffHost(): HandoffHostFn {
  return requireHostSymbol<HandoffHostFn>("handoffHost")
}

export function senpiDecideHostAction(): DecideHostActionFn {
  return requireHostSymbol<DecideHostActionFn>("decideHostAction")
}

export function senpiEngineBuildIdentity(): EngineBuildIdentityFn {
  return requireHostSymbol<EngineBuildIdentityFn>("engineBuildIdentity")
}

export type CreateHostDaemonPathsFn = (target: { readonly socket: string; readonly agentDir?: string }) => { readonly dir: string }

/**
 * The engine's own answer to "which directory holds this endpoint's daemon state". Undefined while
 * the barrel is not loaded yet or when the pinned engine predates the export: the caller keeps its
 * own fallback instead of forcing the barrel onto a path that does not otherwise need it.
 */
export function senpiCreateHostDaemonPaths(): CreateHostDaemonPathsFn | undefined {
  if (sharedState().module === undefined) return undefined
  const value = barrelExports().createHostDaemonPaths
  return isHostSymbol<CreateHostDaemonPathsFn>(value) ? value : undefined
}

/** The engine's RPC client constructor, for the per-child session client (one client per child). */
export function senpiRpcClient(): SenpiBarrelModule["RpcClient"] {
  return requireHostSymbol<SenpiBarrelModule["RpcClient"]>("RpcClient")
}
