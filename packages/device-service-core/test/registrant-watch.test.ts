import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, type FSWatcher } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ARM_SETTLE_MS, watchEndpointFile } from "../src/registrant-watch.ts"

// The dropped event of #12481, made deterministic: a "deaf" directory watch never reports anything, exactly like a
// freshly armed macOS watch that misses an entry created right after it was armed. Only the settle re-check can
// then see the service, and the fake schedule decides when it runs.
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function world() {
  const root = mkdtempSync(join(tmpdir(), "rw-"))
  dirs.push(root)
  const stateDir = join(root, "home", ".omo", "device-service")
  const endpoint = join(stateDir, "service.sock")
  const armed: string[] = []
  const deafWatch = (target: string): FSWatcher => {
    armed.push(target)
    return { close: () => undefined, on: () => undefined } as unknown as FSWatcher
  }
  const settles: { readonly run: () => void; readonly ms: number }[] = []
  const schedule = (run: () => void, ms: number) => {
    const entry = { run, ms }
    settles.push(entry)
    return () => {
      const at = settles.indexOf(entry)
      if (at >= 0) settles.splice(at, 1)
    }
  }
  const runSettles = (): void => {
    for (const settle of settles.splice(0)) settle.run()
  }
  let changes = 0
  const stop = watchEndpointFile(endpoint, () => (changes += 1), { watch: deafWatch, schedule })
  return { root, stateDir, endpoint, armed, settles, runSettles, changes: () => changes, stop }
}

test("#given the state dir and the service appear right after the ancestor watch armed #when no watch event ever arrives #then the settle re-check still reports the endpoint", () => {
  // given
  const w = world()
  expect(w.armed).toEqual([w.root])
  expect(w.settles.map((settle) => settle.ms)).toEqual([ARM_SETTLE_MS])

  // when
  mkdirSync(w.stateDir, { recursive: true })
  writeFileSync(w.endpoint, "")
  w.runSettles()

  // then
  expect(w.changes()).toBe(1)
  expect(w.armed).toEqual([w.root, w.stateDir])
  w.stop()
})

test("#given the state dir appears unseen and the service only later #when each settle runs #then the watch moves down to the state dir and the later service is still reported", () => {
  // given
  const w = world()
  mkdirSync(w.stateDir, { recursive: true })

  // when
  w.runSettles()
  const afterFirstSettle = w.changes()
  writeFileSync(w.endpoint, "")
  w.runSettles()

  // then
  expect(afterFirstSettle).toBe(0)
  expect(w.armed).toEqual([w.root, w.stateDir])
  expect(w.changes()).toBe(1)
  w.stop()
})

test("#given nothing changes #when the settle re-check runs #then it schedules nothing more, so the watch never polls", () => {
  // given
  const w = world()

  // when
  w.runSettles()

  // then
  expect(w.settles).toEqual([])
  expect(w.changes()).toBe(0)
  w.stop()
})

test("#given the endpoint already existed when the watch armed #when the settle re-check runs #then it reports nothing, so a connect walk under way is never restarted", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "rw-"))
  dirs.push(root)
  const stateDir = join(root, "device-service")
  mkdirSync(stateDir)
  writeFileSync(join(stateDir, "service.sock"), "")
  const settles: (() => void)[] = []
  let changes = 0
  const stop = watchEndpointFile(join(stateDir, "service.sock"), () => (changes += 1), {
    watch: () => ({ close: () => undefined, on: () => undefined }) as unknown as FSWatcher,
    schedule: (run) => {
      settles.push(run)
      return () => undefined
    },
  })

  // when
  for (const run of settles.splice(0)) run()

  // then
  expect(changes).toBe(0)
  stop()
})

test("#given a stopped watch #when its pending settle would run #then it was cancelled and reports nothing", () => {
  // given
  const w = world()
  mkdirSync(w.stateDir, { recursive: true })
  writeFileSync(w.endpoint, "")

  // when
  w.stop()

  // then
  expect(w.settles).toEqual([])
  expect(w.changes()).toBe(0)
})
