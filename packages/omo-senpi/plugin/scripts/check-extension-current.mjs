import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { artifactsMatch } from "./build-artifact.mjs"
import { buildExtension, COMPUTER_PRELUDE_ASSET_NAME, extensionBuildPaths, GATEWAY_STORE_WORKER_NAME, memorySyncAssetSources, resolveOutputs, THREAD_SDK_RELATIVE_PATH } from "./build-extension-core.mjs"
import { findStaleRuntimePersona } from "./persona-artifacts.mjs"

export async function checkExtensionCurrent(options = {}) {
  const {
    output,
    taskOutput,
    memberOutput,
    supervisorOutput,
    advisorRuntimeOutput,
    sidePanelRuntimeOutput,
    onboardingScanRuntimeOutput,
    toolkitSdkOutput,
    rollbackRuntimeOutput,
    computerUseOutput,
    memoryDoctorOutput,
    memoryMemfsOutput,
    memoryPalaceOutput,
    sessionHistoryOutput,
    recallStoreOutput,
    telemetryPosthogOutput,
    memorySyncOutput,
    threadClientOutput,
    gatewayStoreWorkerOutput,
    threadSdkOutput,
  } = resolveOutputs(options)
  const currentToolkitSdk = await readBuiltEntry(toolkitSdkOutput)
  if (currentToolkitSdk === undefined) return { ok: false, reason: "missing-output", output: toolkitSdkOutput }
  const currentRollbackRuntime = await readBuiltEntry(rollbackRuntimeOutput)
  if (currentRollbackRuntime === undefined) return { ok: false, reason: "missing-output", output: rollbackRuntimeOutput }
  const currentMain = await readBuiltEntry(output)
  if (currentMain === undefined) return { ok: false, reason: "missing-output", output }
  const currentTask = await readBuiltEntry(taskOutput)
  if (currentTask === undefined) return { ok: false, reason: "missing-output", output: taskOutput }
  const currentMember = await readBuiltEntry(memberOutput)
  if (currentMember === undefined) return { ok: false, reason: "missing-output", output: memberOutput }
  const currentSupervisor = await readBuiltEntry(supervisorOutput)
  if (currentSupervisor === undefined) return { ok: false, reason: "missing-output", output: supervisorOutput }
  const currentAdvisorRuntime = await readBuiltEntry(advisorRuntimeOutput)
  if (currentAdvisorRuntime === undefined) return { ok: false, reason: "missing-output", output: advisorRuntimeOutput }
  const currentSidePanelRuntime = await readBuiltEntry(sidePanelRuntimeOutput)
  if (currentSidePanelRuntime === undefined) return { ok: false, reason: "missing-output", output: sidePanelRuntimeOutput }
  const currentOnboardingScanRuntime = await readBuiltEntry(onboardingScanRuntimeOutput)
  if (currentOnboardingScanRuntime === undefined) return { ok: false, reason: "missing-output", output: onboardingScanRuntimeOutput }
  const currentMemoryDoctor = await readBuiltEntry(memoryDoctorOutput)
  const currentMemoryMemfs = await readBuiltEntry(memoryMemfsOutput)
  const currentMemoryPalace = await readBuiltEntry(memoryPalaceOutput)
  const currentSessionHistory = await readBuiltEntry(sessionHistoryOutput)
  const currentRecallStore = await readBuiltEntry(recallStoreOutput)
  const currentTelemetryPosthog = await readBuiltEntry(telemetryPosthogOutput)
  const currentThreadClient = await readBuiltEntry(threadClientOutput)
  const currentMemorySync = await readBuiltEntry(memorySyncOutput)
  if (currentMemorySync === undefined) return { ok: false, reason: "missing-output", output: memorySyncOutput }
  // Each committed sidecar asset must be byte-identical to its source: the wasm to the INSTALLED Loro
  // package's (a Loro bump without a rebuild would leave a stale binary beside new glue).
  for (const [name, source] of Object.entries(memorySyncAssetSources())) {
    const assetOutput = join(dirname(memorySyncOutput), name)
    const current = await readFile(assetOutput).catch(() => undefined)
    if (current === undefined) return { ok: false, reason: "missing-output", output: assetOutput }
    if (sha256(current) !== sha256(await readFile(source))) return { ok: false, reason: "stale-output", output: assetOutput }
  }
  if (currentMemoryDoctor === undefined) return { ok: false, reason: "missing-output", output: memoryDoctorOutput }
  if (currentMemoryMemfs === undefined) return { ok: false, reason: "missing-output", output: memoryMemfsOutput }
  if (currentMemoryPalace === undefined) return { ok: false, reason: "missing-output", output: memoryPalaceOutput }
  if (currentSessionHistory === undefined) return { ok: false, reason: "missing-output", output: sessionHistoryOutput }
  if (currentRecallStore === undefined) return { ok: false, reason: "missing-output", output: recallStoreOutput }
  if (currentTelemetryPosthog === undefined) return { ok: false, reason: "missing-output", output: telemetryPosthogOutput }
  if (currentThreadClient === undefined) return { ok: false, reason: "missing-output", output: threadClientOutput }
  const currentComputerUse = await readBuiltEntry(computerUseOutput)
  if (currentComputerUse === undefined) return { ok: false, reason: "missing-output", output: computerUseOutput }
  const currentGatewayStoreWorker = await readBuiltEntry(gatewayStoreWorkerOutput)
  if (currentGatewayStoreWorker === undefined) return { ok: false, reason: "missing-output", output: gatewayStoreWorkerOutput }
  const currentThreadSdk = await readBuiltEntry(threadSdkOutput)
  if (currentThreadSdk === undefined) return { ok: false, reason: "missing-output", output: threadSdkOutput }

  const tempRoot = await mkdtemp(join(tmpdir(), "omo-senpi-build-check-"))
  const expected = {
    outputPath: join(tempRoot, "omo.js"),
    taskOutputPath: join(tempRoot, "omo-task.js"),
    memberOutputPath: join(tempRoot, "omo-member.js"),
    supervisorOutputPath: join(tempRoot, "memory-run-supervisor.mjs"),
    advisorRuntimeOutputPath: join(tempRoot, "omo-init-deep-advisor.js"),
    sidePanelRuntimeOutputPath: join(tempRoot, "omo-side-panel.js"),
    onboardingScanRuntimeOutputPath: join(tempRoot, "omo-onboarding-scan.js"),
    toolkitSdkOutputPath: join(tempRoot, "runtime", "agent-toolkit-sdk", "sdk.js"),
    rollbackRuntimeOutputPath: join(tempRoot, "runtime", "rollback-migrate.js"),
    memoryDoctorOutputPath: join(tempRoot, "omo-memory-doctor.js"),
    memoryMemfsOutputPath: join(tempRoot, "omo-memory-memfs.js"),
    memoryPalaceOutputPath: join(tempRoot, "omo-memory-palace.js"),
    sessionHistoryOutputPath: join(tempRoot, "omo-session-history.js"),
    recallStoreOutputPath: join(tempRoot, "omo-recall-store.js"),
    telemetryPosthogOutputPath: join(tempRoot, "omo-telemetry-posthog.js"),
    memorySyncOutputPath: join(tempRoot, "omo-memory-sync.js"),
    threadClientOutputPath: join(tempRoot, "omo-thread-client.js"),
    computerUseOutputPath: join(tempRoot, "omo-computer-use.js"),
    gatewayStoreWorkerOutputPath: join(tempRoot, GATEWAY_STORE_WORKER_NAME),
    threadSdkOutputPath: join(tempRoot, THREAD_SDK_RELATIVE_PATH),
  }
  try {
    await buildExtension(expected)
    for (const [current, built, outputFile] of [
      [currentRollbackRuntime, expected.rollbackRuntimeOutputPath, rollbackRuntimeOutput],
      [currentToolkitSdk, expected.toolkitSdkOutputPath, toolkitSdkOutput],
      [currentMain, expected.outputPath, output],
      [currentTask, expected.taskOutputPath, taskOutput],
      [currentMember, expected.memberOutputPath, memberOutput],
      [currentSupervisor, expected.supervisorOutputPath, supervisorOutput],
      [currentAdvisorRuntime, expected.advisorRuntimeOutputPath, advisorRuntimeOutput],
      [currentSidePanelRuntime, expected.sidePanelRuntimeOutputPath, sidePanelRuntimeOutput],
      [currentOnboardingScanRuntime, expected.onboardingScanRuntimeOutputPath, onboardingScanRuntimeOutput],
      [currentMemoryDoctor, expected.memoryDoctorOutputPath, memoryDoctorOutput],
      [currentMemoryMemfs, expected.memoryMemfsOutputPath, memoryMemfsOutput],
      [currentMemoryPalace, expected.memoryPalaceOutputPath, memoryPalaceOutput],
      [currentSessionHistory, expected.sessionHistoryOutputPath, sessionHistoryOutput],
      [currentRecallStore, expected.recallStoreOutputPath, recallStoreOutput],
      [currentTelemetryPosthog, expected.telemetryPosthogOutputPath, telemetryPosthogOutput],
      [currentMemorySync, expected.memorySyncOutputPath, memorySyncOutput],
      [currentThreadClient, expected.threadClientOutputPath, threadClientOutput],
      [currentComputerUse, expected.computerUseOutputPath, computerUseOutput],
      [currentGatewayStoreWorker, expected.gatewayStoreWorkerOutputPath, gatewayStoreWorkerOutput],
      [currentThreadSdk, expected.threadSdkOutputPath, threadSdkOutput],
    ]) {
      if (!artifactsMatch(current, await readFile(built, "utf8"))) {
        return { ok: false, reason: "stale-output", output: outputFile }
      }
    }
    const stalePersona = await findStaleRuntimePersona(tempRoot, dirname(output), extensionBuildPaths.repoRoot)
    if (stalePersona !== undefined) return { ok: false, reason: "stale-output", output: stalePersona }
    const expectedPrelude = await readFile(join(tempRoot, COMPUTER_PRELUDE_ASSET_NAME), "utf8")
    const currentPrelude = await readFile(join(dirname(output), COMPUTER_PRELUDE_ASSET_NAME), "utf8").catch(() => undefined)
    if (currentPrelude !== expectedPrelude) {
      return { ok: false, reason: "stale-output", output: join(dirname(output), COMPUTER_PRELUDE_ASSET_NAME) }
    }
    return { ok: true, output, taskOutput, memberOutput, advisorRuntimeOutput, sidePanelRuntimeOutput, computerUseOutput, gatewayStoreWorkerOutput, threadSdkOutput }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

async function readBuiltEntry(output) {
  try {
    return await readFile(output, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined
    throw error
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
