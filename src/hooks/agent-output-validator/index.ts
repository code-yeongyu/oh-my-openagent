import type { PluginInput } from "@opencode-ai/plugin";
import {
  validateCommanderOutput,
} from "../../shared/commander-validator";
import {
  validateOracleOutput,
} from "../../shared/reviewer-validator";
import { log } from "../../shared/logger";

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface AgentOutputValidatorConfig {
  disableCommanderValidation: boolean;
  disableOracleValidation: boolean;
  disableImplementationDetection: boolean;
}

/**
 * Agent Output Validator Hook
 *
 * Validates agent output format and prevents implementation code from non-implementation agents.
 *
 * Validates:
 * 1. Oracle output: VERDICT + CRITERIA CHECK table + no implementation code
 * 2. Commander output: VERDICT + required sections + no implementation code
 * 3. Other agents: no restrictions
 *
 * Detection:
 * - Oracle: Output contains "CRITERIA CHECK"
 * - Commander: Output contains "FILES/FUNCTIONS TO CHANGE" or "TASKS FOR IMPLEMENTER"
 * - Implementation code: Output suggests using edit/write/bash tools
 */
export function createAgentOutputValidatorHook(_ctx: PluginInput) {
  const config: AgentOutputValidatorConfig = {
    disableCommanderValidation: false,
    disableOracleValidation: false,
    disableImplementationDetection: false,
  };

  function detectAgentType(output: string): "oracle" | "commander" | "other" {
    const outputUpper = output.toUpperCase();

    // Check for Oracle markers
    if (outputUpper.includes("CRITERIA CHECK")) {
      return "oracle";
    }

    // Check for Commander markers
    if (
      outputUpper.includes("FILES/FUNCTIONS TO CHANGE") ||
      outputUpper.includes("TASKS FOR IMPLEMENTER")
    ) {
      return "commander";
    }

    return "other";
  }

  function detectImplementationCode(output: string): {
    hasImplementation: boolean;
    detectedTools: string[];
    evidence: string[];
  } {
    const evidence: string[] = [];
    const detectedTools: string[] = [];
    const outputLower = output.toLowerCase();

    // Check for edit/write tool usage
    if (
      outputLower.includes("edit(") ||
      outputLower.includes('edit("') ||
      outputLower.includes("write(") ||
      outputLower.includes('write("') ||
      outputLower.includes("filesystem_") ||
      outputLower.includes("sed ") ||
      outputLower.includes("awk ")
    ) {
      evidence.push("Suggests file edit operations (edit, write, sed, awk)");
      detectedTools.push("file-edit");
    }

    // Check for bash/command execution
    if (
      outputLower.includes("bash(") ||
      outputLower.includes('bash("') ||
      outputLower.includes("run:") ||
      outputLower.includes("execute:") ||
      outputLower.includes("npm run") ||
      outputLower.includes("git ") ||
      outputLower.includes("bun run")
    ) {
      evidence.push("Suggests command execution (bash, npm run, git, etc.)");
      detectedTools.push("bash");
    }

    // Check for implementation keywords
    if (
      outputLower.includes("here's code") ||
      outputLower.includes("here's how to implement") ||
      outputLower.includes("implementation:") ||
      outputLower.includes("let me implement") ||
      outputLower.includes("i'll implement")
    ) {
      evidence.push("Contains implementation language");
      detectedTools.push("implementation");
    }

    // Check for code block suggestions (excluding VERDICT/CRITERIA tables)
    const codeBlocks = output.match(/```[\s\S]*?```/g) || [];
    for (const block of codeBlocks) {
      const trimmedBlock = block.trim().replace(/```[a-z]*\n?/gi, "");
      if (
        trimmedBlock.length > 50 && // Substantial code
        !trimmedBlock.includes("VERDICT") && // Not a verdict table
        !trimmedBlock.includes("CRITERIA") && // Not a criteria table
        !trimmedBlock.includes("| # |") // Not a markdown table
      ) {
        evidence.push("Contains substantial code block");
        detectedTools.push("code-block");
        break;
      }
    }

    return {
      hasImplementation: detectedTools.length > 0,
      detectedTools,
      evidence,
    };
  }

  function formatValidationError(errors: string[]): string {
    return `\n\n[AGENT OUTPUT VALIDATION ERROR]\n\nThe agent output failed validation:\n\n${errors
      .map((e, i) => `  ${i + 1}. ${e}`)
      .join("\n")}\n\nPlease retry with correct format.`;
  }

  function formatImplementationWarning(
    agentType: "oracle" | "commander",
    detectedTools: string[],
    evidence: string[]
  ): string {
    const agentName = agentType === "oracle" ? "Oracle (Codex)" : "Commander (Claude)";
    const prohibited = agentType === "oracle" ? "review" : "specification and planning";

    return `\n\n[AGENT RESPONSIBILITY VIOLATION]\n\n${agentName} is PROHIBITED from implementing code.\n\nDetected implementation evidence:\n${evidence
      .map((e, i) => `  ${i + 1}. ${e}`)
      .join("\n")}\n\n${agentName} responsibilities:\n- Provide ${prohibited} only\n- Output structured format (VERDICT + CRITERIA CHECK / sections)\n- Report issues without fixing them\n\nImplementation must be done by: GLM-4.7 (Build agent)\n\nRetry with proper responsibilities.`;
  }

  function validateOracleOutputAndReport(
    output: string
  ): { valid: boolean; error: string | null } {
    const result = validateOracleOutput(output);

    if (!result.isValid) {
      return {
        valid: false,
        error: formatValidationError(result.errors),
      };
    }

    // Check for implementation code in Oracle output
    if (!config.disableImplementationDetection) {
      const detection = detectImplementationCode(output);
      if (detection.hasImplementation) {
        return {
          valid: false,
          error: formatImplementationWarning(
            "oracle",
            detection.detectedTools,
            detection.evidence
          ),
        };
      }
    }

    return { valid: true, error: null };
  }

  function validateCommanderOutputAndReport(
    output: string
  ): { valid: boolean; error: string | null } {
    const result = validateCommanderOutput(output);

    if (!result.isValid) {
      return {
        valid: false,
        error: formatValidationError(result.errors),
      };
    }

    // Check for implementation code in Commander output
    if (!config.disableImplementationDetection) {
      const detection = detectImplementationCode(output);
      if (detection.hasImplementation) {
        return {
          valid: false,
          error: formatImplementationWarning(
            "commander",
            detection.detectedTools,
            detection.evidence
          ),
        };
      }
    }

    return { valid: true, error: null };
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ): Promise<void> => {
    log("[agent-output-validator] Hook called!", { tool: input.tool, sessionID: input.sessionID });
    const { tool } = input;
    const toolLower = tool.toLowerCase();

    // Only validate agent tools
    const agentTools = new Set([
      "task",
      "call_omo_agent",
      "background_task",
    ]);

    if (!agentTools.has(toolLower)) {
      return;
    }

    // Hook cannot be disabled via Claude Code hooks config
    // This is a standalone validation hook

    // Detect agent type from output
    const agentType = detectAgentType(output.output);
    log("[agent-output-validator] Detected agent type", { agentType, outputLength: output.output.length });

    // Validate based on agent type
    let validationResult: { valid: boolean; error: string | null };

    if (agentType === "oracle" && !config.disableOracleValidation) {
      validationResult = validateOracleOutputAndReport(output.output);
      log(`[agent-output-validator] Validating Oracle output: ${validationResult.valid ? "PASS" : "FAIL"}`);
    } else if (agentType === "commander" && !config.disableCommanderValidation) {
      validationResult = validateCommanderOutputAndReport(output.output);
      log(`[agent-output-validator] Validating Commander output: ${validationResult.valid ? "PASS" : "FAIL"}`);
    } else {
      // Not Oracle or Commander, skip validation
      return;
    }

    // If validation failed, append error to output
    if (!validationResult.valid && validationResult.error) {
      output.output += validationResult.error;
      log(`[agent-output-validator] Validation failed. Error appended to output.`);
    }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
  };
}
