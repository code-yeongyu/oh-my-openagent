/// <reference types="bun-types" />

import { isCmuxCompatEnvironment } from "../../../packages/tmux-core/src/cmux-detect"
import { resolveCmuxCliExecutable } from "../../../packages/tmux-core/src/cmux-cli"
import { runTmuxCommand } from "../../../packages/tmux-core/src/runner"
import { spawnTmuxPane } from "../../../packages/tmux-core/src/tmux-utils/pane-spawn"
import { closeTmuxPaneWithDependencies } from "../../../packages/tmux-core/src/tmux-utils/pane-close"

const serverUrl = `http://127.0.0.1:${process.env.OPENCODE_PORT ?? "4096"}`
const sessionId = process.argv[2]
const tmuxShimPath = process.argv[3] ?? "tmux"

if (!sessionId) {
	console.error("usage: bun run live-cmux-driver.ts <sessionId> [tmuxPath]")
	process.exit(1)
}

console.log("environment")
console.log("  TMUX                        =", process.env.TMUX)
console.log("  CMUX_SOCKET_PATH            =", process.env.CMUX_SOCKET_PATH)
console.log("  isCmuxCompatEnvironment()   =", isCmuxCompatEnvironment())
console.log("  resolveCmuxCliExecutable()  =", resolveCmuxCliExecutable())

const spawnResult = await spawnTmuxPane(
	sessionId,
	"live cmux driver",
	{ enabled: true, layout: "main-vertical", main_pane_size: 50, main_pane_min_width: 60, agent_pane_min_width: 30, isolation: "inline" },
	serverUrl,
	process.cwd(),
	process.env.TMUX_PANE,
	"-h",
	{ getTmuxPath: async () => tmuxShimPath },
)

console.log("\nspawnTmuxPane ->", spawnResult)

if (!spawnResult.success || !spawnResult.paneId) {
	process.exit(1)
}

await Bun.sleep(6000)

const capture = await runTmuxCommand(tmuxShimPath, ["capture-pane", "-p", "-t", spawnResult.paneId])
const paneProcesses = Bun.spawnSync(["sh", "-c", "ps -eo command | grep 'opencode attach' | grep -v grep"])

const paneShowsPlaceholder =
	capture.stdout.includes("subagent pane ready") || capture.stdout.includes("Focus this pane to attach")
const attachProcess = paneProcesses.stdout.toString().trim()
const attachObserved = attachProcess.length > 0

console.log("\npane content contains placeholder text =", paneShowsPlaceholder)
console.log("attach process observed                =", attachObserved)
console.log("attach process                         =", attachProcess.split("\n")[0] ?? "(none)")

const closed = await closeTmuxPaneWithDependencies(spawnResult.paneId, {
	isInsideTmux: () => true,
	getTmuxPath: async () => tmuxShimPath,
	runTmuxCommand,
	log: () => undefined,
	delay: (milliseconds: number) => Bun.sleep(milliseconds),
})

console.log("\ncloseTmuxPane ->", closed)

// The pane is closed first so a failed expectation never leaks a live pane.
const failures = [
	paneShowsPlaceholder ? "pane still shows the inert placeholder instead of an attached session" : undefined,
	attachObserved ? undefined : "no `opencode attach` process was observed while the pane was open",
	closed ? undefined : "closeTmuxPaneWithDependencies returned false",
].filter((failure): failure is string => failure !== undefined)

if (failures.length > 0) {
	console.error("\nFAIL")
	for (const failure of failures) {
		console.error("  -", failure)
	}
	process.exit(1)
}

console.log("\nPASS: pane attached through the real cmux CLI and cleaned up")
