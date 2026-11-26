import type { PrincipalKind, RootCallKey } from "../contract"

/**
 * The (call, principal) pairs with no line in the principal matrix that a shipped entry serves today: the boundary keeps
 * them open until their cells land, so default deny removes no capability (design lane ruling on 14996's custody finding).
 * Closed and self-retiring: an entry whose call gains a line fails the totality test as stale. Each names the shipped
 * surface that proves it and the slice that adds the cell from the security design's approved text.
 */
export type PendingCell = {
  readonly call: RootCallKey
  readonly principal: PrincipalKind
  readonly served_by: string
  readonly owner: string
}

export const PENDING_CELLS: readonly PendingCell[] = [
  {
    call: "threads.resolve",
    principal: "person",
    served_by: "the same OS user (security design 3): remote module factories sessions.resolve (remote/client.ts:460)",
    owner: "T1a",
  },
  {
    call: "threads.resolve",
    principal: "script",
    served_by: "remote module factories sessions.resolve (remote/client.ts:460)",
    owner: "T1a",
  },
  {
    call: "threads.readAfterWait",
    principal: "session",
    served_by: "thread_read tool with wait_ms (thread/tools.ts:447)",
    owner: "T1b",
  },
  {
    call: "threads.messages",
    principal: "person",
    served_by: "omo host session read --messages (engine host-session-command)",
    owner: "T1b",
  },
  { call: "threads.messages", principal: "script", served_by: "omo host session read --messages --json", owner: "T1b" },
  {
    call: "threads.locate",
    principal: "person",
    served_by: "the same OS user (security design 3): createThreadSdk.locate (thread/sdk.ts:404)",
    owner: "T1a",
  },
  {
    call: "threads.locate",
    principal: "script",
    served_by: "createThreadSdk.locate (thread/sdk.ts:404)",
    owner: "T1a",
  },
  {
    call: "threads.release",
    principal: "person",
    served_by: "the same OS user (security design 3): createThreadSdk.release (thread/sdk.ts:508)",
    owner: "T1c",
  },
  {
    call: "threads.release",
    principal: "script",
    served_by: "createThreadSdk.release (thread/sdk.ts:508)",
    owner: "T1c",
  },
  {
    call: "threads.adopt",
    principal: "person",
    served_by: "omo daemon adopt (bin/lib/daemon-adopt.js:16)",
    owner: "T1c",
  },
  {
    call: "threads.adopt",
    principal: "script",
    served_by: "omo daemon adopt --json (bin/lib/daemon-adopt.js:86)",
    owner: "T1c",
  },
  {
    call: "threads.aliases.resolve",
    principal: "person",
    served_by: "the same OS user (security design 3): remote module factories aliases.resolve (remote/aliases.ts:148)",
    owner: "T1c",
  },
  {
    call: "threads.aliases.resolve",
    principal: "script",
    served_by: "remote module factories aliases.resolve (remote/aliases.ts:148)",
    owner: "T1c",
  },
  {
    call: "threads.aliases.set",
    principal: "person",
    served_by: "the same OS user (security design 3): remote module factories aliases.set (remote/aliases.ts:164)",
    owner: "T1c",
  },
  {
    call: "threads.aliases.set",
    principal: "script",
    served_by: "remote module factories aliases.set (remote/aliases.ts:164)",
    owner: "T1c",
  },
  {
    call: "threads.aliases.set",
    principal: "session",
    served_by: "thread_rename and thread_create with alias (thread/tools.ts:506, :404)",
    owner: "T1c",
  },
  {
    call: "threads.aliases.clear",
    principal: "person",
    served_by: "the same OS user (security design 3): remote module factories aliases.clear (remote/aliases.ts:189)",
    owner: "T1c",
  },
  {
    call: "threads.aliases.clear",
    principal: "script",
    served_by: "remote module factories aliases.clear (remote/aliases.ts:189)",
    owner: "T1c",
  },
  { call: "account.show", principal: "person", served_by: "omo account show (account-cli.ts:137)", owner: "A1b" },
  {
    call: "account.show",
    principal: "script",
    served_by: "omo account show, JSON output (account-cli.ts:53)",
    owner: "A1b",
  },
  {
    call: "account.signInCheck",
    principal: "person",
    served_by: "omo account sign-in --check (account-sign-in.ts:175)",
    owner: "A1b",
  },
  {
    call: "account.signInCheck",
    principal: "script",
    served_by: "omo account sign-in --check, JSON output (account-sign-in.ts:176)",
    owner: "A1b",
  },
  {
    call: "devices.resolve",
    principal: "person",
    served_by: "the same OS user (security design 3): remote module factories devices.resolve (remote/client.ts:436)",
    owner: "T1a",
  },
  {
    call: "devices.resolve",
    principal: "script",
    served_by: "remote module factories devices.resolve (remote/client.ts:436)",
    owner: "T1a",
  },
  { call: "daemon.run", principal: "person", served_by: "omo daemon run (bin/lib/daemon.js:76)", owner: "C1a" },
  { call: "daemon.run", principal: "script", served_by: "omo daemon run --json (bin/lib/daemon.js:273)", owner: "C1a" },
  {
    call: "daemon.warm",
    principal: "person",
    served_by: "the same OS user (security design 3): createThreadSdk.warmDaemon (thread/sdk.ts:519)",
    owner: "C1a",
  },
  {
    call: "daemon.warm",
    principal: "script",
    served_by: "createThreadSdk.warmDaemon (thread/sdk.ts:519)",
    owner: "C1a",
  },
  {
    call: "daemon.shardPath",
    principal: "person",
    served_by: "omo host shard-path (engine host-command)",
    owner: "C1a",
  },
  {
    call: "daemon.shardPath",
    principal: "script",
    served_by: "omo host shard-path --json (engine host-command)",
    owner: "C1a",
  },
  {
    call: "diagnostics.models",
    principal: "person",
    served_by: "omo doctor --models (bin/lib/model-chains.js:108)",
    owner: "C1b",
  },
  {
    call: "diagnostics.models",
    principal: "script",
    served_by: "omo doctor --models --json (bin/lib/model-chains.js:109)",
    owner: "C1b",
  },
  {
    call: "engine.config.agentDir",
    principal: "person",
    served_by: "omo config agent-dir --json (engine agent-dir-command)",
    owner: "E1c",
  },
  {
    call: "engine.config.agentDir",
    principal: "script",
    served_by: "omo config agent-dir --json (engine agent-dir-command)",
    owner: "E1c",
  },
  {
    call: "engine.config.resources",
    principal: "person",
    served_by: "omo config (engine config-selector)",
    owner: "E1c",
  },
  {
    call: "engine.config.resources",
    principal: "script",
    served_by: "the same OS user (security design 3): omo config (engine config-selector)",
    owner: "E1c",
  },
  {
    call: "engine.models.update",
    principal: "person",
    served_by: "omo update --models (engine package-manager-cli)",
    owner: "E1c",
  },
  {
    call: "engine.models.update",
    principal: "script",
    served_by: "the same OS user (security design 3): omo update --models (engine package-manager-cli)",
    owner: "E1c",
  },
  {
    call: "engine.promptSizes",
    principal: "person",
    served_by: "omo --print-prompt-sizes (engine cli args)",
    owner: "E1c",
  },
  {
    call: "engine.promptSizes",
    principal: "script",
    served_by: "omo --print-prompt-sizes, JSON output (engine cli args)",
    owner: "E1c",
  },
  { call: "engine.tips", principal: "person", served_by: "omo --list-tips (engine cli args)", owner: "E1c" },
  {
    call: "engine.tips",
    principal: "script",
    served_by: "omo --list-tips, JSON output (engine cli args)",
    owner: "E1c",
  },
  {
    call: "engine.sessionOfPid",
    principal: "person",
    served_by: "omo session-of-pid --json (engine session-of-pid-command)",
    owner: "E1c",
  },
  {
    call: "engine.sessionOfPid",
    principal: "script",
    served_by: "omo session-of-pid --json (engine session-of-pid-command)",
    owner: "E1c",
  },
  {
    call: "engine.sessions.exportHtml",
    principal: "person",
    served_by: "omo --export (engine cli args)",
    owner: "E1c",
  },
  {
    call: "engine.sessions.exportHtml",
    principal: "script",
    served_by: "the same OS user (security design 3): omo --export (engine cli args)",
    owner: "E1c",
  },
  {
    call: "toolkit.help",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop help (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.help",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop help (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.help",
    principal: "session",
    served_by: "agentToolkit.help (ulw-loop/sdk/session-toolkit.ts:116)",
    owner: "OC2",
  },
  {
    call: "toolkit.addGoal",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop add-goal (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.addGoal",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop add-goal (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.addGoal",
    principal: "session",
    served_by: "agentToolkit.addGoal (ulw-loop/sdk/session-toolkit.ts:132)",
    owner: "OC2",
  },
  {
    call: "toolkit.checkpoint",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop checkpoint (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.checkpoint",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop checkpoint (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.checkpoint",
    principal: "session",
    served_by: "agentToolkit.checkpoint (ulw-loop/sdk/session-toolkit.ts:134)",
    owner: "OC2",
  },
  {
    call: "toolkit.completeGoals",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop complete-goals (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.completeGoals",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop complete-goals (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.completeGoals",
    principal: "session",
    served_by: "agentToolkit.completeGoals (ulw-loop/sdk/session-toolkit.ts:129)",
    owner: "OC2",
  },
  {
    call: "toolkit.createGoals",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop create-goals (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.createGoals",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop create-goals (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.createGoals",
    principal: "session",
    served_by: "agentToolkit.createGoals (ulw-loop/sdk/session-toolkit.ts:128)",
    owner: "OC2",
  },
  {
    call: "toolkit.criteria",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop criteria (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.criteria",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop criteria (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.criteria",
    principal: "session",
    served_by: "agentToolkit.criteria (ulw-loop/sdk/session-toolkit.ts:130)",
    owner: "OC2",
  },
  {
    call: "toolkit.recordEvidence",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop record-evidence (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.recordEvidence",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop record-evidence (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.recordEvidence",
    principal: "session",
    served_by: "agentToolkit.recordEvidence (ulw-loop/sdk/session-toolkit.ts:131)",
    owner: "OC2",
  },
  {
    call: "toolkit.recordReviewBlockers",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop record-review-blockers (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.recordReviewBlockers",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop record-review-blockers (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.recordReviewBlockers",
    principal: "session",
    served_by: "agentToolkit.recordReviewBlockers (ulw-loop/sdk/session-toolkit.ts:140)",
    owner: "OC2",
  },
  {
    call: "toolkit.status",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop status (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.status",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop status (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.status",
    principal: "session",
    served_by: "agentToolkit.status (ulw-loop/sdk/session-toolkit.ts:121)",
    owner: "OC2",
  },
  {
    call: "toolkit.steer",
    principal: "person",
    served_by: "oh-my-opencode ulw-loop steer (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.steer",
    principal: "script",
    served_by:
      "the same OS user (security design 3): oh-my-opencode ulw-loop steer (omo-opencode/src/cli/runtime-commands.ts:100)",
    owner: "OC2",
  },
  {
    call: "toolkit.steer",
    principal: "session",
    served_by: "agentToolkit.steer (ulw-loop/sdk/session-toolkit.ts:133)",
    owner: "OC2",
  },
]
