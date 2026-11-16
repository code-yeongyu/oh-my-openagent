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
  readonly runnerUser: string
}

export type Refusal = { readonly kind: "refused"; readonly reason: string }

export type GuestPlan = {
  readonly kind: "plan"
  readonly major: MacosMajor
  readonly baseImage: string
  readonly guestName: string
  readonly labels: readonly string[]
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
  if (host.consoleUser !== null && host.consoleUser === host.runnerUser)
    return {
      kind: "refused",
      reason: `the pool runs as ${host.runnerUser}, who holds the console session; guests run only on a host nobody is using`,
    }
  const baseImage = host.baseImages[major]
  if (baseImage === undefined)
    return { kind: "refused", reason: `no recorded base image for macOS ${major} (its first setup is a hands-on step)` }
  if (!/^[0-9]+$/.test(runId) && !/^[0-9a-z-]+$/i.test(runId))
    return { kind: "refused", reason: `run id ${JSON.stringify(runId)} is not a plain id` }
  const name = guestName(major, runId)
  return { kind: "plan", major, baseImage, guestName: name, labels: [RUNNER_LABEL, `macos-${major}`] }
}

export type GuestListing = { readonly name: string; readonly running: boolean }

export function strayGuests(listing: readonly GuestListing[], keep: ReadonlySet<string>): string[] {
  return listing.filter((guest) => isPoolGuest(guest.name) && !keep.has(guest.name)).map((guest) => guest.name)
}
