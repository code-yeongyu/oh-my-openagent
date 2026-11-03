import { expect, test } from "bun:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { GIT_TEST_TIMEOUT, gitRepo } from "../engine/engine-harness.test-support.ts"
import { openDeviceSync } from "../engine/open.ts"
import { deviceKeyring } from "../genesis/vector.test-support.ts"
import { approveDevice } from "./approve.ts"
import { enableSync } from "./enable.ts"
import { createAccountHttp } from "./http.ts"
import { joinAccount, principalOf } from "./join.ts"
import { createPairingHttp } from "./pairing-http.ts"
import { openAccountSession } from "./session.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"

const mailbox = () => {
  let queued = 0
  let waiter: (() => void) | undefined
  return {
    signal() { if (waiter) { const resolve = waiter; waiter = undefined; resolve() } else queued++ },
    sleep: async () => {
      if (queued > 0) { queued--; return }
      await new Promise<void>((resolve) => { waiter = resolve })
    },
    now: () => 0,
  }
}

test("first-device genesis then code-based join then bidirectional memory replication on the wire", async () => {
  const f = await fixture()
  const close: (() => Promise<unknown>)[] = [f.close]
  try {
    expect(await enableSync(f.input)).toEqual({ kind: "joined", created: true })
    const second = await deviceKeyring(20)
    const token = f.server.tokenFor(principalOf(second), "service-second")
    const options = { baseUrl: f.server.url, token: () => token }
    const joiner = {
      account: ACCOUNT, keyring: second, pinDir: join(f.input.pinDir, "second"),
      chain: createAccountHttp(options), pairing: createPairingHttp(options),
    }
    expect(await enableSync({ ...joiner, serviceDeviceId: "service-second" })).toEqual({ kind: "join_required" })
    const a = mailbox()
    const b = mailbox()
    const pending = Promise.withResolvers<string>()
    f.server.onWrite = () => {
      a.signal(); b.signal()
      const id = f.server.pending()[0]?.id
      if (id) pending.resolve(id)
    }
    let shown = ""
    let compared = ""
    const joining = joinAccount({ ...joiner, clock: b, showCode: (code) => { shown = code } })
    const approval = await approveDevice({
      ...f.input, clock: a, pendingId: await pending.promise,
      confirmCode: async (code) => { compared = code; return true },
    })
    expect(approval.kind).toBe("approved")
    expect(await joining).toEqual({ kind: "joined" })
    expect(shown).toMatch(/^\d{6}$/)
    expect(shown).toBe(compared)
    const makeEngine = async (name: string, keyring: typeof second, pinDir: string, http: typeof options) => {
      const root = join(f.input.pinDir, name)
      const repo = join(root, "repo")
      await mkdir(repo, { recursive: true })
      await gitRepo(repo)
      const opened = await openAccountSession({ ...http, account: ACCOUNT, keyring, pinDir, spaceId: new Uint8Array(16).fill(3) })
      if (!opened.ok) throw new Error(opened.reason)
      const sync = await openDeviceSync({ repoDir: repo, stateDir: join(root, "state"), locksDir: join(root, "locks"), session: opened.session, machineId: name })
      if (sync === null) throw new Error("sync unavailable")
      close.push(() => sync.close())
      return { repo, sync }
    }
    const firstEngine = await makeEngine("first-engine", f.keyring, f.input.pinDir, f.options)
    const secondEngine = await makeEngine("second-engine", second, joiner.pinDir, options)
    const firstNote = "---\ndescription: synthetic sync proof\n---\ncreated after genesis\n"
    await writeFile(join(firstEngine.repo, "note.md"), firstNote)
    await firstEngine.sync.engine.runCycle()
    await secondEngine.sync.engine.runCycle()
    expect(await readFile(join(secondEngine.repo, "note.md"), "utf8")).toBe(firstNote)
    const reply = `${firstNote}answered after joining\n`
    await writeFile(join(secondEngine.repo, "note.md"), reply)
    await secondEngine.sync.engine.runCycle()
    await firstEngine.sync.engine.runCycle()
    expect(await readFile(join(firstEngine.repo, "note.md"), "utf8")).toBe(reply)
  } finally {
    for (const stop of close.reverse()) await stop()
  }
}, GIT_TEST_TIMEOUT * 2)
