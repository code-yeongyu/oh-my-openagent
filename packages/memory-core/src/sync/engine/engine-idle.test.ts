import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

for (const realStore of [false, true]) {
  test(`once a local edit is pushed, later cycles with nothing new push nothing, across restarts too (${realStore ? "Loro" : "fake"} store)`, async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore })
    const b = await makeDevice(server, "b", undefined, { realStore })
    devices.push(a, b)
    // The line-set fake keeps each distinct line once, so its note has no repeated `---`.
    const text = realStore ? "---\ndescription: n\n---\nhello\n" : "hello\nworld\n"
    await a.write("note.md", text)
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
    for (const d of [a, b, b]) expect(await d.engine.runCycle()).toMatchObject({ pushed: false })
    await a.restart()
    await b.restart()
    for (const d of [a, b, a]) expect(await d.engine.runCycle()).toMatchObject({ pushed: false })
    expect(server.entries).toHaveLength(1)
    expect(await b.read("note.md")).toBe(text)
  }, GIT_TEST_TIMEOUT)
}
