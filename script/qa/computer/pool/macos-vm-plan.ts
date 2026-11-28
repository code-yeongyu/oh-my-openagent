// Pure decisions of the owned macOS guest pool. No process is started here: macos-vm.ts runs the steps this plans.
// A guest is a clone of a recorded base image (set up once by a person, AUTH-11), started headless with a hypervisor
// virtual keyboard for the physical stop-chord legs, registered as an ephemeral runner, and deleted after one job.

export const MACOS_MAJORS = ["15", "26"] as const
export type MacosMajor = (typeof MACOS_MAJORS)[number]

export const RUNNER_LABEL = "computer-live-macos"

export type PoolHost = {
  readonly platform: string
  readonly arch: string
  readonly hypervisor: string | null
  readonly baseImages: Readonly<Record<string, string>>
  readonly consoleUser: string | null
}

export type Refusal = { readonly kind: "refused"; readonly reason: string }

export type GuestPlan = {
  readonly kind: "plan"
  readonly major: MacosMajor
  readonly baseImage: string
  readonly guestName: string
  readonly consoleHost: string | null
  readonly labels: readonly string[]
}

// R-S4-1: a guest may land on a host with a signed-in console user, but only as a headless guest with clipboard
// bridging off, so the start argv is fixed here and both the --up spawn and the process-count pattern consume it.
export const GUEST_RUN_FLAGS = ["run", "--no-graphics", "--no-clipboard"] as const

export function guestRunArgv(name: string): readonly string[] {
  return [...GUEST_RUN_FLAGS, name]
}

const GUEST_NAME = /^omo-cu-[0-9a-z-]{1,48}$/

export function guestName(major: MacosMajor, runId: string): string {
  return `omo-cu-macos${major}-${runId.toLowerCase().replace(/[^0-9a-z-]/g, "-")}`.slice(0, 55)
}

export function isPoolGuest(name: string): boolean {
  return GUEST_NAME.test(name)
}

export function planGuest(host: PoolHost, major: MacosMajor, runId: string): GuestPlan | Refusal {
  if (host.platform !== "darwin" || host.arch !== "arm64")
    return { kind: "refused", reason: `pool host must be Apple silicon macOS, got ${host.platform}/${host.arch}` }
  if (host.hypervisor === null) return { kind: "refused", reason: "no hypervisor command on the pool host" }
  // R-S4-1: a console user no longer refuses the plan; the plan records who is signed in, and the guest sharing that
  // host is started headless with clipboard bridging off (guestRunArgv) and runs zero host-input legs.
  const baseImage = host.baseImages[major]
  if (baseImage === undefined)
    return { kind: "refused", reason: `no recorded base image for macOS ${major} (its first setup is a hands-on step)` }
  if (!/^[0-9]+$/.test(runId) && !/^[0-9a-z-]+$/i.test(runId))
    return { kind: "refused", reason: `run id ${JSON.stringify(runId)} is not a plain id` }
  const name = guestName(major, runId)
  return {
    kind: "plan",
    major,
    baseImage,
    guestName: name,
    consoleHost: host.consoleUser,
    labels: [RUNNER_LABEL, `macos-${major}`],
  }
}

export type GuestListing = { readonly name: string; readonly running: boolean }
