import { afterEach, beforeEach } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectDeviceService, type DeviceService } from "../src/index.ts"
import { type AgentDirRegistrant, type RegistrantEvent, startAgentDirRegistrant } from "../src/registrant.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld } from "./local-api/conformance/world.ts"
import { deviceKeys } from "./local-api/support.ts"
import { remainingTestTime, resetTestDeadline } from "../../../test-support/test-deadline"

// The shared world of the agent dir registrant tests (#12379): the fake owner is a real local socket with the
// mutual proof, and a stopped owner followed by a new one on the same state dir stands in for a relayd restart.

export const AGENT_DIR = "/srv/agents/engine-a"
const owners: FakeOwner[] = []
const registrants: AgentDirRegistrant[] = []
const services: DeviceService[] = []
const dirs: string[] = []

export function useRegistrantWorld(): void {
  // The root preload resets the per-test deadline; this package's own bunfig does not, so a package-local run
  // would otherwise share one deadline across the file and starve every wait after the first slow test.
  beforeEach(() => resetTestDeadline())
  afterEach(async () => {
    for (const registrant of registrants.splice(0)) registrant.stop()
    for (const service of services.splice(0)) service.close()
    for (const owner of owners.splice(0)) await owner.stop()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
}

export const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dsr-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

export const ownerAt = async (stateDir: string): Promise<FakeOwner> => {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const owner = await startFakeOwner({ stateDir, world: defaultWorld() })
  owners.push(owner)
  return owner
}

export const stopOwner = async (owner: FakeOwner): Promise<void> => {
  owners.splice(owners.indexOf(owner), 1)
  await owner.stop()
}

// The deadline is what is left of the current test's own budget, not a fresh 10 s stopwatch: a waiter armed at
// the start of a test must not expire while the test itself still has time, however slow the host is (#10814).
export const within = <T>(promise: Promise<T>, what: string, ms = remainingTestTime()): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited out the test budget (${Math.round(ms)} ms) for ${what}, it never came`)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

export function recorder() {
  const events: RegistrantEvent[] = []
  const waiters: { readonly match: (event: RegistrantEvent) => boolean; readonly resolve: (event: RegistrantEvent) => void }[] = []
  const onEvent = (event: RegistrantEvent): void => {
    events.push(event)
    for (const waiter of [...waiters])
      if (waiter.match(event)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(event)
      }
  }
  const next = (match: (event: RegistrantEvent) => boolean, what: string): Promise<RegistrantEvent> =>
    within(new Promise<RegistrantEvent>(resolve => waiters.push({ match, resolve })), what)
  return { events, onEvent, next }
}

export const registers = (owner: FakeOwner): number => owner.state.log.filter(type => type === "endpoints.register").length

export const start = (options: Omit<Parameters<typeof startAgentDirRegistrant>[0], "version" | "agentDir"> & { readonly agentDir?: string }) => {
  const registrant = startAgentDirRegistrant({ version: "5.1.60", agentDir: AGENT_DIR, ...options })
  registrants.push(registrant)
  return registrant
}

export async function otherClient(stateDir: string): Promise<DeviceService> {
  const service = await connectDeviceService({ version: "5.1.60", stateDir })
  services.push(service)
  return service
}

export const credential = (id: string) => {
  const keys = deviceKeys()
  return { device: { id, name: id }, signingPrivateKey: keys.signing, sealingPrivateKey: keys.sealing }
}

// The default world's adopted device: a new connection registers at the proof and again on the replayed status.
export const SELF = "dev-self"
export const registeredFor = (deviceId: string | null) => (event: RegistrantEvent): boolean =>
  event.kind === "registered" && event.deviceId === deviceId
