import type { PostEditDiagnosticsOutcome } from "@oh-my-opencode/lsp-core/post-edit"

interface DaemonToolResult {
	readonly content: readonly { readonly type: string; readonly text?: string }[]
	readonly details?: unknown
}

export function postEditOutcomeFromDaemonResult(result: DaemonToolResult): PostEditDiagnosticsOutcome {
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n")
	const availability = availabilityDetails(result.details)
	if (availability === undefined) return text
	if (availability["kind"] === "not_configured") {
		const extension = availability["extension"]
		return typeof extension === "string" ? { kind: "not_configured", extension } : text
	}
	if (availability["kind"] === "not_installed") return notInstalledOutcome(availability, text) ?? text
	return text
}

function notInstalledOutcome(availability: Record<string, unknown>, text: string): PostEditDiagnosticsOutcome | undefined {
	const serverId = availability["serverId"]
	const installDecisionTool = availability["installDecisionTool"]
	if (typeof serverId !== "string" || serverId.length === 0 || typeof installDecisionTool !== "boolean") return undefined
	const decision = availability["decision"]
	const base = { kind: "not_installed", serverId, installDecisionTool, text } as const
	return decision === "declined" || decision === "allowed" ? { ...base, decision } : base
}

function availabilityDetails(details: unknown): Record<string, unknown> | undefined {
	if (!isRecord(details)) return undefined
	const availability = details["availability"]
	return isRecord(availability) ? availability : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
