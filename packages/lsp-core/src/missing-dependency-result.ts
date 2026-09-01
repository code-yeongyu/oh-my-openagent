import { LspServerLookupError } from "./lsp/errors.js";
import { handleMissingDependencyError } from "./lsp/startup-failure.js";
import { lspRequestContext } from "./request-context.js";
import type { ToolExecutionResult } from "./tools.js";

export type MissingDependencyAvailability =
	| {
			readonly kind: "not_configured";
			readonly extension: string;
			readonly availableServers: readonly string[];
			readonly projectConfigPaths: readonly string[];
			readonly userConfigPath: string;
			readonly installDecisionTool: boolean;
	  }
	| {
			readonly kind: "not_installed";
			readonly serverId: string;
			readonly command: readonly string[];
			readonly extensions: readonly string[];
			readonly installHint: string;
			readonly installDecisionTool: boolean;
			readonly installDecisionsPath: string;
	  };

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
			...availabilityDetails(error),
		},
	};
}

function availabilityDetails(error: unknown): { readonly availability: MissingDependencyAvailability } | object {
	const availability = missingDependencyAvailability(error);
	return availability === null ? {} : { availability };
}

function missingDependencyAvailability(error: unknown): MissingDependencyAvailability | null {
	if (!(error instanceof LspServerLookupError) || error.lookup === undefined) return null;
	const context = lspRequestContext();
	switch (error.lookup.status) {
		case "not_configured":
			return {
				kind: "not_configured",
				extension: error.lookup.extension,
				availableServers: [...error.lookup.availableServers],
				projectConfigPaths: [...context.projectConfigPaths],
				userConfigPath: context.userConfigPath,
				installDecisionTool: context.capabilities.installDecisionTool,
			};
		case "not_installed":
			return {
				kind: "not_installed",
				serverId: error.lookup.server.id,
				command: [...error.lookup.server.command],
				extensions: [...error.lookup.server.extensions],
				installHint: error.lookup.installHint,
				installDecisionTool: context.capabilities.installDecisionTool,
				installDecisionsPath: context.installDecisionsPath,
			};
		default: {
			const exhaustive: never = error.lookup;
			return exhaustive;
		}
	}
}
