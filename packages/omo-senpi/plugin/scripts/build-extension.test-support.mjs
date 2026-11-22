import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildExtension } from "./build-extension.mjs"
import { childTreeCpuSeconds } from "../../../omo-native/test/daemon-test-runner.ts"

export function outputPathsIn(root) {
  return {
    outputPath: join(root, "omo.js"),
    taskOutputPath: join(root, "omo-task.js"),
    memberOutputPath: join(root, "omo-member.js"),
    supervisorOutputPath: join(root, "memory-run-supervisor.mjs"),
    advisorRuntimeOutputPath: join(root, "omo-init-deep-advisor.js"),
    sidePanelRuntimeOutputPath: join(root, "omo-side-panel.js"),
    onboardingScanRuntimeOutputPath: join(root, "omo-onboarding-scan.js"),
    toolkitSdkOutputPath: join(root, "runtime", "agent-toolkit-sdk", "sdk.js"),
    bunshinTsOutputPath: join(root, "runtime", "bunshin-ts", "sdk.js"),
    omoSdkOutputPath: join(root, "runtime", "omo-sdk", "sdk.js"),
    rollbackRuntimeOutputPath: join(root, "runtime", "rollback-migrate.js"),
    memoryDoctorOutputPath: join(root, "omo-memory-doctor.js"),
    memoryMemfsOutputPath: join(root, "omo-memory-memfs.js"),
    memoryPalaceOutputPath: join(root, "omo-memory-palace.js"),
    deviceAccountOutputPath: join(root, "omo-device-account.js"),
    memoryCommandsOutputPath: join(root, "omo-memory-commands.js"),
    sessionHistoryOutputPath: join(root, "omo-session-history.js"),
    recallStoreOutputPath: join(root, "omo-recall-store.js"),
    deviceServiceOutputPath: join(root, "omo-device-service.js"),
    telemetryPosthogOutputPath: join(root, "omo-telemetry-posthog.js"),
    telemetryOtlpOutputPath: join(root, "omo-telemetry-otlp.js"),
    memorySyncOutputPath: join(root, "omo-memory-sync.js"),
    threadClientOutputPath: join(root, "omo-thread-client.js"),
    wakeOutputPath: join(root, "omo-wake.js"),
    telemetryRecoveryOutputPath: join(root, "omo-telemetry-recovery.js"),
    feedbackOutputPath: join(root, "omo-feedback.js"),
    desktopToolkitOutputPath: join(root, "omo-desktop-toolkit.js"),
    claimReceiptOutputPath: join(root, "omo-claim-receipt.js"),
    computerUseOutputPath: join(root, "omo-computer-use.js"),
    gatewayStoreWorkerOutputPath: join(root, "gateway-store-worker.mjs"),
    threadSdkOutputPath: join(root, "runtime", "thread-sdk", "sdk.js"),
  }
}

/**
 * The esbuild pass dominates a build test file, so each file builds once and every read-only
 * assertion shares it. Cases that mutate an artifact copy the built tree instead of rebuilding,
 * which keeps them isolated for a fraction of the cost. `cleanupTest` / `cleanupFile` belong in
 * the file's `afterEach` / `afterAll`.
 *
 * `reproductionRoot` is a second, independent build of the same sources, made once per file, that
 * freshness checks compare against (`checkExtensionCurrent({ ...outputs, expectedRoot })`) instead
 * of each check rebuilding its own reproduction. It stays a separate build so the comparison still
 * proves the build reproduces its outputs.
 */
/**
 * #13965: a cold extension build is setup, not the behaviour under test, and its wall time depends on the box's load
 * (one build: 367.7 s at 4.2x CPU oversubscription, 1023.5 s at 8x, against ~30 s on a quiet receipt runner). No wall
 * clock bounds it. It fails only on:
 * - a stall: its process tree used no CPU and its output directory did not change for BUILD_STALL_MS (a hang). The
 *   longest such gap measured in a healthy 8x build was ~3 s; the window is 10x that.
 * - a runaway: its process tree used more than BUILD_CPU_CAP_S CPU seconds, about 3x the 126 s one build used at 8x.
 */
export const BUILD_STALL_MS = 30_000
export const BUILD_CPU_CAP_S = 380
/**
 * Outer bound for the hook that runs the cold builds: the longest CI job that runs these files (senpi-compatibility,
 * 100 min) minus a margin. It is not the correctness check; the stall and CPU guards above are.
 */
export const BUILD_HOOK_OUTER_BOUND_MS = 95 * 60_000
const PROGRESS_SAMPLE_MS = 250
const PROGRESS_EPSILON_S = 0.02

async function outputFingerprint(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  let fingerprint = entries.length
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const info = await stat(join(entry.parentPath, entry.name)).catch(() => undefined)
    if (info !== undefined) fingerprint += info.size + info.mtimeMs
  }
  return fingerprint
}

export function boundBuildProgress(name, root, work, { stallMs = BUILD_STALL_MS, cpuCapS = BUILD_CPU_CAP_S } = {}) {
  return new Promise((resolve, reject) => {
    const startCpu = childTreeCpuSeconds(process.pid)
    let lastCpu = startCpu
    let lastOutput = -1
    let lastAdvance = Date.now()
    let sampling = false
    const sampler = setInterval(async () => {
      if (sampling) return
      sampling = true
      const cpu = childTreeCpuSeconds(process.pid)
      const output = await outputFingerprint(root)
      sampling = false
      const now = Date.now()
      if (cpu >= lastCpu + PROGRESS_EPSILON_S || output !== lastOutput) lastAdvance = now
      if (cpu >= 0) lastCpu = cpu
      lastOutput = output
      const usedCpuS = lastCpu - startCpu
      if (usedCpuS > cpuCapS) {
        settle(() => reject(new Error(`${name} ran away: used ${Math.round(usedCpuS)} CPU seconds (cap ${cpuCapS})`)))
      } else if (now - lastAdvance >= stallMs) {
        const stalledS = Math.round((now - lastAdvance) / 1000)
        settle(() => reject(new Error(`${name} stalled: no CPU or output progress for ${stalledS}s (a hang)`)))
      }
    }, PROGRESS_SAMPLE_MS)
    let settled = false
    function settle(finish) {
      if (settled) return
      settled = true
      clearInterval(sampler)
      finish()
    }
    work.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    )
  })
}

export function createBuildFixture({ build = buildExtension } = {}) {
  const perTestRoots = []
  let sharedBuildPromise = null
  let reproductionPromise = null
  // #13965: a build that rejects (its test timed out and the runner killed the shared minifier) must not be
  // cached, or every later case in the file fails on the same rejection in under a millisecond.
  async function sharedOutputs() {
    sharedBuildPromise ??= (async () => {
      const root = await mkdtemp(join(tmpdir(), "omo-senpi-extension-test-shared-"))
      const paths = outputPathsIn(root)
      try {
        return { root, ...paths, ...(await boundBuildProgress("shared extension build", root, build(paths))) }
      } catch (error) {
        await rm(root, { recursive: true, force: true })
        throw error
      }
    })().catch((error) => {
      sharedBuildPromise = null
      throw error
    })
    return sharedBuildPromise
  }
  async function mutableOutputs() {
    const shared = await sharedOutputs()
    const root = await mkdtemp(join(tmpdir(), "omo-senpi-extension-test-"))
    perTestRoots.push(root)
    await cp(shared.root, root, { recursive: true })
    return { root, ...outputPathsIn(root), mainInputs: shared.mainInputs, taskInputs: shared.taskInputs }
  }
  async function reproductionRoot() {
    reproductionPromise ??= (async () => {
      const root = await mkdtemp(join(tmpdir(), "omo-senpi-extension-test-reproduction-"))
      try {
        await boundBuildProgress("reproduction extension build", root, build(outputPathsIn(root)))
        return root
      } catch (error) {
        await rm(root, { recursive: true, force: true })
        throw error
      }
    })().catch((error) => {
      reproductionPromise = null
      throw error
    })
    return reproductionPromise
  }
  // Run in the file's beforeAll with no hook timeout: the builds are bounded by CPU progress, not a wall clock.
  async function warmBuilds({ reproduction = true } = {}) {
    await sharedOutputs()
    if (reproduction) await reproductionRoot()
  }
  return {
    perTestRoots,
    warmBuilds,
    sharedOutputs,
    mutableOutputs,
    reproductionRoot,
    cleanupTest: async () => {
      await Promise.all(perTestRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    },
    cleanupFile: async () => {
      const roots = await Promise.all([
        sharedBuildPromise?.then((shared) => shared.root).catch(() => undefined),
        reproductionPromise?.catch(() => undefined),
      ])
      await Promise.all(roots.filter((root) => root != null).map((root) => rm(root, { recursive: true, force: true })))
    },
  }
}
