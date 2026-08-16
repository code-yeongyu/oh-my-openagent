import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "bun:test"

import type { RpcRunnerSpec } from "@oh-my-opencode/senpi-task"
import { createRpcModelAdmission } from "@oh-my-opencode/senpi-task/rpc-model-admission"
import { buildRpcModelCatalogSpawn } from "@oh-my-opencode/senpi-task/rpc-spawn"

const agentDirs: string[] = []
const mockProviderExtension = fileURLToPath(
  new URL("../../../scripts/qa/mock-provider/index.ts", import.meta.url),
)

// Snapshot at module load, before any test in this process can mutate process.env:
// other suites prepend fixture bin dirs to PATH (and leaked async cleanup can do it
// mid-test), and a poisoned PATH changes which senpi launcher the probe resolves.
const moduleLoadEnv: NodeJS.ProcessEnv = { ...process.env }

function createAdmission() {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-task-rpc-model-profile-"))
  agentDirs.push(agentDir)
  const parentEnv = {
    ...moduleLoadEnv,
    OMO_DISABLE_POSTHOG: "true",
    OMO_CODING_AGENT_DIR: agentDir,
    SENPI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
  }
  return createRpcModelAdmission({
    buildSpawn: (spec) => buildRpcModelCatalogSpawn(spec, { parentEnv }),
  })
}

function makeSpec(extensions: readonly string[]): RpcRunnerSpec {
  return {
    task_id: "st_model_profile",
    cwd: process.cwd(),
    state_dir: agentDirs.at(-1) ?? process.cwd(),
    prompt: "credential-free model admission",
    model: "omo-mock/mock-1",
    extensions,
  }
}

afterEach(() => {
  for (const agentDir of agentDirs.splice(0)) {
    rmSync(agentDir, { recursive: true, force: true })
  }
})

describe("task RPC launch profile parity", () => {
  test("#given an explicit provider extension #when process model admission runs #then its model is visible without credentials", async () => {
    // given
    const admit = createAdmission()

    // when
    const admission = admit(makeSpec([mockProviderExtension]))

    // then: await directly so a rejection surfaces the RunnerError message (which
    // carries the probe's stderr tail) instead of an opaque "promise rejected".
    expect(await admission).toBeUndefined()
  }, 30_000)

  test("#given a model known only through parent resources #when its provider extension is not forwarded #then admission rejects before launch", async () => {
    // given
    const admit = createAdmission()

    // when
    const admission = admit(makeSpec([]))

    // then
    await expect(admission).rejects.toMatchObject({
      failure: {
        kind: "model_unavailable",
        message: expect.stringContaining("omo-mock/mock-1"),
      },
    })
  }, 30_000)
})
