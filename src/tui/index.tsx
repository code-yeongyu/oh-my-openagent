import { mergeProps } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { RolesModelsSection } from "./sidebar/roles-models-section"

const tuiPlugin: TuiPlugin = async (api, _options, _meta) => {
  // Register the SolidJS slot plugin that targets `sidebar_content`.
  // Slot identity: TuiHostSlotMap.sidebar_content (tui.d.ts:298-300).
  // Registration API: api.slots.register(TuiSlotPlugin) (tui.d.ts:319-323),
  // returns a string slot id we must capture for hot-reload teardown.
  // The Plugin shape requires a `slots` wrapper per @opentui/core plugins/types.d.ts:27.
  //
  // Use mergeProps so that props.session_id is accessed via a reactive getter
  // inside RolesModelsSection, not frozen at registration time. This ensures the
  // createEffect(() => props.session_id) inside the component re-fires on session change.
  const slotId: string = api.slots.register({
    slots: {
      sidebar_content: (_ctx, props) => RolesModelsSection(mergeProps(props, { api })),
    },
  })

  // Teardown: register against api.lifecycle.onDispose (tui.d.ts:331-333).
  // The lifecycle dispose fires on TUI shutdown AND on hot-reload of this plugin.
  api.lifecycle.onDispose(() => {
    // The host SDK does not currently expose api.slots.unregister(id) per tui.d.ts:319-323.
    // If/when the unregister API ships, replace this no-op with: api.slots.unregister?.(slotId)
    // Until then, hot-reload safety relies on the host invalidating its slot registry on
    // plugin teardown. slotId captured here for future use when api.slots.unregister ships.
    void slotId
  })
}

const tuiPluginModule: TuiPluginModule = {
  id: "oh-my-openagent-tui",
  tui: tuiPlugin,
}

export default tuiPluginModule
