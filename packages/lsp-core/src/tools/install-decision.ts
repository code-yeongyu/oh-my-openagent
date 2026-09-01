import { getMergedServers } from "../lsp/config-loader.js";
import { type InstallDecision, isInstallDecision, recordInstallDecision } from "../lsp/server-install-state.js";
import { requireString } from "./parameters.js";
import { text } from "./result.js";
import type { ToolExecutionResult } from "./types.js";

export async function executeLspInstallDecision(params: Record<string, unknown>): Promise<ToolExecutionResult> {
	const serverId = requireString(params, "server_id");
	const decision = params["decision"];
	if (!isInstallDecision(decision)) {
		return text(
			`Invalid decision '${String(decision)}'. Expected "declined" or "allowed".`,
			{ serverId, errorKind: "invalid_decision" },
			true,
		);
	}

	const serverIds = [...new Set(getMergedServers().map((server) => server.id))];
	if (!serverIds.includes(serverId)) {
		const preview = serverIds.slice(0, 20).join(", ");
		return text(
			`Unknown LSP server '${serverId}'. Known servers: ${preview}${serverIds.length > 20 ? "..." : ""}`,
			{ serverId, errorKind: "unknown_server" },
			true,
		);
	}

	recordInstallDecision(serverId, decision);
	return text(`Recorded install decision for '${serverId}': ${decision}. ${decisionFollowUp(decision)}`, {
		serverId,
		decision,
	});
}

function decisionFollowUp(decision: InstallDecision): string {
	return decision === "declined"
		? "Future LSP lookups for this server stay quiet; proceed without LSP."
		: "Future LSP lookups keep install instructions without asking the user.";
}
