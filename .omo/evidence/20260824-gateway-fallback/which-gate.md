# CF1 Which-Gate Finding — gateway HTTP 400 `openai_error`

**Date:** 2026-08-25
**Branch:** `fix/upstream-gateway-error-fallback`
**File analyzed:** `packages/model-core/src/runtime-fallback-error-classifier.ts`

## Question

Reproduce the real mooire-ai one-api gateway payload (HTTP 400, body/name
`openai_error`) through the classifier and record WHICH gate rejects it today,
BEFORE implementing the fix.

## Reproduction

Scratch test `packages/model-core/src/which-gate-scratch.test.ts` drives three
payload shapes through `getRuntimeFallbackErrorName`,
`getRuntimeFallbackStatusCode`, `classifyRuntimeFallbackError`, and
`isRuntimeFallbackRetryableError`:

- top-level `{ name: "openai_error", statusCode: 400 }`
- nested `{ error: { name: "openai_error", status: 400 } }`
- `{ data: { error: { name: "openai_error", statusCode: 400 } } }`

Observed output (all three shapes):
```
errorName = "openai_error"  (normalizes to "openaierror")
statusCode = 400
errorType  = undefined
retryable  = false
```

## Trace through `isRuntimeFallbackRetryableError` (current code)

| Line | Gate | Result for gateway-400 |
|------|------|------------------------|
| :115 | `getRuntimeFallbackStatusCode` | 400 |
| :117 | `classifyRuntimeFallbackError` | **undefined** — `openaierror` matches none of abort / context_overflow / missing_api_key / invalid_api_key / model_not_found / quota_exceeded blocks |
| :120 | `errorType === "abort" \|\| "context_overflow"` | no |
| :122-128 | `errorType` in {missing_api_key, model_not_found, quota_exceeded} | no (undefined) |
| :130 | `retryOnErrors.includes(400)` | **false** — 400 ∉ [429,500,502,503,504] |
| :134 | `getRuntimeFallbackRetryableSignal` | **undefined** — payload has no `isRetryable` field, so the signal branch is SKIPPED entirely (NOT rejected by `isStatusCodeRetrySafe`) |
| :143 | `RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS.some(...)` | **false** — "upstream gateway error" matches no pattern |

## Finding

The gateway-400 `openai_error` payload is rejected by the **:130 status-code
gate** (`retryOnErrors.includes(statusCode)`). Because `statusCode` is 400 and
400 is not in the default `[429,500,502,503,504]` set, the function returns
`false` at :132.

The plan's hypothesis that the `:134-141` retryable-signal path would be
rejected by `isStatusCodeRetrySafe` is **not** what happens: the payload carries
no `isRetryable` field, so `getRuntimeFallbackRetryableSignal` returns
`undefined` and the signal branch never runs. The message-pattern fallthrough
at :143 also misses. The decisive rejection is the **:130 status-code gate**.

## Implication for the fix

The narrow fix must be inserted BEFORE :130: when
`errorType === "upstream_gateway_error"` (which requires normalized
`errorName === "openaierror"`), return `statusCode === 400`. This is
fallback-to-next-model semantics (like `model_not_found`), NOT same-model
retry, and is gated to exactly 400 so genuine client errors stay
non-retryable.
