# QA Evidence — doctor deprecated-key scan fixes (2026-08-09)

Discord report: https://discord.com/channels/1452487457085063218/1490536332961906829/1535893865901596673
(jianli0321: docs show `fallback_models` as supported; `omo doctor` flags it as "Deprecated reasoning config key")

## What was tested

Surface: the real `oh-my-opencode doctor` CLI (`bun packages/omo-opencode/src/cli/index.ts doctor --json`)
plus the `checkDeprecatedReasoningKeys` check imported directly, both against isolated sandbox HOMEs
(mktemp dirs; the real `~/.omo` was never read or written — HOME was overridden for every run).

Scenarios:
1. `repro-omo.jsonc` — canonical MIGRATED config: `provider_options.thinking` / `provider_options.textVerbosity`
   under `categories`, `agents`, the `models` catalog, and a `[codex]` block (`providerOptions`), plus one
   genuinely deprecated key (`categories.deep.variant`) as a control.
2. `reporter-shape-omo.jsonc` — the reporter's exact config shape: `[opencode].agents.<name>.fallback_models`
   (string + object entries), mirroring the screenshots.

## What was observed

- BEFORE (pre-fix code, `before-check-output.json` + `before-cli-doctor.json`):
  6 issues, message "6 deprecated reasoning key(s) found". 5 are bogus descents into
  provider_options/providerOptions — including the self-referential
  "Replace textVerbosity with provider_options.textVerbosity" on a key ALREADY at
  provider_options.textVerbosity. The real CLI `doctor --json` shows the same 6 issues.
- AFTER (fixed code, `after-check-output.json` + `after-cli-doctor.json`):
  exactly 1 issue — the planted control `categories.deep.variant` — with accurate title
  "Deprecated config key" and message "1 deprecated config key(s) found". Real CLI agrees (1 occurrence).
- Reporter shape (`after-check-reporter-shape.json`): status "pass", 0 issues,
  "No deprecated config keys found" — the user's documented `[opencode]` `fallback_models` config is clean.
- Tests: `bun test packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts`
  RED first (new case failed with the 5 bogus paths), GREEN after the fix (3 pass / 9 expects).
  Full doctor dir: 163 pass / 0 fail across 27 files. `tsgo --noEmit -p packages/omo-opencode` exit 0.

## Why it is enough

The changed code path is entirely inside `collectIssues()` of one check file; both the unit seam
(direct check import) and the user-visible surface (real CLI `doctor --json`) were driven before and after
with identical sandbox configs, covering: false-positive removal, label accuracy, and non-regression of
legitimate deprecation flagging (control key still reported; existing tests for top-level/[senpi]/[codex]/
profiles expectations untouched and green).

## What was omitted

- `before/after-cli-doctor.json` include unrelated doctor categories (system/tools/models) that error in the
  sandbox (no opencode binary etc.); only the Configuration section is relevant. No secrets are present:
  sandbox HOMEs contain only the synthetic configs above.
