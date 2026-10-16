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
