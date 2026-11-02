import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySpawnGuards } from "../src/spawn-guard.js";

let root: string;
let project: string;
let codexHome: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "spawn-role-registered-"));
	project = join(root, "project");
	codexHome = join(root, "codex-home");
	await mkdir(join(project, "src", "deep"), { recursive: true });
	vi.stubEnv("OMO_AGENT_TOOLKIT_SURFACE", "lazycodex");
	vi.stubEnv("PLUGIN_DATA", join(root, "data"));
	vi.stubEnv("CODEX_HOME", codexHome);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

async function role(dir: string, file: string, name?: string): Promise<void> {
	await mkdir(dir, { recursive: true });
	const header = name === undefined ? "" : `name = "${name}"\n`;
	await writeFile(join(dir, file), `${header}description = "custom role"\ndeveloper_instructions = "Do the work."\n`);
}

function spawn(cwd: string, input: Record<string, unknown>): string {
	return applySpawnGuards({
		cwd,
		hook_event_name: "PreToolUse",
		model: "test",
		permission_mode: "default",
		session_id: "registered",
		tool_name: "spawn_agent",
		tool_input: {
			task_name: "check",
			message: "Perform the assigned read-only analysis.",
			fork_turns: "none",
			...input,
		},
		tool_use_id: "call",
		transcript_path: null,
		turn_id: "turn",
	});
}

function denial(output: string): string | null {
	if (output === "") return null;
	const parsed: { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } } =
		JSON.parse(output);
	expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
	return parsed.hookSpecificOutput.permissionDecisionReason;
}

describe("#given custom roles registered outside the bundle", () => {
	describe("#when a project registers them in .codex/agents", () => {
		it("#then each registered role spawns, including from a nested working directory", async () => {
			const agents = join(project, ".codex", "agents");
			for (const name of ["cashflow_planner", "debt_planner", "wealth_planner", "finance_reviewer"])
				await role(agents, `${name}.toml`, name);

			for (const name of ["cashflow_planner", "debt_planner", "wealth_planner", "finance_reviewer"]) {
				expect(denial(spawn(project, { agent_type: name }))).toBeNull();
				expect(denial(spawn(join(project, "src", "deep"), { agent_type: name }))).toBeNull();
			}
		});

		it("#then the role is keyed by its declared name, not the file name", async () => {
			await role(join(project, ".codex", "agents"), "planner-file.toml", "wealth_planner");

			expect(denial(spawn(project, { agent_type: "wealth_planner" }))).toBeNull();
			expect(denial(spawn(project, { agent_type: "planner-file" }))).toContain('Received "planner-file"');
		});

		it("#then a role file without a name field registers under its file name", async () => {
			await role(join(project, ".codex", "agents"), "cashflow_planner.toml");

			expect(denial(spawn(project, { agent_type: "cashflow_planner" }))).toBeNull();
		});
	});

	describe("#when they are registered under CODEX_HOME", () => {
		it("#then a standalone agents/*.toml role and a config.toml [agents.<name>] role both spawn", async () => {
			await role(join(codexHome, "agents"), "finance_reviewer.toml", "finance_reviewer");
			await writeFile(
				join(codexHome, "config.toml"),
				'[agents]\nmax_threads = 4\n\n[agents.debt_planner]\nconfig_file = "./agents/debt.toml"\n',
			);

			expect(denial(spawn(project, { agent_type: "finance_reviewer" }))).toBeNull();
			expect(denial(spawn(project, { agent_type: "debt_planner" }))).toBeNull();
		});
	});
});

describe("#given the guard's purpose of never spawning an unregistered or generic agent", () => {
	it("#when the role has no role file anywhere #then it is still denied and the message lists the registered roles", async () => {
		await role(join(project, ".codex", "agents"), "cashflow_planner.toml", "cashflow_planner");

		const reason = denial(spawn(project, { agent_type: "worker" }));

		expect(reason).toContain('Received "worker"');
		expect(reason).toContain("cashflow_planner");
		expect(reason).toContain("lazycodex-worker-medium");
	});

	it("#when agent_type is missing #then it is denied even with custom roles registered", async () => {
		await role(join(project, ".codex", "agents"), "cashflow_planner.toml", "cashflow_planner");

		expect(denial(spawn(project, {}))).toContain("Received no agent_type");
	});

	it("#when a role is registered only in a different project #then this project still denies it", async () => {
		const other = join(root, "other-project");
		await role(join(other, ".codex", "agents"), "cashflow_planner.toml", "cashflow_planner");

		expect(denial(spawn(project, { agent_type: "cashflow_planner" }))).toContain('Received "cashflow_planner"');
	});

	it("#when the agents directory is unreadable or absent #then bundled roles still spawn", async () => {
		expect(denial(spawn(project, { agent_type: "lazycodex-worker-medium" }))).toBeNull();
		expect(denial(spawn(project, { agent_type: "explorer" }))).toBeNull();
	});
});
