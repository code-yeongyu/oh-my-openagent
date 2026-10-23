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
const { jobs } = z.object({
  jobs: z.record(z.string(), z.object({
    name: z.string().optional(),
    needs: z.array(z.string()).optional(),
    if: z.string().optional(),
    "runs-on": z.string(),
    "timeout-minutes": z.union([z.number(), z.string()]).optional(),
    outputs: z.record(z.string(), z.string()).optional(),
    steps: z.array(stepSchema),
  })),
}).parse(Bun.YAML.parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")))

function job(id: string) {
  const found = jobs[id]
  if (found === undefined) throw new Error(`missing CI job: ${id}`)
  return found
}

function script(name: string): string {
  return readFileSync(new URL(`../.github/scripts/${name}`, import.meta.url), "utf8")
}

const parts = [
  ["lsp", "lsp-daemon-tests"],
  ["shard1", "root-tests-posix-1"],
  ["shard2", "root-tests-posix-2"],
  ["codex", "codex-platform-tests"],
  ["senpi", "senpi-tests-posix"],
] as const

describe("combined macOS CI execution contract (#9974)", () => {
  test("#given classifier fast paths #when the combined job is scheduled #then neither false flag allocates macOS", () => {
    const combined = job("macos-combined")
    expect(combined.needs).toEqual(["ci-mode"])
    expect(combined["runs-on"]).toBe("macos-latest")
    expect(combined.if).toBe("needs.ci-mode.outputs.run_heavy == 'true' && needs.ci-mode.outputs.full_matrix == 'true'")
    expect(combined["timeout-minutes"]).toBe(90)
    const install = combined.steps.find((step) => step.id === "install")
    expect(install?.run).toBe("bun install --frozen-lockfile\nbun run script/remove-stale-self-package-tests.ts\n")
    expect(combined.steps.filter((step) => step.run?.includes("bun install"))).toHaveLength(1)
  })

  test("#given an earlier macOS part fails #when subsequent parts are evaluated #then each still runs and exports its actual outcome", () => {
    const combined = job("macos-combined")
    expect(combined.steps.filter((step) => parts.some(([, id]) => id === step.id)).map((step) => step.id))
      .toEqual(parts.map(([, id]) => id))
    for (const [output, id] of parts) {
      const step = combined.steps.find((step) => step.id === id)
      expect(step?.if).toBe("${{ !cancelled() && steps.install.outcome == 'success' }}")
      expect(step?.["continue-on-error"]).toBeUndefined()
      // A hung part must hit its own step timeout (failing only its own context) before the job budget
      // cancels the later parts: every part is bounded, and the part budgets fit inside the job budget.
      expect(step?.["timeout-minutes"]).toBeGreaterThan(0)
      expect(combined.outputs?.[output]).toBe(`\${{ steps.${id}.outcome }}`)
    }
    const partBudget = combined.steps
      .filter((step) => parts.some(([, id]) => id === step.id))
      .reduce((sum, step) => sum + (step["timeout-minutes"] ?? 0), 0)
    expect(partBudget).toBeLessThan(Number(combined["timeout-minutes"]))
  })

  test("#given all former macOS suites #when the combined job runs #then it executes every suite and shared prerequisite", () => {
    const steps = job("macos-combined").steps
    expect(steps.find((step) => step.id === "lsp-daemon-tests"))
      .toMatchObject({ run: "npm test", "working-directory": "packages/lsp-daemon" })
    expect(steps.find((step) => step.id === "root-tests-posix-1")?.run)
      .toBe("bun test --timeout 20000 packages/omo-opencode packages/memory-core")
    expect(steps.find((step) => step.id === "root-tests-posix-2")?.run)
      .toBe("bash .github/scripts/ci-root-shard-2.sh")
    expect(steps.find((step) => step.id === "codex-platform-tests")?.run).toBe(
      "bash .github/scripts/ci-codex-platform-build.sh\nbash .github/scripts/ci-codex-platform-node.sh\nbun test packages/omo-opencode/src/cli/cli-installer.platform.test.ts\n",
    )
    expect(steps.find((step) => step.id === "senpi-tests-posix")?.run)
      .toBe("bash .github/scripts/ci-senpi-posix.sh")
    expect(script("ci-codex-platform-build.sh").trim().split("\n").slice(2)).toEqual([
      "bun run build:codex-install", "bun run build:git-bash-mcp", "bun run build:lsp-tools-mcp",
      "bun run build:lsp-daemon", "npm --prefix packages/omo-codex/plugin ci",
      "bun run --cwd packages/omo-codex/plugin build",
    ])
    expect(script("ci-codex-platform-node.sh").trim().split("\n")[2]?.split(" ")).toEqual([
      "node", "--test",
      "packages/omo-codex/scripts/install-local.test.mjs",
      "packages/omo-codex/scripts/install-local-entrypoint.test.mjs",
      "packages/omo-codex/scripts/install-local-git-bash-preflight.test.mjs",
      "packages/omo-codex/scripts/install-cli-args.test.mjs",
      "packages/omo-codex/plugin/test/node-install-surface.test.mjs",
      "packages/omo-codex/plugin/test/install-time-build-runtime.test.mjs",
    ])
  })

  test.each([
    ["macos-test-1-status", "test", "lsp", "shard1"],
    ["macos-test-2-status", "test", "lsp", "shard2"],
    ["macos-codex-status", "codex-compatibility", "codex"],
    ["macos-senpi-status", "senpi-compatibility", "senpi"],
  ])("#given %s #when its status is published #then Ubuntu judges only the corresponding part", (id, name, ...outputs) => {
    if (id === undefined || name === undefined) throw new Error("incomplete status fixture")
    const status = job(id)
    expect(status.name).toBe(name)
    expect(status["runs-on"]).toBe("ubuntu-26.04")
    expect(status.needs).toEqual(["ci-mode", "macos-combined"])
    expect(status.if).toBe("${{ always() && !cancelled() }}")
    const judge = status.steps.find((step) => step.run?.endsWith("bash .github/scripts/ci-macos-status.sh"))
    expect(judge?.env).toEqual({
      LEG_OS: "${{ matrix.os }}",
      LEG_JOB_STATUS: "${{ needs.macos-combined.result }}",
      TEST_OUTCOMES: outputs.map((output) => `\${{ needs.macos-combined.outputs.${output} }}`).join(" "),
      RUN_HEAVY: "${{ needs.ci-mode.outputs.run_heavy }}",
      FULL_MATRIX: "${{ needs.ci-mode.outputs.full_matrix }}",
      RUNTIME_TOUCHING: "${{ needs.ci-mode.outputs.runtime_touching }}",
    })
    for (const downstream of ["auto-commit-schema", "draft-release"]) {
      expect(job(downstream).needs).toContain(id)
    }
  })
})
