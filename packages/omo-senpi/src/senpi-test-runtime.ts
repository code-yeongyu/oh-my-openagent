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
) as Pick<typeof import("@code-yeongyu/senpi"), "createAgentSession" | "createAgentSessionRuntime">

const resourceLoaderModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "resource-loader.js")).href
) as Pick<typeof import("@code-yeongyu/senpi"), "DefaultResourceLoader">

const sessionManagerModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "session-manager.js")).href
) as Pick<typeof import("@code-yeongyu/senpi"), "SessionManager">

const settingsManagerModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "settings-manager.js")).href
) as Pick<typeof import("@code-yeongyu/senpi"), "SettingsManager">

// senpi's package entry does not export AuthStorage; `ModelRegistry.inMemory` needs one, so it is
// loaded from the dist file and typed through the registry's public `authStorage` member.
type SenpiAuthStorage = InstanceType<typeof import("@code-yeongyu/senpi").ModelRegistry>["authStorage"]
const authStorageModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "auth-storage.js")).href
) as { AuthStorage: { inMemory(data?: Record<string, unknown>): SenpiAuthStorage } }

export const { Theme } = themeModule
export const { ModelRegistry } = modelRegistryModule
export const { ModelRuntime } = modelRuntimeModule
export const { createAgentSession, createAgentSessionRuntime } = sdkModule
export const { DefaultResourceLoader } = resourceLoaderModule
export const { SessionManager } = sessionManagerModule
export const { SettingsManager } = settingsManagerModule
export const { AuthStorage } = authStorageModule
