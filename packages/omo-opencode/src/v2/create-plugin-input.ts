import type { PluginInput } from "@opencode-ai/plugin"
import type { V2PluginContext } from "./context-types"
import { createClientFacade, type SessionNamespaceDeps } from "./client-facade"
import { V2UnsupportedOperationError } from "./unsupported-operation-error"

type V1Shell = PluginInput["$"]

function resolveShell(): V1Shell {
  if (typeof Bun !== "undefined") return Bun.$ as unknown as V1Shell
  return (() => {
    throw new V2UnsupportedOperationError("PluginInput.$")
  }) as unknown as V1Shell
}

/**
 * Builds the V1 `PluginInput` the existing plugin body expects from a V2 plugin context.
 *
 * `serverUrl` is intentionally not set: OpenCode 2.x exposes server URLs through `GET /api/info`,
 * not to plugins, and a `--standalone` server has no HTTP port at all. The V1 code already treats
 * an undefined `serverUrl` as "no live server" (see create-managers.ts).
 */
export function createPluginInput(context: V2PluginContext, deps: SessionNamespaceDeps): PluginInput {
  const { directory, project } = context.location
  return {
    client: createClientFacade(context, deps),
    project: {
      id: project.id,
      worktree: project.canonical,
      time: { created: 0 },
    },
    directory,
    worktree: project.canonical,
    experimental_workspace: { register: () => {} },
    serverUrl: undefined as unknown as URL,
    $: resolveShell(),
  }
}
