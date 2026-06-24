import { handleMissingDependencyError } from "./lsp/startup-failure.js";
import type { ToolExecutionResult } from "./tools.js";

export function missingDependencyResult<TDetails extends object>(
	error: unknown,
	details: TDetails,
): ToolExecutionResult | null {
	const message = handleMissingDependencyError(error);
	if (!message) return null;

	return {
		content: [{ type: "text", text: message }],
		details: {
			...details,
			error: message,
			errorKind: "missing_dependency",
		},
	};
}
