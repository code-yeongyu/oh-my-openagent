/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { sweepStaleOmoAttachPanesWith, type SweepAttachPaneDeps } from "./stale-attach-pane-sweep"

describe("sweepStaleOmoAttachPanesWith", () => {
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
			isServerRunning: async (serverUrl: string) => serverUrl === "http://127.0.0.1:4102/",
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
			isServerRunning: async () => false,
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
			isServerRunning: async () => false,
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
			isServerRunning: async (serverUrl: string) => {
				if (serverUrl === "http://127.0.0.1:4106") {
					throw new Error("bad health check")
				}
				return false
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
		expect(logged).toContain("[sweepStaleOmoAttachPanesWith] failed to check pane server health")
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
			isServerRunning: async (serverUrl: string) => {
				checkedUrls.push(serverUrl)
				return false
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
			isServerRunning: async (serverUrl: string) => {
				checkedUrls.push(serverUrl)
				return false
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
