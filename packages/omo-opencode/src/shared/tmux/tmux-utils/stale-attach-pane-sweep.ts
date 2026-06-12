const ATTACH_SERVER_URL_PATTERN = /\bopencode\s+attach\s+(?:"([^"]+)"|'([^']+)'|(\S+))/
const OMO_ATTACH_PANE_TITLE_PREFIXES = ["omo-subagent-", "omo-team-"]

export type TmuxAttachPane = {
	readonly paneId: string
	readonly title: string
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
		"#{pane_id}\t#{pane_title}\t#{pane_current_command} #{pane_start_command}",
	])

	if (result.exitCode !== 0) {
		return []
	}

	return result.output
		.split("\n")
		.map((line): TmuxAttachPane | null => {
			const [paneId, title, ...commandParts] = line.split("\t")
			if (paneId === undefined || paneId.length === 0) return null
			return { paneId, title: title ?? "", commandLine: commandParts.join("\t").trim() }
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

function isOmoAttachPane(pane: TmuxAttachPane): boolean {
	return OMO_ATTACH_PANE_TITLE_PREFIXES.some((prefix) => pane.title.startsWith(prefix))
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

		const serverUrl = extractAttachServerUrl(pane.commandLine)
		if (serverUrl === null) continue

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
