# Mutation RED - deterministic renewal coverage

## Mutation

The new fake-time test was temporarily changed from `renewMs: 40` to `renewMs: 60_000`, preventing any renewal during the 400 ms virtual-time advance.

## What was tested

```bash
bun test packages/senpi-task/src/lifecycle/admission-lease.test.ts -t "holder renewing on virtual time"
```

## What was observed

```text
Expected: "contended"
Received: "acquired"

0 pass
3 filtered out
1 fail
Command exited with code 1
```

## Why this is enough

The test fails when the real renewal callback does not refresh the on-disk lease. The fixture therefore detects the exact regression it names instead of passing from a default-equivalent value or a mocked result.

## Cleanup receipt

The temporary mutation was reverted immediately to `renewMs: 40`. No mutation remains in the worktree.
