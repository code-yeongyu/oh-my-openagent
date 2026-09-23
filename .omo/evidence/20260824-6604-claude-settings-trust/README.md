# Evidence: Issue #6604 - Claude settings.json project trust gate

Date: 2026-08-24
Branch: issue/6604-claude-settings-trust (base dev @8833800ae)

## Root Cause

`loadClaudeHooksConfig()` in
`packages/omo-opencode/src/hooks/claude-code-hooks/config.ts` merged hooks from
the two project-level settings files

- `<cwd>/.claude/settings.json`
- `<cwd>/.claude/settings.local.json`

unconditionally. Upstream Claude Code only loads project-level settings after a
per-directory trust decision, persisted in `~/.claude.json` under
`projects.<absolute-path>.hasTrustDialogAccepted`. The plugin never consulted
that decision (or any other trust signal), so a repository that commits a
`.claude/settings.json` with e.g. a `UserPromptSubmit` hook got arbitrary shell
commands spawned (`executeHookCommand`, `shell: true`) whenever a user submitted
a prompt in that project. The only existing gate was `isHookCommandDisabled()`,
an opt-out allowlist, not an opt-in trust gate.

## Fix

1. New `project-trust.ts`: `resolveProjectTrust(projectDir)` resolves a
   `{ trusted, source }` decision:
   - explicit Claude Code decision wins: `hasTrustDialogAccepted: true|false`
     read from `$CLAUDE_CONFIG_DIR/.claude.json`, falling back to
     `~/.claude.json` (source `claude-trust-dialog`);
   - no recorded decision + env opt-in `OMO_CLAUDE_SETTINGS_TRUST=1|true`
     trusts the directory (source `env-opt-in`) for users who maintain project
     settings without ever opening the project in Claude Code;
   - otherwise untrusted by default (source `no-decision`). An explicit deny
     cannot be lifted by the env var.
2. `config.ts`: path construction split into user scope
   (`<claude-config-dir>/settings.json`) and project scope (the two cwd-derived
   files). Project-scope paths are only merged when `resolveProjectTrust(cwd)`
   is trusted; skipped paths are logged. User-level settings and an explicit
   `customSettingsPath` are unaffected. Public `getClaudeSettingsPaths()`
   behavior (returned list) is unchanged.

## WHAT WAS TESTED

- New `project-trust.test.ts` (7 tests): default-deny with no decision,
  accepted/rejected Claude decisions, env opt-in, explicit deny beats env
  opt-in, malformed `.claude.json` falls back to default-deny. All run against
  an isolated temp `CLAUDE_CONFIG_DIR`.
- Extended `config.test.ts` with a "loadClaudeHooksConfig project trust gating"
  suite (5 tests): untrusted project hooks excluded, trusted project hooks
  included, explicit deny survives env opt-in, unknown project + env opt-in
  loads, and user-level settings still load for an untrusted project.
- Full scoped suite: `bun test packages/omo-opencode/src/hooks/claude-code-hooks/`.
- Repo typecheck: `bun run typecheck` (tsgo root + script + all packages).

## WHAT WAS OBSERVED

- Failing first: with base `config.ts` and no `project-trust.ts`, the new tests
  fail (4 gating assertions + module-not-found error). See
  `new-tests-red-before-fix.txt` (13 pass / 4 fail / 1 error).
- After the fix: same two test files 22 pass / 0 fail
  (`new-tests-green-after-fix.txt`); full claude-code-hooks dir 127 pass /
  0 fail (`scoped-tests-after.txt`).
- Baseline on clean HEAD (stash) was 116 pass / 0 fail across 16 files
  (`scoped-tests-before-fix.txt`), i.e. the 11 new tests are additive.
- `bun run typecheck` exit 0, zero errors (`typecheck.txt`).

## WHY IT IS ENOUGH

The tests pin the exact vulnerable behavior named in the issue: project-level
hook config from an untrusted cwd is no longer merged into the dispatched hook
config, while every legitimate path (Claude-trusted projects, env opt-in,
user-level settings, custom settings path) keeps working. The gate sits at the
single choke point (`loadClaudeHooksConfig`) through which every CC hook event
handler (UserPromptSubmit, PreToolUse, Stop, ...) obtains its config, so one
gate covers all dispatch surfaces. Remaining regression risk is limited to
users who relied on project `.claude/settings.json` hooks in directories Claude
Code never marked trusted; for them the documented escape hatch is
`OMO_CLAUDE_SETTINGS_TRUST=1`.

## WHAT WAS OMITTED

- Live end-to-end OpenCode drive: the change is confined to the hook-config
  loader covered above; spawning real OpenCode adds no additional coverage of
  the trust decision itself. Unit evidence plus the existing handler DI tests
  (127 passing) cover the changed surface.
- A repo-wide perf test
  (`__tests__/perf/plugin-init-team-mode-resume-defer.test.ts`) fails on clean
  HEAD @8833800ae identically (timing budget exceeded, ~2.5s vs 2s), verified
  via `git stash`; it is a pre-existing environment flake unrelated to this
  change and was not modified.
- No secrets appear in any captured artifact; test fixtures use throwaway
  temp dirs and never touch the real `~/.claude.json`.
