import { type Clock, deleteGuest, type Hypervisor, waitUntilRunning } from "./macos-vm-ops.ts"
import { GUEST_RUN_FLAGS, type GuestPlan } from "./macos-vm-plan.ts"

// The process tag --up holds for its guest; the pool's process count matches it beside the hypervisor's clone and run.
export const UP_HOLD_TAG = "omo-pool-up-hold"

// The pgrep -f pattern for a guest's live processes: an --up's hold, the clone that creates it and the run that boots
// it (all end in its name). The run alternative is built from the same flags the --up spawn uses; the clipboard flag is
// optional so a guest an earlier --up started with plain `run --no-graphics` is still counted (review L2 of #15142).
// pgrep compiles POSIX ERE, so the pattern uses plain groups only: PCRE's `(?:` fails to compile there (review H1).
export function guestProcessPattern(name: string): string {
  const run = GUEST_RUN_FLAGS.filter((flag) => flag !== "--no-clipboard").join(" ")
  return `(${UP_HOLD_TAG}|clone [^ ]+|${run}( --no-clipboard)?) ${name}$`
}

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
  // R-S4-1: every --up names the host's console user (or none), so the receipt shows the guest shared a signed-in host.
  const hostLine = `console host ${plan.consoleHost ?? "none"}: headless no-clipboard guest`
  const release = steps.hold(plan.guestName)
  try {
    const cloned = steps.clone(plan.baseImage, plan.guestName)
    if (cloned.code !== 0)
      return { lines: [hostLine], errors: [`macos-vm: clone failed: ${cloned.stderr}`], exitCode: 1 }
    const pid = steps.startRun(plan.guestName)
    const waited = await waitUntilRunning(hypervisor, plan.guestName, deadlineMs, clock)
    if (waited.status !== "running") {
      const detail = "detail" in waited ? ` (${waited.detail})` : ` after ${deadlineMs / 1000} s`
      return {
        lines: [hostLine, deleteGuest(hypervisor, plan.guestName)],
        errors: [`macos-vm: guest ${plan.guestName} is ${waited.status}${detail}`],
        exitCode: 1,
      }
    }
    return {
      lines: [
        hostLine,
        `GUEST ${plan.guestName} macos=${plan.major} labels=${plan.labels.join(",")} running pid=${pid}`,
      ],
      errors: [],
      exitCode: 0,
    }
  } finally {
    release()
  }
}
