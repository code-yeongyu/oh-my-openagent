import type { PluginInput } from "@opencode-ai/plugin";
import type { SecurityScannerConfig } from "./types";
import { scanContent, formatScanResult } from "./scanner";
import { getAllPatterns } from "./patterns";
import { DEFAULT_SECURITY_SCANNER_CONFIG, SECURITY_SCANNER_NAME } from "./constants";
import { log } from "../../shared";

export type { SecurityScannerConfig, SecretPattern, SecretMatch, ScanResult } from "./types";
export { scanContent, formatScanResult, maskSecret } from "./scanner";
export { DEFAULT_SECRET_PATTERNS, getAllPatterns } from "./patterns";
export { DEFAULT_SECURITY_SCANNER_CONFIG, SECURITY_SCANNER_NAME } from "./constants";

export function createSecurityScannerHook(
  _ctx: PluginInput,
  config?: Partial<SecurityScannerConfig>
) {
  // Merge config with defaults, filtering out undefined values to prevent overwriting
  const fullConfig: SecurityScannerConfig = {
    ...DEFAULT_SECURITY_SCANNER_CONFIG,
    ...(config?.enabled !== undefined && { enabled: config.enabled }),
    ...(config?.patterns !== undefined && { patterns: config.patterns }),
    ...(config?.allowListPatterns !== undefined && { allowListPatterns: config.allowListPatterns }),
    ...(config?.scanOnWrite !== undefined && { scanOnWrite: config.scanOnWrite }),
    ...(config?.scanOnEdit !== undefined && { scanOnEdit: config.scanOnEdit }),
    ...(config?.maskInOutput !== undefined && { maskInOutput: config.maskInOutput }),
  };

  if (!fullConfig.enabled) {
    return {
      "tool.execute.before": async () => {},
      "tool.execute.after": async () => {},
    };
  }

  const patterns = getAllPatterns(fullConfig.patterns);

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      const toolLower = input.tool.toLowerCase();
      
      const shouldScan =
        (toolLower === "write" && fullConfig.scanOnWrite) ||
        (toolLower === "edit" && fullConfig.scanOnEdit);

      if (!shouldScan) {
        return;
      }

      const filePath = (output.args.filePath ?? output.args.file_path) as string | undefined;
      let contentToScan: string | undefined;

      if (toolLower === "write") {
        contentToScan = output.args.content as string | undefined;
      } else if (toolLower === "edit") {
        contentToScan = (output.args.newString ?? output.args.new_string) as string | undefined;
      }

      if (!contentToScan) {
        return;
      }

      const result = scanContent(contentToScan, patterns, fullConfig.allowListPatterns);

      if (result.hasSecrets) {
        log(`[${SECURITY_SCANNER_NAME}] Secrets detected in ${filePath || "content"}`);
        
        const hasCritical = result.matches.some((m) => m.severity === "critical");
        
        if (hasCritical) {
          const errorMessage = formatScanResult(result, filePath);
          throw new Error(`🔐 Security Scan Failed:\n\n${errorMessage}`);
        }
      }
    },

    "tool.execute.after": async (
      _input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      if (!fullConfig.maskInOutput) {
        return;
      }

      const result = scanContent(output.output, patterns, fullConfig.allowListPatterns);

      if (result.hasSecrets) {
        let maskedOutput = output.output;
        
        for (const match of result.matches) {
          const regex = new RegExp(match.pattern, "g");
          maskedOutput = maskedOutput.replace(regex, (found) => {
            const prefix = found.slice(0, 4);
            const suffix = found.slice(-4);
            return `${prefix}${"*".repeat(Math.min(found.length - 8, 20))}${suffix}`;
          });
        }

        output.output = maskedOutput;
        log(`[${SECURITY_SCANNER_NAME}] Masked ${result.matches.length} secrets in output`);
      }
    },
  };
}
