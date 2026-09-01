# Minimal project-agent Team Mode QA

This directory contains a narrow real-OpenCode QA run for the project-agent authorization boundaries in PR #6145. The runner uses the current TypeScript source plugin, an isolated OpenCode configuration and data root per scenario, and a local OpenAI Responses-compatible provider. It does not use the host OpenCode configuration for spawned sessions. Before OpenCode starts, the runner writes `.opencode/agents/repository-reviewer.md` directly into each isolated project. OpenCode's native agent parser supplies the final model, variant, prompt, and permissions from that file, while OMO records exact-directory config-time provenance for the same source.

## What was tested

Five real `opencode run --format json` scenarios were executed:

1. `accepted`: a project-file `repository-reviewer` whose final permissions explicitly allow `call_omo_agent` and all five required Team tools, and explicitly deny `task`, `question`, `write`, `edit`, and `apply_patch`.
2. `rejected-source-shadow`: a later project OpenCode config definition shadows the same-name project-file agent and invalidates exact-directory config-time provenance.
3. `rejected-permission`: the final project agent still allows all five required Team tools and denies `task` and `question`, but denies `call_omo_agent` instead of agreeing with the launcher.
4. `rejected-project-lead`: `repository-reviewer` is declared as the explicit team lead.
5. `rejected-prototype-lead`: inherited prototype name `constructor` is declared as the explicit team lead.

Every scenario uses a distinct inline team name and lead/member shape. Each rejected scenario asserts the exact top-level error class and required message fragment, zero child provider requests, and zero child sessions.

## What was observed

- All 29 assertions passed.
- The accepted stream contains exactly 6 OpenCode run events and used exactly 4 provider requests. `team_create` completed and resolved member `reviewer` to final identity `repository-reviewer`, model `openai/gpt-project-agent`, and variant `xhigh`.
- The accepted child request contained both prompt markers, exposed `call_omo_agent` and all five required Team tools, and did not expose `task`, `question`, `write`, `edit`, or `apply_patch`. Exactly one child provider request and one child session were created.
- The accepted project agent source existed before the parent provider returned the `team_create` call and after the run.
- `rejected-source-shadow` and `rejected-permission` each surfaced `TeamRunCreateError` with the exact provenance and launcher-permission message fragments, respectively.
- `rejected-project-lead` and `rejected-prototype-lead` each surfaced `Error` with the exact project-defined-agent lead rejection fragment.
- The combined rejected stream contains exactly 24 events: 6 per rejected scenario. Every event has a top-level `qaScenario` field. The four rejected scenarios used exactly 12 provider requests total and created no child provider request or child session.
- `provider-requests.jsonl` contains exactly 16 allowlisted metadata-only records across all five scenarios.
- `qa-result.json` records the exact host OpenCode session count before and after; the values are equal. All 5 provider processes stopped and all 5 external sandboxes were removed.
- The evidence directory still contains exactly the original 7 files. No evidence artifact file was added.
- `qa-result.json` records git HEAD `ee3eda6938facb73ad6cfeed32b95ad6cf37e2fd`, exact porcelain status, 12 final uncommitted source/test/doc hashes, and hashes for this README plus both harness scripts.

## Why it is enough

The real OpenCode CLI loads the current source plugin and invokes the actual `team_create` tool. Only the remote model is replaced. Direct pre-launch source creation exercises OpenCode's normal project-agent discovery and final ordered permission rules; no OMO agent override supplies the project agent. The accepted scenario proves final identity, model, variant, prompt, source presence, launcher-compatible permissions, child request, and child session behavior. The four rejection scenarios prove the distinct provenance, permission, project-lead, and inherited-prototype boundaries before any child side effect. Exact event/request counts, unchanged host sessions, stopped providers, removed sandboxes, a fixed seven-file artifact set, and metadata-only outputs cover isolation and cleanup.

## Sanitization and omissions

Raw provider request bodies, HTTP headers, tokens, credentials, environment values, cookies, host database rows, temporary sandbox paths, and raw stderr are not retained. Provider evidence contains only allowlisted metadata fields. OpenCode JSONL replaces sandbox and repository roots with stable placeholders. `qa-result.json` stores stderr byte and non-empty-line counts only.

## Residual risks

- This is a Linux CLI run, not a cross-platform or TUI test.
- The local provider validates OpenAI Responses request construction and tool flow, not a remote provider implementation.
- The exact error-class receipt is the top-level class visible at the tool boundary: runtime member failures are wrapped as `TeamRunCreateError`, while pre-runtime lead validation throws `Error`.
- The run does not exercise cross-directory explicit `leadSessionId`; focused tests cover that separate boundary.

## Exact commands

Run from the worktree root:

```bash
bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
node --check .omo/evidence/20260716-minimal-project-agent-members/fake-provider.mjs
node --check .omo/evidence/20260716-minimal-project-agent-members/run-qa.mjs
host_db="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"
sqlite3 -readonly "$host_db" "SELECT count(*) FROM session;"
node .omo/evidence/20260716-minimal-project-agent-members/run-qa.mjs
sqlite3 -readonly "$host_db" "SELECT count(*) FROM session;"
node -e 'const r=require("./.omo/evidence/20260716-minimal-project-agent-members/qa-result.json"); console.log(JSON.stringify({passed:r.passed,assertionCount:r.assertionCount,hostIsolation:r.hostIsolation},null,2))'
```

## Final git status

`git status --short --untracked-files=all` is recorded verbatim in `qa-result.json` and contains these 19 paths:

```text
 M .omo/evidence/20260716-minimal-project-agent-members/README.md
 M .omo/evidence/20260716-minimal-project-agent-members/fake-provider.mjs
 M .omo/evidence/20260716-minimal-project-agent-members/opencode-run-accepted.jsonl
 M .omo/evidence/20260716-minimal-project-agent-members/opencode-run-rejected.jsonl
 M .omo/evidence/20260716-minimal-project-agent-members/provider-requests.jsonl
 M .omo/evidence/20260716-minimal-project-agent-members/qa-result.json
 M .omo/evidence/20260716-minimal-project-agent-members/run-qa.mjs
 M docs/guide/team-mode.md
 M packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.ts
 M packages/omo-opencode/src/features/team-mode/team-registry/project-agent-loader.test.ts
 M packages/omo-opencode/src/features/team-mode/team-runtime/resolve-member.test.ts
 M packages/omo-opencode/src/features/team-mode/team-runtime/resolve-member.ts
 M packages/omo-opencode/src/features/team-mode/tools/lifecycle-create-tool.ts
 M packages/omo-opencode/src/features/team-mode/tools/lifecycle-inline-project-agent.test.ts
 M packages/omo-opencode/src/plugin-handlers/agent-config-handler.ts
 M packages/omo-opencode/src/plugin-handlers/config-handler.ts
 M packages/omo-opencode/src/plugin-handlers/project-agent-provenance-cache.test.ts
 M packages/team-core/src/team-registry/validator-options.test.ts
 M packages/team-core/src/team-registry/validator.ts
```

## Final source hash manifest

The runner recomputes and asserts this exact 12-file uncommitted source set. `qa-result.json` is the machine-readable manifest.

| SHA-256 | File |
|---|---|
| `5aa3af8214567a61a517a133c2ce4ad0ce720b0570e3057b67649a894cb4e49d` | `docs/guide/team-mode.md` |
| `a60af335e8673d86cdf549477ac2f797fa9982e790ff177a1c0bc83c75132f11` | `packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.ts` |
| `3484844adced89fce0060af748b42b1d2e202fe1647b1d39240462740f7c2942` | `packages/omo-opencode/src/features/team-mode/team-registry/project-agent-loader.test.ts` |
| `66442f029cbc7e082fec2cc063dd84d9448c081ab557480e80eff0da289090a9` | `packages/omo-opencode/src/features/team-mode/team-runtime/resolve-member.test.ts` |
| `5b8efca9d388ea2c8248c4a85c3a6f22f0edbfb1db3e952cf7eb73c7c183732d` | `packages/omo-opencode/src/features/team-mode/team-runtime/resolve-member.ts` |
| `8fca28debafd27be740693bd3d08a19eb9ec0bf2204aa1ea859b0a69589c8efa` | `packages/omo-opencode/src/features/team-mode/tools/lifecycle-create-tool.ts` |
| `fa8ff5778730a99cd9b190c295d3378c7865ba71bdad36da9a1f7350cf95c6dc` | `packages/omo-opencode/src/features/team-mode/tools/lifecycle-inline-project-agent.test.ts` |
| `d649aa09faf54254ff5356a3ad0eac04a140976c9cb016252e9ec05751cfaf43` | `packages/omo-opencode/src/plugin-handlers/agent-config-handler.ts` |
| `50cc5842814879eec75f5c4755a563745956ce41977e00096635329be62bd619` | `packages/omo-opencode/src/plugin-handlers/config-handler.ts` |
| `1f664bb002e397d2961a1573701e7967700f9d9ff0bab59c33d9647ade439136` | `packages/omo-opencode/src/plugin-handlers/project-agent-provenance-cache.test.ts` |
| `fdee7dd4ccec0b819efc77a4e6d11f7267e93868a6687add175ad2bd40fb9a42` | `packages/team-core/src/team-registry/validator-options.test.ts` |
| `cb4140bdf53800ca77cbde3f835b369dce8457c2affb8113e309edd05cce87dc` | `packages/team-core/src/team-registry/validator.ts` |

## Artifact index

- `README.md`: reviewer guide, exact commands, counts, status, and source hash manifest.
- `run-qa.mjs`: isolated five-scenario runner and 29 assertions.
- `fake-provider.mjs`: local OpenAI Responses SSE fake with scenario-specific inline specs.
- `qa-result.json`: assertions, isolation counts, cleanup receipts, git state, and source/harness manifests.
- `provider-requests.jsonl`: sanitized request metadata only.
- `opencode-run-accepted.jsonl`: the single structured accepted run stream.
- `opencode-run-rejected.jsonl`: one combined structured stream with four `qaScenario` values.
