import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { TRANSIENT_DIRNAME } from "./transient-identity"
import { STRANDED_REPORTS_DIRNAME, strandedReportPath } from "./transient-stranded"
import { TRANSIENT_RUN_MAX_AGE_MS, sweepTransientMemoryRuns } from "./transient-sweep"

const roots: string[] = []
const NOW = Date.parse("2026-09-10T12:00:00Z")
const STRANDED = "omo-senpi memory transient run holds memory a durable identity already owns"

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function memoryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-stranded-once-"))
  roots.push(root)
  return join(root, "memory")
}

function write(path: string, content = "x"): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

/** Backdates every entry so the next sweep treats the tree as idle and retries the rescue. */
function ageTree(root: string): void {
  const seconds = (NOW - TRANSIENT_RUN_MAX_AGE_MS - 60_000) / 1000
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) stack.push(child)
      else utimesSync(child, seconds, seconds)
    }
    utimesSync(current, seconds, seconds)
  }
}

/** A crashed transient run holding memory for `identity`, while `<memory>/agents/<identity>` already owns a repo. */
function strandedRun(root: string, token: string, identity: string): string {
  const from = join(root, TRANSIENT_DIRNAME, token, "agents", identity)
  write(join(from, "repo", "system", "persona.md"), "transient memory")
  write(join(root, "agents", identity, "repo", "system", "persona.md"), `${identity} memory`)
  return from
}

/**
 * Ages the tree once, then sweeps `times` times at the same clock, as real time does between sweeps:
 * nothing re-ages the tree, so anything a sweep writes under a run root would make it look active.
 */
async function sweepTimes(root: string, times: number, options: { readonly age?: boolean } = {}) {
  const warnings: { message: string; fields?: Readonly<Record<string, unknown>> }[] = []
  const results = []
  if (options.age !== false) ageTree(root)
  for (let pass = 0; pass < times; pass += 1) {
    results.push(await sweepTransientMemoryRuns({
      memoryRoot: root,
      now: () => NOW,
      isProcessAlive: () => false,
      warn: (message, fields) => warnings.push({ message, ...(fields === undefined ? {} : { fields }) }),
    }))
  }
  return { warnings, results }
}

describe("stranded transient runs are reported once (#8646)", () => {
  test("#given a stranded run that persists across sweeps #when the sweep runs three times #then it is warned once and still counted every pass", async () => {
    // given
    const root = memoryRoot()
    const from = strandedRun(root, "aaa-4242-zz", "project-1")

    // when
    const { warnings, results } = await sweepTimes(root, 3)

    // then
    const stranded = warnings.filter((warning) => warning.message === STRANDED)
    expect(stranded).toHaveLength(1)
    expect(stranded[0]?.fields).toMatchObject({ from, to: join(root, "agents", "project-1"), promotable: false })
    expect(results.map((result) => result.stranded)).toEqual([1, 1, 1])
    expect(existsSync(join(from, "repo", "system", "persona.md"))).toBe(true)
  })

  test("#given two stranded identities #when the sweep runs twice #then each is warned exactly once", async () => {
    // given
    const root = memoryRoot()
    strandedRun(root, "bbb-4242-zz", "project-1")
    strandedRun(root, "ccc-4343-zz", "project-2")

    // when
    const { warnings, results } = await sweepTimes(root, 2)

    // then
    const reportedFrom = warnings.filter((warning) => warning.message === STRANDED).map((warning) => warning.fields?.to)
    expect(reportedFrom.toSorted()).toEqual([join(root, "agents", "project-1"), join(root, "agents", "project-2")])
    expect(results.map((result) => result.stranded)).toEqual([2, 2])
  })

  test("#given a reported stranded run whose durable identity is then removed #when the very next sweep runs #then it promotes the run and drops the report record", async () => {
    // given
    const root = memoryRoot()
    strandedRun(root, "ddd-4242-zz", "project-1")
    await sweepTimes(root, 1)
    const record = strandedReportPath(join(root, TRANSIENT_DIRNAME, "ddd-4242-zz"), "project-1")
    expect(existsSync(record)).toBe(true)
    rmSync(join(root, "agents", "project-1"), { recursive: true, force: true })

    // when - no re-aging: the report must not have made the run look active
    const { results } = await sweepTimes(root, 1, { age: false })

    // then
    expect(results[0]?.promoted).toBe(1)
    expect(existsSync(join(root, "agents", "project-1", "repo", "system", "persona.md"))).toBe(true)
    expect(existsSync(record)).toBe(false)
    expect(readdirSync(join(root, "agents", "project-1"))).toEqual(["repo"])
  })

  test("#given a reported stranded run that is then deleted by hand #when the next sweep runs #then its report record is dropped too", async () => {
    // given
    const root = memoryRoot()
    strandedRun(root, "eee-4242-zz", "project-1")
    await sweepTimes(root, 1)
    const record = strandedReportPath(join(root, TRANSIENT_DIRNAME, "eee-4242-zz"), "project-1")
    rmSync(join(root, TRANSIENT_DIRNAME, "eee-4242-zz"), { recursive: true, force: true })

    // when
    await sweepTimes(root, 1, { age: false })

    // then
    expect(existsSync(record)).toBe(false)
    expect(existsSync(join(root, TRANSIENT_DIRNAME, STRANDED_REPORTS_DIRNAME))).toBe(true)
  })
})
