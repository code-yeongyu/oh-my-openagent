import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
const rootConfig = readFileSync(new URL("../bunfig.root.toml", import.meta.url), "utf8")
const win2ConfigPath = new URL("../bunfig.win2.toml", import.meta.url)
const win2ParallelConfigPath = new URL("../bunfig.win2.parallel.toml", import.meta.url)

function rootTestJob(): string {
  const start = workflow.indexOf("  test:\n")
  const end = workflow.indexOf("\n  typecheck:", start)
  if (start < 0 || end < 0) throw new Error("root test job not found")
  return workflow.slice(start, end)
}

function quotedPatterns(config: string): readonly string[] {
  return [...config.matchAll(/"([^"]+\/\*\*)"/g)].map((match) => match[1] ?? "")
}

describe("root test CI partition", () => {
  test("#given required status check names #when the root matrix is declared #then only os and shard appear", () => {
    const job = rootTestJob()
    const start = job.indexOf("include:")
    const end = job.indexOf("steps:", start)
    const matrix = job.slice(start, end)

    expect(matrix).toContain("- os: ubuntu-latest")
    expect(matrix).toContain("- os: macos-latest")
    expect(matrix).toContain('shard: "1/2"')
    expect(matrix).toContain('shard: "2/2"')
    expect(matrix).not.toContain("config:")
    expect(matrix).not.toContain("test_args:")
    expect(matrix).not.toContain("parallel_args:")
  })

  test("#given global zauc mocks #when Windows root tests are partitioned #then omo-opencode stays in one process", () => {
    const job = rootTestJob()

    expect(job).toContain("bun test packages/omo-opencode packages/memory-core")
    expect(job).toContain("bun test packages/senpi-task/src/runners/rpc-process.windows.test.ts")
    expect(job).toContain("packages/utils/src/codegraph-provision-upgrade.test.ts")
    expect(job).toContain("packages/senpi-task/src/__adversarial__/chaos-bench.test.ts")
    expect(job).toContain("packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts")
    expect(job).toContain("script/codex-installer-version.test.ts")
    expect(job).toContain("packages/omo-native/test/payload.test.ts")
    expect(job).toContain("packages/omo-codex/src/install/install-codex.test.ts")
    expect(job).toContain("packages/shared-skills/provenance-gate.test.ts")
    expect(job).toContain("packages/omo-codex/src/install/install-codex-mcp-manifest.test.ts")
    expect(job).toContain("bun --config=bunfig.win2.parallel.toml test --parallel")
    expect(existsSync(win2ConfigPath)).toBe(true)
    expect(existsSync(win2ParallelConfigPath)).toBe(true)
    expect(quotedPatterns(readFileSync(win2ConfigPath, "utf8"))).toContain("packages/omo-opencode/**")
    expect(quotedPatterns(readFileSync(win2ConfigPath, "utf8"))).toContain("packages/memory-core/**")
    const parallelConfig = readFileSync(win2ParallelConfigPath, "utf8")
    expect(parallelConfig).toContain("packages/senpi-task/src/runners/rpc-process.windows.test.ts")
    expect(parallelConfig).toContain("packages/utils/src/codegraph-provision-upgrade.test.ts")
    expect(parallelConfig).toContain("packages/senpi-task/src/__adversarial__/chaos-bench.test.ts")
    expect(parallelConfig).toContain("packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts")
    expect(parallelConfig).toContain("script/codex-installer-version.test.ts")
    expect(parallelConfig).toContain("packages/omo-native/test/payload.test.ts")
    expect(parallelConfig).toContain("packages/omo-codex/src/install/install-codex.test.ts")
    expect(parallelConfig).toContain("packages/shared-skills/provenance-gate.test.ts")
    expect(parallelConfig).toContain("packages/omo-codex/src/install/install-codex-mcp-manifest.test.ts")
  })

  test("#given the dedicated Senpi compatibility job #when root tests run #then omo-senpi is excluded on every OS", () => {
    const job = rootTestJob()

    expect(job).toContain("bun --config=bunfig.root.toml test")
    expect(quotedPatterns(rootConfig)).toContain("packages/omo-senpi/**")
    expect(quotedPatterns(readFileSync(win2ConfigPath, "utf8"))).toContain("packages/omo-senpi/**")
  })

  test("#given measured package groups #when the matrix command is rendered #then native file sharding is not used", () => {
    const job = rootTestJob()

    expect(job).not.toContain("--shard=")
    expect(job).not.toContain("--path-ignore-patterns=")
    expect(job).not.toContain("format('-c {0}'")
    expect(job).not.toContain("bun test -c")
  })

  test("#given Windows hook tests read process platform #when root tests run #then bun is not launched under Git Bash", () => {
    const job = rootTestJob()
    const runBlock = job.slice(job.indexOf("      - name: Run tests"))

    expect(runBlock).toContain("if: needs.ci-mode.outputs.run_heavy == 'true' && runner.os != 'Windows'")
    expect(runBlock).toContain("if: needs.ci-mode.outputs.run_heavy == 'true' && matrix.shard == '1/2'")
    expect(runBlock).toContain("if: needs.ci-mode.outputs.run_heavy == 'true' && matrix.shard == '2/2'")
    expect(runBlock).not.toContain("shell: bash\n        run: |")
    expect(job).toContain("timeout-minutes: ${{ matrix.os == 'windows-latest' && 60 || 30 }}")
  })

  test("#given Windows cache restore costs more than install #when the root matrix runs #then only non-Windows jobs restore Bun cache", () => {
    const job = rootTestJob()
    const cacheStart = job.indexOf("      - uses: actions/cache@v5")
    const cacheEnd = job.indexOf("      - name: Install dependencies", cacheStart)
    const cacheStep = job.slice(cacheStart, cacheEnd)

    expect(cacheStep).toContain("if: runner.os != 'Windows' && needs.ci-mode.outputs.run_heavy == 'true'")
  })
})
