import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { sealedItems } from "./received-keys.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const ACCEPTED = ["ARCHIVE.md", "café.md", "notes.txt", "people/김영규/card.md", "skills/x/scripts/run.sh", "templates/setup.sh", "Mixed/Case.MD", "$notes.md", "~/inside.md", "dir.with.dots/v1.2.md"]
const REFUSED_ON_CAPTURE = ["con.md", "a:b.md", "trail./x.md", "q?.md", "git.cmd", "bad\u200c.md", "space /y.md"]
/** Windows cannot create these names at all, so capture is never handed one there to refuse; the same spellings are still proven dropped on every OS by the receive side in engine-received-key-liveness.test.ts. */
const UNHOLDABLE_ON_WIN32 = ["con.md", "a:b.md", "trail./x.md", "q?.md", "space /y.md"]
const REFUSED_ON_CAPTURE_HERE = process.platform === "win32" ? REFUSED_ON_CAPTURE.filter((key) => !UNHOLDABLE_ON_WIN32.includes(key)) : REFUSED_ON_CAPTURE
const NFD_NAME = "re\u0301sume\u0301.md"

test("capture never sends a key that receive refuses, and every accepted key round-trips byte-identical", async () => {
  const server = new FakeSyncServer()
  const lines: string[] = []
  const a = await makeDevice(server, "a", undefined, { log: (line) => lines.push(line) })
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  for (const key of [...ACCEPTED, ...REFUSED_ON_CAPTURE_HERE, NFD_NAME]) await a.write(key, `${key.normalize("NFC")}\n`)
  expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
  const nfc = NFD_NAME.normalize("NFC")
  expect(sealedItems(server, 1).map((i) => i.key).sort()).toEqual([...ACCEPTED, nfc].sort())
  const receipts = lines.filter((line) => line.startsWith("sync.item.rejected"))
  expect(receipts.length).toBeGreaterThanOrEqual(REFUSED_ON_CAPTURE_HERE.length)
  for (const key of REFUSED_ON_CAPTURE_HERE) for (const receipt of receipts) expect(receipt.includes(key)).toBe(false)
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 0 })
  expect(await b.workingFiles()).toEqual([".gitkeep", ...ACCEPTED, nfc].sort())
  for (const key of [...ACCEPTED, nfc]) expect(await b.read(key)).toBe(`${key}\n`)
  for (const key of REFUSED_ON_CAPTURE_HERE) expect(await a.read(key)).toBe(`${key}\n`)
}, GIT_TEST_TIMEOUT)
