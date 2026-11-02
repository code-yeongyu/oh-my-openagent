export interface BuildExtensionOptions {
  outputPath?: string
  taskOutputPath?: string
  memberOutputPath?: string
  supervisorOutputPath?: string
  advisorRuntimeOutputPath?: string
  sidePanelRuntimeOutputPath?: string
  toolkitSdkOutputPath?: string
  rollbackRuntimeOutputPath?: string
  memoryDoctorOutputPath?: string
  memoryMemfsOutputPath?: string
  memoryPalaceOutputPath?: string
  deviceAccountOutputPath?: string
  memoryCommandsOutputPath?: string
  sessionHistoryOutputPath?: string
  recallStoreOutputPath?: string
  telemetryPosthogOutputPath?: string
  memorySyncOutputPath?: string
  threadClientOutputPath?: string
  telemetryRecoveryOutputPath?: string
  feedbackOutputPath?: string
  desktopToolkitOutputPath?: string
  claimReceiptOutputPath?: string
  computerUseOutputPath?: string
  gatewayStoreWorkerOutputPath?: string
  threadSdkOutputPath?: string
}
export function buildExtension(options?: BuildExtensionOptions): Promise<{
  mainInputs: string[]
  taskInputs: string[]
  memberInputs: string[]
  supervisorInputs: string[]
  advisorRuntimeInputs: string[]
  sidePanelRuntimeInputs: string[]
  memoryDoctorInputs: string[]
  memoryMemfsInputs: string[]
  memoryPalaceInputs: string[]
  deviceAccountInputs: string[]
  memoryCommandsInputs: string[]
  sessionHistoryInputs: string[]
  recallStoreInputs: string[]
  telemetryPosthogInputs: string[]
  memorySyncInputs: string[]
  threadClientInputs: string[]
  telemetryRecoveryInputs: string[]
  feedbackInputs: string[]
  desktopToolkitInputs: string[]
  claimReceiptInputs: string[]
  computerUseInputs: string[]
  toolkitSdkInputs: string[]
  rollbackRuntimeInputs: string[]
  gatewayStoreWorkerInputs: string[]
  threadSdkInputs: string[]
}>
export interface CheckExtensionCurrentOptions extends BuildExtensionOptions {
  /** An already-built reproduction root to compare against instead of building a fresh one; left in place. */
  expectedRoot?: string
}
export function checkExtensionCurrent(options?: CheckExtensionCurrentOptions): Promise<
  | { ok: true; output: string; gatewayStoreWorkerOutput: string; threadSdkOutput: string }
  | { ok: false; reason: "missing-output" | "stale-output"; output: string }
>
export const GATEWAY_STORE_WORKER_NAME: "gateway-store-worker.mjs"
export const THREAD_SDK_RELATIVE_PATH: string
export const SENPI_LOADER_ALIASES: readonly [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@earendil-works/pi-ai/oauth",
  "@code-yeongyu/senpi",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-tui",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-ai/compat",
  "@mariozechner/pi-ai/oauth",
  "typebox",
  "typebox/compile",
  "typebox/value",
  "@sinclair/typebox",
  "@sinclair/typebox/compile",
  "@sinclair/typebox/value",
]
