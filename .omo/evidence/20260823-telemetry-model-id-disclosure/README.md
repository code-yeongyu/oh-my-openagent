# QA Evidence — telemetry model_id vocabulary + disclosure alignment

Change: `maskProviderAndModel` exports a `model_id` whenever it matches the shipped public model
vocabulary, regardless of routing provider; the provider half is unchanged (unknown provider ->
`custom`). The published privacy disclosure is corrected in the same commit so the documented
contract matches the shipped behavior.

## WHAT WAS TESTED

1. `maskProviderAndModel` behavior across 8 provider/model combinations, driven through the real
   shipped function (not a mock): public model via unknown gateway, via a non-shipping known
   provider, via its own provider; private fine-tune via unknown and known provider; an internal
   codename; and a gateway name that could identify a company.
2. The privacy guard — that a user-authored model name is never exported — under deliberate mutation.
3. The first-run disclosure notice exact-string test (`omo-native-notice.test.ts`).
4. The docs schema pin (`schema-doc.test.ts`), which ties `docs/reference/senpi-telemetry.md` to
   `OMO_NATIVE_EVENT_SCHEMAS`.
5. The full telemetry component suite + `tsgo --noEmit` over the senpi tsconfig.

## WHAT WAS OBSERVED

- `red-product-identity.txt` — RED before the production change. 4 failures, each a behavior
  mismatch (`model_id` "custom" where the new contract expects the public id), not an import error.
- `green-telemetry-suite.txt` — 187 pass / 1 fail after the change.
- `masking-table.txt` — real-surface run of the shipped function. All 8 rows behave as documented:
  - `openrouter` + `claude-opus-5` -> `custom` / `claude-opus-5` (the fix)
  - `my-secret-corp-proxy` + `claude-opus-5` -> `custom` / `claude-opus-5` (gateway name withheld)
  - `my-gateway` + `my-finetune` -> `custom` / `custom` (private model withheld)
  - `anthropic` + `my-finetune` -> `anthropic` / `custom` (private model withheld)
- `mutation-c2-privacy-guard.txt` — with the mask deliberately broken to `model_id: modelId`, the
  privacy guard FAILS. The mutation was reverted; the guard is real coverage, not a tautology.
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` exits 0.

## KNOWN PRE-EXISTING FAILURE (not caused by this change)

`OmO Native product identity > #given an explicit agent directory #when the native state path is
resolved #then it is nested under omo-senpi` fails on this machine because `getOmoNativeStateDir`
resolves the real `~/.omo/agent` instead of the test's temp dir. Verified by stashing this branch's
changes and re-running against unchanged `origin/dev`: the same single test fails there too. Left
untouched — out of scope for this PR.

## WHY IT IS ENOUGH

The behavior change is a pure function with no I/O, so the shipped-function probe plus the unit
matrix exercises every branch of the new rule. The privacy-critical direction (nothing user-authored
escapes) is pinned from both sides: an assertion that holds through the change, and a mutation proof
that it can fail. The disclosure surfaces are covered by the schema pin plus the notice exact-string
test, and the notice copy itself ("no prompts, no paths") remains true and unchanged.

## WHAT WAS OMITTED

No live PostHog transport was driven; no event was sent to the network. The unit suites inject a
recorded transport by design, and this change does not touch transport, schema keys, or the
allowlist — only the value one masking function returns.
