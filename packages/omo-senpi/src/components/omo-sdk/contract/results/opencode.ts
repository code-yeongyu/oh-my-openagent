// What the OpenCode-edition calls answer as their `value`: the record each command prints today with --json
// (packages/omo-opencode/src/cli/), restated here because the SDK package does not import that edition's CLI.
export type PluginInstalled = {
  readonly platforms: readonly { readonly platform: string; readonly wrote: readonly string[] }[]
}

export type Cleanup = {
  readonly codexHome: string
  readonly configPath: string
  readonly configChanged: boolean
  readonly configBackupPath?: string
  readonly removedPaths: readonly string[]
  readonly skippedPaths: readonly { readonly path: string; readonly reason: string }[]
  readonly removedAgentLinks: readonly string[]
  readonly skippedAgentLinks: readonly string[]
  readonly projectCleanup?: {
    readonly changed: boolean
    readonly configPath: string
    readonly artifacts: readonly { readonly path: string }[]
  }
}

export type LocalVersion = {
  readonly currentVersion: string | null
  readonly latestVersion: string | null
  readonly isUpToDate: boolean
  readonly isLocalDev: boolean
  readonly isPinned: boolean
  readonly pinnedVersion: string | null
  readonly status: "up-to-date" | "outdated" | "local-dev" | "dev" | "pinned" | "pinned-mismatch" | "error" | "unknown"
}

export type ConfigMigrated = {
  readonly dryRun: boolean
  readonly error?: string
  readonly journalResumed: boolean
  readonly migratedFrom: readonly string[]
  readonly migrations: readonly { readonly from: string; readonly to: string }[]
  readonly skippedConflictCount: number
  readonly targetBackupPaths: readonly string[]
}

export type ModelCapabilitiesRefreshed = {
  readonly sourceUrl: string
  readonly generatedAt: string
  readonly modelCount: number
}

export type BoulderWork = {
  readonly work_id: string
  readonly plan_name: string
  readonly active_plan: string
  readonly worktree_path?: string
  readonly status: string
  readonly started_at: string
  readonly ended_at?: string
  readonly elapsed_ms?: number
  readonly elapsed_human?: string
  readonly total_tasks: number
  readonly completed_tasks: number
  readonly remaining_tasks: number
  readonly percentage: number
  readonly session_count: number
  readonly current_task?: { readonly task_key: string; readonly task_title: string; readonly elapsed_human?: string }
}
export type BoulderStatus = { readonly works: readonly BoulderWork[] }

export type WorktreeSweep = {
  readonly apply: boolean
  readonly olderThanDays: number
  readonly repos: readonly {
    readonly repo: string
    readonly defaultBranch: string
    readonly classifications: readonly {
      readonly path: string
      readonly action: "SWEEP" | "KEEP" | "PRUNE"
      readonly reason: string
    }[]
    readonly removed: readonly string[]
    readonly failed: readonly { readonly path: string; readonly error: string }[]
  }[]
  readonly sweepCount: number
  readonly keepCount: number
  readonly pruneCount: number
}

export type ToolkitHelp = { readonly text: string }
