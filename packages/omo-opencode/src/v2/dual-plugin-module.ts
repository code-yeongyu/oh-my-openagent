import type { PluginModule } from "@opencode-ai/plugin"
import type { createV2Setup } from "./create-v2-setup"

/**
 * One default export that both plugin loaders accept.
 *
 * OpenCode 1.x reads `id` and `server` and ignores other keys (packages/opencode/src/plugin/shared.ts
 * `readV1Plugin`). OpenCode 2.x decodes `{ id, setup }` with an Effect `Schema.Struct`, which ignores
 * excess keys, so the same object satisfies both (packages/core/src/plugin/module.ts).
 */
export type DualPluginModule = PluginModule & {
  readonly setup: ReturnType<typeof createV2Setup>
}
