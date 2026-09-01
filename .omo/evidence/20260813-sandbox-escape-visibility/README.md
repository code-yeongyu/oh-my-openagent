# Sandbox escape visibility evidence

Date: 2026-08-13
Branch: `fix/memory-sandbox-escape-visibility`
Base: `origin/dev`

## What was proven

- The behavioral RED drove the real `createIdentityRuntime` construction path and invoked its lazy sandbox with an unresolved non-absolute child command. Before the fix, the child arguments degraded to unsandboxed identity behavior and the injected logger received no warning (`Received: []`, exit 1).
- Reflection sandbox construction now resolves the inner command when the concrete transform is built. `wasSandboxed` and `warning` are therefore truthful before the transform is invoked.
- `identity-runtime.ts` consumes the constructed transform warning and emits `memory reflection sandbox degraded` with `identity`, `runId`, and the degradation reason.
- `wiring-runtime.ts` also required treatment: facts sandbox construction occurs per facts spawn and can encounter the same unresolved inner-command escape. It now emits `memory facts sandbox degraded` with the same identifying context.
- Sandbox policy and degradation semantics are unchanged: an unresolved command still runs unsandboxed and is not made fatal; only visibility and status timing changed.

## RED

Command:

```sh
bun test packages/omo-senpi/src/components/memory/identity-runtime.test.ts
```

Behavioral failure is recorded verbatim in `red-behavior.txt` with `EXIT=1`. The key failure was:

```text
Expected to contain: {
  level: "warn",
  message: "memory reflection sandbox degraded",
  details: {
    identity: "agent-test",
    runId: "reflection-run-visible",
    warning: "reflection sandbox unavailable: inner command \"missing-senpi\" is not absolute and could not be resolved; running unsandboxed",
  },
}
Received: []
```

`red.txt` records an earlier environment-only attempt before the task worktree was linked to the repository's existing dependency installation; it failed during module resolution and is not the behavioral RED.

## Required verification

- `full-suite.command.txt` / `full-suite.txt`: full memory suite, `585 pass`, `0 fail`, `EXIT=0`.
- `typecheck.command.txt` / `typecheck.txt`: omo-senpi typecheck, `EXIT=0`.
- `bundle-check.command.txt` / `bundle-check.txt`: no-pipeline Bun 1.3.12 freshness check, final `EXIT=0`.

## Bundle decision

The initial freshness check reported `stale-output`. The bundles were regenerated with the same no-pipeline Bun 1.3.12 command without `--check`. Marker comparison showed changed source digests, including the main extension that contains the memory runtime change, so the regenerated omo-senpi bundles are included under the two-tier rule. No `packages/omo-codex/plugin/components/codegraph/dist/*` files were changed.
