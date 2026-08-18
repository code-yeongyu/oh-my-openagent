# codex P2 follow-up: normalize suffixes before the provider capability lookup

Review comment: https://github.com/code-yeongyu/oh-my-openagent/pull/6485#discussion_r3709065480
Captured 2026-08-04 on Windows 11, bun 1.3.12.

## The defect this closes (introduced by this PR's own family fallback)

`get-model-capabilities.ts` passed the RAW `input.modelID` to
`providerCache.findProviderModelMetadata`, while the snapshot lookup and family
detection both use the canonical id. The connected-providers adapter matches
exactly (`packages/omo-opencode/src/shared/connected-providers-cache.ts:254` and
`:260` compare `entry === modelID` / `entry.id === modelID`), so a request for
`o3:high` never finds a cache entry for `o3`.

Before this PR that only meant `supportsTemperature` stayed undefined and the
configured temperature was preserved. With the family fallback this PR adds, an
undefined value now hands the decision to heuristics, so a provider that explicitly
advertises the bare model as temperature-capable would have had its temperature
deleted. Explicit provider metadata must win over family inference.

## Fix

Try the exact id first (so an explicitly suffixed cache entry still wins), then fall
back to the suffix-stripped form. Product diff: 1 file, +20/-1.

## RED (product change reverted, test kept)

```
bun test v1.3.14 (0d9b296a)
bun : 
At line:8 char:8
+ $red = bun test $T 2>&1 | Out-String
+        ~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
packages\model-core\src\model-capabilities-suffixed-provider-lookup.test.ts:
22 | 
23 |     // when
24 |     const capabilities = getModelCapabilities({ providerID: "openai", modelID: "o3:high", providerCache })
25 | 
26 |     // then
27 |     expect(capabilities.supportsTemperature).toBe(true)
                                                  ^
error: expect(received).toBe(expected)

Expected: true
Received: undefined

      at <anonymous> 
(C:\Users\pss\.omo-contrib\work\omo\packages\model-core\src\model-capabilities-suffixed-provider-lookup.test.ts:27:46)
(fail) getModelCapabilities provider lookup for suffixed model ids > #given a provider advertising the bare model 
#when a colon-suffixed id is requested #then the provider metadata still resolves [10.96ms]
35 |     // when
36 |     const parenthesized = getModelCapabilities({ providerID: "openai", modelID: "o3(high)", providerCache })
37 |     const spaced = getModelCapabilities({ providerID: "openai", modelID: "o3 high", providerCache })
38 | 
39 |     // then
40 |     expect(parenthesized.supportsTemperature).toBe(true)
                                                   ^
error: expect(received).toBe(expected)

Expected: true
Received: undefined

      at <anonymous> 
(C:\Users\pss\.omo-contrib\work\omo\packages\model-core\src\model-capabilities-suffixed-provider-lookup.test.ts:40:47)
(fail) getModelCapabilities provider lookup for suffixed model ids > #given a provider advertising the bare model 
#when a parenthesized or spaced suffix is requested #then the provider metadata still resolves [3.43ms]

 2 pass
 2 fail
 4 expect() calls
Ran 4 tests across 1 file. [764.00ms]
```

## GREEN (fix restored)

```
bun test v1.3.14 (0d9b296a)
bun : 
At line:10 char:10
+ $green = bun test $T 2>&1 | Out-String
+          ~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
 4 pass
 0 fail
 6 expect() calls
Ran 4 tests across 1 file. [627.00ms]
```

## Regression: full model-core suite

```
 342 pass
 0 fail
```

typecheck:packages exit=0

## Guards pinned by the new tests

- an exact suffixed cache entry still wins over the bare model (precedence preserved)
- when neither form matches, temperature stays unresolved (no new inference introduced)

## 2026-08-05 follow-up: same-provider prefixed IDs

Review comment:
https://github.com/code-yeongyu/oh-my-openagent/pull/6485#discussion_r3720591901

The suffix fallback still missed `custom/future-model:high` when the provider
cache advertised only `future-model`. The lookup now tries, in order:

1. the exact requested ID;
2. the same-provider prefix-stripped requested ID;
3. the suffix-stripped ID;
4. the same-provider prefix-stripped bare ID.

The prefix is stripped only when it matches `providerID`; a
`custom` request for `other/future-model:high` remains unresolved.

RED:

```text
command=bun test packages/model-core/src/model-capabilities-suffixed-provider-lookup.test.ts
exit_code=1
result=5 pass, 1 fail
failure=custom/future-model:high did not resolve future-model metadata
```

GREEN:

```text
command=bun test packages/model-core/src/model-capabilities-suffixed-provider-lookup.test.ts
exit_code=0
result=6 pass, 0 fail, 9 expect calls

command=bun test packages/model-core/src
exit_code=0
result=346 pass, 0 fail, 669 expect calls

command=bun run typecheck
exit_code=0

command=bun run build
exit_code=0
```

The direct public-API driver observed:

```json
{"lookups":["custom/future-model:high","future-model:high","custom/future-model","future-model"],"supportsTemperature":false,"source":"runtime"}
```

## 2026-08-05 follow-up: suffixed snapshot IDs

Review comment:
https://github.com/code-yeongyu/oh-my-openagent/pull/6485#discussion_r3720738201

The same ordered candidate list now resolves runtime and bundled snapshot
entries, not only provider-cache metadata. Runtime snapshot entries keep
precedence over bundled entries, and exact suffixed entries keep precedence
over bare entries within each snapshot.

RED:

```text
command=bun test packages/model-core/src/model-capabilities-suffixed-provider-lookup.test.ts
exit_code=1
result=6 pass, 1 fail
failure=openai/gpt-5.6-sol:high missed bundled gpt-5.6-sol temperature metadata
```

GREEN:

```text
command=bun test packages/model-core/src/model-capabilities-suffixed-provider-lookup.test.ts
exit_code=0
result=7 pass, 0 fail, 11 expect calls

command=bun test packages/model-core/src
exit_code=0
result=347 pass, 0 fail, 671 expect calls

command=bun run typecheck
exit_code=0

command=bun run build
exit_code=0
```

The real OpenCode `chat.params` handler observed:

```json
[{"modelID":"gpt-5.6-sol:high","temperatureSent":false},{"modelID":"gpt-5.4:high","temperatureSent":false},{"modelID":"o3-deep-research","temperatureSent":true}]
```

## 2026-08-05 follow-up: provider-specific snapshot precedence

Review comment:
https://github.com/code-yeongyu/oh-my-openagent/pull/6485#discussion_r3720980123

Snapshot candidates now place provider-qualified requested and canonical IDs
before their unqualified forms. This preserves a provider-specific capability
when both qualified and bare snapshot entries exist and disagree.

RED:

```text
command=bun test packages/model-core/src/model-capabilities-suffixed-provider-lookup.test.ts
exit_code=1
result=7 pass, 2 fail
failure=both Anthropic forms selected bare temperature:false instead of provider-specific temperature:true
```

GREEN:

```text
command=bun test packages/model-core/src/model-capabilities-suffixed-provider-lookup.test.ts
exit_code=0
result=9 pass, 0 fail, 15 expect calls

command=bun test packages/model-core/src
exit_code=0
result=349 pass, 0 fail, 675 expect calls

command=bun run typecheck
exit_code=0

command=bun run build
exit_code=0
```

The real OpenCode `chat.params` handler observed:

```json
[{"providerID":"anthropic","modelID":"claude-opus-4.8:high","temperatureSent":true},{"providerID":"anthropic","modelID":"anthropic/claude-opus-4.8:high","temperatureSent":true},{"providerID":"azure-anthropic","modelID":"claude-opus-4.8:high","temperatureSent":false}]
```

## 2026-08-05 integration follow-up: aliases prefer canonical entries

The first provider-precedence CI run
(`https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31011209139`)
failed the OpenAI fast-alias contract on all three platforms after `dev` moved.
Provider-qualified requested IDs were winning even when
`resolveModelIDAlias()` had selected a canonical model.

The branch was merged with current `upstream/dev`. Snapshot lookup order now
depends on canonicalization:

- canonical IDs preserve requested/suffixed specificity;
- exact and pattern aliases prefer canonical provider-qualified entries before
  alias-specific entries.

RED:

```text
command=bun test packages/model-core/src/model-capabilities-openai-fast-aliases.test.ts
exit_code=1
result=2 pass, 1 fail, 13 expect calls
failure=gpt-5.6-luna-fast selected the provider-specific alias snapshot instead of canonical gpt-5.6-luna
```

GREEN:

```text
command=bun test packages/model-core/src/model-capabilities-openai-fast-aliases.test.ts
exit_code=0
result=3 pass, 0 fail, 16 expect calls

command=bun test packages/model-core/src/model-capabilities-suffixed-provider-lookup.test.ts
exit_code=0
result=9 pass, 0 fail, 15 expect calls

command=bun test packages/model-core/src
exit_code=0
result=349 pass, 0 fail, 678 expect calls

command=bun run typecheck
exit_code=0

command=bun run build
exit_code=0
```

The public capability API and real OpenCode handler observed:

```json
{"aliasMatch":true,"aliasCanonicalModelID":"gpt-5.6-luna","aliasSnapshotSource":"bundled-snapshot","anthropicTemperatureSent":true}
```

## 2026-08-05 follow-up: suffix-stripped alias canonicalization

Review comment:
https://github.com/code-yeongyu/oh-my-openagent/pull/6485#discussion_r3721120898

When direct alias resolution has no match, capability resolution now strips a
recognized variant suffix and runs the bare form through the alias registry.
The returned capability record preserves the original requested ID while using
the canonical alias target for snapshot lookup.

RED:

```text
command=bun test packages/model-core/src/model-capabilities-openai-fast-aliases.test.ts
exit_code=1
result=3 pass, 2 fail, 18 expect calls
failure=OpenAI and Vercel suffixed fast aliases stayed canonical and missed gpt-5.6-sol snapshot metadata
```

GREEN:

```text
command=bun test packages/model-core/src/model-capabilities-openai-fast-aliases.test.ts
exit_code=0
result=5 pass, 0 fail, 18 expect calls

command=bun test packages/model-core/src/model-capabilities-suffixed-provider-lookup.test.ts
exit_code=0
result=9 pass, 0 fail, 15 expect calls

command=bun test packages/model-core/src
exit_code=0
result=351 pass, 0 fail, 680 expect calls

command=bun run typecheck
exit_code=0

command=bun run build
exit_code=0
```

The real OpenCode `chat.params` handler observed:

```json
[{"providerID":"openai","modelID":"gpt-5.6-sol-fast:high","temperatureSent":false},{"providerID":"vercel","modelID":"openai/gpt-5.6-sol-fast:high","temperatureSent":false}]
```
