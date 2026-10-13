import type { PluginInput } from "@opencode-ai/plugin"
import type { V2PluginContext } from "../context-types"
import { createAppNamespace } from "./app-namespace"
import { createConfigNamespace } from "./config-namespace"
import { withFallback } from "./fallback"
import { createProviderNamespace } from "./provider-namespace"
import { createSessionNamespace, type SessionNamespaceDeps } from "./session-namespace"

type V1Client = PluginInput["client"]

/**
 * The V1 SDK client shape the plugin body is written against, backed by the 2.x context. Mapped
 * methods return the 1.x response shape; every method not mapped yet rejects with the exact
 * operation name (see fallback.ts).
 */
export function createClientFacade(context: V2PluginContext, deps: SessionNamespaceDeps): V1Client {
  return withFallback(["client"], {
    provider: withFallback(["client", "provider"], createProviderNamespace(context)),
    config: withFallback(["client", "config"], createConfigNamespace(context)),
    app: withFallback(["client", "app"], createAppNamespace(context)),
    session: withFallback(["client", "session"], createSessionNamespace(context, deps)),
  }) as unknown as V1Client
}
