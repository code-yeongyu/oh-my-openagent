import type { PluginInput } from "@opencode-ai/plugin";
import type { GitSafetyConfig } from "./types";
import { validateGitCommand } from "./validator";
import { DEFAULT_GIT_SAFETY_CONFIG, GIT_SAFETY_VALIDATOR_NAME } from "./constants";
import { log } from "../../shared";

export type { GitSafetyConfig, GitSafetyResult, ParsedGitCommand } from "./types";
export { validateGitCommand, parseGitCommand, isProtectedBranch } from "./validator";
export { DEFAULT_GIT_SAFETY_CONFIG, GIT_SAFETY_VALIDATOR_NAME } from "./constants";

export function createGitSafetyValidatorHook(
  _ctx: PluginInput,
  config?: Partial<GitSafetyConfig>
) {
  // Merge config with defaults, filtering out undefined values to prevent overwriting
  const fullConfig: GitSafetyConfig = {
    ...DEFAULT_GIT_SAFETY_CONFIG,
    ...(config?.protectedBranches !== undefined && { protectedBranches: config.protectedBranches }),
    ...(config?.blockForceOperations !== undefined && { blockForceOperations: config.blockForceOperations }),
    ...(config?.warnOnDestructive !== undefined && { warnOnDestructive: config.warnOnDestructive }),
    ...(config?.allowListPatterns !== undefined && { allowListPatterns: config.allowListPatterns }),
  };

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      // Only intercept bash commands
      const toolLower = input.tool.toLowerCase();
      if (toolLower !== "bash") {
        return;
      }

      const command = output.args.command as string | undefined;
      if (!command) {
        return;
      }

      // Validate the git command
      const result = validateGitCommand(command, fullConfig);

      if (!result.allowed) {
        log(`[${GIT_SAFETY_VALIDATOR_NAME}] Blocked: ${command}`);
        log(`[${GIT_SAFETY_VALIDATOR_NAME}] Reason: ${result.reason}`);
        throw new Error(`🚫 Git Safety: ${result.reason}${result.suggestion ? `\n\n💡 ${result.suggestion}` : ""}`);
      }

      if (result.reason && result.severity === "warn") {
        // Log warning but allow the command
        log(`[${GIT_SAFETY_VALIDATOR_NAME}] Warning: ${result.reason}`);
      }
    },
  };
}
