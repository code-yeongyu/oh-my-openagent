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
	readonly isServerRunning: (serverUrl: string) => Promise<boolean>
	readonly closePane: (paneId: string) => Promise<boolean>
	readonly log: (message: string, payload?: unknown) => void
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
	const [{ log }, { isInsideTmux }, { getTmuxPath }, serverHealth, { closeTmuxPane }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("./server-health"),
		import("./pane-close"),
	])

	return {
		isInsideTmux,
		getTmuxPath,
		listCandidatePanes: listTmuxPanesViaTmux,
		isServerRunning: (serverUrl) => serverHealth.isServerRunning(serverUrl, {
			state: serverHealth.createServerHealthState(),
		}),
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

function normalizeTrustedAttachServerUrl(serverUrl: string): string | null {
	let parsed: URL
	try {
		parsed = new URL(serverUrl)
	} catch {
		return null
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
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

		const serverUrl = normalizeTrustedAttachServerUrl(rawServerUrl)
		if (serverUrl === null) {
			deps.log("[sweepStaleOmoAttachPanesWith] skipped untrusted attach server URL", {
				paneId: pane.paneId,
				serverUrl: rawServerUrl,
			})
			continue
		}

		let serverRunning: boolean
		try {
			serverRunning = await deps.isServerRunning(serverUrl)
		} catch (error) {
			deps.log("[sweepStaleOmoAttachPanesWith] failed to check pane server health", {
				error: getErrorMessage(error),
				paneId: pane.paneId,
				serverUrl,
			})
			continue
		}
		if (serverRunning) continue

		try {
			const closed = await deps.closePane(pane.paneId)
			if (closed) {
				closedCount += 1
			}
		} catch (error) {
			deps.log("[sweepStaleOmoAttachPanesWith] failed to close stale pane", {
				error: getErrorMessage(error),
				paneId: pane.paneId,
				serverUrl,
			})
		}
	}

	return closedCount
}

export async function sweepStaleOmoAttachPanes(): Promise<number> {
	const deps = await buildRuntimeAttachPaneDeps()
	return sweepStaleOmoAttachPanesWith(deps)
}
