import { join } from "node:path";

import type { UltragoalScope } from "./session-scope.js";
import {
	ULTRAGOAL_BRIEF,
	ULTRAGOAL_DIR,
	ULTRAGOAL_GOALS,
	ULTRAGOAL_INDEX,
	ULTRAGOAL_LEDGER,
	ULTRAGOAL_SESSIONS,
} from "./types.js";

/** Root `./.omo/ultragoal` directory for a repo. */
export function ultragoalRootDir(repoRoot: string): string {
	return join(repoRoot, ULTRAGOAL_DIR);
}

/** `./.omo/ultragoal/sessions` directory holding all per-session scopes. */
export function ultragoalSessionsRoot(repoRoot: string): string {
	return join(ultragoalRootDir(repoRoot), ULTRAGOAL_SESSIONS);
}

/** Per-repo session registry path `./.omo/ultragoal/index.json`. */
export function ultragoalIndexPath(repoRoot: string): string {
	return join(ultragoalRootDir(repoRoot), ULTRAGOAL_INDEX);
}

/** Per-session content directory `./.omo/ultragoal/sessions/<scope>`. */
export function ultragoalSessionDir(scope: UltragoalScope): string {
	return join(ultragoalSessionsRoot(scope.repoRoot), scope.sessionScope);
}

/** Backwards-compatible alias used by the rest of the codebase. */
export function ultragoalDir(scope: UltragoalScope): string {
	return ultragoalSessionDir(scope);
}

export function ultragoalBriefPath(scope: UltragoalScope): string {
	return join(ultragoalSessionDir(scope), ULTRAGOAL_BRIEF);
}

export function ultragoalGoalsPath(scope: UltragoalScope): string {
	return join(ultragoalSessionDir(scope), ULTRAGOAL_GOALS);
}

export function ultragoalLedgerPath(scope: UltragoalScope): string {
	return join(ultragoalSessionDir(scope), ULTRAGOAL_LEDGER);
}

// --- Legacy repo-level getters (read-only, for v1 -> v2 migration) ---

/** Legacy v1 goals path `./.omo/ultragoal/goals.json` (repo-level, no session). */
export function legacyUltragoalGoalsPath(repoRoot: string): string {
	return join(ultragoalRootDir(repoRoot), ULTRAGOAL_GOALS);
}

/** Legacy v1 brief path `./.omo/ultragoal/brief.md`. */
export function legacyUltragoalBriefPath(repoRoot: string): string {
	return join(ultragoalRootDir(repoRoot), ULTRAGOAL_BRIEF);
}

/** Legacy v1 ledger path `./.omo/ultragoal/ledger.jsonl`. */
export function legacyUltragoalLedgerPath(repoRoot: string): string {
	return join(ultragoalRootDir(repoRoot), ULTRAGOAL_LEDGER);
}

export function repoRelative(absolutePath: string, repoRoot: string): string {
	const slashPrefix = `${repoRoot}/`;
	const backslashPrefix = `${repoRoot}\\`;
	if (absolutePath.startsWith(slashPrefix)) return absolutePath.slice(slashPrefix.length).split("\\").join("/");
	if (absolutePath.startsWith(backslashPrefix))
		return absolutePath.slice(backslashPrefix.length).split("\\").join("/");
	return absolutePath.split("\\").join("/");
}
