export interface BuildExtensionOptions {
  outputPath?: string
  taskOutputPath?: string
  memberOutputPath?: string
  supervisorOutputPath?: string
  advisorRuntimeOutputPath?: string
  toolkitSdkOutputPath?: string
}
export function buildExtension(options?: BuildExtensionOptions): Promise<{
  mainInputs: string[]
  taskInputs: string[]
  memberInputs: string[]
  supervisorInputs: string[]
  advisorRuntimeInputs: string[]
  toolkitSdkInputs: string[]
}>
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
