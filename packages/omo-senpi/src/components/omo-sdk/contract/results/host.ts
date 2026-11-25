import type { WarmAnswer } from "../../../../../../senpi-task/src/runners/rpc-host/host-warm-reply"
import type { JsonObject } from "../../../remote/types"
import type { ConfigStatus } from "../../config"

// What the daemon, diagnostics and install calls answer as their `value`. A record the engine's host command prints is
// a JSON object here: its own type is exported by the engine in slice E1a. Every other record is the one the `omo` verb
// prints today with --json, or the finding list a prose verb reports as lines.
export type { ConfigStatus, WarmAnswer }

type HostReply = JsonObject & { readonly action: string }

/** A refused or failed warm is reported here and the run still succeeds (design 6.7). */
export type DaemonRun = { readonly ensure: HostReply; readonly warm: WarmAnswer }
export type DaemonEnsure = HostReply
export type DaemonStatus = { readonly endpoints: readonly JsonObject[]; readonly aggregate: JsonObject }
export type DaemonStop = HostReply
export type DaemonStopAll = {
  readonly endpoints: readonly {
    readonly socket: string
    readonly outcome: "requested" | "drained" | "already_drained" | "refused" | "timeout"
    readonly polls?: number
    readonly summary?: string
  }[]
}
export type DaemonHandoff = { readonly endpoints: readonly { readonly socket: string; readonly action: string }[] }
export type DaemonGc = {
  readonly removed: readonly JsonObject[]
  readonly kept: readonly JsonObject[]
  readonly reaped_meta: readonly string[]
  readonly pruned_stores: readonly string[]
}
export type DaemonRollbackPrepare = {
  readonly dry_run: boolean
  readonly stores: readonly JsonObject[]
  readonly coverage: {
    readonly discovered: number
    readonly from_index: number
    readonly from_sidecars: number
    readonly from_store: number
    readonly missing: readonly string[]
    readonly endpoints_without_store_map: readonly string[]
  }
}
export type DaemonShardPath = { readonly path: string }

/** One line of a doctor report as data: its level, the check it belongs to and what it says. */
export type Finding = {
  readonly level: "ok" | "notice" | "warn" | "fail"
  readonly check: string
  readonly message: string
}
export type Diagnostics = { readonly findings: readonly Finding[] }
export type FixReflectionLock = { readonly dry_run: boolean; readonly findings: readonly Finding[] }
export type ReapStaleEngines = {
  readonly engines: readonly {
    readonly pid: number
    readonly outcome: "reaped" | "refused" | "not_found"
    readonly reason?: string
  }[]
}

import type { SetupInventory, SetupStageId } from "../inputs/host"

export type { SetupInventory, SetupStageId }

// The install namespace's values (slice C1c, #14960): every field the commands need to keep each byte, typed; nothing
// here holds a stage plan, a file's bytes or a key. The phrases in the setup summary are built by one function from the
// typed fields beside them (omo-native bin/lib/setup-summary.js summaryPhrase).

type ListEntry<Key extends string> = { readonly key: Key; readonly value: readonly string[]; readonly text: string }
type CountEntry<Key extends string> = { readonly key: Key; readonly value: number; readonly text: string }

/** One line of `omo setup --dry-run`. */
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

/** One line of the counts an apply reports. */
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

type Phrased = { readonly text: string }
type Ids = { readonly count: number; readonly ids: readonly string[] }
type Reasons = { readonly count: number; readonly reasons: readonly { readonly id: string; readonly reason: string }[] }

/** One item of the setup summary: its class, kind, state and the fields its phrase is built from. */
export type SetupSummaryItem = Phrased &
  (
    | ({ readonly class: "logins"; readonly kind: "login"; readonly state: "store_malformed" } & {
        readonly count: number
      })
    | {
        readonly class: "logins"
        readonly kind: "api_key"
        readonly state: "will_import"
        readonly count: number
        readonly keys: readonly { readonly provider: string; readonly source: string }[]
      }
    | ({ readonly class: "logins"; readonly kind: "api_key"; readonly state: "already_present" } & Ids)
    | ({
        readonly class: "logins"
        readonly kind: "api_key"
        readonly state: "unserved"
        readonly models_path: string
      } & Ids)
    | ({
        readonly class: "logins"
        readonly kind: "oauth_login"
        readonly state: "sign_in_again"
        readonly commands: readonly { readonly target: string; readonly providers: readonly string[] }[]
      } & Ids)
    | ({ readonly class: "logins"; readonly kind: "oauth_login"; readonly state: "signed_in" | "no_provider" } & Ids)
    | ({
        readonly class: "mcp_servers"
        readonly kind: "mcp_server"
        readonly state: "will_import" | "already_present" | "store_malformed"
      } & Ids)
    | ({ readonly class: "mcp_servers"; readonly kind: "mcp_server"; readonly state: "refused" } & Reasons)
    | ({
        readonly class: "skills"
        readonly kind: "skill"
        readonly state: "will_import" | "already_present" | "bundled"
      } & Ids)
    | ({ readonly class: "skills"; readonly kind: "skill"; readonly state: "skipped" } & Reasons)
    | {
        readonly class: "providers"
        readonly kind: "provider"
        readonly state: "will_import"
        readonly id: string
        readonly base_url: string
        readonly models: readonly string[]
        readonly key_source: "kept_existing" | "store_malformed" | "found" | "none"
        readonly key_from?: string
      }
    | ({
        readonly class: "providers"
        readonly kind: "provider"
        readonly state: "already_present" | "store_malformed" | "not_carried"
      } & Ids)
    | {
        readonly class: "model_choices"
        readonly kind: "model_choice"
        readonly state: "will_write"
        readonly default_ref?: string
        readonly categories: readonly string[]
        readonly agents: readonly string[]
      }
    | ({
        readonly class: "model_choices"
        readonly kind: "model_choice"
        readonly state: "kept" | "carried" | "blocked"
      } & Ids)
    | {
        readonly class: "model_choices"
        readonly kind: "model_choice"
        readonly state: "dropped"
        readonly count: number
      }
    | { readonly class: "categories"; readonly kind: "category"; readonly state: "all_usable"; readonly count: number }
    | ({
        readonly class: "categories"
        readonly kind: "category"
        readonly state: "usable"
        readonly total: number
      } & Ids)
    | {
        readonly class: "categories"
        readonly kind: "category"
        readonly state: "unavailable"
        readonly id: string
        readonly providers: readonly string[]
        readonly unlisted_provider_model?: string
      }
  )

/** A summary line: its items and their phrases joined. */
export type SetupSummaryPart = Phrased & { readonly items: readonly SetupSummaryItem[] }

export type SetupSummary = {
  readonly sources: readonly ("opencode" | "oh-my-pi" | "gajae-code" | "commandcode")[]
  readonly rows: readonly {
    readonly class: "logins" | "mcp_servers" | "skills" | "providers" | "model_choices"
    readonly parts: readonly SetupSummaryPart[]
  }[]
  readonly coverage?: readonly SetupSummaryPart[]
  readonly notes: readonly {
    readonly code: "detect" | "credentials" | "assets" | "providers" | "model_choices"
    readonly text: string
  }[]
  readonly command_code_planned: boolean
}

/** What `omo setup --dry-run` prints, as data, and the plan install.setup.apply takes back. */
export type SetupPlan = {
  readonly inventory: SetupInventory
  readonly stages: readonly {
    readonly id: SetupStageId
    readonly description: string
    readonly present: boolean
    readonly pending: number
    readonly entries: readonly SetupPlanEntry[]
  }[]
  readonly summary: SetupSummary
  readonly pending: number
  readonly target_roots: readonly string[]
}

export type SetupApplied = {
  readonly applied: readonly SetupStageId[]
  readonly skipped: readonly SetupStageId[]
  readonly stages: readonly {
    readonly id: SetupStageId
    readonly outcome: "applied" | "skipped" | "nothing_pending"
    readonly entries: readonly SetupCountEntry[]
  }[]
}

type Installed = { readonly omo: string; readonly engine: string }

/** install.update: the version its channel names, the command that installs it, and what happened. */
export type InstallUpdate = {
  readonly state: "printed" | "up_to_date" | "updated"
  readonly version: string
  readonly channel: string
  readonly manager: string
  /** The package manager's argv. */
  readonly command: readonly string[]
  /** The same command as `omo update --print` shows it. */
  readonly command_line: string
  readonly ran: boolean
  readonly before: Installed
  readonly after?: Installed
  readonly versioned?: { readonly final_dir: string; readonly kept: string }
}

/**
 * `details` of an install_failed failure: one closed reason per way an update fails, every value a caller branches on
 * as a typed field. Never a package manager's captured output.
 */
export type InstallFailedDetails =
  | { readonly reason: "engine_missing"; readonly before: string; readonly command: string }
  | { readonly reason: "manager_not_started"; readonly command: string }
  | { readonly reason: "manager_failed"; readonly exit_status: number; readonly command: string }
  | {
      readonly reason: "not_moved"
      readonly before: string
      readonly after: string
      readonly target: string
      readonly command: string
    }
  | {
      readonly reason: "file_held"
      readonly file?: string
      readonly attempts: number
      readonly holders: readonly { readonly name: string; readonly pid: number }[]
      readonly before: string
      /** not_needed: an omo still reads, so nothing was reinstalled. */
      readonly restore: "not_needed" | "restored" | "failed"
      readonly installed_now?: string
      readonly previous_command?: string
    }
  | {
      readonly reason: "versioned"
      readonly cause: "no_bun" | "busy" | "bun_install_failed" | "wrong_version" | "path_still_old"
      readonly exit_status: number
      readonly before: string
      readonly target: string
      readonly versions_dir: string
      readonly current: string
      readonly version_dir: string
      readonly final_dir?: string
      readonly holder?: string
      readonly reported?: string
      readonly updated?: string
      readonly on_path?: string
      readonly on_path_real?: string
      readonly seen?: string
    }
  | { readonly reason: "binary_install"; readonly error_code: string; readonly cause: string }

type BuildComponent = { readonly commit: string; readonly committedAt: string; readonly branch: string }

/** install.version: what `omo --version` prints: the product, its engine, and a build's stamps when it carries them. */
export type InstallVersion = {
  readonly version: string
  readonly engine: string
  readonly omo_build?: { readonly command: string; readonly omo: BuildComponent; readonly engine: BuildComponent }
  readonly engine_build?: {
    readonly scheme: "epoch" | "nodef"
    readonly epoch: number
    readonly sha7: string
    readonly source: "buildInfo" | "senpi-package" | "omitted"
  }
}
export type SdkRoot = { readonly path: string }
