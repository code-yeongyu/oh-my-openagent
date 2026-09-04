import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"

const workflowPath = new URL("../.github/workflows/windows-flake-soak.yml", import.meta.url)
const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : ""
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

function soakStep(source: string): string {
  const start = source.indexOf("      - name: Run allowlisted target repeatedly")
  const end = source.indexOf("      - name: Upload Windows soak telemetry", start)
  if (start < 0 || end < 0) throw new Error("windows soak step not found")
  const step = source.slice(start, end)
  const runStart = step.indexOf("        run: |\n")
  if (runStart < 0) throw new Error("windows soak run block not found")
  return step.slice(runStart)
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

  test("#given any job outcome #when the soak finishes #then telemetry artifacts always upload", () => {
    const uploadStart = workflow.indexOf("      - name: Upload Windows soak telemetry")
    const upload = workflow.slice(uploadStart)

    expect(upload).toContain("if: always()")
    expect(upload).toContain("uses: actions/upload-artifact@v4")
    expect(upload).toContain("${{ github.run_id }}-${{ github.run_attempt }}")
    expect(upload).toContain("if-no-files-found: warn")
  })
})
