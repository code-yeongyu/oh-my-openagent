import type { PostEditFileLocation } from "./file-location.js";

export interface PostEditNotInstalledOutcome {
	readonly kind: "not_installed";
	readonly serverId: string;
	readonly installDecisionTool: boolean;
	/** A recorded install decision; absent while the user has not decided. */
	readonly decision?: "declined" | "allowed";
	readonly text: string;
}

export interface NotInstalledGuidanceState {
	readonly notInstalledServers: Set<string>;
}

/**
 * Decides whether a missing-server nudge reaches the model.
 *
 * Recorded decisions keep their own text. Undecided nudges are skipped for files outside a project
 * (no marked root, the agent's config dir, or a temp dir) because a repo-local install there would
 * create a manifest in HOME or a temp dir. Without a decision tool nothing can be recorded, so a
 * server is nudged at most once per session state.
 */
export function notInstalledGuidance(
	filePath: string,
	outcome: PostEditNotInstalledOutcome,
	state: NotInstalledGuidanceState,
	locateFile: ((filePath: string) => PostEditFileLocation) | undefined,
): string | undefined {
	if (outcome.decision !== undefined) return outcome.text;
	if (locateFile !== undefined && locateFile(filePath) !== "project") return undefined;
	if (outcome.installDecisionTool) return outcome.text;
	if (state.notInstalledServers.has(outcome.serverId)) return undefined;
	state.notInstalledServers.add(outcome.serverId);
	return outcome.text;
}
