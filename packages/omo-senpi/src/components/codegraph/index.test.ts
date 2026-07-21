/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import {
	createCodegraphComponent,
	type CodegraphCommandResolution,
	type CodegraphComponentOptions,
	type CodegraphNodeSupport,
} from "./index"

function fakeResolution(overrides: Partial<CodegraphCommandResolution> = {}): CodegraphCommandResolution {
	return {
		argsPrefix: [],
		command: "/opt/homebrew/bin/codegraph",
		exists: true,
		source: "path",
		...overrides,
	}
}

function fakeNodeSupport(overrides: Partial<CodegraphNodeSupport> = {}): CodegraphNodeSupport {
	return {
		major: 22,
		override: false,
		supported: true,
		...overrides,
	}
}

function createTestComponent(options: CodegraphComponentOptions = {}): OmoSenpiComponent {
	return createCodegraphComponent({
		resolveCommand: () => fakeResolution(),
		resolveNodeSupport: () => fakeNodeSupport(),
		buildEnv: () => ({
			CODEGRAPH_INSTALL_DIR: "/home/test/.omo/codegraph",
			CODEGRAPH_NO_DAEMON: "1",
			CODEGRAPH_NO_DOWNLOAD: "1",
			CODEGRAPH_TELEMETRY: "0",
			DO_NOT_TRACK: "1",
		}),
		...options,
	})
}

function fakeContext() {
	return {
		logger: { info() {}, warn() {}, error() {} },
		config: { getFlag: () => undefined },
	}
}

describe("createCodegraphComponent", () => {
	it("#given registerMcpServer available and supported binary #when registered #then declares codegraph stdio server", async () => {
		const pi = new FakeExtensionAPI()
		const component = createTestComponent()

		await component.register(pi, fakeContext())

		expect(pi.mcpServers).toEqual([
			{
				name: "codegraph",
				config: {
					type: "stdio",
					command: "/opt/homebrew/bin/codegraph",
					args: ["serve", "--mcp"],
					enabled: true,
					lifecycle: "eager",
					env: {
						CODEGRAPH_INSTALL_DIR: "/home/test/.omo/codegraph",
						CODEGRAPH_NO_DAEMON: "1",
						CODEGRAPH_NO_DOWNLOAD: "1",
						CODEGRAPH_TELEMETRY: "0",
						DO_NOT_TRACK: "1",
					},
				},
			},
		])
	})

	it("#given bundled binary #when registered #then enables without node support check", async () => {
		const pi = new FakeExtensionAPI()
		const component = createTestComponent({
			resolveCommand: () => fakeResolution({ source: "bundled", command: "/usr/local/bin/node", argsPrefix: ["/app/codegraph.js"] }),
			resolveNodeSupport: () => fakeNodeSupport({ supported: false }),
		})

		await component.register(pi, fakeContext())

		expect(pi.mcpServers[0]?.config.enabled).toBe(true)
		expect(pi.mcpServers[0]?.config.command).toBe("/usr/local/bin/node")
		expect(pi.mcpServers[0]?.config.args).toEqual(["/app/codegraph.js", "serve", "--mcp"])
	})

	it("#given binary missing #when registered #then registers disabled placeholder", async () => {
		const pi = new FakeExtensionAPI()
		const component = createTestComponent({
			resolveCommand: () => fakeResolution({ exists: false, command: "codegraph" }),
		})

		await component.register(pi, fakeContext())

		expect(pi.mcpServers).toHaveLength(1)
		expect(pi.mcpServers[0]?.name).toBe("codegraph")
		expect(pi.mcpServers[0]?.config.enabled).toBe(false)
	})

	it("#given PATH binary and unsupported node #when registered #then registers disabled placeholder", async () => {
		const pi = new FakeExtensionAPI()
		const component = createTestComponent({
			resolveNodeSupport: () => fakeNodeSupport({ supported: false }),
		})

		await component.register(pi, fakeContext())

		expect(pi.mcpServers).toHaveLength(1)
		expect(pi.mcpServers[0]?.config.enabled).toBe(false)
	})

	it("#given old senpi without registerMcpServer #when registered #then skips gracefully", async () => {
		const logs: string[] = []
		const pi: Pick<SenpiExtensionAPI, "on" | "registerTool" | "registerCommand" | "registerFlag" | "getFlag" | "sendMessage" | "sendUserMessage"> = {
			on() {},
			registerTool() {},
			registerCommand() {},
			registerFlag() {},
			getFlag() {
				return undefined
			},
			sendMessage() {},
			sendUserMessage() {},
		}
		const component = createTestComponent()

		await component.register(pi as SenpiExtensionAPI, {
			...fakeContext(),
			logger: { info: (m: string) => logs.push(m), warn() {}, error() {} },
		})

		expect(logs.some((l) => l.includes("registerMcpServer"))).toBe(true)
	})

	it("#given senpi-task child marker #when registered #then skips registration", async () => {
		const pi = new FakeExtensionAPI()
		const env = { SENPI_CODING_AGENT_SESSION_DIR: "/tmp/agent" }
		const component = createTestComponent({ env })

		await component.register(pi, fakeContext())

		expect(pi.mcpServers).toHaveLength(0)
	})

	it("#given win32 platform and .cmd binary #when registered #then wraps with cmd.exe", async () => {
		const pi = new FakeExtensionAPI()
		const component = createTestComponent({
			resolveCommand: () => fakeResolution({ command: "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.cmd" }),
			platform: "win32",
		})

		await component.register(pi, fakeContext())

		expect(pi.mcpServers[0]?.config.command).toBe("cmd.exe")
		expect(pi.mcpServers[0]?.config.args).toEqual(["/d", "/s", "/c", "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.cmd", "serve", "--mcp"])
	})

	it("#given argsPrefix #when registered #then prepends before serve --mcp", async () => {
		const pi = new FakeExtensionAPI()
		const component = createTestComponent({
			resolveCommand: () => fakeResolution({ argsPrefix: ["--node-runtime", "node22"] }),
		})

		await component.register(pi, fakeContext())

		expect(pi.mcpServers[0]?.config.args).toEqual(["--node-runtime", "node22", "serve", "--mcp"])
	})

	it("#given OMO_CODEGRAPH_DAEMON=1 and default env builder #when registered #then omits CODEGRAPH_NO_DAEMON", async () => {
		const pi = new FakeExtensionAPI()
		const component = createCodegraphComponent({
			resolveCommand: () => fakeResolution(),
			resolveNodeSupport: () => fakeNodeSupport(),
			env: { OMO_CODEGRAPH_DAEMON: "1" },
		})

		await component.register(pi, fakeContext())

		const env = (pi.mcpServers[0]?.config.env ?? {}) as Record<string, string>
		expect("CODEGRAPH_NO_DAEMON" in env).toBe(false)
		expect(env.CODEGRAPH_NO_DOWNLOAD).toBe("1")
		expect(env.DO_NOT_TRACK).toBe("1")
	})

	it("#given OMO_CODEGRAPH_DAEMON=true (truthy variant) #when registered #then omits CODEGRAPH_NO_DAEMON", async () => {
		const pi = new FakeExtensionAPI()
		const component = createCodegraphComponent({
			resolveCommand: () => fakeResolution(),
			resolveNodeSupport: () => fakeNodeSupport(),
			env: { OMO_CODEGRAPH_DAEMON: " True " },
		})

		await component.register(pi, fakeContext())

		const env = (pi.mcpServers[0]?.config.env ?? {}) as Record<string, string>
		expect("CODEGRAPH_NO_DAEMON" in env).toBe(false)
	})

	it("#given no daemon opt-in and default env builder #when registered #then pins CODEGRAPH_NO_DAEMON=1", async () => {
		const pi = new FakeExtensionAPI()
		const component = createCodegraphComponent({
			resolveCommand: () => fakeResolution(),
			resolveNodeSupport: () => fakeNodeSupport(),
			env: {},
		})

		await component.register(pi, fakeContext())

		const env = (pi.mcpServers[0]?.config.env ?? {}) as Record<string, string>
		expect(env.CODEGRAPH_NO_DAEMON).toBe("1")
	})

	it("#given OMO_CODEGRAPH_DAEMON=0 #when registered #then pins CODEGRAPH_NO_DAEMON=1", async () => {
		const pi = new FakeExtensionAPI()
		const component = createCodegraphComponent({
			resolveCommand: () => fakeResolution(),
			resolveNodeSupport: () => fakeNodeSupport(),
			env: { OMO_CODEGRAPH_DAEMON: "0" },
		})

		await component.register(pi, fakeContext())

		const env = (pi.mcpServers[0]?.config.env ?? {}) as Record<string, string>
		expect(env.CODEGRAPH_NO_DAEMON).toBe("1")
	})
})
