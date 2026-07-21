# Task 5 evidence - public exports

## What was tested

- The agents barrel and package root export `BUILTIN_AGENTS`, `BUILTIN_AGENT_DEFAULTS`, `CURATED_READONLY_AGENT_NAMES`, `resolveAgent`, and its result types.
- The package API tripwire imports and uses the values and types from the root surface.

## What was observed

- Both scoped `tsgo --noEmit` gates exited 0.
- Mutation proof: temporarily removing the root `resolveAgent` export failed the package API tripwire; restoring the export returned the package suite to green.

## Why it is enough

The compile gate and runtime root-import tripwire cover both type-only and value exports from the supported package surface.

## What was omitted

No deep-import compatibility was added; consumers use the barrel and package root.
