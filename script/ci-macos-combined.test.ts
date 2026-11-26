import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { z } from "zod"

const stepSchema = z.object({
  id: z.string().optional(),
  run: z.string().optional(),
  if: z.string().optional(),
  "working-directory": z.string().optional(),
  "continue-on-error": z.boolean().optional(),
  "timeout-minutes": z.number().optional(),
  env: z.record(z.string(), z.string()).optional(),
})
const { jobs } = z
  .object({
    jobs: z.record(
      z.string(),
      z.object({
        name: z.string().optional(),
        needs: z.array(z.string()).optional(),
        if: z.string().optional(),
        "runs-on": z.string(),
        "timeout-minutes": z.union([z.number(), z.string()]).optional(),
        outputs: z.record(z.string(), z.string()).optional(),
        steps: z.array(stepSchema),
      }),
    ),
  })
  .parse(Bun.YAML.parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")))

function job(id: string) {
  const found = jobs[id]
  if (found === undefined) throw new Error(`missing CI job: ${id}`)
  return found
}

function script(name: string): string {
  return readFileSync(new URL(`../.github/scripts/${name}`, import.meta.url), "utf8")
}

// The two parallel macOS jobs (#14849) and the parts each runs, in order, with the output each part exports.
const macosJobs = {
  "macos-combined-1": [
    ["lsp", "lsp-daemon-tests"],
    ["shard1a", "root-tests-posix-1a"],
    ["shard1b", "root-tests-posix-1b"],
    ["shard2b", "root-tests-posix-2b"],
    ["codex", "codex-platform-tests"],
  ],
  "macos-combined-2": [
    ["shard2a", "root-tests-posix-2a"],
    ["senpi", "senpi-tests-posix"],
  ],
} as const
type MacosJob = keyof typeof macosJobs
const macosJobIds = Object.keys(macosJobs) as MacosJob[]
// Checkout, setup, install (measured 2-6 min) and the upload/summary steps have no step budget of their own; each job
// budget must leave them this much beyond the sum of its part budgets.
const unbudgetedMinutes = 10

describe("combined macOS CI execution contract (#9974)", () => {
  test.each(macosJobIds)(
    "#given classifier fast paths #when %s is scheduled #then neither false flag allocates macOS",
    (id) => {
      const combined = job(id)
      expect(combined.needs).toEqual(["ci-mode"])
      expect(combined["runs-on"]).toBe("macos-latest")
      expect(combined.if).toBe(
        "needs.ci-mode.outputs.run_heavy == 'true' && needs.ci-mode.outputs.full_matrix == 'true'",
      )
      const install = combined.steps.find((step) => step.id === "install")
      expect(install?.run).toBe("bun install --frozen-lockfile\nbun run script/remove-stale-self-package-tests.ts\n")
      expect(combined.steps.filter((step) => step.run?.includes("bun install"))).toHaveLength(1)
    },
  )

  test.each(macosJobIds)(
    "#given an earlier part of %s fails #when subsequent parts are evaluated #then each still runs and exports its actual outcome",
    (id) => {
      const combined = job(id)
      const parts = macosJobs[id]
      const isPart = (step: { id?: string | undefined }) => parts.some(([, partId]) => partId === step.id)
      expect(combined.steps.filter(isPart).map((step) => step.id)).toEqual(parts.map(([, partId]) => partId))
      expect(Object.keys(combined.outputs ?? {})).toEqual(parts.map(([output]) => output))
      for (const [output, partId] of parts) {
        const step = combined.steps.find((step) => step.id === partId)
        expect(step?.if).toBe("${{ !cancelled() && steps.install.outcome == 'success' }}")
        expect(step?.["continue-on-error"]).toBeUndefined()
        // A hung part must hit its own step timeout (failing only its own context) before the job budget
        // cancels the later parts: every part is bounded, and the part budgets fit inside the job budget.
        expect(step?.["timeout-minutes"]).toBeGreaterThan(0)
        expect(combined.outputs?.[output]).toBe(`\${{ steps.${partId}.outcome }}`)
      }
      const partBudget = combined.steps.filter(isPart).reduce((sum, step) => sum + (step["timeout-minutes"] ?? 0), 0)
      expect(partBudget + unbudgetedMinutes).toBeLessThanOrEqual(Number(combined["timeout-minutes"]))
    },
  )

  test("#given the two macOS jobs #when their parts are listed #then every part, the LSP tests included, runs exactly once", () => {
    const partIds = macosJobIds.flatMap((id) =>
      job(id).steps.flatMap((step) => (step.id === undefined ? [] : [step.id])),
    )
    const expected = macosJobIds.flatMap((id) => macosJobs[id].map(([, partId]) => partId))
    for (const partId of expected) expect(partIds.filter((stepId) => stepId === partId)).toHaveLength(1)
    expect(macosJobIds.flatMap((id) => job(id).steps).filter((step) => step.run === "npm test")).toHaveLength(1)
  })

  test("#given all former macOS suites #when the two jobs run #then they execute every suite and shared prerequisite", () => {
    const steps = macosJobIds.flatMap((id) => job(id).steps)
    expect(steps.find((step) => step.id === "lsp-daemon-tests")).toMatchObject({
      run: "npm test",
      "working-directory": "packages/lsp-daemon",
    })
    expect(steps.find((step) => step.id === "root-tests-posix-1a")?.run).toBe(
      'mkdir -p "$CI_JUNIT_DIR"\nbun test --timeout 20000 packages/memory-core/src/sync/ packages/memory-core/src/memfs/ --reporter=junit --reporter-outfile="$CI_JUNIT_DIR/root-1a.xml"\n',
    )
    expect(steps.find((step) => step.id === "root-tests-posix-1b")?.run).toBe(
      'mkdir -p "$CI_JUNIT_DIR"\nbun --config=bunfig.macos-shard-1b.toml test --timeout 20000 packages/omo-opencode packages/memory-core --reporter=junit --reporter-outfile="$CI_JUNIT_DIR/root-1b.xml"\n',
    )
    expect(steps.find((step) => step.id === "root-tests-posix-2a")?.run).toBe(
      "bash .github/scripts/ci-root-shard-2.sh heavy",
    )
    expect(steps.find((step) => step.id === "root-tests-posix-2b")?.run).toBe(
      "bash .github/scripts/ci-root-shard-2.sh light",
    )
    expect(script("ci-root-shard-2.sh")).toContain(
      "bun --config=bunfig.win2.parallel.toml test --timeout 20000 ./script",
    )
    expect(script("ci-root-shard-2.sh")).not.toContain("test --timeout 20000 script ")
    expect(steps.find((step) => step.id === "codex-platform-tests")?.run).toBe(
      "bash .github/scripts/ci-codex-platform-build.sh\nbash .github/scripts/ci-codex-platform-node.sh\nbun test packages/omo-opencode/src/cli/cli-installer.platform.test.ts\n",
    )
    expect(steps.find((step) => step.id === "senpi-tests-posix")?.run).toBe("bash .github/scripts/ci-senpi-posix.sh")
    expect(script("ci-codex-platform-build.sh").trim().split("\n").slice(2)).toEqual([
      "bun run build:codex-install",
      "bun run build:git-bash-mcp",
      "bun run build:lsp-tools-mcp",
      "bun run build:lsp-daemon",
      "npm --prefix packages/omo-codex/plugin ci",
      "bun run --cwd packages/omo-codex/plugin build",
    ])
    expect(script("ci-codex-platform-node.sh").trim().split("\n")[2]?.split(" ")).toEqual([
      "node",
      "--test",
      "packages/omo-codex/scripts/install-local.test.mjs",
      "packages/omo-codex/scripts/install-local-entrypoint.test.mjs",
      "packages/omo-codex/scripts/install-local-git-bash-preflight.test.mjs",
      "packages/omo-codex/scripts/install-cli-args.test.mjs",
      "packages/omo-codex/plugin/test/node-install-surface.test.mjs",
      "packages/omo-codex/plugin/test/install-time-build-runtime.test.mjs",
    ])
  })

  test.each([
    ["macos-test-1-status", "test", ["lsp", "shard1a", "shard1b"]],
    ["macos-test-2-status", "test", ["lsp", "shard2a", "shard2b"]],
    ["macos-codex-status", "codex-compatibility", ["codex"]],
    ["macos-senpi-status", "senpi-compatibility", ["senpi"]],
  ] as const)(
    "#given %s #when its status is published #then Ubuntu judges only the corresponding parts from the jobs that ran them",
    (id, name, outputs) => {
      // Each output comes from the one macOS job that runs its part; the status needs exactly those jobs, in job order.
      const source = (output: string) => {
        const found = macosJobIds.find((jobId) => macosJobs[jobId].some(([exported]) => exported === output))
        if (found === undefined) throw new Error(`no macOS job exports ${output}`)
        return found
      }
      const sources = macosJobIds.filter((jobId) => outputs.some((output) => source(output) === jobId))
      const status = job(id)
      expect(status.name).toBe(name)
      expect(status["runs-on"]).toBe("ubuntu-26.04")
      expect(status.needs).toEqual(["ci-mode", ...sources])
      expect(status.if).toBe("${{ always() && !cancelled() }}")
      const judge = status.steps.find((step) => step.run?.endsWith("bash .github/scripts/ci-macos-status.sh"))
      expect(judge?.env).toEqual({
        LEG_OS: "${{ matrix.os }}",
        LEG_JOB_STATUS: sources.map((jobId) => `\${{ needs.${jobId}.result }}`).join(" "),
        TEST_OUTCOMES: outputs
          .map((output) => `\${{ needs.${source(output)}.outputs.${output} || 'missing' }}`)
          .join(" "),
        RUN_HEAVY: "${{ needs.ci-mode.outputs.run_heavy }}",
        FULL_MATRIX: "${{ needs.ci-mode.outputs.full_matrix }}",
        RUNTIME_TOUCHING: "${{ needs.ci-mode.outputs.runtime_touching }}",
      })
      for (const downstream of ["auto-commit-schema", "draft-release"]) {
        expect(job(downstream).needs).toContain(id)
      }
    },
  )
})
