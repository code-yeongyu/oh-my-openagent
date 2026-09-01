import { join } from "node:path";
import { env as processEnv, stderr as processStderr } from "node:process";

import { buildCodegraphChildEnv, buildCodegraphEnv } from "../../../../../utils/src/codegraph/env.ts";
import { CODEGRAPH_PINNED_VERSION } from "../../../../../utils/src/codegraph/manifest.ts";
import type { CodegraphNodeSupport } from "../../../../../utils/src/codegraph/node-support.ts";
import {
	codegraphCommandRequiresSupportedLocalNode,
	type CodegraphCommandResolution,
} from "../../../../../utils/src/codegraph/resolve.ts";
import { runProcessWithTreeTimeout } from "../../../../../utils/src/process-tree.ts";
import type { CodegraphCommandResult, CodegraphConfig, CodegraphSessionStartDeps } from "./hook-types.js";
import { resolveServeProcessInvocation } from "./serve-invocation.js";

export const SESSION_START_COMMAND_TIMEOUT_MS = 60_000;

export type CodegraphBootstrapConfig = CodegraphConfig & {
	readonly trustedCodegraphInstallDir?: string;
};

export type SessionStartCommandResolution =
	| { readonly kind: "resolved"; readonly resolution: CodegraphCommandResolution }
	| { readonly kind: "unsupported-node" }
	| { readonly error: string; readonly kind: "unavailable"; readonly source: CodegraphCommandResolution["source"] };

export async function resolveSessionStartCommand(options: {
	readonly config: CodegraphBootstrapConfig;
	readonly deps: CodegraphSessionStartDeps;
	readonly env: Record<string, string | undefined>;
	readonly homeDir: string;
	readonly nodeSupport: CodegraphNodeSupport;
}): Promise<SessionStartCommandResolution> {
	const trustedInstallDir = options.config.trustedCodegraphInstallDir;
	const installDir = trustedInstallDir ?? join(options.homeDir, ".omo", "codegraph");
	const resolved = options.deps.resolveCommand({
		env: options.env,
		homeDir: options.homeDir,
		provisioned: () => options.deps.resolveManagedBin(installDir),
	});
	const managedBin = options.deps.resolveManagedBin(installDir);
	if (resolved.source !== "env" && managedBin !== null) {
		return { kind: "resolved", resolution: { argsPrefix: [], command: managedBin, exists: true, source: "provisioned" } };
	}
	if (resolved.source !== "env" && options.config.auto_provision !== false && options.deps.managedInstallExists(installDir)) {
		const upgraded = await options.deps.ensureProvisioned({
			installDir,
			lockDir: join(installDir, ".locks"),
			version: CODEGRAPH_PINNED_VERSION,
		});
		if (upgraded.provisioned && upgraded.binPath !== undefined) {
			return { kind: "resolved", resolution: { argsPrefix: [], command: upgraded.binPath, exists: true, source: "provisioned" } };
		}
	}
	if (resolved.exists && canUseResolvedCommand(resolved, options.nodeSupport)) {
		return { kind: "resolved", resolution: resolved };
	}
	if (resolved.exists && options.config.auto_provision === false) return { kind: "unsupported-node" };
	if (options.config.auto_provision === false) {
		return { error: "codegraph binary unavailable and auto_provision is disabled", kind: "unavailable", source: resolved.source };
	}

	const provisioned = await options.deps.ensureProvisioned({
		installDir,
		lockDir: join(installDir, ".locks"),
		version: CODEGRAPH_PINNED_VERSION,
	});
	if (!provisioned.provisioned || provisioned.binPath === undefined) {
		return { error: provisioned.error ?? "provisioning did not produce a binary", kind: "unavailable", source: resolved.source };
	}
	return { kind: "resolved", resolution: { argsPrefix: [], command: provisioned.binPath, exists: true, source: "provisioned" } };
}

export function sessionStartCodegraphEnv(config: CodegraphBootstrapConfig, homeDir: string): Record<string, string> {
	const env = buildCodegraphEnv({ daemon: false, homeDir });
	return config.trustedCodegraphInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config.trustedCodegraphInstallDir };
}

export async function runSessionStartCodegraphCommand(
	projectRoot: string,
	command: string,
	args: readonly string[],
	options: { readonly env: Record<string, string>; readonly timeoutMs: number },
): Promise<CodegraphCommandResult> {
	const invocation = resolveCodegraphCommandInvocation(command, args);
	return runProcessWithTreeTimeout({
		args: invocation.args,
		command: invocation.command,
		cwd: projectRoot,
		env: buildCodegraphChildEnv({ ambientEnv: processEnv, codegraphEnv: options.env }),
		maxBuffer: 1024 * 1024,
		onTerminationReport: (report) => processStderr.write(`[codegraph-session-start] process tree termination ${JSON.stringify(report)}\n`),
		timeoutMs: options.timeoutMs,
	}).then(({ exitCode, stderr, stdout, timedOut }) => ({ exitCode, stderr, stdout, timedOut }));
}

export function resolveCodegraphCommandInvocation(
	command: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
): { readonly args: readonly string[]; readonly command: string } {
	return resolveServeProcessInvocation(command, args, platform);
}

function canUseResolvedCommand(resolved: CodegraphCommandResolution, nodeSupport: CodegraphNodeSupport): boolean {
	return !codegraphCommandRequiresSupportedLocalNode(resolved) || nodeSupport.supported;
}
