# Team Agent Ancestor Provenance QA

## What Was Tested

This evidence covers the focused change that lets Team Mode use the nearest registered project-agent provenance snapshot from the active directory or a lexical ancestor. The nearest snapshot remains authoritative, including an empty snapshot.

Changed product paths:

- `packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.ts`
- `packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.test.ts`
- `docs/guide/team-mode.md`

## Test-First Evidence

Before the production edit:

```text
bun test packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.test.ts
5 pass, 1 fail
```

The new parent-to-descendant assertion failed because the exact-directory lookup returned `false`. The nearer nonmatching snapshot, nearer empty snapshot, and sibling-prefix controls passed.

After the production edit:

```text
bun test packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.test.ts
6 pass, 0 fail, 7 expect() calls
```

## Static Verification

```text
bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.ts packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.test.ts
PASS: no violations

bun run typecheck
PASS

bun run build
PASS: all steps completed

git diff --check
PASS
```

`lsp_diagnostics` reported no diagnostics for either changed TypeScript file after installing the worktree's frozen dependencies.

The adjacent provenance-cache regression passed. The combined command that also names `team-runtime/resolve-member.test.ts` reported `10 pass, 1 fail, 1 error` because that untouched `local/dev-stack` test already contains an extra closing `})` (`Unexpected }` at line 350). The focused registry test, typecheck, build, and PR branch do not contain a failure caused by this change.

## Real OpenCode QA

The existing PR #6145 isolated fake-provider harness was reused against the current worktree. Its temporary copy was updated only for the current three-file source manifest, the current error text, and the unified project configuration location `.omo/omo.jsonc` with the `[opencode]` block.

```text
node .omo/evidence/20260716-minimal-project-agent-members/run-qa.mjs
passed: true
assertionCount: 29
host session count: 8523 -> 8523
```

Observed behavior:

- An exact project-defined member launched with its final identity, model, variant, prompt, and required Team tools.
- The member launch denied nested `task`, `question`, and repository-write tools.
- Same-name later-source shadowing, incompatible permissions, project-agent lead selection, and prototype-name lead selection all failed before child creation.
- Providers stopped and all isolated sandboxes were removed.
- The real OpenCode database session count was unchanged.

Artifacts:

- `qa-result.json`: 29 machine assertions and scenario summaries.
- `opencode-run-accepted.jsonl`: sanitized accepted-run event stream.
- `opencode-run-rejected.jsonl`: sanitized rejected-run event streams.
- `provider-requests.jsonl`: allowlisted provider metadata only.

## PR Head Revalidation

After merging current `base/dev`, aligning nullable registry fields plus member `task` narrowing, and committing the exact QA generator, the PR #6145 source head recorded in `qa-result.json` was revalidated:

```text
bun test packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.test.ts
6 pass

bun test packages/omo-opencode/src/plugin-handlers/project-agent-provenance-cache.test.ts packages/omo-opencode/src/features/team-mode/team-runtime/resolve-member.test.ts
31 pass

bun run typecheck
PASS

bun run build
PASS

isolated real OpenCode QA
29 assertions passed; host QA sessions 0; total host counts recorded as informational
```

This evidence directory contains the exact tracked `run-qa.mjs` and `fake-provider.mjs` used for PR-head verification. The generator records SHA-256 hashes for itself, the provider, the README, and all 16 non-evidence product paths changed by the PR. `sourceTreeCleanAtQaHead` excludes only this evidence directory and the two known historical line-ending-only evidence paths. Host isolation is concurrency-safe: the assertion requires zero host-database sessions under every QA sandbox path; before/after total session counts remain informational because unrelated live OpenCode sessions may create rows during the run. Both evidence and product manifests pass `sha256sum --check`.

## Why This Is Enough

The unit regression proves the new ancestor-selection rule and its fail-closed boundaries. The real OpenCode run proves the unchanged final-registry, permission, lead, and child-launch behavior through the actual `team_create` surface. Typecheck and build cover integration with the current package layout.

## What Was Omitted

Raw provider request bodies, headers, tokens, credentials, environment dumps, host database rows, and temporary sandbox paths were not retained. Persisted event output replaces repository and sandbox roots; stderr is summarized by byte and non-empty-line counts.
