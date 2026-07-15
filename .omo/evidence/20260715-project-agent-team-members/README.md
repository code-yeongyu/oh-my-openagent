# Project Agent Team Mode QA: PASS

## Verdict

Real QA passed **23/23 assertions** at exact source HEAD `7e19e17e4352cffe3ac33a91a370e73aa6995972` (`7e19e17e4`). It did not run against a source head plus uncommitted PR changes.

The real `opencode run --format json` run selected the canonical OMO Sisyphus lead, authorized `team_create`, launched the exact project-defined `repository-reviewer` member, used its configured model, variant, and prompt, shaped member permissions, used the nested member worktree, delivered the Team message to the lead, shut down the provider, removed the sandbox, and preserved host isolation.

## What was tested

### Real OpenCode harness

```text
node .omo/evidence/20260715-project-agent-team-members/run-qa.mjs
```

The runner loads `packages/omo-opencode/src/index.ts` from the exact source checkout through a `file://` URL. It creates a fresh external sandbox with isolated HOME, XDG roots, and CODEX_HOME; removes inherited OpenCode configuration and provider credentials; initializes a fixture Git project; and drives `opencode run --format json` with model `openai/gpt-fake` and the project-agent Team prompt.

The local fake OpenAI Responses provider records selected non-secret metadata. Host database checks are read-only.

### Deterministic suites

The refreshed `bun test` scopes cover the project-agent handler and assembly path, caller and parent permission checks, final origin-registry provenance, Team lifecycle authority, member preparation, nested member directory provenance and routing, worktree ownership, dormant cleanup, force-delete cleanup, terminal task cancellation, and background-session permissions.

Focused final-blocker command scope, 12 files:

```text
bun test \
  packages/omo-opencode/src/plugin-handlers/agent-config-handler.test.ts \
  packages/omo-opencode/src/features/team-mode/resolve-caller-team-lead.test.ts \
  packages/omo-opencode/src/features/team-mode/tools/lifecycle-authority.test.ts \
  packages/omo-opencode/src/features/team-mode/tools/lifecycle-inline-spec.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/project-agent-member.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/prepare-team-members.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/worktree-ownership.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/create.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/cleanup-team-run-resources.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/shutdown.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/delete-team-bg-cancel.test.ts \
  packages/omo-opencode/src/features/background-agent/manager-session-permission.test.ts
```

Provenance and authority command scope, 9 files:

```text
bun test --verbose \
  packages/omo-opencode/src/plugin-handlers/agent-config-handler.test.ts \
  packages/omo-opencode/src/plugin-handlers/agent-config-assembly.test.ts \
  packages/omo-opencode/src/shared/project-agent-origin-registry.test.ts \
  packages/omo-opencode/src/features/team-mode/resolve-caller-team-lead.test.ts \
  packages/omo-opencode/src/features/team-mode/open-code-agent-eligibility.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/native-agent-admission.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/team-parent-permission.test.ts \
  packages/omo-opencode/src/features/team-mode/tools/lifecycle-authority.test.ts \
  packages/omo-opencode/src/features/team-mode/tools/lifecycle-inline-spec.test.ts
```

Ownership and cleanup command scope, 7 files:

```text
bun test --verbose \
  packages/omo-opencode/src/features/team-mode/team-runtime/prepare-team-members.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/worktree-ownership.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/cleanup-team-run-resources.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/shutdown.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/delete-team-bg-cancel.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/delete-team-force-state.test.ts \
  packages/omo-opencode/src/features/background-agent/manager-directory-routing.test.ts
```

Widened affected-suite and documentation checks:

```text
bun test \
  packages/team-core \
  packages/omo-opencode/src/features/team-mode \
  packages/omo-opencode/src/features/background-agent \
  packages/omo-opencode/src/plugin-handlers/agent-config-handler.test.ts \
  packages/omo-opencode/src/plugin-handlers/agent-config-assembly.test.ts \
  packages/omo-opencode/src/shared/project-agent-origin-registry.test.ts
bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts
bash /home/nikita/work/Projects/ai/op/oh-my-openagent/.agents/skills/opencode-qa/scripts/lib/common.sh --self-check
node --check .omo/evidence/20260715-project-agent-team-members/run-qa.mjs
node --check .omo/evidence/20260715-project-agent-team-members/fake-provider.mjs
git diff --check
```

## What was observed

### Real-harness proof

`qa-result.json` records all 23 assertions as true. The run exited successfully, the provider observed the parent `team_create` call, and the child had exact `repository-reviewer` identity, `openai/gpt-project-agent` model, `xhigh` variant, project prompt marker, assigned task, Team guidance, and member worktree directory.

The child exposed the required Team member tools, did not receive repository write tools or `question`, completed `team_send_message` to `lead`, received the tool result, and completed. The live lead inbox recorded `QA_TEAM_MESSAGE` from `reviewer`.

Host isolation is explicit in `qa-result.json`:

```text
host session count: 3920 -> 3920
newHostSessions: []
hostDatabaseExcludedQaSandbox: true
```

The fake provider stopped and the successful sandbox was removed.

### Deterministic proof

- `focused-final-blockers.log`: **164 pass, 0 fail, 368 expect() calls, 12 files**.
- `provenance-authority-supplemental.log`: **138 pass, 0 fail, 268 expect() calls, 9 files**.
- `token-ownership-supplemental.log`: **62 pass, 0 fail, 154 expect() calls, 7 files**.
- `team-background-suite.log`: **1297 pass, 2 skip, 0 fail, 3192 expect() calls, 144 files**.
- `markdown-link-audit.log`: **16 pass, 0 fail, 21 expect() calls, 1 file**.
- `opencode-qa-common-self-check.log`: pass, including dependencies, DB path, SQL escaping, free port, isolated XDG/HOME, shim, and cleanup checks.
- Both `node --check` commands passed. `git diff --check` passed.

The focused tests cover the runtime failures fixed by this work: canonical-key rather than display-name parent lookup, aggregate `config.agent` provenance reflection, nested member-directory provenance, ownership-safe dormant cleanup, terminal task cancellation, and per-task directory routing.

## Why this is enough

The real harness proves the user-visible path through the installed OpenCode CLI and exact current source: final-registry authorization, project-agent resolution, model and prompt selection, permission shaping, worktree launch, Team guidance, live mailbox delivery, completion, provider shutdown, and sandbox cleanup.

The deterministic suites cover adversarial provenance, parent permission, cancellation, ownership, cleanup, and directory-routing cases that are unsafe or impractical to manufacture in a successful live run. The widened suite covers the affected Team Mode and background-agent areas. This is not a claim that the full root suite ran.

## What was omitted and redacted

- No raw provider request bodies were retained.
- No tokens, auth headers, credentials, private configuration, environment dumps, or host database rows were recorded.
- The fake provider uses a non-secret placeholder API key.
- Provider evidence retains selected model IDs, branch labels, booleans, Team run IDs, and tool names only.
- Temporary sandbox paths remain in structured evidence for traceability, but the directories were removed.

## Residual risks

- The provider is deterministic and local. It proves OpenCode and plugin integration, not remote vendor behavior.
- Failure-path ownership, cancellation, force-delete, dormant-cleanup, and directory-routing behavior is deterministic test proof rather than destructive live CLI testing.
- The full root suite was not rerun. The focused suites, widened affected suite, Markdown audit, OpenCode self-check, syntax checks, diff check, and real CLI path were rerun.
- File-level LSP diagnostics could not address this secondary worktree because the diagnostics request root is the primary checkout. The requested Node syntax checks passed.

## Artifact index

- `README.md`: commands, scope, observations, omissions, and residual risks.
- `qa-result.json`: 23 passing assertions, exact source head, runtime metadata, host isolation, and cleanup state.
- `opencode-run.jsonl`, `opencode-run.stderr.log`: structured CLI result and warning stream.
- `provider-requests.jsonl`, `provider-stdout.log`, `provider-stderr.log`: sanitized fake-provider evidence.
- `isolated-sessions.json`, `child-session-parts.json`, `lead-inbox-messages.json`: isolated session, Team guidance, and live message evidence.
- `focused-final-blockers.log`, `provenance-authority-supplemental.log`, `token-ownership-supplemental.log`, `team-background-suite.log`: deterministic suite summaries.
- `markdown-link-audit.log`, `opencode-qa-common-self-check.log`: documentation and QA-harness checks.
- `run-qa.mjs`, `fake-provider.mjs`: reproducible redacted harness.
