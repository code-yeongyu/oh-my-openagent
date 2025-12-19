import type { PluginInput } from "@opencode-ai/plugin";
import type { ConflictDetectorConfig } from "./types";
import { FileEditRegistry } from "./registry";
import { DEFAULT_CONFLICT_DETECTOR_CONFIG, CONFLICT_DETECTOR_NAME, WARNING_MESSAGES } from "./constants";
import { log } from "../../shared";
import { getAgentForSession } from "../../features/claude-code-session-state/agent-registry";

export type { FileEditLock, ConflictDetectorConfig, ConflictCheckResult } from "./types";
export { FileEditRegistry } from "./registry";
export { DEFAULT_CONFLICT_DETECTOR_CONFIG, CONFLICT_DETECTOR_NAME } from "./constants";

export function createConflictDetectorHook(
  _ctx: PluginInput,
  config?: Partial<ConflictDetectorConfig>
) {
  // Merge config with defaults, filtering out undefined values to prevent overwriting
  const fullConfig: ConflictDetectorConfig = {
    ...DEFAULT_CONFLICT_DETECTOR_CONFIG,
    ...(config?.enabled !== undefined && { enabled: config.enabled }),
    ...(config?.lockTimeoutMs !== undefined && { lockTimeoutMs: config.lockTimeoutMs }),
    ...(config?.warnOnConflict !== undefined && { warnOnConflict: config.warnOnConflict }),
    ...(config?.blockOnConflict !== undefined && { blockOnConflict: config.blockOnConflict }),
  };

  if (!fullConfig.enabled) {
    return {
      "tool.execute.before": async () => {},
      "tool.execute.after": async () => {},
    };
  }

  const registry = FileEditRegistry.getInstance(fullConfig);

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      const toolLower = input.tool.toLowerCase();
      
      if (toolLower !== "write" && toolLower !== "edit") {
        return;
      }

      const filePath = (output.args.filePath ?? output.args.file_path) as string | undefined;
      if (!filePath) {
        return;
      }

      const agentName = getAgentForSession(input.sessionID);
      const operation = toolLower as "write" | "edit";

      const conflict = registry.hasConflict(filePath, agentName);

      if (conflict.hasConflict && conflict.existingLock) {
        const warningMessage = WARNING_MESSAGES.conflict(
          filePath,
          conflict.existingLock.agentName,
          agentName
        );

        log(`[${CONFLICT_DETECTOR_NAME}] ${warningMessage}`);

        if (fullConfig.blockOnConflict) {
          throw new Error(`⚠️ Conflict: ${warningMessage}`);
        }
      }

      registry.acquireLock(filePath, agentName, input.sessionID, operation);
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      const toolLower = input.tool.toLowerCase();
      
      if (toolLower !== "write" && toolLower !== "edit") {
        return;
      }

      const metadata = output.metadata as Record<string, unknown> | undefined;
      const filePath = metadata?.filePath as string | undefined;
      const agentName = getAgentForSession(input.sessionID);

      if (filePath) {
        registry.releaseLock(filePath, agentName);
      }
    },
  };
}
