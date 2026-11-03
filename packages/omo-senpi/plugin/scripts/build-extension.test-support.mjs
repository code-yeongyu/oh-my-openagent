import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildExtension } from "./build-extension.mjs"

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
    rollbackRuntimeOutputPath: join(root, "runtime", "rollback-migrate.js"),
    memoryDoctorOutputPath: join(root, "omo-memory-doctor.js"),
    memoryMemfsOutputPath: join(root, "omo-memory-memfs.js"),
    memoryPalaceOutputPath: join(root, "omo-memory-palace.js"),
    deviceAccountOutputPath: join(root, "omo-device-account.js"),
    memoryCommandsOutputPath: join(root, "omo-memory-commands.js"),
    sessionHistoryOutputPath: join(root, "omo-session-history.js"),
    recallStoreOutputPath: join(root, "omo-recall-store.js"),
    telemetryPosthogOutputPath: join(root, "omo-telemetry-posthog.js"),
    telemetryOtlpOutputPath: join(root, "omo-telemetry-otlp.js"),
    memorySyncOutputPath: join(root, "omo-memory-sync.js"),
    threadClientOutputPath: join(root, "omo-thread-client.js"),
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
export function createBuildFixture() {
  const perTestRoots = []
  let sharedBuildPromise = null
  let reproductionPromise = null
  async function sharedOutputs() {
    sharedBuildPromise ??= (async () => {
      const root = await mkdtemp(join(tmpdir(), "omo-senpi-extension-test-shared-"))
      const paths = outputPathsIn(root)
      const build = await buildExtension(paths)
      return { root, ...paths, ...build }
    })()
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
      await buildExtension(outputPathsIn(root))
      return root
    })()
    return reproductionPromise
  }
  return {
    perTestRoots,
    sharedOutputs,
    mutableOutputs,
    reproductionRoot,
    cleanupTest: async () => {
      await Promise.all(perTestRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    },
    cleanupFile: async () => {
      const roots = await Promise.all([
        sharedBuildPromise === null ? undefined : sharedBuildPromise.then((shared) => shared.root),
        reproductionPromise,
      ])
      await Promise.all(roots.filter((root) => root != null).map((root) => rm(root, { recursive: true, force: true })))
    },
  }
}
