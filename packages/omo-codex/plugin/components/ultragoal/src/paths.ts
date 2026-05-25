import { join } from "node:path";
import { ULTRAGOAL_BRIEF, ULTRAGOAL_DIR, ULTRAGOAL_GOALS, ULTRAGOAL_LEDGER } from "./types.js";

export function ultragoalDir(repoRoot: string): string {
	return join(repoRoot, ULTRAGOAL_DIR);
}

export function ultragoalBriefPath(repoRoot: string): string {
	return join(ultragoalDir(repoRoot), ULTRAGOAL_BRIEF);
}

export function ultragoalGoalsPath(repoRoot: string): string {
	return join(ultragoalDir(repoRoot), ULTRAGOAL_GOALS);
}

export function ultragoalLedgerPath(repoRoot: string): string {
	return join(ultragoalDir(repoRoot), ULTRAGOAL_LEDGER);
}

export function repoRelative(absolutePath: string, repoRoot: string): string {
	const slashPrefix = `${repoRoot}/`;
	const backslashPrefix = `${repoRoot}\\`;
	if (absolutePath.startsWith(slashPrefix)) return absolutePath.slice(slashPrefix.length).split("\\").join("/");
	if (absolutePath.startsWith(backslashPrefix))
		return absolutePath.slice(backslashPrefix.length).split("\\").join("/");
	return absolutePath.split("\\").join("/");
}
