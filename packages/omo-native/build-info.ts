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

/** `epoch`: a compile-time epoch was derived. `nodef`: it was not, so I2 never hands off. */
export type EngineBuildScheme = "epoch" | "nodef"
export type EngineBuildSource = "buildInfo" | "senpi-package" | "omitted"

export interface EngineBuildStamp {
	readonly scheme: EngineBuildScheme
	readonly epoch: number
	readonly sha7: string
	readonly source: EngineBuildSource
}

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const SHORT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/
const OMITTED_STAMP: EngineBuildStamp = { scheme: "nodef", epoch: 0, sha7: "", source: "omitted" }

function parseEngineBuildSource(raw: unknown): EngineBuildSource | undefined {
	if (raw === "buildInfo" || raw === "senpi-package" || raw === "omitted") return raw
	return undefined
}

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

/** Converts a known ISO timestamp to unix seconds. Never invents an epoch. */
export function unixSecondsFromCommittedAt(iso: string): number | undefined {
	const ms = Date.parse(iso)
	if (!Number.isFinite(ms)) return undefined
	const seconds = Math.trunc(ms / 1000)
	if (seconds <= 0) return undefined
	return seconds
}

function epochFromMetadata(raw: unknown): number | undefined {
	if (typeof raw === "number") {
		if (!Number.isSafeInteger(raw) || raw <= 0) return undefined
		return raw
	}
	if (typeof raw !== "string") return undefined
	if (ISO_DATE_PATTERN.test(raw)) return unixSecondsFromCommittedAt(raw)
	if (/^[0-9]+$/.test(raw)) {
		const epoch = Number(raw)
		if (!Number.isSafeInteger(epoch) || epoch <= 0) return undefined
		return epoch
	}
	return undefined
}

function sha7FromGitHead(raw: unknown): string | undefined {
	if (typeof raw !== "string" || !SHORT_SHA_PATTERN.test(raw)) return undefined
	return raw.toLowerCase().slice(0, 7)
}

export function engineBuildStampFromComponent(
	component: BuildComponentInfo,
	source: "buildInfo",
): EngineBuildStamp | undefined {
	const epoch = unixSecondsFromCommittedAt(component.committedAt)
	if (epoch === undefined) return undefined
	return { scheme: "epoch", epoch, sha7: shortSha(component.commit), source }
}

function engineBuildStampFromSenpiPackage(raw: unknown): EngineBuildStamp | undefined {
	if (typeof raw !== "object" || raw === null) return undefined
	const candidate = raw as {
		gitHead?: unknown
		committedAt?: unknown
		gitCommittedAt?: unknown
		gitHeadCommittedAt?: unknown
	}
	const sha7 = sha7FromGitHead(candidate.gitHead)
	const epoch =
		epochFromMetadata(candidate.committedAt) ??
		epochFromMetadata(candidate.gitCommittedAt) ??
		epochFromMetadata(candidate.gitHeadCommittedAt)
	if (sha7 === undefined || epoch === undefined) return undefined
	return { scheme: "epoch", epoch, sha7, source: "senpi-package" }
}

/** Parses a stamped engineBuild payload; undefined for anything malformed. */
export function parseEngineBuildStamp(raw: unknown): EngineBuildStamp | undefined {
	if (typeof raw !== "object" || raw === null) return undefined
	const candidate = raw as { scheme?: unknown; epoch?: unknown; sha7?: unknown; source?: unknown }
	if (candidate.scheme !== "epoch" && candidate.scheme !== "nodef") return undefined
	const source = parseEngineBuildSource(candidate.source)
	if (source === undefined) return undefined
	if (typeof candidate.epoch !== "number" || !Number.isSafeInteger(candidate.epoch) || candidate.epoch < 0) {
		return undefined
	}
	if (typeof candidate.sha7 !== "string") return undefined
	if (candidate.scheme === "epoch" && (candidate.epoch === 0 || candidate.sha7.length !== 7)) return undefined
	return { scheme: candidate.scheme, epoch: candidate.epoch, sha7: candidate.sha7, source }
}

/** Resolves the stamp a compile should embed. Missing metadata degrades to `nodef`. */
export function resolveEngineBuildStamp(input: {
	readonly buildInfo?: OmoBuildInfo
	readonly senpiPackage?: unknown
}): EngineBuildStamp {
	if (input.buildInfo !== undefined) {
		return engineBuildStampFromComponent(input.buildInfo.engine, "buildInfo") ?? OMITTED_STAMP
	}
	return engineBuildStampFromSenpiPackage(input.senpiPackage) ?? OMITTED_STAMP
}

export function engineBuildIdentityLine(stamp: EngineBuildStamp): string {
	switch (stamp.scheme) {
		case "epoch":
			return `engine-build +${stamp.epoch}.${stamp.sha7} (scheme epoch)`
		case "nodef":
			return "engine-build (scheme nodef)"
		default: {
			const exhaustive: never = stamp.scheme
			throw new Error(`unexpected scheme: ${String(exhaustive)}`)
		}
	}
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
	const stamp = engineBuildStampFromComponent(info.engine, "buildInfo") ?? OMITTED_STAMP
	return [
		`${info.command} dev build`,
		`omo   ${info.omo.commit} ${info.omo.committedAt} (${info.omo.branch})`,
		`senpi ${info.engine.commit} ${info.engine.committedAt} (${info.engine.branch})`,
		engineBuildIdentityLine(stamp),
	]
}
