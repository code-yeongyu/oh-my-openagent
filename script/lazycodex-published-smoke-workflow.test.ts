/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)

describe("published LazyCodex smoke workflow", () => {
  test("runs published lazycodex-ai smoke commands from a clean external directory", () => {
    // #given
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const hasSmokeJob = workflow.includes("lazycodex-published-smoke:")
    const smokeIsNonBlocking = workflow.includes("lazycodex-published-smoke:") &&
      workflow.includes("continue-on-error: true")
    const hasExternalSmokeDir = workflow.includes("SMOKE_DIR=$(mktemp -d)") &&
      workflow.includes('cd "$SMOKE_DIR/cwd"')
    const isolatesCodexState =
      workflow.includes("HOME: ${{ runner.temp }}/lazycodex-published-smoke/home") &&
      workflow.includes("CODEX_HOME: ${{ runner.temp }}/lazycodex-published-smoke/codex") &&
      workflow.includes("CODEX_LOCAL_BIN_DIR: ${{ runner.temp }}/lazycodex-published-smoke/bin")
    const runsNpxInstallSmoke = workflow.includes(
      "npx -y lazycodex-ai@latest --dry-run install --no-tui --codex-autonomous",
    )
    const runsNpxDoctorSmoke = workflow.includes(
      "npx -y lazycodex-ai@latest --dry-run doctor",
    )
    const warnsOnInstallMismatch = workflow.includes("::warning::lazycodex-ai install dry-run output changed:")
    const warnsOnDoctorMismatch = workflow.includes("::warning::lazycodex-ai doctor dry-run output changed:")
    const doctorWarningExpectsCodexExec = workflow.includes('[[ "$npx_doctor_output" != codex\\ exec\\ * ]]') &&
      workflow.includes('[[ "$npx_doctor_output" != *"--sandbox danger-full-access"* ]]') &&
      workflow.includes("Use $omo:lcx-doctor") &&
      workflow.includes('[[ "$npx_doctor_output" == *"--model"* ]]') &&
      workflow.includes('[[ "$npx_doctor_output" == *"gpt-5.5-codex-mini"* ]]')
    const removedStrictInstallGate = !workflow.includes(
      'test "$npx_install_output" = "npx --yes --package oh-my-openagent omo install --platform=codex --no-tui --codex-autonomous"',
    )
    const expectsWindowsSafeInstallShape = workflow.includes(
      '"npx --yes oh-my-openagent@latest install --platform=codex --no-tui --codex-autonomous"',
    )
    const rejectsLegacyInstallShape = !workflow.includes(
      '"npx --yes --package oh-my-openagent omo install --platform=codex --no-tui --codex-autonomous"',
    )
    const removedStrictDoctorGate = !workflow.includes(
      'test "$npx_doctor_output" = "npx --yes --package oh-my-openagent omo doctor"',
) && !workflow.includes('[ "$npx_doctor_output" != "npx --yes --package oh-my-openagent omo doctor" ]')
    const keepsDoctorAsCodexWorkflow = workflow.includes('[[ "$npx_doctor_output" != codex\\ exec\\ * ]]') &&
      workflow.includes("Use $omo:lcx-doctor") &&
      workflow.includes('[[ "$npx_doctor_output" == *"--model"* ]]')

    // #then
    expect(hasSmokeJob, "CI must expose a published LazyCodex registry smoke job").toBe(true)
    expect(smokeIsNonBlocking, "published lazycodex smoke must not block CI before the next alias release reaches npm latest").toBe(true)
    expect(hasExternalSmokeDir, "published lazycodex smoke must run from an external temp directory").toBe(true)
    expect(isolatesCodexState, "published lazycodex smoke must isolate HOME and Codex install paths").toBe(true)
    expect(runsNpxInstallSmoke, "publish workflow must run npx lazycodex-ai install smoke from npm").toBe(true)
    expect(runsNpxDoctorSmoke, "publish workflow must run npx lazycodex-ai doctor smoke from npm").toBe(true)
    expect(warnsOnInstallMismatch, "publish workflow must warn instead of failing when lazycodex install output changes").toBe(true)
    expect(warnsOnDoctorMismatch, "publish workflow must warn instead of failing when lazycodex doctor output changes").toBe(true)
    expect(doctorWarningExpectsCodexExec, "published doctor smoke must expect the Codex doctor workflow and reject forced models").toBe(true)
    expect(removedStrictInstallGate, "publish workflow must not use the strict lazycodex install equality gate").toBe(true)
    expect(expectsWindowsSafeInstallShape, "published smoke must expect the Windows-safe direct package install command").toBe(true)
    expect(rejectsLegacyInstallShape, "published smoke must not expect the Windows-broken --package omo install command").toBe(true)
    expect(removedStrictDoctorGate, "publish workflow must not use the strict lazycodex doctor equality gate").toBe(true)
    expect(keepsDoctorAsCodexWorkflow, "published smoke must keep doctor routed through the Codex workflow").toBe(true)
  })
})
