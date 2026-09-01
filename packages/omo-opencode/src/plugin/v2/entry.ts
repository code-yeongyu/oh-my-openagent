import { createPluginModule } from "../../testing/create-plugin-module"
import { defineV2Plugin } from "./v2-plugin"
import type { V2Plugin } from "./types"

/**
 * Dual-host entry for the `./v2` subpath.
 *
 * Exports the same dual-shape module as the root entry: V1 hosts call
 * `.server(input)`, V2 hosts call `.setup(ctx)`. `Plugin.define` is identity
 * at runtime, so the plain object literal satisfies the V2 `Plugin` contract
 * without importing the beta plugin package.
 */

const pluginModule = createPluginModule()
const v2Plugin: V2Plugin = defineV2Plugin({
  id: pluginModule.id ?? "oh-my-openagent",
  startV1ServerPlugin: (input) => pluginModule.server(input as never),
})

const dualHostPlugin = {
  id: pluginModule.id ?? "oh-my-openagent",
  server: pluginModule.server,
  setup: v2Plugin.setup,
}

export const omoPlugin = pluginModule.server
export const omoPluginV2 = v2Plugin
export default dualHostPlugin
