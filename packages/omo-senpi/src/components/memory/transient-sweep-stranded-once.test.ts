import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { TRANSIENT_DIRNAME } from "./transient-identity"
import { STRANDED_REPORTED_MARKER } from "./transient-stranded"
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

async function sweepTimes(root: string, times: number) {
  const warnings: { message: string; fields?: Readonly<Record<string, unknown>> }[] = []
  const results = []
  for (let pass = 0; pass < times; pass += 1) {
    ageTree(root)
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

  test("#given a reported stranded run whose durable identity is later removed #when the sweep runs #then it is promoted without the marker", async () => {
    // given
    const root = memoryRoot()
    strandedRun(root, "ddd-4242-zz", "project-1")
    await sweepTimes(root, 1)
    rmSync(join(root, "agents", "project-1"), { recursive: true, force: true })

    // when
    const { results } = await sweepTimes(root, 1)

    // then
    expect(results[0]?.promoted).toBe(1)
    expect(existsSync(join(root, "agents", "project-1", "repo", "system", "persona.md"))).toBe(true)
    expect(existsSync(join(root, "agents", "project-1", STRANDED_REPORTED_MARKER))).toBe(false)
  })
})
