// Types for setup-stream.js, which omo-senpi's onboarding scan imports across the package
// boundary: omo-ai ships this module as plain JS, so it is the single source of the setup stream.

export type SetupSource = "detect" | "providers" | "credentials" | "assets" | "model-choices"
export type SetupStageId = "credentials" | "assets" | "providers" | "model-choices"

export const SETUP_SOURCES: readonly SetupSource[]

export type SetupItem = {
  readonly id: string
  readonly kind: string
  readonly state: string
  readonly detail?: string
}

export type SetupStagePlan = {
  readonly pending: number
  readonly notices?: readonly string[]
  readonly [field: string]: unknown
}

export type SetupStageResult = {
  readonly source: SetupSource
  readonly items: readonly SetupItem[]
  readonly notices: readonly string[]
  readonly plan: SetupStagePlan
  readonly disabled?: true
  readonly error?: Error
}

export type SetupRuntime = {
  readonly home: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly pluginRoot?: string
  readonly loadModelCatalog?: () => Promise<readonly unknown[]>
  readonly loadSqlite?: () => Promise<unknown>
}

export type SetupScanOptions = {
  readonly includeCustomProviders?: boolean
  readonly onSourceStart?: (source: SetupSource) => void
}

export type SetupInventory = {
  readonly harnesses: readonly { readonly id: string; readonly installed: boolean }[]
}

export type SetupPlans = { readonly [stage: string]: unknown }

export type SetupApplyStage = {
  readonly id: SetupStageId
  readonly plan: SetupStagePlan
}

export function canonicalAgentDir(env?: Readonly<Record<string, string | undefined>>, home?: string): string

export function scanSetup(runtime: SetupRuntime, agentDir: string, options?: SetupScanOptions): AsyncGenerator<SetupStageResult, void, undefined>

export function collectSetupPlans(stream: AsyncIterable<SetupStageResult> | Iterable<SetupStageResult>): Promise<{ inventory: SetupInventory; plans: SetupPlans }>

export type SetupAuthEntry = {
  readonly provider: string
  readonly key: string
}

/** Per-apply writer options: how credential additions and notice lines travel. */
export type SetupApplyOptions = {
  /** Routes credential additions through a locked credential store (the engine's AuthStorage) instead of the CLI's direct writer. */
  readonly writeAuth?: (target: string, additions: readonly SetupAuthEntry[]) => Promise<void> | void
  /** Receives the apply's notice lines (the CLI prints them; an RPC caller collects them into its reply). */
  readonly report?: (line: string) => void
}

/** Refused by `applySetupStages` when `staleGuard` finds a target that changed since planning. */
export class SetupStaleError extends Error {
  readonly paths: readonly string[]
  readonly applied: readonly SetupStageId[]
}

/** The target paths of the given stages whose content changed since their plans read them (content hash, never mtime alone). */
export function staleSetupTargets(plans: SetupPlans, stageIds: Iterable<SetupStageId>, written?: ReadonlySet<string>): string[]

/** True when any of the given stages would write into a credential store. */
export function authWritesPending(plans: SetupPlans, stageIds: Iterable<SetupStageId>): boolean

export function applySetupStages(
  plans: SetupPlans,
  confirm: (stage: SetupApplyStage) => boolean | Promise<boolean>,
  report?: (line: string) => void,
  options?: SetupApplyOptions & {
    /** Re-checked right before each stage writes; a non-empty result refuses that stage with `SetupStaleError`. */
    readonly staleGuard?: (stageId: SetupStageId, written: ReadonlySet<string>) => readonly string[] | undefined
  },
): Promise<Set<SetupStageId>>
