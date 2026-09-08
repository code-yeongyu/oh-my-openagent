# The npm payload verifier does not require the prompt the Codex installer reads

## What was tested

`script/verify-npm-payload.mjs`, the gate the publish workflow runs before every `npm publish`
(base package, `oh-my-openagent` alias, and `lazycodex-ai`), against the real `npm pack --dry-run`
path list of this branch's base commit.

- Probe: `gate-probe.mjs` computes what the shipped gate requires (shared-skills export targets only)
  and what the added Codex-install requirement resolves to, both against the same packed path list.
- Unit: `bun test script/npm-payload-required-paths.test.ts`.

## What was observed

```
packed paths: 1222
shipped gate (shared-skills only) missing: []
new gate required: ["packages/prompts-core/prompts/ultrawork/codex.md"]
new gate missing: ["packages/prompts-core/prompts/ultrawork/codex.md"]
```

| Input | Before | After |
| --- | --- | --- |
| real packed path list of `dev` (payload that shipped as 5.0.0-beta.43) | gate reports nothing missing | gate reports the canonical Codex prompt missing |
| `bun test script/npm-payload-required-paths.test.ts` | file did not exist | 3 pass / 0 fail |
| mutation: `requiredCodexInstallPaths()` returns `[]` | - | 2 of 3 tests fail, then pass again once reverted |

## Why it is enough

The gate ran in the 5.0.0-beta.43 publish and printed containment OK for a payload whose Codex
install cannot run, which is the exact miss this change closes. The probe reproduces that verdict on
the same packed path list, and the mutation shows the new assertions fail when the requirement is
removed.

## What was omitted

The verifier is not executed end to end here because npm 12 changed `npm pack --json` from an array
to an object keyed by package name, which the existing `packedPaths()` reader does not handle; CI and
the publish workflow pin Node 24 (npm 11), where the shipped reader is correct. The probe therefore
feeds the same real packed list into the required-path check directly instead of shimming npm.
