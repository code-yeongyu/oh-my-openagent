import { join } from "node:path";
import { ULW_LOOP_BRIEF, ULW_LOOP_DIR, ULW_LOOP_GOALS, ULW_LOOP_LEDGER } from "./types.js";

export function ulwLoopDir(repoRoot: string): string {
	return join(repoRoot, ULW_LOOP_DIR);
}

export function ulwLoopBriefPath(repoRoot: string): string {
	return join(ulwLoopDir(repoRoot), ULW_LOOP_BRIEF);
}

export function ulwLoopGoalsPath(repoRoot: string): string {
	return join(ulwLoopDir(repoRoot), ULW_LOOP_GOALS);
}

export function ulwLoopLedgerPath(repoRoot: string): string {
	return join(ulwLoopDir(repoRoot), ULW_LOOP_LEDGER);
}

export function repoRelative(absolutePath: string, repoRoot: string): string {
	const slashPrefix = `${repoRoot}/`;
	const backslashPrefix = `${repoRoot}\\`;
	if (absolutePath.startsWith(slashPrefix)) return absolutePath.slice(slashPrefix.length).split("\\").join("/");
	if (absolutePath.startsWith(backslashPrefix))
		return absolutePath.slice(backslashPrefix.length).split("\\").join("/");
	return absolutePath.split("\\").join("/");
}
