import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { afterEach, describe, expect, it } from "vitest";

const cleanupRoots: string[] = [];

afterEach(() => {
	for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("lazycodex executor verify CLI", () => {
	it("#given valid lazycodex executor stdin #when CLI runs #then stdout contains block JSON", () => {
		// given
		const cwd = createWorkspace();
		const payload = JSON.stringify(createPayload(cwd));

		// when
		const result = runCli(payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('"decision":"block"');
		expect(result.stdout).toContain("거짓말이다");
	});

	it("#given malformed stdin #when CLI runs #then stdout is empty and exit is zero", () => {
		// given
		const payload = "{not-json";

		// when
		const result = runCli(payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("#given unrelated agent stdin #when CLI runs #then stdout is empty and exit is zero", () => {
		// given
		const cwd = createWorkspace();
		const payload = JSON.stringify(createPayload(cwd, { agent_type: "worker" }));

		// when
		const result = runCli(payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("#given receipt artifact stdin #when CLI runs #then stdout is empty and exit is zero", () => {
		// given
		const cwd = createWorkspace();
		const artifactPath = join(cwd, ".omo", "evidence", "receipt.txt");
		mkdirSync(join(cwd, ".omo", "evidence"), { recursive: true });
		writeFileSync(artifactPath, "verified\n");
		const payload = JSON.stringify(
			createPayload(cwd, { last_assistant_message: `EVIDENCE_RECORDED: ${artifactPath}` }),
		);

		// when
		const result = runCli(payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("#given unknown command #when CLI runs #then it exits nonzero with usage", () => {
		// given
		const cwd = createWorkspace();
		const payload = JSON.stringify(createPayload(cwd));

		// when
		const result = spawnSync(execPath, [join(process.cwd(), "dist", "cli.js"), "hook", "stop"], {
			input: payload,
			encoding: "utf8",
		});

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("Usage:");
	});
});

function runCli(input: string) {
	return spawnSync(execPath, [join(process.cwd(), "dist", "cli.js"), "hook", "subagent-stop"], {
		input,
		encoding: "utf8",
	});
}

function createWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "lazycodex-executor-verify-cli-"));
	cleanupRoots.push(root);
	return root;
}

function createPayload(
	cwd: string,
	overrides: Record<string, string | boolean> = {},
): Record<string, string | boolean> {
	return {
		hook_event_name: "SubagentStop",
		agent_type: "lazycodex-executor",
		agent_id: "agent_1",
		session_id: "sess.1",
		cwd,
		transcript_path: "/dev/null",
		model: "gpt-5.5",
		permission_mode: "default",
		stop_hook_active: true,
		last_assistant_message: "done!",
		...overrides,
	};
}
