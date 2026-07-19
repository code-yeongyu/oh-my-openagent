import { expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../runner"

const staleAttachPaneSweepSpecifier = import.meta.resolve("./stale-attach-pane-sweep")
const environmentSpecifier = import.meta.resolve("./environment")
const paneCloseSpecifier = import.meta.resolve("./pane-close")
const runnerSpecifier = import.meta.resolve("../runner")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")

it("#given OpenCode credentials and historical OMO pane metadata #when production stale attach sweep runs #then health requests omit authorization", async () => {
	// given
	const environment = {
		password: process.env.OPENCODE_SERVER_PASSWORD,
		username: process.env.OPENCODE_SERVER_USERNAME,
	}
	const authorizationHeaders: Array<string | null> = []
	const healthPaths: string[] = []
	const closedPaneIds: string[] = []
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			authorizationHeaders.push(request.headers.get("authorization"))
			healthPaths.push(new URL(request.url).pathname)
			return new Response(null, { status: 503 })
		},
	})
	const serverUrl = `http://127.0.0.1:${server.port}`
	const paneMetadata = `%historical\tsleep 300\t${serverUrl}\tfish fish`
	process.env.OPENCODE_SERVER_PASSWORD = "historical-sweep-password-fixture"
	process.env.OPENCODE_SERVER_USERNAME = "historical-sweep-user-fixture"

	try {
		mock.module(environmentSpecifier, () => ({ isInsideTmux: () => true }))
		mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: async () => "test-tmux" }))
		mock.module(runnerSpecifier, () => ({
			runTmuxCommand: async (): Promise<TmuxCommandResult> => ({
				success: true,
				output: paneMetadata,
				stdout: paneMetadata,
				stderr: "",
				exitCode: 0,
			}),
		}))
		mock.module(paneCloseSpecifier, () => ({
			closeTmuxPane: async (paneId: string) => {
				closedPaneIds.push(paneId)
				return true
			},
		}))
		const { sweepStaleOmoAttachPanes } = await import(`${staleAttachPaneSweepSpecifier}?test=${crypto.randomUUID()}`)

		// when
		const result = await sweepStaleOmoAttachPanes()

		// then
		expect(healthPaths.length > 0).toBe(true)
		expect(healthPaths.every((path) => path === "/global/health")).toBe(true)
		expect(authorizationHeaders.every((header) => header === null)).toBe(true)
		expect(result).toBe(1)
		expect(closedPaneIds).toEqual(["%historical"])
	} finally {
		mock.restore()
		if (environment.password === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
		else process.env.OPENCODE_SERVER_PASSWORD = environment.password
		if (environment.username === undefined) delete process.env.OPENCODE_SERVER_USERNAME
		else process.env.OPENCODE_SERVER_USERNAME = environment.username
		await server.stop(true)
	}
})
