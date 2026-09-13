// Explicit selectors, pinned by a test to the bundled role TOMLs. The generated
// default is a non-fork fallback, not a selector: a user can opt out of owning it.
export const LAZYCODEX_SPAWN_ROLES: ReadonlySet<string> = new Set([
	"explorer",
	"lazycodex-clone-fidelity-reviewer",
	"lazycodex-code-reviewer",
	"lazycodex-gate-reviewer",
	"lazycodex-qa-executor",
	"lazycodex-worker-high",
	"lazycodex-worker-low",
	"lazycodex-worker-medium",
	"librarian",
	"metis",
	"momus",
	"plan",
]);

export function spawnRoleDenial(input: unknown): string | null {
	const role = typeof input === "object" && input !== null && "agent_type" in input ? input.agent_type : undefined;
	if (typeof role === "string" && LAZYCODEX_SPAWN_ROLES.has(role)) return null;
	return `LazyCodex requires an explicit registered agent_type: ${[...LAZYCODEX_SPAWN_ROLES].join(", ")}. Received ${JSON.stringify(role) ?? "no agent_type"}. Use the matching role and fork_turns: "none" (V2) or fork_context: false (V1), unless full history is deliberately required. The hook cannot see the tool schema; if agent_type is unavailable, stop and report incompatible role routing rather than spawning a generic agent. Describing a role in message does not select its TOML.`;
}
