import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "bun:test"

import type { RpcRunnerSpec } from "@oh-my-opencode/senpi-task"
import { createRpcModelAdmission, PROBE_TIMEOUT_MS } from "@oh-my-opencode/senpi-task/rpc-model-admission"
import { buildRpcModelCatalogSpawn, type RpcSpawnDescriptor } from "@oh-my-opencode/senpi-task/rpc-spawn"

/**
 * Admission can spend three full catalog probes worst case: a timed-out probe is re-probed once
 * (a timeout is inconclusive, not absence), and a first exit-0 listing that omits the requested
 * model. Keep the test deadline derived from the production budget, with 20s for termination and
 * runner overhead. The confirming probe deliberately keeps the full probe budget: it decides a
 * rejection, so starving it would time out on exactly the slow-but-complete listings this path must
 * admit.
 */
const ADMISSION_TEST_TIMEOUT_MS = PROBE_TIMEOUT_MS * 3 + 20_000

const agentDirs: string[] = []
const mockProviderExtension = fileURLToPath(
  new URL("../../../scripts/qa/mock-provider/index.ts", import.meta.url),
)
// Snapshot at module load, before any test in this process can mutate process.env:
// other suites prepend fixture bin dirs to PATH, and a poisoned PATH changes
// which Senpi launcher the probe resolves.
const moduleLoadEnv: NodeJS.ProcessEnv = { ...process.env }
const senpiPackageDir = dirname(createRequire(import.meta.url).resolve("@code-yeongyu/senpi/package.json"))
const senpiRpcEntry = join(senpiPackageDir, "dist", "rpc-entry.js")

function buildPinnedCatalogSpawn(spec: RpcRunnerSpec, parentEnv: NodeJS.ProcessEnv): RpcSpawnDescriptor {
  return buildRpcModelCatalogSpawn(spec, {
    parentEnv,
    resolveSenpiExecutable: () => null,
    resolveRpcEntry: () => senpiRpcEntry,
  })
}

function createAdmission() {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-task-rpc-model-profile-"))
  agentDirs.push(agentDir)
  const parentEnv = {
    ...moduleLoadEnv,
    HOME: agentDir,
    USERPROFILE: agentDir,
    TERM: "dumb",
    OMO_DISABLE_POSTHOG: "true",
    OMO_CODING_AGENT_DIR: agentDir,
    SENPI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
    XDG_DATA_HOME: join(agentDir, "xdg-data"),
    XDG_CACHE_HOME: join(agentDir, "xdg-cache"),
    XDG_CONFIG_HOME: join(agentDir, "xdg-config"),
    XDG_STATE_HOME: join(agentDir, "xdg-state"),
  }
  return createRpcModelAdmission({
    buildSpawn: (spec) => buildPinnedCatalogSpawn(spec, parentEnv),
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
  test("#given ambient PATH resolves a foreign senpi #when the catalog spawn is built #then it pins the package-local CLI", () => {
    // given
    const spec = makeSpec([mockProviderExtension])

    // when
    const descriptor = buildPinnedCatalogSpawn(spec, {
      ...moduleLoadEnv,
      PATH: join(tmpdir(), "foreign-senpi-bin"),
    })

    // then
    expect(descriptor.command).toBe(process.execPath)
    expect(descriptor.args[0]).toBe(join(senpiPackageDir, "dist", "cli.js"))
  })

  test("#given an explicit provider extension #when process model admission runs #then its model is visible without credentials", async () => {
    // given
    const admit = createAdmission()

    // when
    const admission = admit(makeSpec([mockProviderExtension]))

    // then
    expect(await admission).toBeUndefined()
  }, { timeout: ADMISSION_TEST_TIMEOUT_MS })

  test("#given a model known only through parent resources #when its provider extension is not forwarded #then admission rejects before launch", async () => {
    // given
    const admit = createAdmission()

    // when
    const admission = admit(makeSpec([]))

    // then
    await expect(admission).rejects.toMatchObject({
      failure: {
        kind: "model_unavailable",
        message: expect.stringMatching(/omo-mock\/mock-1.*probed catalog has/),
      },
    })
  }, { timeout: ADMISSION_TEST_TIMEOUT_MS })
})
