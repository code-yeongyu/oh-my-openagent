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
	readonly buildEnv?: () => Record<string, string>
	readonly platform?: NodeJS.Platform
	readonly env?: Record<string, string | undefined>
}

const CODEGRAPH_COMPONENT_NAME = "codegraph"
const CHILD_SESSION_MARKER_ENV = "SENPI_CODING_AGENT_SESSION_DIR"
// Config source decision: the senpi-visible config loader (@oh-my-opencode/omo-config-core,
// used by components/task) has a strict schema (categories/agents/task/teams) with NO
// codegraph section, and the codegraph section in utils/omo-config targets the
// codex/opencode/omo harnesses, not senpi. So daemon opt-in is an env toggle, matching
// existing senpi env-flag truthiness patterns (telemetry-core TRUTHY values).
const DAEMON_OPT_IN_ENV = "OMO_CODEGRAPH_DAEMON"
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes"])

function isDaemonOptedIn(env: Record<string, string | undefined>): boolean {
	const value = env[DAEMON_OPT_IN_ENV]?.trim().toLowerCase()
	return value !== undefined && TRUTHY_ENV_VALUES.has(value)
}

export function createCodegraphComponent(options: CodegraphComponentOptions = {}): OmoSenpiComponent {
	const resolveCommand = options.resolveCommand ?? resolveCodegraphCommand
	const resolveNodeSupport = options.resolveNodeSupport ?? resolveCodegraphNodeSupport
	const env = options.env ?? process.env
	const buildEnv = options.buildEnv ?? (() => buildCodegraphEnv({ daemon: isDaemonOptedIn(env) }))
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

			// DESIGN NOTE: with the daemon opted in, the registered stdio process is upstream's
			// lightweight proxy; its lifecycle is protected by upstream's own PPID watchdog plus
			// senpi runtime MCP teardown. No omo-side wrapper is added here (deliberate).
			pi.registerMcpServer(CODEGRAPH_COMPONENT_NAME, {
				type: "stdio",
				command: finalCommand,
				args: finalArgs,
				env: buildEnv(),
				enabled,
			})
		},
	}
}

export type { CodegraphCommandResolution, CodegraphNodeSupport }
