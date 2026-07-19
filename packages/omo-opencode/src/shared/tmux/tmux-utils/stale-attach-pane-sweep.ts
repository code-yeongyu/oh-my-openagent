const ATTACH_SERVER_URL_PATTERN = /\bopencode\s+attach\s+(?:"([^"]+)"|'([^']+)'|(\S+))/
const OMO_ATTACH_PANE_TITLE_PREFIXES = ["omo-subagent-", "omo-team-"]
const OMO_ATTACH_SERVER_URL_OPTION = "@omo_attach_server_url"

export type TmuxAttachPane = {
	readonly paneId: string
	readonly title: string
	readonly attachServerUrl: string
	readonly commandLine: string
}

export type SweepAttachPaneDeps = {
	readonly isInsideTmux: () => boolean
	readonly getTmuxPath: () => Promise<string | null | undefined>
	readonly listCandidatePanes: (tmux: string) => Promise<readonly TmuxAttachPane[]>
	readonly probeServerReachability: (serverUrl: string) => Promise<HistoricalAttachServerReachability>
	readonly closePane: (paneId: string) => Promise<boolean>
	readonly log: (message: string, payload?: unknown) => void
}

export type HistoricalAttachServerReachability = "reachable" | "unreachable"

export type HistoricalAttachServerProbeOptions = {
	readonly fetchImplementation?: typeof fetch
	readonly retryDelayMs?: number
	readonly timeoutMs?: number
}

const HISTORICAL_SERVER_PROBE_ATTEMPTS = 2
const HISTORICAL_SERVER_PROBE_RETRY_DELAY_MS = 250
const HISTORICAL_SERVER_PROBE_TIMEOUT_MS = 3000

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function probeHistoricalAttachServerReachability(
	serverUrl: string,
	options: HistoricalAttachServerProbeOptions = {},
): Promise<HistoricalAttachServerReachability> {
	const fetchImplementation = options.fetchImplementation ?? fetch
	const healthUrl = new URL("/global/health", serverUrl).toString()
	const retryDelayMs = options.retryDelayMs ?? HISTORICAL_SERVER_PROBE_RETRY_DELAY_MS
	const timeoutMs = options.timeoutMs ?? HISTORICAL_SERVER_PROBE_TIMEOUT_MS

	for (let attempt = 1; attempt <= HISTORICAL_SERVER_PROBE_ATTEMPTS; attempt++) {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)

		try {
			await fetchImplementation(healthUrl, {
				credentials: "omit",
				redirect: "manual",
				signal: controller.signal,
			})
			return "reachable"
		} catch {
			if (attempt < HISTORICAL_SERVER_PROBE_ATTEMPTS) {
				await delay(retryDelayMs)
			}
		} finally {
			clearTimeout(timeout)
		}
	}

	return "unreachable"
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}

	return String(error)
}

async function listTmuxPanesViaTmux(tmux: string): Promise<TmuxAttachPane[]> {
	const { runTmuxCommand } = await import("../runner")
	const result = await runTmuxCommand(tmux, [
		"list-panes",
		"-a",
		"-F",
		`#{pane_id}\t#{pane_title}\t#{${OMO_ATTACH_SERVER_URL_OPTION}}\t#{pane_current_command} #{pane_start_command}`,
	])

	if (result.exitCode !== 0) {
		return []
	}

	return result.output
		.split("\n")
		.map((line): TmuxAttachPane | null => {
			const [paneId, title, attachServerUrl, ...commandParts] = line.split("\t")
			if (paneId === undefined || paneId.length === 0) return null
			return {
				paneId,
				title: title ?? "",
				attachServerUrl: attachServerUrl ?? "",
				commandLine: commandParts.join("\t").trim(),
			}
		})
		.filter((pane): pane is TmuxAttachPane => pane !== null)
}

async function buildRuntimeAttachPaneDeps(): Promise<SweepAttachPaneDeps> {
	const [{ log }, { isInsideTmux }, { getTmuxPath }, { closeTmuxPane }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("./pane-close"),
	])

	return {
		isInsideTmux,
		getTmuxPath,
		listCandidatePanes: listTmuxPanesViaTmux,
		probeServerReachability: probeHistoricalAttachServerReachability,
		closePane: closeTmuxPane,
		log,
	}
}

function extractAttachServerUrl(commandLine: string): string | null {
	const match = commandLine.match(ATTACH_SERVER_URL_PATTERN)
	if (!match) return null

	return match[1] ?? match[2] ?? match[3] ?? null
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
	if (normalized === "localhost" || normalized === "::1") {
		return true
	}

	const octets = normalized.split(".")
	if (octets.length !== 4 || octets[0] !== "127") {
		return false
	}

	return octets.every((octet) => {
		if (!/^\d{1,3}$/.test(octet)) {
			return false
		}
		const value = Number(octet)
		return value >= 0 && value <= 255
	})
}

function normalizeHistoricalAttachServerUrl(serverUrl: string): string | null {
	let parsed: URL
	try {
		parsed = new URL(serverUrl)
	} catch {
		return null
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return null
	}

	if (parsed.username || parsed.password || parsed.port === "0") {
		return null
	}

	if (!isLoopbackHostname(parsed.hostname)) {
		return null
	}

	return serverUrl
}

function isOmoAttachPane(pane: TmuxAttachPane): boolean {
	return pane.attachServerUrl.length > 0 || OMO_ATTACH_PANE_TITLE_PREFIXES.some((prefix) => pane.title.startsWith(prefix))
}

export async function sweepStaleOmoAttachPanesWith(deps: SweepAttachPaneDeps): Promise<number> {
	if (!deps.isInsideTmux()) {
		return 0
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		return 0
	}

	let candidatePanes: readonly TmuxAttachPane[]
	try {
		candidatePanes = await deps.listCandidatePanes(tmux)
	} catch (error) {
		deps.log("[sweepStaleOmoAttachPanesWith] failed to list candidate panes", {
			error: getErrorMessage(error),
		})
		return 0
	}

	let closedCount = 0
	for (const pane of candidatePanes) {
		if (!isOmoAttachPane(pane)) continue

		const rawServerUrl = pane.attachServerUrl || extractAttachServerUrl(pane.commandLine)
		if (rawServerUrl === null) continue

		const serverUrl = normalizeHistoricalAttachServerUrl(rawServerUrl)
		if (serverUrl === null) {
			deps.log("[sweepStaleOmoAttachPanesWith] skipped untrusted attach server URL", {
				paneId: pane.paneId,
				reason: "invalid-or-untrusted-url",
			})
			continue
		}

		let serverReachability: HistoricalAttachServerReachability
		try {
			serverReachability = await deps.probeServerReachability(serverUrl)
		} catch (error) {
			deps.log("[sweepStaleOmoAttachPanesWith] failed to probe pane listener reachability", {
				error: getErrorMessage(error),
				paneId: pane.paneId,
				serverOrigin: new URL(serverUrl).origin,
			})
			continue
		}
		if (serverReachability === "reachable") continue

		try {
			const closed = await deps.closePane(pane.paneId)
			if (closed) {
				closedCount += 1
			}
		} catch (error) {
			deps.log("[sweepStaleOmoAttachPanesWith] failed to close stale pane", {
				error: getErrorMessage(error),
				paneId: pane.paneId,
				serverOrigin: new URL(serverUrl).origin,
			})
		}
	}

	return closedCount
}

export async function sweepStaleOmoAttachPanes(): Promise<number> {
	const deps = await buildRuntimeAttachPaneDeps()
	return sweepStaleOmoAttachPanesWith(deps)
}
