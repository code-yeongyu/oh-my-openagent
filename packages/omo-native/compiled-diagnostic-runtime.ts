// The compiled binary has no npm package layout: `bin/lib/package-paths.js` resolves `packageRoot`
// inside the binary's virtual filesystem and `resolveSenpi()` finds no installed engine, so the npm
// loaders behind doctor and setup coverage fail open and silently drop their lines. These loaders
// answer the same questions from the provisioned runtime (the staged category-coverage bundle) and
// from the engine modules compiled into this binary. The relative literals keep bun tracing them.
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export const COMPILED_DIAGNOSTIC_RUNTIME = join("plugin", "runtime", "category-coverage", "index.js")

export function compiledDiagnosticRuntimeLoader(execDir: string): () => Promise<unknown> {
  return () => import(pathToFileURL(join(execDir, COMPILED_DIAGNOSTIC_RUNTIME)).href)
}

// `omo setup` validates model choices against the builtin provider catalog. The npm loader finds it
// beside the installed engine; here it is the pi-ai graph compiled into this binary, read through the
// table senpi publishes to extensions in both its source and compiled runtimes.
export async function loadCompiledModelCatalog() {
  const { VIRTUAL_MODULES } = await import("../../node_modules/@code-yeongyu/senpi/dist/core/extensions/virtual-modules.js")
  const catalog: unknown = VIRTUAL_MODULES["@earendil-works/pi-ai/providers/all"]
  const builtinProviders: unknown = typeof catalog === "object" && catalog !== null ? Reflect.get(catalog, "builtinProviders") : undefined
  if (typeof builtinProviders !== "function") throw new Error("the compiled engine carries no builtin provider catalog")
  return builtinProviders()
}

export async function loadCompiledCoverageEngine() {
  const [runtime, auth, store, settings, subscription, subscriptionSettings] = await Promise.all([
    import("../../node_modules/@code-yeongyu/senpi/dist/core/model-runtime.js"),
    import("../../node_modules/@code-yeongyu/senpi/dist/core/auth-storage.js"),
    import("../../node_modules/@code-yeongyu/senpi/dist/core/models-store.js"),
    import("../../node_modules/@code-yeongyu/senpi/dist/core/settings-manager.js"),
    import("../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/anthropic-subscription/index.js"),
    import("../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/anthropic-subscription/settings.js"),
  ])
  return {
    ModelRuntime: runtime.ModelRuntime,
    AuthStorage: auth.AuthStorage,
    ReadOnlyAuthStorage: auth.ReadOnlyAuthStorage,
    InMemoryCodingAgentModelsStore: store.InMemoryCodingAgentModelsStore,
    SettingsManager: settings.SettingsManager,
    registerAnthropicSubscription: subscription.registerAnthropicSubscriptionExtension,
    loadAnthropicSubscriptionSettings: subscriptionSettings.loadAnthropicSubscriptionProviderSettings,
  }
}
