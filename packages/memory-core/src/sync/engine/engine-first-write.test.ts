import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const note = (body: string) => `---\ndescription: seed note\n---\n${body}`

/** The first memory write commits the seed before any engine runs, the way /memfs init does. */
async function commitSeed(device: Device): Promise<void> {
  const git = ["git", "-C", device.repo.root, "-c", "user.name=seed", "-c", "user.email=seed@example.invalid"]
  await Bun.$`${git} add -A`.quiet()
  await Bun.$`${git} commit -q -m seed`.quiet()
}

/** The device's next cycle, bounded so a loop that never cycles fails with a message instead of hanging. */
async function nextCycle(device: Device): Promise<void> {
  let breaker: ReturnType<typeof setTimeout> | undefined
  const never = new Promise<never>((_resolve, reject) => {
    breaker = setTimeout(() => reject(new Error(`waited 10s for a cycle on ${device.name}, none ran`)), 10_000)
  })
  try {
    await Promise.race([device.engine.nextCycle(), never])
  } finally {
    clearTimeout(breaker)
  }
}

// p9 proof of record: both devices made their first memory write (the seed) before their sync loops started,
// then the loops started and moved nothing. Started engines must carry each seed across with no manual cycle.
test(
  "#given two devices whose seeds were committed before sync started #when both engines start #then each seed crosses to the other and the shared note converges",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    const b = await makeDevice(server, "b", undefined, { realStore: true })
    devices.push(a, b)
    await a.write("system/persona.md", note("persona written on a\n"))
    await a.write("a-only.md", note("from a\n"))
    await commitSeed(a)
    await b.write("system/persona.md", note("persona written on b\n"))
    await b.write("b-only.md", note("from b\n"))
    await commitSeed(b)

    const aStarted = nextCycle(a)
    a.engine.start()
    await aStarted
    const bStarted = nextCycle(b)
    b.engine.start()
    await bStarted
    for (let cycles = 0; cycles < 4 && (await a.read("b-only.md")) === null; cycles += 1) await nextCycle(a)

    expect(await b.read("a-only.md")).toBe(note("from a\n"))
    expect(await a.read("b-only.md")).toBe(note("from b\n"))
    expect(await a.read("system/persona.md")).toBe(await b.read("system/persona.md"))
  },
  GIT_TEST_TIMEOUT,
)
