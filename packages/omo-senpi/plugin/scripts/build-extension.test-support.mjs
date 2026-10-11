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
    toolkitSdkOutputPath: join(root, "runtime", "agent-toolkit-sdk", "sdk.js"),
    rollbackRuntimeOutputPath: join(root, "runtime", "rollback-migrate.js"),
    memoryDoctorOutputPath: join(root, "omo-memory-doctor.js"),
    memoryMemfsOutputPath: join(root, "omo-memory-memfs.js"),
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
 */
export function createBuildFixture(build = buildExtension) {
  const perTestRoots = []
  let sharedBuildPromise = null
  let sharedRoot
  async function sharedOutputs() {
    sharedBuildPromise ??= (async () => {
      const root = await mkdtemp(join(tmpdir(), "omo-senpi-extension-test-shared-"))
      sharedRoot = root
      const paths = outputPathsIn(root)
      const outputs = await build(paths)
      return { root, ...paths, ...outputs }
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
  return {
    perTestRoots,
    sharedOutputs,
    mutableOutputs,
    cleanupTest: async () => {
      await Promise.all(perTestRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    },
    cleanupFile: async () => {
      if (sharedBuildPromise === null) return
      try {
        await sharedBuildPromise
      } finally {
        if (sharedRoot !== undefined) await rm(sharedRoot, { recursive: true, force: true })
      }
    },
  }
}
