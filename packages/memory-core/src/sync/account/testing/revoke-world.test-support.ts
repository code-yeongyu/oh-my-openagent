// A multi-device account on the chain wire server for the rotation-on-revoke tests (#12280): A runs
// the genesis, every other device joins through the real pairing ceremony, and each device gets a
// real engine over a CLI-shaped account session (its own bearer, its own device-list view). The
// service's freeze is the server's FreezeModel.

import { expect } from "bun:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { gitRepo } from "../../engine/engine-harness.test-support.ts"
import { type DeviceSync, openDeviceSync } from "../../engine/open.ts"
import { deviceKeyring } from "../../genesis/vector.test-support.ts"
import type { DeviceKeyring } from "../../keyring-port.ts"
import { approveDevice } from "../approve.ts"
import { enableSync } from "../enable.ts"
import { createAccountHttp } from "../http.ts"
import { joinAccount, principalOf } from "../join.ts"
import { createPairingHttp } from "../pairing-http.ts"
import { openAccountSession } from "../session.ts"
import { ACCOUNT, fixture } from "./genesis-enable.test-support.ts"

/** A ceremony clock whose sleep resolves on the next server write, never on time. */
const mailbox = () => {
  let queued = 0
  let waiter: (() => void) | undefined
  return {
    signal() {
      if (waiter) {
        const resolve = waiter
        waiter = undefined
        resolve()
      } else queued++
    },
    sleep: async () => {
      if (queued > 0) {
        queued--
        return
      }
      await new Promise<void>((resolve) => {
        waiter = resolve
      })
    },
    now: () => 0,
  }
}

/** Awaits `signal`, failing with `message` if it has not resolved within 20 s (a circuit breaker, not a wait). */
export async function within<T>(signal: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const breaker = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited 20s: ${message}`)), 20_000)
  })
  try {
    return await Promise.race([signal, breaker])
  } finally {
    clearTimeout(timer)
  }
}

export interface WorldDevice {
  readonly name: string
  readonly serviceDeviceId: string
  readonly keyring: DeviceKeyring
  readonly pinDir: string
  readonly token: string
}

export interface Engine {
  readonly repo: string
  readonly sync: DeviceSync
  write(text: string): Promise<void>
  read(): Promise<string | null>
}

export type World = Awaited<ReturnType<typeof revokeWorld>>

export async function revokeWorld(options: { readonly stream?: boolean } = {}) {
  const f = await fixture(options)
  const close: (() => Promise<unknown>)[] = []
  expect(await enableSync(f.input)).toEqual({ kind: "joined", created: true })
  const a: WorldDevice = {
    name: "a",
    serviceDeviceId: "service-first",
    keyring: f.keyring,
    pinDir: f.input.pinDir,
    token: f.options.token(),
  }
  const devices: WorldDevice[] = [a]

  const join_ = async (name: string, seed: number): Promise<WorldDevice> => {
    const keyring = await deviceKeyring(seed)
    const serviceDeviceId = `service-${name}`
    const token = f.server.tokenFor(principalOf(keyring), serviceDeviceId)
    const http = { baseUrl: f.server.url, token: () => token }
    const joiner = {
      account: ACCOUNT,
      keyring,
      pinDir: join(f.input.pinDir, name),
      chain: createAccountHttp(http),
      pairing: createPairingHttp(http),
    }
    expect(await enableSync({ ...joiner, serviceDeviceId })).toEqual({ kind: "join_required" })
    const approver = mailbox()
    const joining = mailbox()
    const pending = Promise.withResolvers<string>()
    const before = new Set(f.server.pending().map((row) => row.id))
    f.server.onWrite = () => {
      approver.signal()
      joining.signal()
      const id = f.server.pending().find((row) => !before.has(row.id))?.id
      if (id !== undefined) pending.resolve(id)
    }
    const joined = joinAccount({ ...joiner, clock: joining, showCode: () => undefined })
    const approved = await approveDevice({
      ...f.input,
      clock: approver,
      pendingId: await pending.promise,
      confirmCode: async () => true,
    })
    expect(approved.kind).toBe("approved")
    expect(await joined).toEqual({ kind: "joined" })
    f.server.onWrite = null
    const device = { name, serviceDeviceId, keyring, pinDir: joiner.pinDir, token }
    devices.push(device)
    return device
  }

  /** `legacy` drops the freeze settler: a client from before rotation on revoke. */
  const engine = async (
    device: WorldDevice,
    options: { readonly legacy?: boolean; readonly onStatusChange?: () => void } = {},
  ): Promise<Engine> => {
    const root = join(f.input.pinDir, `${device.name}-engine`)
    const repo = join(root, "repo")
    await mkdir(repo, { recursive: true })
    await gitRepo(repo)
    const opened = await openAccountSession({
      baseUrl: f.server.url,
      token: () => device.token,
      account: ACCOUNT,
      keyring: device.keyring,
      pinDir: device.pinDir,
      spaceId: new Uint8Array(16).fill(3),
    })
    if (!opened.ok) throw new Error(`session refused: ${opened.reason}`)
    const { freeze: _freeze, ...legacySession } = opened.session
    const session = options.legacy === true ? legacySession : opened.session
    const sync = await openDeviceSync({
      repoDir: repo,
      stateDir: join(root, "state"),
      locksDir: join(root, "locks"),
      session,
      machineId: device.name,
      ...(options.onStatusChange === undefined ? {} : { onStatusChange: options.onStatusChange }),
    })
    if (sync === null) throw new Error("sync unavailable")
    close.push(() => sync.close())
    return {
      repo,
      sync,
      write: (text) => writeFile(join(repo, "note.md"), `---\ndescription: rotation on revoke\n---\n${text}\n`),
      read: () => readFile(join(repo, "note.md"), "utf8").catch(() => null),
    }
  }

  /** Batch entries the server admitted, as their epochs, oldest first. */
  const batchEpochs = (): number[] => f.entries.flatMap((entry) => (entry.kind === "batch" ? [entry.epoch] : []))

  /** The keyring rotations the server admitted, oldest first, as member-id lists. */
  const rotations = (): string[][] =>
    f.entries.flatMap((entry) => {
      if (entry.kind !== "keyring" || entry.body["kind"] !== "rotation") return []
      const members = entry.body["members"]
      return [Array.isArray(members) ? members.map((m) => String((m as Record<string, unknown>)["id"])) : []]
    })

  /** A request made with `device`'s bearer, the way a client reaches the revoke routes. */
  const call = (device: WorldDevice, method: string, path: string) =>
    fetch(`${f.server.url}${path}`, { method, headers: { authorization: `Bearer ${device.token}` } })

  return {
    f,
    a,
    devices,
    join: join_,
    engine,
    rotations,
    batchEpochs,
    call,
    async close() {
      for (const stop of close.reverse()) await stop()
      await f.close()
    },
  }
}
