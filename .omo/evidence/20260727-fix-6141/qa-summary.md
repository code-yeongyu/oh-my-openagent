# QA summary - issue #6141 - Hephaestus dropped for AWS Bedrock vendor-prefixed gpt-5 ids

Captured 2026-07-27 (UTC) on Windows 11, bun 1.3.14, node v22.14.0, opencode 1.18.5.
The live OpenCode surface was rerun on 2026-07-30 after redirecting process temp
variables into the sandbox; both captures now show `tmp` under the sandbox and
the real OpenCode session count stayed unchanged at `2818 -> 2818`.
The reviewer rerun on 2026-07-31 also builds from source before driving
OpenCode, fails closed on build or parse errors, and again observed an unchanged
real session count of `2818 -> 2818`. See `review-rerun-20260731.txt`.
Base: `upstream/dev` @ `da2d4a916`.

## The defect

`packages/omo-opencode/src/agents/hephaestus/agent.ts` gates Hephaestus registration on
four ANCHORED regexes (`/^gpt-5[.-]4(?:$|[.-])/i` and siblings), applied to
`extractModelName`, which strips only the `provider/` segment:

```ts
function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model
}
```

AWS Bedrock ids carry a SECOND, dot-delimited vendor namespace. `amazon-bedrock/openai.gpt-5.4`
becomes `openai.gpt-5.4`, which fails the `^gpt-5` anchor. `isHephaestusSupportedModel`
returns false, `maybeCreateHephaestusConfig`
(`agents/builtin-agents/hephaestus-agent.ts:82`) returns undefined, and Hephaestus
silently disappears from the resolved agent map with no error surfaced.

The same `extractModelName` also feeds `getHephaestusPromptSource:69`
(`GPT_5_4_RE.test(extractModelName(model))`), so a Bedrock gpt-5.4 that got past the gate
would additionally receive the generic `"gpt"` prompt instead of the gpt-5.4 prompt. Both
call sites are repaired by the single change below.

Deliberately untouched: `types.ts` `isGpt5_5Model` / `isGpt5_6Model` use substring matching
(`.includes("gpt-5.6")`) and already survive Bedrock ids, and `isGptNativeSisyphusModel` is
unanchored. This confirms `hephaestus/agent.ts::extractModelName` is the correct and only
owner boundary.

## The change

One product file, `packages/boulder-state`-style minimal (+3 / -1):

```ts
const HOSTED_VENDOR_PREFIX_RE = /^(?:[^./]+\.)+(gpt-5[.-].*)$/i

function extractModelName(model: string): string {
  const afterProvider = model.includes("/") ? (model.split("/").pop() ?? model) : model
  return HOSTED_VENDOR_PREFIX_RE.exec(afterProvider)?.[1] ?? afterProvider
}
```

The guard strips one or more leading `<vendor>.` segments ONLY when the remainder is itself
a gpt-5 id. Support is not broadened: an id merely containing `gpt-5` (`some-gpt-5.4-tune`)
still does not match, and a Bedrock id outside the family (`openai.gpt-4o`) stays unsupported.

## Why this shape, and not the shape of closed PR #6148

PR #6148 (closed 2026-07-25, never merged, no review comments) stripped at
`lastIndexOf(".")` behind a `/^(gpt|claude|gemini)[.-]/` guard. Executed against the exact
reported id that approach does NOT fix the bug:

```
amazon-bedrock/openai.gpt-5.4  ->  openai.gpt-5.4     (unchanged - still broken)
amazon-bedrock/openai.gpt-5-4  ->  gpt-5-4            (only the dash form worked)
```

For `openai.gpt-5.4` the text after the LAST dot is `4`, which fails its own guard, so
nothing is stripped. Anchoring the vendor segments from the LEFT and requiring the
remainder to be a gpt-5 id fixes the dotted form and is a strict superset (it also handles
region-qualified `us.openai.gpt-5.4`).

## Behavior-change enumeration (the regression argument)

Every id was run through the old and new `extractModelName` plus the four unchanged
regexes. Exactly five rows change, all of them Bedrock gpt-5 ids:

| id | before | after |
|---|---|---|
| `amazon-bedrock/openai.gpt-5.4` | false | **true** |
| `amazon-bedrock/openai.gpt-5-4` | false | **true** |
| `amazon-bedrock/openai.gpt-5.6` | false | **true** |
| `amazon-bedrock/openai.gpt-5.3-codex` | false | **true** |
| `amazon-bedrock/us.openai.gpt-5.4` | false | **true** |
| `openai/gpt-5.4` | true | true (unchanged) |
| `github-copilot/gpt-5.4` | true | true (unchanged) |
| `gpt-5.4` (bare) | true | true (unchanged - the #6148 trap) |
| `gpt-5-4` (bare) | true | true (unchanged) |
| `opencode/gpt-5.3-codex-spark` | true | true (unchanged) |
| `vercel/openai/gpt-5.6-terra` | true | true (unchanged) |
| `openai/gpt-4o` | false | false (unchanged) |
| `amazon-bedrock/openai.gpt-4o` | false | false (unchanged) |
| `amazon-bedrock/anthropic.claude-3.5-sonnet` | false | false (unchanged) |
| `anthropic/claude-opus-4-7` | false | false (unchanged) |
| `gpt-5.10` | false | false (unchanged) |
| `some-gpt-5.4-tune` | false | false (unchanged) |

## What was tested, and what was observed

| # | Scenario | Artifact | Observed |
|---|---|---|---|
| RED | New tests on unmodified base | `red-6141.txt` | 3 fail / 33 pass. Bedrock ids return false where true is expected; `getHephaestusPromptSource` throws `UnsupportedHephaestusModelError`. Behavioural failures, not compile errors. |
| GREEN | Same tests with the fix | `green-6141.txt` | `agent.test.ts` 36/36; whole `agents/` tree 374/374 across 30 files. |
| Negative control | Revert only the product file, keep tests | `negative-control-6141.txt` | The same 3 cases fail again (exit 1). The tests are pinned to the product change. |
| Typecheck | `tsgo --noEmit -p packages/omo-opencode` | `typecheck-6141.txt` | exit 0. |
| Regression | 3 suites, clean base vs PR | `regression-comparison.txt`, `related-suite-6141.txt`, `baseline-preexisting-failures.txt` | base 707 pass / **0 fail**; with PR 712 pass / **0 fail** (+5 new tests). Zero new failures. |
| **Live surface** | **REAL opencode** `debug config` | `live-driver.sh`, `live-driver-before.txt`, `live-driver-after.txt` | See below. |
| Isolation | sandbox proof | `isolation-proof.txt` | See below. |

### Live surface: real opencode agent registration

This is the AGENTS.md-mandated surface for `packages/omo-opencode/src/**`: real opencode
driven in an isolated sandbox, not a direct-function driver. `bash live-driver.sh <out>`
builds a throwaway project holding `.opencode/opencode.json` (loading the locally built
`dist/index.js`) and `.opencode/oh-my-openagent.jsonc` with
`agents.hephaestus.model = "amazon-bedrock/openai.gpt-5.4"`, then runs
`opencode debug paths` and `opencode debug config` and parses the resolved agent map.
It needs no API key: a config model override is returned directly by the resolution
pipeline, so registration is exercised without any provider call.

| | registered agents | Hephaestus |
|---|---|---|
| before (`upstream/dev`) | **11** | `HEPHAESTUS REGISTERED : false` |
| after (this PR) | **12** | `HEPHAESTUS REGISTERED : true` (key `Hephaestus - Deep Agent`, `model: amazon-bedrock/openai.gpt-5.4`, `mode: primary`) |

The control agent (`Sisyphus - ultraworker`) is registered in BOTH runs, which proves the
plugin loaded and the harness was sound in the baseline - Hephaestus was the only agent
missing, exactly as reported.

### Isolation

`opencode debug paths` in both captures resolves `data`, `config`, `cache` and `state`
inside the sandbox temp dir, because the driver redirects `HOME`, `USERPROFILE`, `APPDATA`,
`LOCALAPPDATA` and every `XDG_*` var into a `mktemp -d` directory that is deleted on exit.
The real user config sha256 is identical before and after.

Honest note: the real opencode database digest does move between captures, because this QA
was executed from inside a live opencode session that continuously writes to its own
database. The authoritative isolation evidence is therefore the `debug paths` block - every
path the driver used was under the sandbox, so it could not have read or written the real
database.

## Why this is enough

The regression tests drive the real exported predicate and the real prompt-source resolver
through the package barrel, and they fail on `upstream/dev` for the behavioural reason
before passing here. The live capture drives real opencode end to end and shows the
operator-visible symptom from the issue - Hephaestus missing from the agent map - appearing
and then disappearing on the same config. The behavior-change enumeration above bounds the
blast radius to exactly five ids.

## Residual risk

- **Classification only.** This makes omo classify `amazon-bedrock/openai.gpt-5.4`
  correctly; whether AWS actually serves that id for a given account is orthogonal and
  unchanged.
- **Support deliberately not broadened.** Ids that merely embed `gpt-5`
  (`some-gpt-5.4-tune`) remain unsupported. Auto-supporting them would be a
  behavior-contract change, not a bug fix.
- **Vendor-segment shape.** The pattern assumes the gpt-5 id is the final dotted group, the
  documented Bedrock/OpenRouter form. An id where it is not final is not covered.
- **Other agents not touched.** Only Hephaestus used anchored regexes on the
  vendor-prefixed name; the Sisyphus-side detectors are unanchored or substring-based and
  already handled Bedrock, so they were intentionally left alone.

## What was omitted

No secrets, tokens, credentials or environment dumps. The isolation record contains only
file paths and sha256 digests, never config contents. The driver writes solely into a
`mktemp -d` sandbox removed on exit.
