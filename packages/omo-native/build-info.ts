/** Build provenance stamped into compiled dev binaries. */
export interface BuildComponentInfo {
	readonly commit: string
	readonly committedAt: string
	readonly branch: string
}

export interface OmoBuildInfo {
	readonly command: string
	readonly omo: BuildComponentInfo
	readonly engine: BuildComponentInfo
}

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/

function parseComponent(raw: unknown): BuildComponentInfo | undefined {
	if (typeof raw !== "object" || raw === null) return undefined
	const candidate = raw as { commit?: unknown; committedAt?: unknown; branch?: unknown }
	if (typeof candidate.commit !== "string" || !FULL_SHA_PATTERN.test(candidate.commit)) return undefined
	if (typeof candidate.committedAt !== "string" || !ISO_DATE_PATTERN.test(candidate.committedAt)) return undefined
	if (typeof candidate.branch !== "string" || candidate.branch.length === 0) return undefined
	return { commit: candidate.commit, committedAt: candidate.committedAt, branch: candidate.branch }
}

/** Parses a stamped omoBuild payload; undefined for anything malformed. */
export function parseBuildInfo(raw: unknown): OmoBuildInfo | undefined {
	if (typeof raw !== "object" || raw === null) return undefined
	const candidate = raw as { command?: unknown; omo?: unknown; engine?: unknown }
	if (typeof candidate.command !== "string" || candidate.command.length === 0) return undefined
	const omo = parseComponent(candidate.omo)
	const engine = parseComponent(candidate.engine)
	if (omo === undefined || engine === undefined) return undefined
	return { command: candidate.command, omo, engine }
}

export function shortSha(commit: string): string {
	return commit.slice(0, 7)
}

/** "2026-09-04T10:17:49+09:00" -> "2026-09-04 10:17 +09:00" (seconds dropped) */
function humanCommitDate(iso: string): string {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?(.*)$/.exec(iso)
	if (match === null) return iso
	return `${match[1]} ${match[2]}:${match[3]}${match[4] ? ` ${match[4]}` : ""}`
}

/** One-line label the TUI header shows instead of a version. */
export function buildLabel(info: OmoBuildInfo): string {
	return `omo@${shortSha(info.omo.commit)} ${humanCommitDate(info.omo.committedAt)} · senpi@${shortSha(info.engine.commit)} ${humanCommitDate(info.engine.committedAt)}`
}

/** Multi-line provenance for --version and doctor output. */
export function versionLines(info: OmoBuildInfo): string[] {
	return [
		`${info.command} dev build`,
		`omo   ${info.omo.commit} ${info.omo.committedAt} (${info.omo.branch})`,
		`senpi ${info.engine.commit} ${info.engine.committedAt} (${info.engine.branch})`,
	]
}
