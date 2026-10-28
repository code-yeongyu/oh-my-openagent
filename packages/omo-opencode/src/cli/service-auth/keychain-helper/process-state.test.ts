import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Copy = typeof import("./process-copy.test-support")

const root = mkdtempSync(join(tmpdir(), "keychain-process-copies-"))
let first: Copy
let second: Copy

// Two separately bundled copies of the store in one process, as the omo-device-account and omo-feedback sidecars are.
async function bundledCopy(name: string): Promise<Copy> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "process-copy.test-support.ts")], outdir: join(root, name), target: "bun" })
  if (!built.success) throw new Error(built.logs.join("\n"))
  const [output] = built.outputs
  if (output === undefined) throw new Error("no bundle output")
  return (await import(output.path)) as Copy
}

beforeAll(async () => {
  first = await bundledCopy("first")
  second = await bundledCopy("second")
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("one keychain state per process across bundled copies (#11262 design 3.2, 3.6; rows 12, 13, 23)", () => {
  test("#given two bundled copies #when each asks for the process approval cache #then it is one instance", () => {
    expect(first.processApprovalCache()).toBe(second.processApprovalCache())
  })

  test("#given one copy holds the prompt lock #when the other copy takes it #then it is refused, never reaped as stale", async () => {
    const path = join(root, "locks", "account.keychain-prompt")
    const release = await first.promptLockAt(path)()
    expect(release).not.toBeNull()
    expect(await second.promptLockAt(path)()).toBeNull()
    await release?.()
    const again = await second.promptLockAt(path)()
    expect(again).not.toBeNull()
    await again?.()
  })

  test("#given two copies racing for the prompt lock #when both take it at once #then exactly one gets it", async () => {
    const path = join(root, "race", "account.keychain-prompt")
    const [a, b] = await Promise.all([first.promptLockAt(path)(), second.promptLockAt(path)()])
    expect([a, b].filter(release => release !== null)).toHaveLength(1)
    await a?.()
    await b?.()
  })

  test("#given a secrets call running in one copy #when the other copy queues one #then it starts only after the first ends", async () => {
    const order: string[] = []
    let finish = () => {}
    const running = first.gatedSecrets(async () => {
      order.push("first-start")
      await new Promise<void>(resolve => {
        finish = resolve
      })
      order.push("first-end")
    })
    const queued = second.gatedSecrets(async () => {
      order.push("second-run")
    })
    await Promise.resolve()
    finish()
    await Promise.all([running, queued])
    expect(order).toEqual(["first-start", "first-end", "second-run"])
  })
})
