import { spawn } from "node:child_process"
import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { killGroup, watchTreeProgress } from "../../../omo-native/test/daemon-test-runner.ts"

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
const BUILD_STALL_MS = 30_000
const BUILD_CPU_CAP_S = 380
/**
 * Outer bound for the hook that runs the cold builds. It is not the correctness check; the stall and CPU guards above
 * are. In a GitHub Actions job it is half that job's limit on this platform (ci.yml: senpi-tests-linux 18 min, the
 * macOS Senpi step 20 min, the Windows Senpi step 75 min), so a broken guard fails here, naming the hook, instead of
 * the job being cancelled; the other half covers checkout, install and the earlier tests. A healthy hook there builds
 * twice at roughly 30 s each. Outside Actions (receipt containers, a developer box) no job limit applies, and the
 * bound has to clear the slowest healthy hook measured: 3263 s for both cold builds at 8x CPU oversubscription, which
 * 95 min clears by 1.75x.
 */
const CI_JOB_LIMIT_MIN = { linux: 18, darwin: 20, win32: 75 }
const OFF_ACTIONS_BOUND_MIN = 95
export const BUILD_HOOK_OUTER_BOUND_MS =
  (process.env["GITHUB_ACTIONS"] === "true"
    ? (CI_JOB_LIMIT_MIN[process.platform] ?? CI_JOB_LIMIT_MIN.linux) / 2
    : OFF_ACTIONS_BOUND_MIN) * 60_000
const OUTPUT_SAMPLE_MS = 250
const STDERR_TAIL_CHARS = 2_000
const DEFAULT_BUILD_MODULE = new URL("./build-extension.mjs", import.meta.url).href

// The build runs in its own node process: buildExtension runs every bundler step through spawnSync, which blocks the
// event loop of whatever process calls it, so a guard sampling from the same process never runs while a bundler hangs.
const BUILD_CHILD_SOURCE = `
import { writeFile } from "node:fs/promises"
const [moduleUrl, pathsJson, resultPath] = process.argv.slice(1)
const { buildExtension } = await import(moduleUrl)
const result = await buildExtension(JSON.parse(pathsJson))
await writeFile(resultPath, JSON.stringify(result ?? null))
process.exit(0)
`

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

function describeBuildBound(bound, cpuCapS) {
  switch (bound.kind) {
    case "stalled":
      return `stalled: no CPU or output progress for ${bound.stalledForS}s (a hang)`
    case "runaway":
      return `ran away: used ${Math.round(bound.cpuS)} CPU seconds (cap ${cpuCapS})`
    case "unmeasurable":
      return `could not read its process tree's CPU for ${bound.forS}s, so neither bound could be checked`
  }
}

/**
 * Builds `paths` with `buildModule`'s buildExtension in a child process group, bounded by watchTreeProgress (the same
 * stall, runaway and unmeasurable bounds the daemon tests use), where a change in the output directory `root` also
 * counts as progress. A tripped bound kills the whole group before rejecting.
 *
 * win32 has no tree CPU reader yet (#14832), so there the build is reported as unmeasurable once and only the hook's
 * outer bound applies, the same as before this guard existed.
 */
export function boundBuild(
  name,
  root,
  paths,
  {
    buildModule = DEFAULT_BUILD_MODULE,
    stallMs = BUILD_STALL_MS,
    cpuCapS = BUILD_CPU_CAP_S,
    sample,
    killTree = killGroup,
    platform = process.platform,
    report = (line) => process.stderr.write(`${line}\n`),
  } = {},
) {
  const measured = platform !== "win32"
  const resultPath = `${root}.build-result.json`
  const child = spawn(
    "node",
    ["--input-type=module", "-e", BUILD_CHILD_SOURCE, buildModule, JSON.stringify(paths), resultPath],
    {
      detached: measured,
      stdio: ["ignore", "inherit", "pipe"],
    },
  )
  let stderr = ""
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS)
  })
  if (!measured) {
    report(`${name}: its process tree's CPU is unmeasurable on win32 (#14832); only the hook's outer bound applies`)
  }
  return new Promise((resolve, reject) => {
    let lastOutput = -1
    let outputMoved = false
    let reading = false
    const outputWatch = measured
      ? setInterval(async () => {
          if (reading) return
          reading = true
          const output = await outputFingerprint(root)
          reading = false
          if (output !== lastOutput) {
            lastOutput = output
            outputMoved = true
          }
        }, OUTPUT_SAMPLE_MS)
      : undefined
    let settled = false
    const stopWatch =
      !measured || child.pid === undefined
        ? () => {}
        : watchTreeProgress(child.pid, (bound) => trip(describeBuildBound(bound, cpuCapS)), {
            stallMs,
            cpuCapS,
            ...(sample === undefined ? {} : { sample }),
            progressed: () => {
              const moved = outputMoved
              outputMoved = false
              return moved
            },
          })
    function settle(finish) {
      if (settled) return
      settled = true
      clearInterval(outputWatch)
      stopWatch()
      finish()
    }
    function trip(why) {
      settle(() => {
        // Reject only once the leader is reaped, so the caller never sees a group still holding the build.
        const rejectBound = () => reject(new Error(`${name} ${why}; killed process group ${child.pid}`))
        child.once("exit", rejectBound)
        try {
          killTree(child)
        } catch (error) {
          // The group could not be signalled: end at least the leader, and reject with that error once it has exited.
          // Any other group member is left running; the caller sees the error and owns that cleanup.
          child.removeListener("exit", rejectBound)
          child.once("exit", () => reject(error))
          child.kill("SIGKILL")
        }
      })
    }
    child.on("error", (error) => settle(() => reject(error)))
    child.on("exit", (code, signal) => {
      settle(async () => {
        try {
          // A sidecar the build left behind (the minifier server) must not outlive it: it is still in the group, so
          // the group signal reaches it after the leader exited. win32 has no group, so nothing is killed by pid there.
          if (measured) killTree(child)
          if (code !== 0) throw new Error(`${name} failed: code=${String(code)} signal=${String(signal)}\n${stderr}`)
          resolve(JSON.parse(await readFile(resultPath, "utf8")))
        } catch (error) {
          reject(error)
        } finally {
          await rm(resultPath, { force: true })
        }
      })
    })
  })
}

export function createBuildFixture({ buildModule } = {}) {
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
        return { root, ...paths, ...(await boundBuild("shared extension build", root, paths, { buildModule })) }
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
        await boundBuild("reproduction extension build", root, outputPathsIn(root), { buildModule })
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
  // Run in the file's beforeAll under BUILD_HOOK_OUTER_BOUND_MS: the builds are bounded by CPU and output progress;
  // the hook bound is only the outer limit below the CI job's.
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
