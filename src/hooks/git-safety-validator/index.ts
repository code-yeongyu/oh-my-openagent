import type { PluginInput } from "@opencode-ai/plugin";
import type { GitSafetyConfig } from "./types";
import { validateGitCommand } from "./validator";
import { DEFAULT_GIT_SAFETY_CONFIG, GIT_SAFETY_VALIDATOR_NAME } from "./constants";
import { log } from "../../shared";

export type { GitSafetyConfig, GitSafetyResult, ParsedGitCommand } from "./types";
export { validateGitCommand, parseGitCommand, isProtectedBranch } from "./validator";
export { DEFAULT_GIT_SAFETY_CONFIG, GIT_SAFETY_VALIDATOR_NAME } from "./constants";

/**
 * Create the Git Safety Validator hook
 *
 * This hook intercepts bash commands and validates git operations for safety:
 * - Blocks force push to protected branches (main, master, production)
 * - Warns on destructive operations (reset --hard, clean -f, etc.)
 * - Provides suggestions for safer alternatives
 */
export function createGitSafetyValidatorHook(
  _ctx: PluginInput,
  config?: Partial<GitSafetyConfig>
) {
  const fullConfig: GitSafetyConfig = {
    ...DEFAULT_GIT_SAFETY_CONFIG,
    ...config,
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
        // Block the operation by modifying the command to echo the error
        log(`[${GIT_SAFETY_VALIDATOR_NAME}] Blocked: ${command}`);
        log(`[${GIT_SAFETY_VALIDATOR_NAME}] Reason: ${result.reason}`);

        // Replace the command with an error message
        output.args.command = `echo "${result.reason}\n\n${result.suggestion || ""}" && exit 1`;
        return;
      }

      if (result.reason && result.severity === "warn") {
        // Log warning but allow the command
        log(`[${GIT_SAFETY_VALIDATOR_NAME}] Warning: ${result.reason}`);
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      // Only process bash commands
      const toolLower = input.tool.toLowerCase();
      if (toolLower !== "bash") {
        return;
      }

      // Check if the output contains our blocked message
      if (output.output.includes("BLOCKED:")) {
        // Add additional context to the output
        output.output += "\n\n💡 Tip: Use the suggestion above for a safer approach.";
      }
    },
  };
}
