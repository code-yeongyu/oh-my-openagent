import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))

const themeModule = await import(pathToFileURL(join(
  senpiDistDir,
  "modes",
  "interactive",
  "theme",
  "theme.js",
)).href) as Pick<typeof import("@code-yeongyu/senpi"), "Theme">

const modelRegistryModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "model-registry.js")).href
) as Pick<typeof import("@code-yeongyu/senpi"), "ModelRegistry">

const modelRuntimeModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "model-runtime.js")).href
) as Pick<typeof import("@code-yeongyu/senpi"), "ModelRuntime">

const sdkModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "sdk.js")).href
) as Pick<typeof import("@code-yeongyu/senpi"), "createAgentSession">

export const { Theme } = themeModule
export const { ModelRegistry } = modelRegistryModule
export const { ModelRuntime } = modelRuntimeModule
export const { createAgentSession } = sdkModule
