// #12280 R-B6: a memory repository's journal can hold a batch sealed by a previous principal of this
// machine (its keys were discarded by `omo account forget`, then a new principal re-joined). The
// service refuses a batch whose record signature is not the caller's own, so that batch is re-sealed
// under the new principal, never sent as it is.

import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { approveDevice } from "../account/approve.ts"
import { enableSync } from "../account/enable.ts"
import { createAccountHttp } from "../account/http.ts"
import { joinAccount, principalOf } from "../account/join.ts"
import { createPairingHttp } from "../account/pairing-http.ts"
import { openAccountSession } from "../account/session.ts"
import { ACCOUNT, fixture } from "../account/testing/genesis-enable.test-support.ts"
import { forgetTrustAnchor } from "../crypto/trust-pin.ts"
import { deviceKeyring } from "../genesis/vector.test-support.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { GIT_TEST_TIMEOUT, gitRepo } from "./engine-harness.test-support.ts"
import { openDeviceSync } from "./open.ts"

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

test(
  "#given a journaled batch sealed by the machine's previous principal #when a new principal re-joins and opens the engine #then the batch is re-sealed and lands under the new principal",
  async () => {
    const f = await fixture()
    const close: (() => Promise<unknown>)[] = []
    try {
      expect(await enableSync(f.input)).toEqual({ kind: "joined", created: true })
      const pinDir = join(f.input.pinDir, "machine")
      const join_ = async (keyring: DeviceKeyring, serviceDeviceId: string) => {
        const token = f.server.tokenFor(principalOf(keyring), serviceDeviceId)
        const http = { baseUrl: f.server.url, token: () => token }
        const joiner = {
          account: ACCOUNT,
          keyring,
          pinDir,
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
        expect(
          (
            await approveDevice({
              ...f.input,
              clock: approver,
              pendingId: await pending.promise,
              confirmCode: async () => true,
            })
          ).kind,
        ).toBe("approved")
        expect((await joined).kind).toBe("joined")
        f.server.onWrite = null
        return http
      }
      const root = join(f.input.pinDir, "machine-engine")
      const repo = join(root, "repo")
      await mkdir(repo, { recursive: true })
      await gitRepo(repo)
      const logs: string[] = []
      const engineFor = async (
        keyring: DeviceKeyring,
        http: { baseUrl: string; token: () => string },
        failFirstAppend: boolean,
      ) => {
        const opened = await openAccountSession({
          ...http,
          account: ACCOUNT,
          keyring,
          pinDir,
          spaceId: new Uint8Array(16).fill(3),
        })
        if (!opened.ok) throw new Error(`session refused: ${opened.reason}`)
        let failing = failFirstAppend
        const transport = {
          ...opened.session.transport,
          append: async (request: Parameters<typeof opened.session.transport.append>[0]) => {
            if (failing) {
              failing = false
              throw new Error("the connection dropped after the upload")
            }
            return opened.session.transport.append(request)
          },
        }
        const sync = await openDeviceSync({
          repoDir: repo,
          stateDir: join(root, "state"),
          locksDir: join(root, "locks"),
          session: { ...opened.session, transport },
          machineId: "machine",
          log: (line) => logs.push(line),
        })
        if (sync === null) throw new Error("sync unavailable")
        return sync
      }

      const first = await deviceKeyring(20)
      const firstHttp = await join_(first, "service-machine-1")
      const firstEngine = await engineFor(first, firstHttp, true)
      await Bun.write(
        join(repo, "note.md"),
        "---\ndescription: sealed by the first principal\n---\nkept across the re-join\n",
      )
      await expect(firstEngine.engine.runCycle()).rejects.toThrow("the connection dropped")
      await firstEngine.close()
      // The same principal's own journaled batch is resent as sealed, never re-sealed.
      const resent = await engineFor(first, firstHttp, true)
      await expect(resent.engine.runCycle()).rejects.toThrow("the connection dropped")
      await resent.close()
      expect(logs.filter((line) => line.includes("re-sealing"))).toEqual([])
      // `omo account forget`: the first principal's keys are discarded and its pin retired; no revoke.
      await forgetTrustAnchor(pinDir, ACCOUNT)

      const second = await deviceKeyring(21)
      const secondHttp = await join_(second, "service-machine-2")
      const secondEngine = await engineFor(second, secondHttp, false)
      close.push(() => secondEngine.close())
      expect((await secondEngine.engine.runCycle()).pushed).toBe(true)
      expect(logs.filter((line) => line.includes("re-sealing"))).toHaveLength(1)
      const landed = f.entries.filter((entry) => entry.kind === "batch")
      expect(landed.map((entry) => (entry.author.kind === "device" ? entry.author.id : ""))).toEqual([
        second.principal().id,
      ])
    } finally {
      for (const stop of close.reverse()) await stop()
      await f.close()
    }
  },
  GIT_TEST_TIMEOUT * 4,
)
