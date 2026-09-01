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

export const { Theme } = themeModule
export const { ModelRegistry } = modelRegistryModule
export const { ModelRuntime } = modelRuntimeModule
