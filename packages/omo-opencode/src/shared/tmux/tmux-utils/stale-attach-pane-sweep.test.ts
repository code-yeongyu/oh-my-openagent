/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import {
	probeHistoricalAttachServerReachability,
	sweepStaleOmoAttachPanesWith,
	type SweepAttachPaneDeps,
} from "./stale-attach-pane-sweep"

describe("sweepStaleOmoAttachPanesWith", () => {
	it("#given an authenticated historical listener #when swept anonymously #then a 401 response preserves its pane", async () => {
		const originalPassword = process.env.OPENCODE_SERVER_PASSWORD
		const originalUsername = process.env.OPENCODE_SERVER_USERNAME
		const authorizationHeaders: Array<string | null> = []
		const closed: string[] = []
		process.env.OPENCODE_SERVER_PASSWORD = "historical-ambient-password"
		process.env.OPENCODE_SERVER_USERNAME = "historical-ambient-user"

		try {
			const result = await sweepStaleOmoAttachPanesWith({
				isInsideTmux: () => true,
				getTmuxPath: async () => "tmux",
				listCandidatePanes: async () => [{
					paneId: "%historical",
					title: "omo-subagent-historical",
					attachServerUrl: "http://127.0.0.1:5317",
					commandLine: "fish",
				}],
				probeServerReachability: (serverUrl) => probeHistoricalAttachServerReachability(serverUrl, {
					fetchImplementation: (async (_input: RequestInfo | URL, init?: RequestInit) => {
						authorizationHeaders.push(new Headers(init?.headers).get("authorization"))
						return new Response(null, { status: 401 })
					}) as typeof fetch,
					retryDelayMs: 0,
				}),
				closePane: async (paneId) => {
					closed.push(paneId)
					return true
				},
				log: () => undefined,
			})

			expect(result).toBe(0)
			expect(authorizationHeaders).toHaveLength(1)
			expect(authorizationHeaders.every((header) => header === null)).toBe(true)
			expect(closed).toEqual([])
		} finally {
			if (originalPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
			else process.env.OPENCODE_SERVER_PASSWORD = originalPassword
			if (originalUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
			else process.env.OPENCODE_SERVER_USERNAME = originalUsername
		}
	})

	it("#given a refused historical listener #when both anonymous attempts fail at transport #then its pane is closed", async () => {
		const requests: RequestInit[] = []
		const closed: string[] = []
		const result = await sweepStaleOmoAttachPanesWith({
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [{
				paneId: "%refused",
				title: "omo-subagent-refused",
				attachServerUrl: "http://127.0.0.1:5318",
				commandLine: "fish",
			}],
			probeServerReachability: (serverUrl) => probeHistoricalAttachServerReachability(serverUrl, {
				fetchImplementation: (async (_input: RequestInfo | URL, init?: RequestInit) => {
					requests.push(init ?? {})
					throw new TypeError("connection refused")
				}) as typeof fetch,
				retryDelayMs: 0,
			}),
			closePane: async (paneId) => {
				closed.push(paneId)
				return true
			},
			log: () => undefined,
		})

		expect(result).toBe(1)
		expect(requests).toHaveLength(2)
		expect(requests.every((request) => request.redirect === "manual")).toBe(true)
		expect(requests.every((request) => new Headers(request.headers).get("authorization") === null)).toBe(true)
		expect(closed).toEqual(["%refused"])
	})

	it("#given direct non-success HTTP responses #when historical reachability is probed #then every response is treated as reachable", async () => {
		for (const status of [401, 403, 503]) {
			const result = await probeHistoricalAttachServerReachability("http://127.0.0.1:5319", {
				fetchImplementation: (async () => new Response(null, { status })) as typeof fetch,
				retryDelayMs: 0,
			})
			expect(result).toBe("reachable")
		}
	})

	it("#given a redirecting historical listener #when reachability is probed #then the redirect response preserves the pane without contacting its target", async () => {
		const requests: Array<{ url: string; init: RequestInit }> = []
		const closed: string[] = []
		const fetchImplementation = (async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push({ url: input.toString(), init: init ?? {} })
			return new Response(null, {
				status: 302,
				headers: { Location: "http://127.0.0.1:5320/redirect-target" },
			})
		}) as typeof fetch

		const result = await sweepStaleOmoAttachPanesWith({
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [{
				paneId: "%redirect",
				title: "omo-subagent-redirect",
				attachServerUrl: "http://127.0.0.1:5319/source",
				commandLine: "fish",
			}],
			probeServerReachability: (serverUrl) => probeHistoricalAttachServerReachability(serverUrl, {
				fetchImplementation,
				retryDelayMs: 0,
			}),
			closePane: async (paneId) => {
				closed.push(paneId)
				return true
			},
			log: () => undefined,
		})

		expect(result).toBe(0)
		expect(requests).toHaveLength(1)
		expect(requests[0]?.url).toBe("http://127.0.0.1:5319/global/health")
		expect(requests[0]?.init.redirect).toBe("manual")
		expect(requests[0]?.init.credentials).toBe("omit")
		expect(new Headers(requests[0]?.init.headers).get("authorization")).toBeNull()
		expect(closed).toEqual([])
	})

	it("#given stale and live OMO attach panes #when sweep called #then only panes with dead servers are closed", async () => {
		// given
		const closed: string[] = []
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%dead",
					title: "omo-subagent-dead",
					attachServerUrl: "",
					commandLine: `/bin/sh -c "opencode attach http://127.0.0.1:4101 --session ses_dead --dir /tmp/project"`,
				},
				{
					paneId: "%live",
					title: "omo-subagent-live",
					attachServerUrl: "",
					commandLine: `opencode attach 'http://127.0.0.1:4102/' --session 'ses_live' --dir '/tmp/project'`,
				},
				{
					paneId: "%team",
					title: "omo-team-member",
					attachServerUrl: "",
					commandLine: `opencode attach 'http://127.0.0.1:4104/' --session 'ses_team' --dir '/tmp/project'`,
				},
				{
					paneId: "%manual",
					title: "manual-shell",
					attachServerUrl: "",
					commandLine: "opencode attach http://127.0.0.1:4105 --session ses_manual",
				},
				{
					paneId: "%other",
					title: "",
					attachServerUrl: "",
					commandLine: "vim README.md",
				},
			],
			probeServerReachability: async (serverUrl: string) => serverUrl === "http://127.0.0.1:4102/" ? "reachable" : "unreachable",
			closePane: async (paneId: string) => {
				closed.push(paneId)
				return true
			},
			log: () => undefined,
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(2)
		expect(closed).toEqual(["%dead", "%team"])
	})

	it("#given manual attach pane with dead server #when sweep called #then manual pane is not closed", async () => {
		// given
		const closed: string[] = []
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%manual",
					title: "manual-opencode",
					attachServerUrl: "",
					commandLine: "opencode attach http://127.0.0.1:4105 --session ses_manual",
				},
			],
			probeServerReachability: async () => "unreachable",
			closePane: async (paneId: string) => {
				closed.push(paneId)
				return true
			},
			log: () => undefined,
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(0)
		expect(closed).toEqual([])
	})

	it("#given OMO attach pane close fails #when sweep called #then failed close is not counted", async () => {
		// given
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%stubborn",
					title: "omo-subagent-stubborn",
					attachServerUrl: "",
					commandLine: "opencode attach http://127.0.0.1:4103 --session ses_dead",
				},
			],
			probeServerReachability: async () => "unreachable",
			closePane: async () => false,
			log: () => undefined,
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(0)
	})

	it("#given server health check throws for one pane #when sweep called #then later stale panes are still closed", async () => {
		// given
		const closed: string[] = []
		const logged: string[] = []
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%bad-health",
					title: "omo-subagent-bad-health",
					attachServerUrl: "",
					commandLine: "opencode attach http://127.0.0.1:4106 --session ses_bad",
				},
				{
					paneId: "%dead",
					title: "omo-subagent-dead",
					attachServerUrl: "",
					commandLine: "opencode attach http://127.0.0.1:4107 --session ses_dead",
				},
			],
			probeServerReachability: async (serverUrl: string) => {
				if (serverUrl === "http://127.0.0.1:4106") {
					throw new Error("bad health check")
				}
				return "unreachable"
			},
			closePane: async (paneId: string) => {
				closed.push(paneId)
				return true
			},
			log: (message: string) => {
				logged.push(message)
			},
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(1)
		expect(closed).toEqual(["%dead"])
		expect(logged).toContain("[sweepStaleOmoAttachPanesWith] failed to probe pane listener reachability")
	})

	it("#given team pane metadata with overwritten title and shell command line #when sweep called #then metadata server url is used", async () => {
		// given
		const checkedUrls: string[] = []
		const closed: string[] = []
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%team",
					title: "sleep 300",
					attachServerUrl: "http://127.0.0.1:4108",
					commandLine: "fish fish",
				},
			],
			probeServerReachability: async (serverUrl: string) => {
				checkedUrls.push(serverUrl)
				return "unreachable"
			},
			closePane: async (paneId: string) => {
				closed.push(paneId)
				return true
			},
			log: () => undefined,
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(1)
		expect(checkedUrls).toEqual(["http://127.0.0.1:4108"])
		expect(closed).toEqual(["%team"])
	})

	it("#given OMO attach panes point at untrusted hosts #when sweep called #then health checks are not attempted", async () => {
		// given
		const checkedUrls: string[] = []
		const closed: string[] = []
		const logged: string[] = []
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%metadata-external",
					title: "sleep 300",
					attachServerUrl: "https://example.com:4108",
					commandLine: "fish fish",
				},
				{
					paneId: "%metadata-link-local",
					title: "sleep 300",
					attachServerUrl: "http://169.254.169.254:4108",
					commandLine: "fish fish",
				},
				{
					paneId: "%command-private",
					title: "omo-subagent-private",
					attachServerUrl: "",
					commandLine: "opencode attach http://192.168.1.20:4108 --session ses_private",
				},
				{
					paneId: "%command-external",
					title: "omo-team-external",
					attachServerUrl: "",
					commandLine: "opencode attach 'https://example.org:4108/' --session ses_external",
				},
				{
					paneId: "%local",
					title: "omo-subagent-local",
					attachServerUrl: "",
					commandLine: "opencode attach http://localhost:4108 --session ses_local",
				},
			],
			probeServerReachability: async (serverUrl: string) => {
				checkedUrls.push(serverUrl)
				return "unreachable"
			},
			closePane: async (paneId: string) => {
				closed.push(paneId)
				return true
			},
			log: (message: string) => {
				logged.push(message)
			},
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(1)
		expect(checkedUrls).toEqual(["http://localhost:4108"])
		expect(closed).toEqual(["%local"])
		expect(logged).toEqual([
			"[sweepStaleOmoAttachPanesWith] skipped untrusted attach server URL",
			"[sweepStaleOmoAttachPanesWith] skipped untrusted attach server URL",
			"[sweepStaleOmoAttachPanesWith] skipped untrusted attach server URL",
			"[sweepStaleOmoAttachPanesWith] skipped untrusted attach server URL",
		])
	})
})
