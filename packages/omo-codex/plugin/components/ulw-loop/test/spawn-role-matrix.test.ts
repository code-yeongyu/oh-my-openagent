import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySpawnGuards, runSpawnGuardCli } from "../src/spawn-guard.js";
import { LAZYCODEX_SPAWN_ROLES } from "../src/spawn-role-guard.js";

let cwd: string;
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "spawn-role-matrix-"));
	vi.stubEnv("OMO_AGENT_TOOLKIT_SURFACE", "lazycodex");
	vi.stubEnv("PLUGIN_DATA", join(cwd, "data"));
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(cwd, { recursive: true, force: true });
});

function guard(tool_name: string, tool_input: Record<string, unknown>) {
	return applySpawnGuards({
		cwd,
		hook_event_name: "PreToolUse",
		model: "test",
		permission_mode: "default",
		session_id: "matrix",
		tool_name,
		tool_input,
		tool_use_id: "call",
		transcript_path: null,
		turn_id: "turn",
	});
}

describe("#given no active plan #when native spawns cross the role boundary", () => {
	for (const tool of [
		"spawn_agent",
		"multi_agent_v1.spawn_agent",
		"collaborationspawn_agent",
		"collaboration.spawn_agent",
	]) {
		for (const fork of [false, true]) {
			for (const registered of [false, true]) {
				for (const named of [false, true]) {
					it(`${tool}: named=${named}, full-history=${fork}, registered=${registered}`, () => {
						const role = registered ? "lazycodex-worker-medium" : "worker";
						const input = {
							message: "TASK: implement",
							...(named ? { agent_type: role } : {}),
							...(tool.includes("collaboration")
								? { fork_turns: fork ? "all" : "none", task_name: "work" }
								: { fork_context: fork }),
						};
						const output = guard(tool, input);
						if (named && registered) expect(output).toBe("");
						else expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe("deny");
					});
				}
			}
		}
	}
	it.each(["default", "deep", "explore", "", "unknown", 42, null])(
		"rejects non-registry or malformed agent_type=%s",
		(agent_type) => {
			expect(JSON.parse(guard("spawn_agent", { agent_type })).hookSpecificOutput.permissionDecision).toBe("deny");
		},
	);
	it("rejects omitted fork_turns and role rather than silently inheriting full history", () => {
		expect(
			JSON.parse(guard("collaboration.spawn_agent", { task_name: "work", message: "TASK: work" })).hookSpecificOutput
				.permissionDecision,
		).toBe("deny");
	});
	it("does not change Senpi role admission", () => {
		vi.stubEnv("OMO_AGENT_TOOLKIT_SURFACE", "omo-senpi");
		expect(guard("spawn_agent", { agent_type: "deep" })).toBe("");
	});
	it("pins explicit selectors to actual bundled TOML names", async () => {
		const root = new URL("../../ultrawork/agents/", import.meta.url);
		const names = await Promise.all(
			(await readdir(root))
				.filter((file) => file.endsWith(".toml"))
				.map(async (file) => {
					const content = await readFile(new URL(file, root), "utf8");
					return /^name = "([^"]+)"/m.exec(content)?.[1];
				}),
		);
		expect([...LAZYCODEX_SPAWN_ROLES].sort()).toEqual(names.sort());
	});
	it("still enforces admission breakers after role validation", async () => {
		await mkdir(join(cwd, "data", "spawn-breaker"), { recursive: true });
		await writeFile(join(cwd, "data", "spawn-breaker", "matrix.json"), JSON.stringify({ reason: "capacity" }));
		expect(JSON.parse(guard("spawn_agent", { agent_type: "explorer" })).hookSpecificOutput.permissionDecision).toBe(
			"deny",
		);
	});
	it("fails loudly on malformed hook input", async () => {
		let output = "";
		await runSpawnGuardCli(
			Readable.from(["{bad-json"]),
			new Writable({
				write(chunk, _encoding, callback) {
					output += chunk.toString();
					callback();
				},
			}),
		);
		expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe("deny");
	});
	it("does not intercept other tools", () => {
		expect(guard("read_file", {})).toBe("");
	});
});
