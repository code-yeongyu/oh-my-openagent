import { describe, expect, it } from "bun:test"

import type { TmuxCommandResult } from "../runner"
import type { TmuxConfig } from "../types"
import { spawnTmuxPane } from "./pane-spawn"
import { spawnTmuxSession } from "./session-spawn"
import { spawnTmuxWindow } from "./window-spawn"

const enabledTmuxConfig = {
	enabled: true,
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 120,
	agent_pane_min_width: 40,
	isolation: "inline",
} satisfies TmuxConfig

const healthPath = "/global/health"
const password = "trusted-listener-password-fixture"

function tmuxResult(output: string, exitCode: number): TmuxCommandResult {
	return {
		success: exitCode === 0,
		output,
		stdout: output,
		stderr: "",
		exitCode,
	}
}

function restoreEnvironmentVariable(name: "OPENCODE_SERVER_PASSWORD" | "OPENCODE_SERVER_USERNAME", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name]
		return
	}
	process.env[name] = value
}

describe("trusted tmux listener health", () => {
	it("#given a password-protected listener #when default pane, window, and session wrappers spawn #then each authenticates and succeeds", async () => {
		// given
		const environment = {
			password: process.env.OPENCODE_SERVER_PASSWORD,
			username: process.env.OPENCODE_SERVER_USERNAME,
		}
		const contacts: Array<{ path: string; authorization: string | null }> = []
		const expectedAuthorization = `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`
		process.env.OPENCODE_SERVER_PASSWORD = password
		delete process.env.OPENCODE_SERVER_USERNAME

		try {
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch(request) {
					const path = new URL(request.url).pathname
					const authorization = request.headers.get("authorization")
					contacts.push({ path, authorization })
					if (path !== healthPath) return new Response(null, { status: 404 })
					return new Response(null, { status: authorization === expectedAuthorization ? 200 : 401 })
				},
			})

			try {
				const runTmuxCommand = async (_command: string, args: string[]): Promise<TmuxCommandResult> => {
					switch (args[0]) {
						case "split-window":
							return tmuxResult("%pane", 0)
						case "new-window":
							return tmuxResult("%window", 0)
						case "has-session":
							return tmuxResult("", 1)
						case "new-session":
							return tmuxResult("%session", 0)
						case "select-pane":
							return tmuxResult("", 0)
						default:
							throw new Error(`Unexpected tmux command: ${args.join(" ")}`)
					}
				}
				const deps = {
					log: () => undefined,
					runTmuxCommand,
					isInsideTmux: () => true,
					getTmuxPath: async () => "tmux",
				}
				const serverUrl = `http://127.0.0.1:${server.port}`

				// when
				const pane = await spawnTmuxPane("pane-session", "pane", enabledTmuxConfig, `${serverUrl}?caller=pane`, "/tmp", undefined, "-h", deps)
				const window = await spawnTmuxWindow("window-session", "window", enabledTmuxConfig, `${serverUrl}?caller=window`, "/tmp", deps)
				const session = await spawnTmuxSession("tmux-session", "session", enabledTmuxConfig, `${serverUrl}?caller=session`, "/tmp", undefined, deps)

				// then
				expect(pane).toEqual({ success: true, paneId: "%pane" })
				expect(window).toEqual({ success: true, paneId: "%window" })
				expect(session).toEqual({ success: true, paneId: "%session" })
				expect(contacts.length > 0).toBe(true)
				expect(contacts.every((contact) => contact.path === healthPath)).toBe(true)
				expect(contacts.every((contact) => contact.authorization === expectedAuthorization)).toBe(true)
			} finally {
				await server.stop(true)
			}
		} finally {
			restoreEnvironmentVariable("OPENCODE_SERVER_PASSWORD", environment.password)
			restoreEnvironmentVariable("OPENCODE_SERVER_USERNAME", environment.username)
		}
	})
})
