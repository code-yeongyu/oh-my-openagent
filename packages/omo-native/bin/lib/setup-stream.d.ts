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
  /** The consent question `omo setup --ask-each` shows for this stage's current plan. */
  readonly question: (plan: SetupStagePlan) => string
}

type ListEntry<Key extends string> = { readonly key: Key; readonly value: readonly string[] }
type CountEntry<Key extends string> = { readonly key: Key; readonly value: number }

/** One line of `omo setup --dry-run`: what a stage's plan holds, by key. */
export type SetupPlanEntry =
  | ListEntry<
      | "planned-add"
      | "skipped-existing"
      | "skipped-oauth"
      | "skipped-unmapped"
      | "planned-mcp"
      | "mcp-skipped-existing"
      | "planned-skills"
      | "skills-skipped-existing"
      | "skills-skipped-bundled"
      | "planned-providers"
      | "providers-skipped-existing"
      | "planned-model-choices"
      | "model-choices-skipped-existing"
      | "model-choices-already-carried"
    >
  | CountEntry<"model-choices-not-carried">

/** One line of the counts an apply reports, by key. */
export type SetupCountEntry =
  | CountEntry<
      | "imported"
      | "skipped-existing"
      | "skipped-oauth"
      | "skipped-unmapped"
      | "mcp-imported"
      | "mcp-skipped-existing"
      | "skills-imported"
      | "skills-skipped-existing"
      | "skills-skipped-bundled"
      | "provider-keys-imported"
      | "providers-skipped-existing"
      | "model-choices-not-carried"
    >
  | ListEntry<"providers-imported" | "model-choices-carried" | "model-choices-skipped-existing">

export type SetupEntry = SetupPlanEntry | SetupCountEntry

export function setupEntryText(entry: SetupEntry): string

export type SetupStage = SetupApplyStage & {
  readonly plan: SetupStagePlan | undefined
  readonly present: boolean
  readonly entries: (plan: SetupStagePlan) => SetupPlanEntry[]
  readonly countEntries: (plan: SetupStagePlan) => SetupCountEntry[]
}

/** In apply order; a stage whose source failed has no plan and is never applied. */
export function setupStages(plans: SetupPlans): SetupStage[]

export function canonicalAgentDir(env?: Readonly<Record<string, string | undefined>>, home?: string): string

export function scanSetup(
  runtime: SetupRuntime,
  agentDir: string,
  options?: SetupScanOptions,
): AsyncGenerator<SetupStageResult, void, undefined>

export function collectSetupPlans(
  stream: AsyncIterable<SetupStageResult> | Iterable<SetupStageResult>,
): Promise<{ inventory: SetupInventory; plans: SetupPlans }>

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
  /** The file effects the stages make (setup-fs.js); the real file system when absent. */
  readonly fs?: typeof import("./setup-fs.js").REAL_SETUP_FS
}

/** Refused by `applySetupStages` when `staleGuard` finds a target that changed since planning. */
export class SetupStaleError extends Error {
  readonly paths: readonly string[]
  readonly applied: readonly SetupStageId[]
}

/** The target paths of the given stages whose content changed since their plans read them (content hash, never mtime alone). */
export function staleSetupTargets(
  plans: SetupPlans,
  stageIds: Iterable<SetupStageId>,
  written?: ReadonlySet<string>,
): string[]

/** True when any of the given stages would write into a credential store. */
export function authWritesPending(plans: SetupPlans, stageIds: Iterable<SetupStageId>): boolean

/** Which stages an apply had written when \`error\` left it, and the stage that threw. */
export function setupApplyFault(
  error: unknown,
): { readonly applied: readonly SetupStageId[]; readonly stage: SetupStageId } | undefined

export function applySetupStages(
  plans: SetupPlans,
  confirm: (stage: SetupApplyStage) => boolean | Promise<boolean>,
  report?: (line: string) => void,
  options?: SetupApplyOptions & {
    /** Re-checked right before each stage writes; a non-empty result refuses that stage with `SetupStaleError`. */
    readonly staleGuard?: (stageId: SetupStageId, written: ReadonlySet<string>) => readonly string[] | undefined
  },
): Promise<Set<SetupStageId>>
