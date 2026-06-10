import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config"
import { createGitNexusTools } from "../tools/gitnexus"

/**
 * Build the gitnexus_* tools record.
 *
 * Gated on `gitnexus.server_url` being configured in the user config.
 * When the server URL is not set, returns an empty record and none of the
 * gitnexus_* tools are registered (zero overhead).
 */
export function createGitNexusToolsRecord(
  pluginConfig: Pick<OhMyOpenCodeConfig, "gitnexus">,
): Record<string, ToolDefinition> {
  return createGitNexusTools(pluginConfig.gitnexus)
}
