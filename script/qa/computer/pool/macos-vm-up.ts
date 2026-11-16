import { type Clock, deleteGuest, type Hypervisor, waitUntilRunning } from "./macos-vm-ops.ts"
import type { GuestPlan } from "./macos-vm-plan.ts"

// The process tag --up holds for its guest; the pool's process count matches it beside the hypervisor's clone and run.
export const UP_HOLD_TAG = "omo-pool-up-hold"

export type UpSteps = {
  readonly hold: (guestName: string) => () => void
  readonly clone: (baseImage: string, guestName: string) => { readonly code: number; readonly stderr: string }
  readonly startRun: (guestName: string) => number
}

export type UpResult = {
  readonly lines: readonly string[]
  readonly errors: readonly string[]
  readonly exitCode: number
}

// Holds the guest from before the clone until the wait ends, so a concurrent --sweep sees a live process for it in
// the gap between the clone exiting and the run process starting.
export async function bringUp(
  hypervisor: Hypervisor,
  steps: UpSteps,
  clock: Clock,
  plan: GuestPlan,
  deadlineMs: number,
): Promise<UpResult> {
  const release = steps.hold(plan.guestName)
  try {
    const cloned = steps.clone(plan.baseImage, plan.guestName)
    if (cloned.code !== 0) return { lines: [], errors: [`macos-vm: clone failed: ${cloned.stderr}`], exitCode: 1 }
    const pid = steps.startRun(plan.guestName)
    const waited = await waitUntilRunning(hypervisor, plan.guestName, deadlineMs, clock)
    if (waited.status !== "running") {
      const detail = "detail" in waited ? ` (${waited.detail})` : ` after ${deadlineMs / 1000} s`
      return {
        lines: [deleteGuest(hypervisor, plan.guestName)],
        errors: [`macos-vm: guest ${plan.guestName} is ${waited.status}${detail}`],
        exitCode: 1,
      }
    }
    return {
      lines: [`GUEST ${plan.guestName} macos=${plan.major} labels=${plan.labels.join(",")} running pid=${pid}`],
      errors: [],
      exitCode: 0,
    }
  } finally {
    release()
  }
}
