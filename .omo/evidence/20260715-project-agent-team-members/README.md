# Project Agent Team Mode QA: PASS

## Verdict

The refreshed real OpenCode QA passes at source HEAD `4f9e62f517ec70bbc668aa1450e093d21c0a1731` plus the current uncommitted PR changes.

The real `opencode run --format json` process selected the canonical OMO `Sisyphus - ultraworker` lead, authorized `team_create`, launched the exact project-defined `repository-reviewer` member, delivered its Team message, observed normal child completion, preserved the host OpenCode session count, stopped the fake provider, and removed the isolated sandbox.

## What was tested

### Real OpenCode harness

```text
node .omo/evidence/20260715-project-agent-team-members/run-qa.mjs
```

The runner:

- loads `packages/omo-opencode/src/index.ts` directly through a `file://` URL, not a published package or stale build;
- creates an external `/tmp/omo-project-agent-team-qa-*` sandbox with fresh `HOME`, `USERPROFILE`, all XDG roots, and `CODEX_HOME`;
- removes inherited OpenCode config overrides and provider credentials;
- initializes a fresh Git project containing only the QA project-agent fixture;
- selects the canonical `Sisyphus - ultraworker` default agent;
- uses a local fake OpenAI Responses provider that records selected metadata only;
- reads the host database only through direct, read-only `SELECT count(*) FROM session` guards;
- removes the temporary sandbox on pass or assertion failure.

The spawned CLI command is equivalent to:

```text
opencode run \
  --format json \
  --model openai/gpt-fake \
  --dir <isolated-project> \
  "QA_TRIGGER_PROJECT_AGENT_TEAM: create the requested team and wait for its member to start."
```

### Focused final-blocker suite

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

### Provenance/authority and token-ownership supplements

```text
bun test --verbose \
  packages/omo-opencode/src/plugin-handlers/agent-config-handler.test.ts \
  packages/omo-opencode/src/features/team-mode/resolve-caller-team-lead.test.ts \
  packages/omo-opencode/src/features/team-mode/tools/lifecycle-authority.test.ts

bun test --verbose \
  packages/omo-opencode/src/features/team-mode/team-runtime/prepare-team-members.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/worktree-ownership.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/cleanup-team-run-resources.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/shutdown.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/delete-team-bg-cancel.test.ts
```

### Broad and documentation checks

```text
bun test packages/omo-opencode/src/features/team-mode packages/omo-opencode/src/features/background-agent
bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts
bash /home/nikita/work/Projects/ai/op/oh-my-openagent/.agents/skills/opencode-qa/scripts/lib/common.sh --self-check
```

## What was observed

### Real-harness proof

`qa-result.json` records **23/23 assertions passing**:

- OpenCode exited successfully and the provider observed the parent `team_create` call.
- The legitimate OMO Sisyphus lead was authorized through the final registry even though OMO plugin entries do not depend on OpenCode `native: true` metadata.
- Runtime state records member name `reviewer` and exact subagent identity `repository-reviewer`.
- Runtime state records `openai/gpt-project-agent` with variant `xhigh`.
- The child provider request contains `QA_PROJECT_AGENT_PROMPT_MARKER` and the assigned `QA_CHILD_TASK`.
- The child exposes all five required member tools: `team_send_message`, `team_task_list`, `team_task_get`, `team_task_update`, and `team_status`.
- The child does not expose `apply_patch`, `edit`, `write`, or `question`.
- `isolated-sessions.json` places the child in the exact `member-worktree` directory.
- `child-session-parts.json` contains the Team communication contract, TeamRunId instructions, member-tool guidance, and lead-only restrictions.
- `team_send_message` completed for recipient `lead` and returned `deliveredTo: ["lead"]`.
- `lead-inbox-messages.json` records sender `reviewer`, recipient `lead`, and body `QA_TEAM_MESSAGE` while the run was live.
- The child received the tool result and completed with `QA_CHILD_DONE`.
- Runtime state includes `ownedWorktreeRoot`, `worktreeOwnershipToken`, and `worktreeCanonicalPath` for the exact member leaf.
- Host OpenCode session count remained **3850 -> 3850**.
- The fake provider stopped and the successful sandbox was removed.

### Focused deterministic proof

- `focused-final-blockers.log`: **160 pass, 0 fail, 357 expect() calls, 12 files**.
- `provenance-authority-supplemental.log`: **56 pass, 0 fail, 103 expect() calls, 3 files**.
- `token-ownership-supplemental.log`: **43 pass, 0 fail, 98 expect() calls, 5 files**.
- `team-background-suite.log`: **1123 pass, 1 skip, 0 fail, 2808 expect() calls, 112 files**.
- `markdown-link-audit.log`: **16 pass, 0 fail, 21 expect() calls, 1 file**.
- `opencode-qa-common-self-check.log`: all dependency, DB-path, SQL-escape, free-port, isolated XDG/HOME, shim, and cleanup checks passed.
- `node --check` passed for `run-qa.mjs` and `fake-provider.mjs`; `git diff --check` passed.
- Initial and final worktree status match outside this evidence directory. This task changed no production source, tests, docs, packages, generated Codex files, or git history.

The provenance and authority tests prove what the real success path intentionally does not attempt:

- protected OMO final-registry identities remain eligible when `native` is `false` or absent;
- numerically prefixed user collisions are filtered before final display-name remapping;
- project collisions using a configured display alias are filtered while the real OMO entry is preserved;
- a prefixed project caller is denied when the protected Sisyphus identity is absent after collision filtering;
- ambiguous final-registry identities fail closed;
- undefined, unknown, and hard-reject callers cannot create teams.

The ownership and cancellation tests prove unsafe or impractical live failure paths:

- token markers are created for a newly owned exact leaf and removed only on a matching token and canonical path;
- pre-existing leaves, shared parents, legacy unmarked paths, and tampered-token paths are preserved;
- concurrent same-leaf reservation conflicts while sibling leaves receive independent ownership;
- cancellation returning `false` or throwing retains active resources and session registrations;
- normal and force cleanup remove only ownership-proven leaves.

## Why this is enough

The real harness proves the full user-visible success path through the installed OpenCode CLI and current plugin source: final-registry authorization, exact project-agent resolution, permission-shaped tool exposure, worktree launch, Team guidance, live mailbox delivery, completion, and isolation cleanup.

The focused tests complement that success path with adversarial provenance collisions, permission inheritance denial, atomic ownership-token behavior, concurrent reservation, cancellation failures, and destructive cleanup boundaries. These cases should not be manufactured inside the successful real session because doing so would weaken isolation or make destructive behavior harder to review.

## What was omitted and redacted

- No raw provider request bodies were retained.
- No tokens, auth headers, credentials, private config, environment dumps, or host database rows were recorded.
- The fake provider uses only a non-secret placeholder API key.
- Provider evidence contains selected model IDs, branch labels, booleans, Team run IDs, and tool names.
- Temporary sandbox paths remain in structured evidence for traceability, but the directories themselves were removed.

## Residual risks

- The provider is deterministic and local. This proves OpenCode/plugin integration without testing a remote model vendor.
- Failure-path ownership and cancellation behavior is deterministic test proof rather than a destructive live CLI scenario.
- The full root suite was not rerun in this evidence refresh. The focused and broad affected suites, Markdown audit, OpenCode self-check, and real CLI path were rerun.
- File-level LSP diagnostics could not address this secondary worktree because the diagnostics request root is the primary checkout. The requested Node syntax checks passed.

## Artifact index

- `README.md`: commands, real/focused proof distinction, observations, omissions, and residual risks.
- `qa-result.json`: 23 passing assertions, source state, runtime member metadata, host counts, and cleanup state.
- `opencode-run.jsonl`: structured parent turn with completed `team_create` and runtime state.
- `opencode-run.stderr.log`: real CLI warning stream.
- `provider-requests.jsonl`: sanitized provider metadata.
- `provider-stdout.log`, `provider-stderr.log`: fake provider lifecycle output.
- `isolated-sessions.json`: isolated parent and child session rows.
- `child-session-parts.json`: Team guidance, completed message tool call, and child completion.
- `lead-inbox-messages.json`: live persisted reviewer-to-lead message.
- `focused-final-blockers.log`: focused final-blocker suite.
- `provenance-authority-supplemental.log`: provenance collision and caller-authority suite.
- `token-ownership-supplemental.log`: ownership-token, preservation, cancellation, and cleanup suite.
- `team-background-suite.log`: broad Team/background suite.
- `markdown-link-audit.log`: Markdown audit.
- `opencode-qa-common-self-check.log`: official OpenCode QA harness self-check.
- `run-qa.mjs`, `fake-provider.mjs`: reproducible redacted harness.
