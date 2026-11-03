import { onTestFinished } from "bun:test"
import { cp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { repo } from "../backends/git-fixture"
import { captureBaseline } from "../git/baseline"
import { mergeIsolatedChanges, type IsolationMergeOptions } from "./index"

export async function setup(nested = false) {
  const f = await repo()
  if (nested) {
    const inner = await repo()
    await cp(inner.repoRoot, join(f.repoRoot, "inner"), { recursive: true })
  }
  const baseline = await captureBaseline(f.repoRoot)
  const isolationDir = join(f.root, "child")
  await cp(f.repoRoot, isolationDir, { recursive: true })
  const options = { ...f, baseline, isolationDir, id: "test", artifactsDir: join(f.root, "artifacts"), apply: true, mode: "patch" as const }
  return options
}

async function signalOrFailure(signal: Promise<void>, merge: Promise<unknown>, name: string) {
  const ended = merge.then(() => { throw new Error(`${name} merge finished before its lock signal`) })
  await Promise.race([signal, ended])
}

type Gates = { readonly release: PromiseWithResolvers<void>; readonly own: <T>(work: Promise<T>) => Promise<T> }

async function concurrentMerges(mode: "patch" | "branch", firstOverrides: Partial<IsolationMergeOptions>, { release, own }: Gates) {
  const f = await setup()
  await writeFile(join(f.isolationDir, "one"), "one\n")
  const other = join(f.root, "other")
  await cp(f.repoRoot, other, { recursive: true })
  await writeFile(join(other, "two"), "two\n")
  const entered = Promise.withResolvers<void>()
  const queued = Promise.withResolvers<void>()
  const events: string[] = []
  const first = own(mergeIsolatedChanges({ ...f, mode, ...firstOverrides, lockHook: async event => {
    events.push(`first:${event}`)
    if (event === "acquired") { entered.resolve(); await release.promise }
  } }))
  await signalOrFailure(entered.promise, first, "first")
  const second = own(mergeIsolatedChanges({ ...f, mode, id: "second", isolationDir: other, lockHook: event => {
    events.push(`second:${event}`)
    if (event === "waiting") queued.resolve()
  } }))
  await signalOrFailure(queued.promise, second, "second")
  return { f, first, second, events }
}

/** Starts two merges of one repository, the first held at "acquired" until `release()`. Every git call it makes is owned by the
 * calling test: when the test ends, however it ends, its teardown releases the hold and waits for setup and both merges to
 * settle before the fixture tree is removed, so no git work outlives the test and no rejection lands on the next test (#9846, #9678).
 * A merge that fails before its lock signal rejects `ready` instead of leaving the helper waiting. */
export function startConcurrentMerges(mode: "patch" | "branch", firstOverrides: Partial<IsolationMergeOptions> = {}) {
  const release = Promise.withResolvers<void>()
  const work: Promise<unknown>[] = []
  let pending = 0
  const own = <T>(promise: Promise<T>) => {
    pending++
    work.push(promise)
    promise.then(() => { pending-- }, () => { pending-- })
    return promise
  }
  // Registered before setup() registers the fixture's removal: bun runs onTestFinished callbacks in registration order.
  onTestFinished(async () => {
    release.resolve()
    for (let settled = 0; settled < work.length; settled++) await Promise.allSettled([work[settled]])
  })
  const ready = own(concurrentMerges(mode, firstOverrides, { release, own }))
  return { ready, release: () => release.resolve(), settled: () => pending === 0 }
}
