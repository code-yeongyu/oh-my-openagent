import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))

const themeModule = (await import(
  pathToFileURL(join(senpiDistDir, "modes", "interactive", "theme", "theme.js")).href
)) as Pick<typeof import("@code-yeongyu/senpi"), "Theme">

const modelRegistryModule = (await import(pathToFileURL(join(senpiDistDir, "core", "model-registry.js")).href)) as Pick<
  typeof import("@code-yeongyu/senpi"),
  "ModelRegistry"
>

const modelRuntimeModule = (await import(pathToFileURL(join(senpiDistDir, "core", "model-runtime.js")).href)) as Pick<
  typeof import("@code-yeongyu/senpi"),
  "ModelRuntime"
>

const sdkModule = (await import(pathToFileURL(join(senpiDistDir, "core", "sdk.js")).href)) as Pick<
  typeof import("@code-yeongyu/senpi"),
  "createAgentSession" | "createAgentSessionRuntime"
>

const resourceLoaderModule = (await import(
  pathToFileURL(join(senpiDistDir, "core", "resource-loader.js")).href
)) as Pick<typeof import("@code-yeongyu/senpi"), "DefaultResourceLoader">

const sessionManagerModule = (await import(
  pathToFileURL(join(senpiDistDir, "core", "session-manager.js")).href
)) as Pick<typeof import("@code-yeongyu/senpi"), "SessionManager">

const messagesModule = (await import(pathToFileURL(join(senpiDistDir, "core", "messages.js")).href)) as Pick<
  typeof import("@code-yeongyu/senpi"),
  "convertToLlm"
>

const settingsManagerModule = (await import(
  pathToFileURL(join(senpiDistDir, "core", "settings-manager.js")).href
)) as Pick<typeof import("@code-yeongyu/senpi"), "SettingsManager">

// senpi's package entry does not export AuthStorage; `ModelRegistry.inMemory` needs one, so it is
// loaded from the dist file and typed through the registry's public `authStorage` member.
type SenpiAuthStorage = InstanceType<typeof import("@code-yeongyu/senpi").ModelRegistry>["authStorage"]
const authStorageModule = (await import(pathToFileURL(join(senpiDistDir, "core", "auth-storage.js")).href)) as {
  AuthStorage: { inMemory(data?: Record<string, unknown>): SenpiAuthStorage }
}

// The process-wide MCP service a session's builtin attaches to. Its startup connects outlive
// session_start (they race in the background), so a test that removes its HOME awaits them first.
interface SenpiMcpServerSnapshot {
  readonly name: string
  readonly lifecycleState: string
  readonly generation: number | null
  readonly pid: number | null
}
const mcpServiceModule = (await import(
  pathToFileURL(join(senpiDistDir, "core", "extensions", "builtin", "mcp", "service.js")).href
)) as {
  getMcpService(): {
    whenAttachSettled(timeoutMs?: number): Promise<"settled" | "timeout">
    getServerSnapshots(): readonly SenpiMcpServerSnapshot[]
    getSnapshot(): { readonly connectionCount: number; readonly disposed: boolean }
  }
}

// The loader senpi builds every extension's `pi` with; not on the package entry, so loaded from the dist file.
interface SenpiEventBus {
  emit(channel: string, data: unknown): void
}
const eventBusModule = (await import(pathToFileURL(join(senpiDistDir, "core", "event-bus.js")).href)) as {
  createEventBus(): SenpiEventBus
}
const extensionLoaderModule = (await import(
  pathToFileURL(join(senpiDistDir, "core", "extensions", "loader.js")).href
)) as {
  createExtensionRuntime(): object
  loadExtensionFromFactory(
    factory: (pi: unknown) => void | Promise<void>,
    cwd: string,
    eventBus: SenpiEventBus,
    runtime: object,
  ): Promise<{ readonly path: string }>
}

export const senpiPackageVersion: unknown = (
  JSON.parse(readFileSync(join(senpiDistDir, "..", "package.json"), "utf8")) as { version?: unknown }
).version
export const { createEventBus } = eventBusModule
export const { createExtensionRuntime, loadExtensionFromFactory } = extensionLoaderModule
export const { Theme } = themeModule
export const { ModelRegistry } = modelRegistryModule
export const { ModelRuntime } = modelRuntimeModule
export const { createAgentSession, createAgentSessionRuntime } = sdkModule
export const { DefaultResourceLoader } = resourceLoaderModule
export const { SessionManager } = sessionManagerModule
export const { convertToLlm } = messagesModule
export const { SettingsManager } = settingsManagerModule
export const { AuthStorage } = authStorageModule
export const { getMcpService } = mcpServiceModule
