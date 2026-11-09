import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { credentialLockPaths } from "@oh-my-opencode/omo-opencode/service-auth"
import type { DesktopSyncDescriptor } from "@oh-my-opencode/memory-core/sync-engine"
import { desktopSyncBoundary } from "./desktopSyncBoundary"

// Security contract (account-transport-api v8 sections 1 and 5): the engine's pin boundary admits a dispatch only
// while main's durable record is active and names the captured identity, generation and incarnation.

const homes: string[] = []
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }) })

const descriptor: DesktopSyncDescriptor = {
  genesis: "supported", rpId: "recovery.example.test", userName: "account-1",
  serviceOrigin: "https://api.example.test", accountId: "account-1", serviceDeviceId: "device-1",
  syncPrincipalId: "principal-1", publicKeys: { signing: "signing-1", sealing: "sealing-1" },
  generation: "generation-1", incarnation: "incarnation-1",
}
const active = {
  version: 1, state: "active", generation: "generation-1", incarnation: "incarnation-1",
  accountId: "account-1", serviceDeviceId: "device-1", publicKeys: { signing: "signing-1", sealing: "sealing-1" },
}

async function homeWith(record: unknown | "missing" | "corrupt"): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "omo-desktop-boundary-"))
  homes.push(home)
  const paths = credentialLockPaths(descriptor.serviceOrigin, home)
  await mkdir(paths.directory, { recursive: true, mode: 0o700 })
  if (record === "corrupt") await writeFile(paths.desktopRecord, "{not json")
  else if (record !== "missing") await writeFile(paths.desktopRecord, JSON.stringify(record))
  return home
}

describe("the desktop engine pin boundary", () => {
  test("an active record naming the capture admits the synchronous dispatch and returns its value", async () => {
    const home = await homeWith(active)
    expect(await desktopSyncBoundary(descriptor, new AbortController().signal, home)(() => "renamed")).toBe("renamed")
  })

  const refused: readonly [string, unknown | "missing" | "corrupt"][] = [
    ["a missing record", "missing"],
    ["a corrupt record", "corrupt"],
    ["a transitioning record", { ...active, state: "transitioning" }],
    ["a cleared record", { ...active, state: "cleared", accountId: null, serviceDeviceId: null, publicKeys: null }],
    ["another generation", { ...active, generation: "generation-2" }],
    ["a restarted main's incarnation", { ...active, incarnation: "incarnation-2" }],
    ["another device", { ...active, serviceDeviceId: "device-2" }],
    ["rotated signing key", { ...active, publicKeys: { signing: "signing-2", sealing: "sealing-1" } }],
    ["rotated sealing key", { ...active, publicKeys: { signing: "signing-1", sealing: "sealing-2" } }],
    ["an unknown field", { ...active, token: "x" }],
  ]
  for (const [name, record] of refused) {
    test(`${name} refuses before the dispatch runs`, async () => {
      const home = await homeWith(record)
      let dispatched = false
      const outcome = await desktopSyncBoundary(descriptor, new AbortController().signal, home)(() => { dispatched = true })
        .then(() => "admitted", () => "refused")
      expect(outcome).toBe("refused")
      expect(dispatched).toBe(false)
    })
  }

  test("a retired channel lifetime refuses even with an active record", async () => {
    const home = await homeWith(active)
    const lifetime = new AbortController()
    lifetime.abort()
    let dispatched = false
    const outcome = await desktopSyncBoundary(descriptor, lifetime.signal, home)(() => { dispatched = true })
      .then(() => "admitted", () => "refused")
    expect(outcome).toBe("refused")
    expect(dispatched).toBe(false)
  })
})

describe("the canonical lock and record paths", () => {
  test("derive the cross-repo golden vector for the production origin", () => {
    // The desktop vendored lock module asserts the same vector; a drift on either side splits the lock.
    const paths = credentialLockPaths("https://api.omo.dev", "/home/fixture")
    const id = "71643f4acfe42d71eb5b691bc773d98f41e05a6589f10347e4146f4a81cebbd2"
    // The id is the cross-repo vector; the separators are the platform's own, as on the desktop side.
    const directory = join("/home/fixture", ".omo", "session-locks")
    expect(paths).toEqual({
      directory,
      lock: join(directory, `${id}.lock`),
      desktopRecord: join(directory, `${id}.desktop-generation.json`),
    })
  })
})
