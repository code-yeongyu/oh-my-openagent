import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { z } from "zod"
import {
  discoverSuite,
  discoverTestFiles,
  WINDOWS_SPLITS,
  type WindowsSplit,
  windowsTimedInvocations,
} from "./ci-test-discovery.ts"

// Partition contract of the split Windows suites (#14942, #15096): the parallel Windows jobs together run every test file
// of the unsplit suite (root shard 1 = omo-opencode + memory-core, root shard 2 = ci-root-shard-2.sh `all`, and the
// Senpi package suite), each file exactly once.
// Each part's files are derived from its telemetry-wrapped bun commands in ci.yml and the bunfig each one names, so a
// part that drops, repeats or adds a file fails here. The status jobs check the same partition again on the hosted run
// from the Bun timing records the parts upload (script/ci-shard-coverage.ts).

const stepSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
})
const { jobs } = z
  .object({
    jobs: z.record(z.string(), z.object({ needs: z.array(z.string()).optional(), steps: z.array(stepSchema) })),
  })
  .parse(Bun.YAML.parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")))

const splits = {
  "windows-root": {
    job: "test-windows-1",
    steps: ["root-tests-windows-1a", "root-tests-windows-1b"],
    status: "windows-test-1-status",
    upload: "windows-shard-record-root-1${{ matrix.part }}",
    download: "windows-shard-record-root-1*",
  },
  "windows-root-2": {
    job: "test-windows-2",
    steps: ["root-tests-windows-2a", "root-tests-windows-2b"],
    status: "windows-test-2-status",
    upload: "windows-shard-record-root-2${{ matrix.part }}",
    download: "windows-shard-record-root-2*",
  },
  "windows-senpi": {
    job: "senpi-tests-windows",
    steps: ["senpi-tests-windows"],
    status: "windows-senpi-status",
    upload: "windows-shard-record-senpi-${{ matrix.part }}",
    download: "windows-shard-record-senpi-*",
  },
} as const satisfies Record<
  WindowsSplit,
  { job: string; steps: readonly string[]; status: string; upload: string; download: string }
>
const splitNames = Object.keys(splits) as WindowsSplit[]

function job(id: string) {
  const found = jobs[id]
  if (found === undefined) throw new Error(`missing CI job: ${id}`)
  return found
}

function runs(split: WindowsSplit): string[] {
  const { job: id, steps } = splits[split]
  return steps.map((stepId) => {
    const run = job(id).steps.find((step) => step.id === stepId)?.run
    if (run === undefined) throw new Error(`${id} has no ${stepId} step`)
    return run
  })
}

function recordsByFile(split: WindowsSplit): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const { record, invocation } of runs(split).flatMap(windowsTimedInvocations)) {
    for (const file of discoverTestFiles(invocation.config, invocation.filters)) {
      result.set(file, [...(result.get(file) ?? []), record])
    }
  }
  return result
}

describe("split Windows suites run every file of the unsplit suite exactly once (#14942)", () => {
  test.each(splitNames)(
    "#given %s #when its parts' files are counted #then none is missing, repeated or extra",
    (split) => {
      const reference = discoverSuite(WINDOWS_SPLITS[split].suite)
      const ran = recordsByFile(split)
      expect(reference.size).toBeGreaterThan(0)
      expect({
        repeated: [...ran]
          .filter(([, records]) => records.length > 1)
          .map(([file, records]) => `${file}: ${records.join(", ")}`),
        missing: [...reference].filter((file) => !ran.has(file)).sort(),
        extra: [...ran.keys()].filter((file) => !reference.has(file)).sort(),
      }).toEqual({ repeated: [], missing: [], extra: [] })
    },
  )

  test.each(splitNames)(
    "#given %s #when ci.yml wraps its bun commands #then every one writes a record the status job checks",
    (split) => {
      const wrapped = runs(split).flatMap((run) => [...run.matchAll(/& \.github\/scripts\/windows-ci-telemetry\.ps1/g)])
      const timed = runs(split).flatMap(windowsTimedInvocations)
      expect(timed).toHaveLength(wrapped.length)
      expect(timed.map(({ record }) => record).sort()).toEqual([...WINDOWS_SPLITS[split].records].sort())
    },
  )

  test("#given global zauc mocks #when root shard 1 is split #then every omo-opencode file runs in one bun process", () => {
    const records = new Set(
      [...recordsByFile("windows-root")]
        .filter(([file]) => file.startsWith("packages/omo-opencode/"))
        .flatMap(([, rs]) => rs),
    )
    expect([...records]).toEqual(["shard-1b"])
  })

  test.each(splitNames)(
    "#given %s #when its status job runs #then it verifies the records its parts upload",
    (split) => {
      const { job: id, status, upload, download } = splits[split]
      const uploadStep = job(id).steps.find((step) => step.name === "Upload Windows shard record")
      expect(uploadStep?.with).toMatchObject({ name: upload, overwrite: true, "if-no-files-found": "error" })
      const statusJob = job(status)
      expect(statusJob.needs).toEqual(["ci-mode", id])
      expect(statusJob.steps.find((step) => step.name?.startsWith("Download"))?.with).toMatchObject({
        pattern: download,
      })
      expect(statusJob.steps.find((step) => step.id === "coverage")?.run).toBe(
        `bun script/ci-shard-coverage.ts ${split} "$RUNNER_TEMP/windows-shard-records"`,
      )
    },
  )
})
