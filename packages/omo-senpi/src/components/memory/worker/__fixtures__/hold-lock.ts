// Live lock holder for concurrency tests: acquires the given lock path with THIS process's
// identity and waits for its parent to close stdin, so lock recovery (which only reclaims proven-dead
// owners) cannot reclaim it while the test is running. The test normally kills the child; readiness is
// signalled on stdout, never timed.

import { writeFileSync } from "node:fs"
import { connect } from "node:net"

import { acquireLock, createLockRecord } from "@oh-my-opencode/memory-core"

const lockPath = process.argv[2]
if (lockPath === undefined) throw new Error("lock path is required")

const record = await createLockRecord("facts-finalize", { runId: "hold-lock-fixture" })
await acquireLock(lockPath, record, { waitTimeoutMs: 10_000, retryDelayMs: 10 })
process.stdout.write("held\n")

await new Promise<void>((resolve) => {
  const done = (): void => {
    const marker = process.env.EXIT_MARKER
    if (marker !== undefined) writeFileSync(marker, "exited\n")
    // A still-open stdin holds the event loop after a control-channel exit; release it so the
    // process can actually terminate on every ownership-loss path.
    process.stdin.destroy()
    resolve()
  }
  process.stdin.once("end", done)
  process.stdin.once("close", done)
  process.stdin.once("error", done)
  process.stdin.resume()
  const port = process.env.CONTROL_PORT
  if (port !== undefined) {
    const control = connect({ host: "127.0.0.1", port: Number(port) })
    control.once("close", done)
    control.once("error", done)
  }
})
