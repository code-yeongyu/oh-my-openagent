export const ULW_LOOP_CREATE_GOALS_COMMAND = 'omo-agent-toolkit ulw-loop create-goals --brief "<brief>" --json';

export interface PlanMissingRecovery {
	readonly message: string;
	readonly details?: { readonly existingSessionIds: readonly string[] };
}

/**
 * A missing plan is either "never bootstrapped" or "bootstrapped under a different
 * session id"; the recovery text has to answer both without the caller guessing.
 */
export function planMissingRecovery(existingSessionIds: readonly string[]): PlanMissingRecovery {
	const lines = [`Recovery: bootstrap the plan with \`${ULW_LOOP_CREATE_GOALS_COMMAND}\`.`];
	if (existingSessionIds.length === 0) return { message: lines.join("\n") };
	lines.push(
		`Existing ulw-loop session ids under .omo/ulw-loop/: ${existingSessionIds.join(", ")}. Re-run with \`--session-id <id>\` to target one of them.`,
	);
	return { message: lines.join("\n"), details: { existingSessionIds } };
}

export function sessionIdRequiredMessage(flag: string): string {
	return [
		`${flag} requires a non-empty value.`,
		"Recovery: subprocess, eval, and hook contexts do not inherit the ulw-loop session env (OMO_ULW_LOOP_SESSION_ID / CODEX_SESSION_ID / CODEX_THREAD_ID / PI_SESSION_ID),",
		`so pass the scope explicitly: \`${flag} <id>\` (for example \`${flag} 01a05b8a-6763-7780-834f-319423b071ce\`).`,
	].join("\n");
}
