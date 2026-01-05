import type { PluginInput } from "@opencode-ai/plugin";
import type {
	BashToolArgs,
	EditToolArgs,
	ReadToolArgs,
	ToolExecuteBeforeOutput,
	ToolExecuteInput,
	ToolExecuteOutput,
	WriteToolArgs,
} from "./types";
import {
	checkComplianceViolations,
	checkDangerousBashCommand,
	isProtectedFile,
} from "./utils";

export function createEnterpriseSecurityHook(_ctx: PluginInput) {
	const toolExecuteBefore = async (
		input: ToolExecuteInput,
		output: ToolExecuteBeforeOutput,
	) => {
		const toolName = input.tool.toLowerCase();

		if (toolName === "read" || toolName === "write" || toolName === "edit") {
			const args = output.args as ReadToolArgs | WriteToolArgs | EditToolArgs;
			const filePath = args.filePath;

			if (filePath) {
				const protection = isProtectedFile(filePath);
				if (protection.blocked) {
					output.blocked = true;
					output.message = `SECURITY: Access to protected file denied.\nFile: ${filePath}\nReason: ${protection.reason}\n\nProtected files include: .env, .ssh/*, secrets/, credentials, API keys, etc.`;
					return;
				}
			}
		}

		if (toolName === "write" || toolName === "edit") {
			const args = output.args as WriteToolArgs | EditToolArgs;
			const content =
				"content" in args
					? args.content
					: "newString" in args
						? args.newString
						: "";

			if (content) {
				const violations = checkComplianceViolations(content);
				if (violations.length > 0) {
					const errorViolations = violations.filter(
						(v) => v.severity === "error",
					);
					const warningViolations = violations.filter(
						(v) => v.severity === "warning",
					);

					let message =
						"COMPLIANCE WARNING: Potential security issues detected.\n\n";

					if (errorViolations.length > 0) {
						message += "ERRORS (must fix):\n";
						for (const violation of errorViolations) {
							message += `  - ${violation.type}: ${violation.pattern}\n`;
						}
					}

					if (warningViolations.length > 0) {
						message += "\nWARNINGS (review recommended):\n";
						for (const violation of warningViolations) {
							message += `  - ${violation.type}\n`;
						}
					}

					message += "\nFor SOC2/GDPR/HIPAA compliance:\n";
					message += "  - Remove hardcoded credentials\n";
					message += "  - Use environment variables for secrets\n";
					message += "  - Ensure PII is not logged or exposed\n";
					message += "  - Use proper data encryption\n";

					if (errorViolations.length > 0) {
						output.blocked = true;
						output.message = message;
						return;
					}

					console.warn(message);
				}
			}
		}

		if (toolName === "bash") {
			const args = output.args as BashToolArgs;
			const command = args.command;

			if (command) {
				const check = checkDangerousBashCommand(command);
				if (check.dangerous) {
					output.blocked = true;
					output.message = `SECURITY: Dangerous bash command blocked.\nCommand: ${command}\nReason: ${check.reason}\n\nDangerous commands include: rm -rf /, fork bombs, disk wiping, curl|bash, etc.`;
					return;
				}

				if (
					command.includes("curl") &&
					command.includes("-d") &&
					command.includes("password")
				) {
					console.warn(
						"WARNING: Potential credential exposure in HTTP request. Consider using secure methods.",
					);
				}

				if (
					(command.includes("mysqldump") ||
						command.includes("pg_dump") ||
						command.includes("mongodump")) &&
					!command.includes("ssl") &&
					!command.includes("encryption") &&
					!command.includes("gpg")
				) {
					console.warn(
						"WARNING: Database export without encryption detected. Consider encrypting sensitive data exports for compliance.",
					);
				}
			}
		}
	};

	const toolExecuteAfter = async (
		_input: ToolExecuteInput,
		output: ToolExecuteOutput,
	) => {
		if (output.output) {
			const violations = checkComplianceViolations(output.output);
			if (violations.length > 0) {
				const warningViolations = violations.filter(
					(v) => v.severity === "warning",
				);
				if (warningViolations.length > 0) {
					console.warn(
						`COMPLIANCE: Tool output may contain sensitive data (${warningViolations.map((v) => v.type).join(", ")}). Review before sharing.`,
					);
				}
			}
		}
	};

	return {
		"tool.execute.before": toolExecuteBefore,
		"tool.execute.after": toolExecuteAfter,
	};
}
