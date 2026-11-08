import { afterEach, expect, test } from "bun:test"

import { CrashInjected, INBOUND_POINTS } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// Seeded random create/edit/delete/interrupt runs on two devices, with crashes at every inbound
// point (mid-render included) followed by edits. With deletes, both devices must converge and no
// cycle may stay stuck. Without deletes, every line ever written must also survive. On the Loro
// store the devices must agree byte for byte, every written line must be on disk (a conflict
// copy counts) and no file may hold a line twice.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FILES = ["a.md", "b.md", "notes/c.md"]
const STEPS = 24

async function run(seed: number, deletes: boolean, realStore = false, points: readonly string[] = INBOUND_POINTS) {
  const random = prng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T
  const server = new FakeSyncServer()
  const pair = [await makeDevice(server, "a", undefined, { realStore }), await makeDevice(server, "b", undefined, { realStore })]
  devices.push(...pair)
  const written = new Map<string, Set<string>>()
  let line = 0
  for (let step = 0; step < STEPS; step += 1) {
    const device = pick(pair)
    const roll = random()
    if (roll < 0.45) {
      const file = pick(FILES)
      const text = `line-${seed}-${(line += 1)}`
      const current = (await device.read(file)) ?? ""
      await device.write(file, `${current}${text}\n`)
      written.set(file, (written.get(file) ?? new Set()).add(text))
    } else if (roll < 0.55 && deletes) {
      await device.write(pick(FILES), null)
    } else if (roll < 0.7) {
      // 1-3 crashes in a row, each at a random point and occurrence, so later ones land inside a
      // resume; a person may edit (or delete) any file between them, including one just rendered.
      const crashes = 1 + Math.floor(random() * 3)
      for (let c = 0; c < crashes; c += 1) {
        const point = pick(points)
        const nth = 1 + Math.floor(random() * 3)
        let seen = 0
        await device.restart((at) => {
          if (at === point && (seen += 1) === nth) throw new CrashInjected(`${point}#${nth}`)
        })
        await device.engine.runCycle().catch((error: unknown) => {
          if (!(error instanceof CrashInjected)) throw error
        })
        if (random() < 0.6) {
          const file = pick(FILES)
          if (deletes && random() < 0.2) {
            await device.write(file, null)
          } else {
            const text = `line-${seed}-${(line += 1)}`
            const current = (await device.read(file)) ?? ""
            await device.write(file, `${current}${text}\n`)
            written.set(file, (written.get(file) ?? new Set()).add(text))
          }
        }
      }
      await device.restart()
    } else {
      await device.engine.runCycle()
    }
  }
  for (let round = 0; round < 3; round += 1) for (const device of pair) await device.engine.runCycle()
  const [a, b] = pair as [Device, Device]
  for (const device of pair) expect(await device.workingTempFiles()).toEqual([])
  for (const device of pair) expect(await device.renderJournals()).toEqual([])
  if (realStore) {
    const files = await a.workingFiles()
    expect(await b.workingFiles()).toEqual(files)
    const all: string[] = []
    for (const file of files) {
      const text = (await a.read(file)) ?? ""
      expect([file, await b.read(file)]).toEqual([file, text])
      const lines = text.split("\n").filter((l) => l !== "")
      expect([file, lines.length]).toEqual([file, new Set(lines).size])
      all.push(...lines)
    }
    if (!deletes) for (const lines of written.values()) for (const l of lines) expect([l, all.includes(l)]).toEqual([l, true])
    for (const device of pair) expect((await device.engine.state()).cycle).toBeNull()
    return
  }
  // The fake store is a line set: a device's own unrendered edit keeps its local line order, so
  // convergence is equal line sets, not equal bytes.
  const lines = (text: string | null) => (text ?? "").split("\n").filter((l) => l !== "").sort()
  for (const file of FILES) expect([file, lines(await a.read(file))]).toEqual([file, lines(await b.read(file))])
  for (const device of pair) expect((await device.engine.state()).cycle).toBeNull()
  if (!deletes) {
    // A line may live in its file or in a conflict copy made for an edit during an interrupted sync.
    let disk = ""
    for (const file of await a.workingFiles()) disk += `${(await a.read(file)) ?? ""}\n`
    for (const lines of written.values()) for (const l of lines) expect([l, disk.includes(l)]).toEqual([l, true])
  }
}

for (const seed of [1, 2, 3]) {
  test(`seed ${seed}: random create/edit/delete/interrupt runs converge with no stuck cycle`, () => run(seed, true), 120_000)
  test(`seed ${seed}: random write/interrupt runs converge and lose no written line`, () => run(seed + 100, false), 120_000)
}

for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
  test(`Loro store, seed ${seed}: random write/multi-crash runs agree byte for byte, keep every line and duplicate none`, () => run(seed, false, true), 180_000)
  test(`Loro store, seed ${seed + 100}: random create/edit/delete/multi-crash runs agree byte for byte and duplicate nothing`, () => run(seed + 100, true, true), 180_000)
}

// The render window alone (a leftover staged file, a record without its landing, a landed render),
// with deletes, so a staged leftover can meet a delete record (#10548 round-4 L1).
const RENDER_WINDOW = ["staged", "render-intent", "render-key"]
for (const seed of [61, 62, 63, 64]) {
  test(`Loro store, seed ${seed}: crashes inside the render window with deletes agree byte for byte`, () => run(seed, true, true, RENDER_WINDOW), 180_000)
}
