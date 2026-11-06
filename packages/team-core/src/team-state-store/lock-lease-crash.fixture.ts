// A lock holder that stops at one lease step and waits to be killed, for the crash tests in lock-lease-race.test.ts.
import { withLock } from "./locks"

const step = process.env.STEP
await withLock(
  process.env.LOCK_PATH ?? "",
  async lease => {
    await lease.handOver(Number(process.env.HELPER_PID))
    if (step === "handed") process.stdout.write("at handed\n")
    if (step === "restored") {
      await lease.restore()
      process.stdout.write("at restored\n")
    }
    await new Promise(() => {})
  },
  { staleAfterMs: Number.POSITIVE_INFINITY },
)
