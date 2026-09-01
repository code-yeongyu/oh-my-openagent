# QA evidence: fix #6990 — permission.task user override on main agents

Date: 2026-08-18. Worktree: `fix/issue-6990-permission-task` (omo @ 5f3eab64e + fix).
Surface driven: real `opencode serve` v1.18.18 (bun 1.4.0-canary.1) loading this
worktree's built plugin bundle via `file://<worktree>/dist/index.js`, HTTP API
`GET /agent`, per the `opencode-qa` skill (Case B, server route).

## WHAT WAS TESTED

1. User-config wins: boot with user-layer `~/.omo/omo.jsonc` containing a
   `[opencode]` harness block that sets `agents.{sisyphus,atlas,hephaestus,prometheus}.permission.task = "ask"`.
   Assert each served main agent's effective task action is `ask`.
2. Negative control (default preserved): identical boot WITHOUT the user task
   config. Assert each served main agent's effective task action is `allow`.
3. Isolation: real `~/.local/share/opencode/opencode.db` session count compared
   read-only before/after (5861 -> 5861).

Driver: `qa-driver.sh` (uses the opencode-qa skill harness
`.agents/skills/opencode-qa/scripts/lib/common.sh`: isolated XDG + HOME
sandbox, free port, readiness poll on `/global/health`). A fake OpenAI provider
entry (baseURL `http://127.0.0.1:9/v1`, never dialed — agent registration only
needs model metadata) lets Atlas register, which otherwise needs a resolvable
model. Raw output: `qa-run.txt`.

## WHAT WAS OBSERVED

- user-config scenario: raw task entries per main agent are `*=deny` (global
  default injected by the handler) followed by `*=ask` (user value surviving
  `applyToolConfig`); effective (last-wins) action `ask` for all four agents.
- default scenario: `*=deny` then `*=allow`; effective action `allow` for all
  four agents — the plugin default is unchanged when the user configured
  nothing.
- All 9 checks passed; real opencode.db session count unchanged.
- Before-fix behavior is captured by the unit-test RED run (4 failures:
  `Expected: "ask" / Received: "allow"` in
  `tool-config-handler-task-deny.test.ts`).

## WHY THIS IS ENOUGH

The change is 4 moved lines in one handler; the QA drives the exact production
path (omo.jsonc user layer -> `[opencode]` block -> plugin Zod config ->
`applyAgentConfig` deep-merge -> `applyToolConfig` -> served agent permission)
on a real opencode server for all four affected agents, in both the
user-configured and default states, with the untouched-host proof the skill
mandate requires. Unit tests additionally pin the handler-level behavior for
all four agents plus the sisyphus-junior and subagent deny-list regressions.

## WHAT WAS OMITTED

- No model API calls were made (no API keys in this environment); the fake
  provider's endpoint is never contacted because no session is prompted.
- Atlas is covered here via the fake provider metadata; no real atlas model
  resolution was exercised (unrelated to this change).

## CONFIG-PATH FINDING (documented for reviewers)

During QA setup we verified how a user actually reaches `permission.task`
today:

- Top-level `agents.<key>.permission` in `omo.jsonc` is REJECTED by the strict
  shared schema `OmoAgentDefInputSchema` (`packages/omo-config-core/src/schema/agent.ts`,
  `.strict()`, no `permission` key): `validatePluginConfig` drops the whole
  `agents` section with diagnostic `Invalid omo config at ...: agents.sisyphus...`
  (probe output: `pipeline-findings.txt`).
- The working path is the `[opencode]` harness block:
  `{"[opencode]": {"agents": {"sisyphus": {"permission": {"task": "ask"}}}}}`,
  which is freeform to the core and validated by the plugin's own
  `AgentOverridesSchema` (`permission.task` = enum `ask|allow|deny`).
- The object mapping form (`permission.task = {"rtl-designer": "deny"}`) is
  NOT accepted by `AgentPermissionSchema`
  (`packages/omo-opencode/src/config/schema/internal/permission.ts`: `task` is
  `PermissionValueSchema.optional()`, unlike `bash` which allows a record).
  Widening it is issue option A, tracked as a follow-up and out of scope here.
