import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"

const workflowPath = new URL("../.github/workflows/windows-flake-soak.yml", import.meta.url)
const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : ""
const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)
const ciWorkflow = existsSync(ciWorkflowPath) ? readFileSync(ciWorkflowPath, "utf8") : ""
const unsupportedTargetFixture = "bun-test-from-user-input"

const expectedTargets = [
  {
    name: "reconciliation",
    arguments: [
      '@("test", "packages/omo-senpi/src/components/memory/worker/run-reconciliation.test.ts")',
    ],
  },
  {
    name: "hooks-state",
    arguments: ['@("test", "script/senpi-hooks-state.test.ts")'],
  },
  {
    name: "mailbox",
    arguments: ['@("test", "packages/omo-senpi/src/components/thread/mailbox.test.ts")'],
  },
  {
    name: "team-message",
    arguments: [
      '@("test", "packages/omo-opencode/src/features/team-mode/tools/messaging.test.ts")',
    ],
  },
  {
    name: "memory-supervisor",
    arguments: [
      '@("test", "packages/omo-senpi/src/components/memory/worker/memory-run-supervisor.integration.test.ts")',
    ],
  },
  {
    name: "facts-lock",
    arguments: [
      '@("test", "packages/memory-core/src/locks", "packages/omo-senpi/src/components/memory/commands/facts.test.ts")',
    ],
  },
  {
    name: "reply-listener",
    arguments: [
      '@("test", "packages/openclaw-core/src/__tests__/reply-listener-startup.test.ts")',
    ],
  },
  {
    name: "dag-race",
    arguments: ['@("test", "packages/senpi-task/src/dag")'],
  },
  {
    name: "memfs-restore",
    arguments: [
      '@("test", "packages/omo-senpi/src/components/memory/commands/memfs-extra.test.ts")',
    ],
  },
  {
    name: "senpi-overflow",
    arguments: [] as readonly string[],
  },
  {
    name: "full-shard-2",
    arguments: [
      '@("test", "packages/senpi-task/src/runners/rpc-process.windows.test.ts", "packages/senpi-task/src/__adversarial__/chaos-bench.test.ts", "packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts", "script/codex-installer-version.test.ts", "packages/shared-skills/provenance-gate.test.ts", "packages/omo-codex/src/install/install-codex-mcp-manifest.test.ts", "packages/senpi-task/src/dag/scheduler.test.ts", "packages/omo-native/test/payload.test.ts", "script/build-omo-binary.test.ts")',
      '@("--config=bunfig.win2.parallel.toml", "test", "--parallel")',
    ],
  },
] as const

function assertTargetAllowlisted(source: string, target: string): void {
  if (!source.includes(`        - ${target}`) || !source.includes(`"${target}" = @(`)) {
    throw new Error("windows soak target is not allowlisted")
  }
}

function soakStepSection(source: string): string {
  const start = source.indexOf("      - name: Run allowlisted target repeatedly")
  const end = source.indexOf("      - name: Upload Windows soak telemetry", start)
  if (start < 0 || end < 0) throw new Error("windows soak step not found")
  return source.slice(start, end)
}

function soakStep(source: string): string {
  const step = soakStepSection(source)
  const runStart = step.indexOf("        run: |\n")
  if (runStart < 0) throw new Error("windows soak run block not found")
  return step.slice(runStart)
}

function rootTestJob(source: string): string {
  const start = source.indexOf("  test:\n")
  const end = source.indexOf("\n  typecheck:", start)
  if (start < 0 || end < 0) throw new Error("root test job not found")
  return source.slice(start, end)
}

function windowsShardTwoStep(source: string): string {
  const job = rootTestJob(source)
  const condition =
    "runner.os == 'Windows' && matrix.shard == '2/2'"
  const start = job.indexOf(condition)
  const end = job.indexOf("      - name: Upload Windows post-test telemetry", start)
  if (start < 0 || end < 0) throw new Error("Windows shard-2 test step not found")
  return job.slice(start, end)
}

function fullShardTwoTarget(source: string): string {
  const step = soakStep(source)
  const start = step.indexOf('"full-shard-2" = @(')
  const end = step.indexOf("\n          }\n\n          $target", start)
  if (start < 0 || end < 0) throw new Error("full-shard-2 target not found")
  return step.slice(start, end)
}

function testArgumentLists(source: string): readonly string[] {
  return [...source.matchAll(/-TestArguments (@\([^\n]+\))/g)].map(
    (match) => match[1] ?? "",
  )
}

function targetArgumentLists(source: string): readonly string[] {
  return [...source.matchAll(/Arguments = \[string\[\]\](@\([^\n]+\))/g)].map(
    (match) => match[1] ?? "",
  )
}

function expectInOrder(source: string, tokens: readonly string[]): void {
  let previous = -1
  for (const token of tokens) {
    const current = source.indexOf(token)
    expect(current, `missing ordered workflow token: ${token}`).toBeGreaterThan(previous)
    previous = current
  }
}

describe("Windows flake soak workflow", () => {
  test("#given an unsupported target fixture #when the allowlist is checked #then the target is rejected", () => {
    expect(() => assertTargetAllowlisted(workflow, unsupportedTargetFixture)).toThrow(
      "windows soak target is not allowlisted",
    )
  })

  test("#given intended flaky surfaces #when the allowlist is checked #then every target is predeclared", () => {
    for (const target of expectedTargets) {
      assertTargetAllowlisted(workflow, target.name)
    }
  })

  test("#given a manually dispatched soak #when triggers are inspected #then no automatic event is registered", () => {
    const triggerStart = workflow.indexOf("on:\n")
    const triggerEnd = workflow.indexOf("\npermissions:", triggerStart)
    const trigger = workflow.slice(triggerStart, triggerEnd)

    expect(trigger).toContain("workflow_dispatch:")
    expect(trigger).not.toContain("push:")
    expect(trigger).not.toContain("pull_request:")
  })

  test("#given a repaired workflow ref #when another commit is soaked #then checkout targets the requested test ref", () => {
    expect(workflow).toContain("test_ref:")
    expect(workflow).toContain("ref: ${{ inputs.test_ref || github.ref }}")
  })

  test("#given target and iteration inputs #when the job starts #then both boundaries are validated", () => {
    const step = soakStep(workflow)

    expect(workflow).toContain("runs-on: windows-latest")
    expect(workflow).toContain("type: choice")
    expect(workflow).toContain("type: number")
    expect(step).toContain("$targets.ContainsKey($target)")
    expect(step).toContain('Write-Error "windows soak target is not allowlisted"')
    expect(step).toContain("[int]::TryParse($env:SOAK_ITERATIONS, [ref]$iterationCount)")
    expect(step).toContain("$iterationCount -lt 1 -or $iterationCount -gt 50")
  })

  test("#given an allowlisted target #when commands are resolved #then only fixed Bun arguments are selected", () => {
    const step = soakStep(workflow)

    for (const target of expectedTargets) {
      for (const args of target.arguments) {
        expect(step).toContain(args)
      }
    }
    expect(step).toContain('$target -eq "senpi-overflow"')
    expect(step).toContain("target not yet implemented: senpi-overflow")
    expect(step).toContain("-TestArguments $phase.Arguments")
    expect(step).not.toContain("${{ inputs.target }}")
    expect(step).not.toContain("Invoke-Expression")
    expect(step).not.toContain("cmd /c")
    expect(step).not.toContain("powershell -Command")
  })

  test("#given multiple iterations #when a selected command runs #then arguments stay unchanged and the first failure stops", () => {
    const step = soakStep(workflow)

    expect(step).toContain("$phases = @($targets[$target])")
    expect(step).toContain(
      "for ($iteration = 1; $iteration -le $iterationCount; $iteration++)",
    )
    expect(step).toContain("& .github/scripts/windows-ci-telemetry.ps1")
    expect(step).toContain("failed at iteration $iteration")
    expect(step).toContain("exit $iterationExitCode")
    expect(step).not.toContain("timeout")
    expect(step).not.toContain("$phase.Arguments +")
  })

  test("#given completed and failing iterations #when the summary renders #then step outputs report the true indices", () => {
    const step = soakStep(workflow)
    const summaryStart = workflow.indexOf("      - name: Write job summary")
    const summary = workflow.slice(summaryStart)

    expect(workflow).toContain("id: run-soak")
    expect(step).toContain(
      '"iterations_ran=$iteration" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append',
    )
    expect(step).toContain(
      '"failed_iteration=$iteration" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append',
    )
    expect(summary).toContain(
      "- Iterations actually run: `${{ steps.run-soak.outputs.iterations_ran || '0' }}`.",
    )
    expect(summary).toContain(
      "- Failed iteration: `${{ steps.run-soak.outputs.failed_iteration || 'none' }}`.",
    )
    expect(summary).not.toContain("- Iterations actually run: `$SOAK_ITERATIONS_RAN`.")
    expect(summary).not.toContain("- Failed iteration: `$SOAK_FAILED_ITERATION`.")
    expect(summary).not.toContain("SOAK_ITERATIONS_RAN:")
    expect(summary).not.toContain("SOAK_FAILED_ITERATION:")
    expect(summary).not.toContain("SOAK_ITERATIONS_RAN: ${{ env.SOAK_ITERATIONS_RAN }}")
    expect(summary).not.toContain("SOAK_FAILED_ITERATION: ${{ env.SOAK_FAILED_ITERATION }}")
  })

  test("#given the real Windows shard-2 job #when full-shard-2 is soaked #then setup and test commands stay equivalent", () => {
    const ciJob = rootTestJob(ciWorkflow)
    const ciShard = windowsShardTwoStep(ciWorkflow)
    const soak = workflow
    const soakShard = fullShardTwoTarget(workflow)
    const preparation = [
      "uses: actions/checkout@v7",
      "uses: actions/setup-node@v7",
      'node-version: "24"',
      "uses: oven-sh/setup-bun@v2",
      'bun-version: "1.4.0"',
      "name: Install dependencies",
      "run: bun install --frozen-lockfile",
      "name: Remove stale self-package test copies",
      "run: bun run script/remove-stale-self-package-tests.ts",
      "name: Run vendored lsp-daemon tests",
      "run: npm test",
      "working-directory: packages/lsp-daemon",
    ] as const

    expectInOrder(ciJob, preparation)
    expectInOrder(soak, preparation)
    expect(ciShard).toContain("shell: pwsh")
    expect(soakStepSection(workflow)).toContain("shell: pwsh")
    expect(ciShard).toContain("WINDOWS_TEST_SHARD: ${{ matrix.shard }}")
    expect(soakStepSection(workflow)).toContain(
      "WINDOWS_TEST_SHARD: ${{ inputs.target == 'full-shard-2' && '2/2' || 'flake-soak' }}",
    )
    expect(targetArgumentLists(soakShard)).toEqual(testArgumentLists(ciShard))
    expect(soakShard.indexOf('Phase = "quarantine"')).toBeLessThan(
      soakShard.indexOf('Phase = "remainder"'),
    )
    expect(soakStep(workflow)).toContain(
      '$ciWorkflow = Get-Content -Path ".github/workflows/ci.yml" -Raw',
    )
    expect(soakStep(workflow)).toContain(
      '$serialRemainder = \'-TestArguments @("--config=bunfig.win2.parallel.toml", "test")\'',
    )
    expect(soakStep(workflow)).toContain(
      '$parallelRemainder = \'-TestArguments @("--config=bunfig.win2.parallel.toml", "test", "--parallel")\'',
    )
    expect(soakStep(workflow)).toContain(
      '$targets[$target][1].Arguments = [string[]]@("--config=bunfig.win2.parallel.toml", "test")',
    )
    expect(soakStep(workflow)).toContain(
      'Write-Error "checked-out ci.yml has an unsupported Windows shard-2 remainder command"',
    )
  })

  test("#given any job outcome #when the soak finishes #then telemetry artifacts always upload", () => {
    const uploadStart = workflow.indexOf("      - name: Upload Windows soak telemetry")
    const upload = workflow.slice(uploadStart)

    expect(upload).toContain("if: always()")
    expect(upload).toContain("uses: actions/upload-artifact@v4")
    expect(upload).toContain("${{ github.run_id }}-${{ github.run_attempt }}")
    expect(upload).toContain("if-no-files-found: warn")
  })
})
