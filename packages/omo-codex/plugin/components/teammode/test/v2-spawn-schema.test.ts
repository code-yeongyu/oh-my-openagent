import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const teamScriptPath = fileURLToPath(new URL("../skills/teammode/scripts/team.mjs", import.meta.url));

describe("MultiAgentV2 spawn schema", () => {
	it("#given a team member #when preparing its native spawn #then emits only exposed V2 fields", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-teammode-v2-schema-"));
		try {
			const init = Bun.spawnSync({
				cmd: [
					process.execPath,
					teamScriptPath,
					"init",
					"--name",
					"Schema",
					"--session-name",
					"schema",
					"--session",
					"schema",
					"--transport",
					"multi_agent_v2",
				],
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(init.exitCode).toBe(0);

			// when
			const added = Bun.spawnSync({
				cmd: [
					process.execPath,
					teamScriptPath,
					"add-member",
					"--team",
					"schema",
					"--id",
					"A",
					"--name",
					"schema-member",
					"--task-name",
					"schema_member",
					"--focus",
					"spawn schema",
					"--lens",
					"area",
					"--deliverable",
					"schema contract",
				],
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			});
			const delivery = new TextDecoder().decode(added.stdout);

			// then
			expect(added.exitCode).toBe(0);
			expect(delivery).toContain('using only task_name "schema_member", message <bootstrap>, and fork_turns "none"');
			expect(delivery).not.toMatch(/agent_type|model|reasoning_effort|service_tier/);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
