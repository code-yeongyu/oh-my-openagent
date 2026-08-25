// Live lock holder for concurrency tests: acquires the given lock path with THIS process's
// identity and blocks forever, so lock recovery (which only reclaims proven-dead owners)
// cannot reclaim it. The test kills the child; readiness is signalled on stdout, never timed.

import { acquireLock, createLockRecord } from "@oh-my-opencode/memory-core"

const lockPath = process.argv[2]
if (lockPath === undefined) throw new Error("lock path is required")

const record = await createLockRecord("facts-finalize", { runId: "hold-lock-fixture" })
await acquireLock(lockPath, record, { waitTimeoutMs: 10_000, retryDelayMs: 10 })
process.stdout.write("held\n")
await new Promise<never>(() => {})
