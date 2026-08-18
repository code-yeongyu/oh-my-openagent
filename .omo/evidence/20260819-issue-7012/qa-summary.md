# Issue 7012 QA summary

## What was tested

- Failing-first regression: a fresh identity whose repository exists but whose runtime directories do not exist.
- Focused identity-runtime and first-write context tests.
- Reflection/facts sandbox regression suites.
- Senpi package typecheck and a targeted bundle of the changed production entry.
- An isolated data-plane probe using a fresh, initially absent XDG data home plus forced Linux writable-directory canonicalization.

## What was observed

- Before the production fix, the new test failed because `reflectionSessions` remained absent after the first lazy sandbox invocation.
- After the fix, the same validator passed and all expected runtime directories existed.
- Forced Linux sandbox construction included the canonical `reflectionSessions` bind grant without ENOENT.
- All paths used by the QA probe were inside one temporary sandbox; no real user-home path was read or written.
- The temporary sandbox was removed, XDG environment values were restored, and no process was spawned.

## Why this is enough

The RED/GREEN pair pins the missing first-write seam at `createIdentityRuntime`. The forced Linux canonicalization step exercises the exact `realpathSync`-dependent path that caused Issue #7012, while the focused sandbox suites cover adjacent transform behavior. Typecheck and the targeted bundle cover static and build integration risk.

## What was omitted

Raw environment dumps, host paths, credentials, and unrelated logs were not retained. A broader memory sweep was diagnostic only because two unrelated existing Windows/fixture failures appeared outside the changed paths; the scoped tests covering this change are green.
