import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveMemoryRoot } from "../../../memory-core/src/identity/layout.ts";

import { engineStateDir, isolatedChildEnv, sandboxStateDir } from "./sandbox-child-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("isolatedChildEnv", () => {
	test("points every agent-dir lane at the sandbox and drops host routing and session identity", () => {
		const caller = {
			PATH: "/bin",
			OMO_CODING_AGENT_DIR: "/home/u/.omo/agent",
			PI_CODING_AGENT_DIR: "/home/u/.omo/agent",
			OMO_RPC_SOCKET_PATH: "/home/u/.omo/agent/rpc/desktop.sock",
			SENPI_RPC_SOCKET: "/home/u/.omo/agent/rpc/rpc.sock",
			SENPI_RPC_HOST_PUBLIC_SOCKET: "/home/u/.omo/agent/rpc/rpc.sock",
			SENPI_RPC_HOST_WATCH_FD: "3",
			PI_SESSION_ID: "01a0dda0",
			PI_SESSION_FILE: "/home/u/.omo/agent/sessions/x.jsonl",
			PI_GOAL_STORE_FILE: "/home/u/.omo/agent/goal.json",
			SENPI_PY_KERNEL_PARENT_PID: "62742",
		};

		const env = isolatedChildEnv(caller, "/tmp/sbx/agent");

		expect(env).toEqual({
			PATH: "/bin",
			OMO_CODING_AGENT_DIR: "/tmp/sbx/agent",
			SENPI_CODING_AGENT_DIR: "/tmp/sbx/agent",
			PI_CODING_AGENT_DIR: "/tmp/sbx/agent",
			// Beside the agent dir, joined with the platform separator (`\tmp\sbx\memory` on Windows).
			OMO_MEMORY_HOME: join(dirname("/tmp/sbx/agent"), "memory"),
		});
		expect(caller.OMO_CODING_AGENT_DIR).toBe("/home/u/.omo/agent");
	});
});

describe("isolatedChildEnv memory root", () => {
	test("resolves the child's memory root inside the sandbox, never the caller's real ~/.omo/memory", () => {
		const sandboxAgentDir = "/tmp/sbx/agent";
		for (const caller of [
			{ PATH: "/bin", HOME: "/home/u" },
			{ PATH: "/bin", HOME: "/home/u", OMO_MEMORY_HOME: "/home/u/.omo/memory" },
		]) {
			const env = isolatedChildEnv(caller, sandboxAgentDir);

			const childRoot = resolveMemoryRoot(env, "/tmp/sbx/project");
			const insideSandbox = relative(resolve("/tmp/sbx"), childRoot);
			expect(isAbsolute(insideSandbox) || insideSandbox.split(sep)[0] === "..").toBe(false);
			expect(childRoot).not.toBe(resolveMemoryRoot(caller, "/tmp/sbx/project"));
		}
	});
});

describe("sandboxStateDir", () => {
	test("resolves where an isolatedChildEnv child's engine keeps state, never the caller's agent dir", () => {
		const sandbox = { cwd: "/tmp/sbx-absent/project", agentDir: "/tmp/sbx-absent/agent" };
		const caller = { OMO_CODING_AGENT_DIR: "/home/u/.omo/agent", HOME: "/home/u" };

		const stateDir = sandboxStateDir(sandbox);

		expect(stateDir).toBe(engineStateDir(sandbox.cwd, isolatedChildEnv(caller, sandbox.agentDir)));
		// The engine resolves the agent dir, so on Windows `/tmp/...` gains the drive letter: compare resolved paths.
		const insideProjects = relative(resolve(sandbox.agentDir, "projects"), stateDir);
		expect(isAbsolute(insideProjects) || insideProjects.split(sep)[0] === "..").toBe(false);
		expect(stateDir).not.toBe(engineStateDir(sandbox.cwd, caller));
	});
});

/** Every non-test driver in this directory tree. */
function drivers(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "node_modules" ? [] : drivers(path);
		return /\.(mjs|ts)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
	});
}

/**
 * An env literal that spreads the caller's environment and names a sandbox SENPI_CODING_AGENT_DIR
 * without routing through isolatedChildEnv inherits OMO_CODING_AGENT_DIR, which outranks it: that
 * sent QA children to the production host (oh-my-openagent#8967).
 */
describe("QA drivers", () => {
	test("never pair an inherited environment spread with a SENPI_CODING_AGENT_DIR override", () => {
		const offenders = [];
		for (const file of drivers(here)) {
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, index) => {
				if (!/\bSENPI_CODING_AGENT_DIR\s*:/.test(line)) return;
				let start = index;
				while (start > Math.max(0, index - 15) && lines[start - 1].trim() !== "") start -= 1;
				const window = lines.slice(start, index + 1).join("\n");
				const spreadsCaller =
					/\.\.\.(?:process\.env|env|baseEnv|cleanEnv|scratch\.env|extraEnv|scrubbedEnv\(|isolatedHomeEnv\()/.test(window);
				if (spreadsCaller && !window.includes("isolatedChildEnv(")) offenders.push(`${relative(here, file)}:${index + 1}`);
			});
		}
		expect(offenders).toEqual([]);
	});
});
