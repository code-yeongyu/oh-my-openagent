/**
 * Idempotent-tool allowlist for daemon request retries (PR #6256 review).
 *
 * The review rejected the previous approach of classifying every post-write
 * socket close/error as "unwritten": that silently reverts the at-most-once
 * boundary for disk-writing tools (`format`, `install_decision`) and mutating
 * tools (`rename`), because a request whose commit status is unknown may have
 * already been executed by the daemon.
 *
 * Only explicitly idempotent (read-only) tools may be retried after a
 * mid-request socket close/error. Everything else keeps at-most-once
 * semantics: when `requestWritten` is true and the outcome is indeterminate,
 * the client must not resend.
 *
 * Keep this list in sync with `LSP_MCP_TOOLS` in
 * `packages/lsp-core/src/tools/definitions.ts`. A new read-only tool must be
 * added here before its requests can survive a daemon restart mid-flight.
 */
const IDEMPOTENT_TOOLS: ReadonlySet<string> = new Set([
	"status",
	"diagnostics",
	"goto_definition",
	"find_references",
	"symbols",
	"prepare_rename",
]);

export function isIdempotentTool(name: string): boolean {
	return IDEMPOTENT_TOOLS.has(name);
}
