import { loadSenpiOmoConfig } from "../config-resolution"
import {
	buildCodegraphEnv,
	resolveCodegraphCommand,
	resolveCodegraphNodeSupport,
	type CodegraphCommandResolution,
	type CodegraphNodeSupport,
	type ResolveCodegraphCommandOptions,
	type ResolveCodegraphNodeSupportOptions,
} from "@oh-my-opencode/utils"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

export interface CodegraphComponentOptions {
	readonly resolveCommand?: (options: ResolveCodegraphCommandOptions) => CodegraphCommandResolution
	readonly resolveNodeSupport?: (options: ResolveCodegraphNodeSupportOptions) => CodegraphNodeSupport
	readonly buildCodegraphEnv?: (options: { readonly daemon: boolean }) => Record<string, string>
	readonly loadConfig?: typeof loadSenpiOmoConfig
	readonly resolveCwd?: () => string
	readonly platform?: NodeJS.Platform
	readonly env?: Record<string, string | undefined>
}

const CODEGRAPH_COMPONENT_NAME = "codegraph"
const CHILD_SESSION_MARKER_ENV = "SENPI_CODING_AGENT_SESSION_DIR"
const DAEMON_OVERRIDE_ENV = "OMO_CODEGRAPH_DAEMON"
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes"])
const FALSY_ENV_VALUES = new Set(["0", "false", "no"])

function resolveDaemonEnvironmentOverride(env: Record<string, string | undefined>): boolean | undefined {
	const value = env[DAEMON_OVERRIDE_ENV]?.trim().toLowerCase()
	if (value === undefined || value.length === 0) return undefined
	if (TRUTHY_ENV_VALUES.has(value)) return true
	if (FALSY_ENV_VALUES.has(value)) return false
	return undefined
}

function resolveDaemon(
	env: Record<string, string | undefined>,
	configuredDaemon: boolean | undefined,
): boolean {
	return resolveDaemonEnvironmentOverride(env) ?? configuredDaemon ?? true
}

export function createCodegraphComponent(options: CodegraphComponentOptions = {}): OmoSenpiComponent {
	const resolveCommand = options.resolveCommand ?? resolveCodegraphCommand
	const resolveNodeSupport = options.resolveNodeSupport ?? resolveCodegraphNodeSupport
	const buildEnv = options.buildCodegraphEnv ?? buildCodegraphEnv
	const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
	const resolveCwd = options.resolveCwd ?? (() => process.cwd())
	const env = options.env ?? process.env
	const platform = options.platform ?? process.platform

	return {
		name: CODEGRAPH_COMPONENT_NAME,
		register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
			if (typeof pi.registerMcpServer !== "function") {
				ctx.logger.info("omo-senpi codegraph skipped: senpi ExtensionAPI does not expose registerMcpServer", {
					component: CODEGRAPH_COMPONENT_NAME,
				})
				return
			}

			if (env[CHILD_SESSION_MARKER_ENV] !== undefined) {
				ctx.logger.info("omo-senpi codegraph skipped: running inside a senpi-task RPC child", {
					component: CODEGRAPH_COMPONENT_NAME,
				})
				return
			}

			const loaded = loadConfig({ cwd: resolveCwd(), env })
			const daemon = resolveDaemon(env, loaded.config.codegraph?.daemon)

			const resolved = resolveCommand({ env })
			const nodeSupport = resolveNodeSupport({ env })
			const enabled =
				resolved.exists &&
				(resolved.source === "bundled" || resolved.source === "env" || nodeSupport.supported)

			const command = resolved.command
			const args: string[] = [...resolved.argsPrefix, "serve", "--mcp"]

			const isWin32 = platform === "win32"
			const isWindowsExecutable = /\.(cmd|bat)$/i.test(command)
			const finalCommand = isWin32 && isWindowsExecutable ? "cmd.exe" : command
			const finalArgs = isWin32 && isWindowsExecutable ? ["/d", "/s", "/c", command, ...args] : args

			pi.registerMcpServer(CODEGRAPH_COMPONENT_NAME, {
				type: "stdio",
				command: finalCommand,
				args: finalArgs,
				env: buildEnv({ daemon }),
				enabled,
				lifecycle: "eager",
			})
		},
	}
}

export type { CodegraphCommandResolution, CodegraphNodeSupport }
