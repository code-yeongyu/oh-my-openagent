import { type Static, Type } from "typebox"

import { LaunchSpec } from "./threads-authority"

// The daemon, diagnostics, install and config calls of first-party design 6.7 and 6.11. The endpoint flags (socket,
// key_root) are the root's endpoint selector (contract/root-options.ts), never a call input; launch_spec and
// mcp_presenter_enforcement are slice P1a-s's (security design 4.4). A field in a type grants nothing.
const None = Type.Object({})
const Path = Type.String({ minLength: 1 })
const Policy = Type.Optional(Type.Union([Type.Literal("upgrade"), Type.Literal("fallback"), Type.Literal("never")]))
const Count = Type.Integer({ minimum: 1 })

export const ConfigStatus = None
export const ConfigMigrate = Type.Object({ dry_run: Type.Optional(Type.Boolean()) })
export const ConfigModelCapabilitiesRefresh = Type.Object({
  directory: Type.Optional(Path),
  source_url: Type.Optional(Type.String({ minLength: 1 })),
})

export const DaemonRun = Type.Object({ policy: Policy, pinned: Type.Optional(Type.Boolean()) })
export const DaemonEnsure = Type.Object({
  policy: Policy,
  pinned: Type.Optional(Type.Boolean()),
  launch_spec: LaunchSpec,
  mcp_presenter_enforcement: Type.Optional(Type.Boolean()),
})
export const DaemonWarm = Type.Object({
  cwd: Type.Optional(Path),
  kind: Type.Optional(Type.String({ minLength: 1 })),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})
export const DaemonStatus = Type.Object({
  all: Type.Optional(Type.Boolean()),
  include_workers: Type.Optional(Type.Boolean()),
})
export const DaemonStop = Type.Object({
  drain: Type.Optional(Type.Boolean()),
  instance: Type.Optional(Type.String({ minLength: 1 })),
  wait_ms: Type.Optional(Count),
  force: Type.Optional(Type.Boolean()),
  expected_generation: Type.Optional(
    Type.Object(
      {
        instance_id: Type.String({ minLength: 1 }),
        generation: Type.Integer({ minimum: 0 }),
        pid: Count,
        process_start_time: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
  ),
})
export const DaemonStopAll = Type.Object({
  drain: Type.Optional(Type.Boolean()),
  wait: Type.Optional(Type.Boolean()),
  deadline_ms: Type.Optional(Count),
})
export const DaemonHandoff = Type.Object({
  policy: Policy,
  launch_spec: LaunchSpec,
  allow_downgrade: Type.Optional(Type.Boolean()),
  when: Type.Optional(
    Type.Object(
      {
        idle: Type.Object(
          {
            operation: Type.String({ minLength: 1 }),
            if_instance: Type.String({ minLength: 1 }),
            if_generation: Type.Integer({ minimum: 0 }),
            target_build: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  ),
})
export const DaemonGc = Type.Object({
  prune_store_index: Type.Optional(Type.Boolean()),
  agent_dir: Type.Optional(Path),
})
export const DaemonRollbackPrepare = Type.Object({
  stores: Type.Optional(Type.Array(Path, { minItems: 1 })),
  allow_missing_index: Type.Optional(Type.Boolean()),
  dry_run: Type.Optional(Type.Boolean()),
})
export const DaemonShardPath = Type.Object({
  kind: Type.Union([Type.Literal("p"), Type.Literal("i")]),
  owner: Type.String({ minLength: 1 }),
  root: Type.Optional(Path),
})

export const DiagnosticsRun = Type.Object({
  status: Type.Optional(Type.Boolean()),
  verbose: Type.Optional(Type.Boolean()),
  platform: Type.Optional(Type.Union([Type.Literal("opencode"), Type.Literal("codex")])),
})
export const DiagnosticsModels = None
export const DiagnosticsFixReflectionLock = Type.Object({ dry_run: Type.Optional(Type.Boolean()) })
export const DiagnosticsReapStaleEngines = Type.Object({ pids: Type.Array(Count, { minItems: 1 }) })

export const InstallSetupDetect = None
export const InstallSetupPlan = None
/** `omo setup`'s inventory (N/bin/lib/setup-report.js): one row per harness found on this machine. */
const SetupInventorySchema = Type.Object({
  harnesses: Type.Array(
    Type.Object({
      id: Type.String(),
      installed: Type.Boolean(),
      providers: Type.Array(Type.String()),
      credentialTypes: Type.Array(Type.String()),
      modelHint: Type.String(),
      notices: Type.Array(Type.String()),
      importableCount: Type.Integer({ minimum: 0 }),
    }),
  ),
})

/** What `omo setup --dry-run` prints and install.setup.apply takes back: the stages a person consents to. */
const SetupPlanSchema = Type.Object({
  inventory: SetupInventorySchema,
  stages: Type.Array(Type.Object({ id: Type.String({ minLength: 1 }), description: Type.String() })),
})
export type SetupPlan = Static<typeof SetupPlanSchema>
export type SetupInventory = Static<typeof SetupInventorySchema>

export const InstallSetupApply = Type.Object({
  plan: SetupPlanSchema,
  consent: Type.Union([Type.Literal("all"), Type.Literal("each")], {
    description: "all: --yes, asked once; each: --ask-each, asked per stage.",
  }),
})
export const InstallUpdate = Type.Object({ dry_run: Type.Optional(Type.Boolean()) })
export const InstallVersion = None
export const InstallSdkRoot = None
