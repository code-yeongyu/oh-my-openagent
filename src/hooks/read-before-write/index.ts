import type { PluginInput } from "@opencode-ai/plugin";
import * as path from "node:path";
import { existsSync } from "node:fs";
import picomatch from "picomatch";
import type { ReadBeforeWriteConfig } from "./types";
import { FileReadRegistry } from "./registry";
import { DEFAULT_CONFIG, HOOK_NAME, ERROR_MESSAGES, WARNING_MESSAGES } from "./constants";
import { log } from "../../shared";

export type { FileReadEntry, ReadBeforeWriteConfig, EnforcementResult, RegistryStats } from "./types";
export { FileReadRegistry } from "./registry";
export { DEFAULT_CONFIG, HOOK_NAME, MAX_TRACKED_FILES } from "./constants";

/**
 * Check if a file path matches any of the exempt path patterns.
 * 
 * @param filePath - Absolute file path to check
 * @param exemptPaths - Array of glob patterns
 * @param projectRoot - Project root directory for relative path calculation
 * @returns true if the path is exempt
 */
function isPathExempt(filePath: string, exemptPaths: string[], projectRoot: string): boolean {
  // Convert to relative path for pattern matching
  let relativePath = filePath;
  if (filePath.startsWith(projectRoot)) {
    relativePath = filePath.slice(projectRoot.length);
    if (relativePath.startsWith("/")) {
      relativePath = relativePath.slice(1);
    }
  }

  for (const pattern of exemptPaths) {
    if (picomatch.isMatch(relativePath, pattern, { dot: true, bash: true })) {
      return true;
    }
  }

  return false;
}

/**
 * Creates the read-before-write enforcement hook.
 * 
 * This hook:
 * 1. Tracks file reads via tool.execute.before on "read" tool
 * 2. Tracks writes to NEW files as "read" (DD-8) for create-then-edit workflows
 * 3. Enforces read-before-write for write/edit/multiedit tools
 * 4. Cleans up session data on session.deleted and session.compacted events
 * 
 * SDK Constraint: tool.execute.after does NOT have access to output.args,
 * so BOTH tracking AND enforcement happen in tool.execute.before.
 * 
 * @param ctx - Plugin context
 * @param config - Optional configuration override
 * @returns Hook handlers or null if disabled
 */
export function createReadBeforeWriteHook(
  ctx: PluginInput,
  config?: Partial<ReadBeforeWriteConfig>
) {
  const finalConfig: ReadBeforeWriteConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  // Early exit if disabled
  if (!finalConfig.enabled || finalConfig.mode === "disabled") {
    log(`[${HOOK_NAME}] Hook disabled`);
    return null;
  }

  log(`[${HOOK_NAME}] Hook initialized`, {
    mode: finalConfig.mode,
    exemptTools: finalConfig.exempt_tools,
    exemptPaths: finalConfig.exempt_paths,
  });

  const registry = FileReadRegistry.getInstance(finalConfig);

  /**
   * Enforce read-before-write for a single file.
   * Throws an error in block mode, logs a warning in warn mode.
   */
  function enforceReadBeforeWrite(sessionId: string, filePath: string): void {
    // Check path exemption
    if (isPathExempt(filePath, finalConfig.exempt_paths, ctx.directory)) {
      log(`[${HOOK_NAME}] Path exempt: ${filePath}`);
      return;
    }

    // Normalize the path
    const absolutePath = path.resolve(ctx.directory, filePath);

    // Check if file exists (new files are allowed without prior read)
    if (!existsSync(absolutePath)) {
      log(`[${HOOK_NAME}] New file allowed: ${absolutePath}`);
      return;
    }

    // Check if file was read
    if (registry.hasRead(sessionId, absolutePath)) {
      log(`[${HOOK_NAME}] Read found: ${absolutePath}`);
      return;
    }

    // Enforcement action based on mode
    if (finalConfig.mode === "block") {
      const message = ERROR_MESSAGES.blocked(filePath);
      log(`[${HOOK_NAME}] ${message}`);
      throw new Error(message);
    } else if (finalConfig.mode === "warn") {
      const message = WARNING_MESSAGES.noRead(filePath);
      log(`[${HOOK_NAME}] ${message}`);
    }
  }

  /**
   * Handle multiedit tool - check each file individually.
   */
  function handleMultiedit(sessionId: string, args: Record<string, unknown>): void {
    // multiedit args structure: { edits: [{ filePath, ... }, ...] }
    const edits = args.edits as Array<{ filePath?: string; file_path?: string }> | undefined;
    if (!Array.isArray(edits)) {
      return;
    }

    for (const edit of edits) {
      const filePath = edit.filePath ?? edit.file_path;
      if (filePath && typeof filePath === "string") {
        enforceReadBeforeWrite(sessionId, filePath);
      }
    }
  }

  return {
    /**
     * Combined read tracking and enforcement handler.
     * 
     * SDK Constraint: tool.execute.after does NOT have access to output.args
     * (only title, output, metadata), so we must do everything in before hook.
     */
    "tool.execute.before": async (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
      },
      output: {
        args: Record<string, unknown>;
      }
    ): Promise<void> => {
      // Guard: missing sessionID (fail-open per FR-6)
      if (!input.sessionID) {
        log(WARNING_MESSAGES.missingSession());
        return;
      }

      const toolLower = input.tool.toLowerCase();

      // TRACKING: Record reads
      if (toolLower === "read") {
        const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as string | undefined;
        if (filePath && typeof filePath === "string") {
          const absolutePath = path.resolve(ctx.directory, filePath);
          registry.recordRead(input.sessionID, absolutePath);
        }
        return; // Read tracking done, exit early
      }

      // TRACKING: Record writes to NEW files as "read" (DD-8)
      // This enables create-then-edit workflows without blocking
      if (toolLower === "write") {
        const filePath = (output.args.filePath ?? output.args.file_path) as string | undefined;
        if (filePath && typeof filePath === "string") {
          const absolutePath = path.resolve(ctx.directory, filePath);
          // Only track if file doesn't exist (new file creation)
          if (!existsSync(absolutePath)) {
            registry.recordRead(input.sessionID, absolutePath);
            log(`[${HOOK_NAME}] New file write tracked as read: ${absolutePath}`);
          }
        }
      }

      // ENFORCEMENT: Only check write/edit/multiedit
      if (!["write", "edit", "multiedit"].includes(toolLower)) {
        return;
      }

      // Check tool exemption first (fast path)
      if (finalConfig.exempt_tools.includes(input.tool)) {
        log(`[${HOOK_NAME}] Tool exempt: ${input.tool}`);
        return;
      }

      // Handle single file (write/edit)
      if (toolLower === "write" || toolLower === "edit") {
        const filePath = (output.args.filePath ?? output.args.file_path) as string | undefined;
        if (!filePath) {
          return;
        }
        enforceReadBeforeWrite(input.sessionID, filePath);
      }

      // Handle multiedit (check each file individually)
      if (toolLower === "multiedit") {
        handleMultiedit(input.sessionID, output.args);
      }
    },

    /**
     * Event handler for session lifecycle cleanup.
     */
    event: async (input: { event: { type: string; properties?: unknown } }): Promise<void> => {
      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      // Clean up on session.deleted
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          registry.clearSession(sessionInfo.id);
        }
      }

      // Clean up on session.compacted (defensive pattern per codebase convention)
      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined;
        if (sessionID) {
          registry.clearSession(sessionID);
        }
      }
    },
  };
}
