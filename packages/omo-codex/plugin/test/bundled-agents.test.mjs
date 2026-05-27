import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(testDir);
const componentRoot = join(pluginRoot, "components", "ultrawork");
const syncAgentsPath = join(componentRoot, "hooks", "sync-agents.py");

async function makeTempDir() {
	return mkdtemp(join(tmpdir(), "codex-bundled-agents-"));
}

async function runSyncHook(codexHome) {
	return new Promise((resolve, reject) => {
		const child = spawn("python3", [syncAgentsPath], {
			env: { ...process.env, CODEX_HOME: codexHome },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end('{"hook_event_name":"SessionStart"}');
	});
}

test("#given session start #when sync hook runs #then bundles explorer agent", async () => {
	const codexHome = await makeTempDir();
	try {
		const result = await runSyncHook(codexHome);
		assert.equal(result.code, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "");

		const target = join(codexHome, "agents", "explorer.toml");
		const targetStat = await lstat(target);
		assert.equal(targetStat.isFile(), true);
		assert.equal(targetStat.isSymbolicLink(), false);

		const content = await readFile(target, "utf8");
		assert.match(content, /^name = "explorer"$/m);
		assert.match(content, /^model = /m);
		assert.match(content, /^model_reasoning_effort = /m);
		assert.match(content, /^developer_instructions = """/m);
		assert.match(content, /codebase search specialist/i);
	} finally {
		await rm(codexHome, { recursive: true, force: true });
	}
});

test("#given session start #when sync hook runs #then bundles librarian agent", async () => {
	const codexHome = await makeTempDir();
	try {
		const result = await runSyncHook(codexHome);
		assert.equal(result.code, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "");

		const target = join(codexHome, "agents", "librarian.toml");
		const targetStat = await lstat(target);
		assert.equal(targetStat.isFile(), true);
		assert.equal(targetStat.isSymbolicLink(), false);

		const content = await readFile(target, "utf8");
		assert.match(content, /^name = "librarian"$/m);
		assert.match(content, /^model = /m);
		assert.match(content, /^model_reasoning_effort = /m);
		assert.match(content, /^developer_instructions = """/m);
		assert.match(content, /THE LIBRARIAN/);
	} finally {
		await rm(codexHome, { recursive: true, force: true });
	}
});

test("#given session start #when sync hook runs #then bundles plan agent into CODEX_HOME/agents", async () => {
	const codexHome = await makeTempDir();
	try {
		const result = await runSyncHook(codexHome);
		assert.equal(result.code, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "");

		const target = join(codexHome, "agents", "plan.toml");
		const targetStat = await lstat(target);
		assert.equal(targetStat.isFile(), true);
		assert.equal(targetStat.isSymbolicLink(), false);

		const content = await readFile(target, "utf8");
		assert.match(content, /^name = "plan"$/m);
		assert.match(content, /^model = /m);
		assert.match(content, /^model_reasoning_effort = /m);
		assert.match(content, /^developer_instructions = """/m);
		assert.match(content, /strategic planning consultant/i);
	} finally {
		await rm(codexHome, { recursive: true, force: true });
	}
});

test("#given session start #when sync hook runs #then installs exactly the expected bundled set", async () => {
	const codexHome = await makeTempDir();
	try {
		await runSyncHook(codexHome);
		const entries = await readdir(join(codexHome, "agents"), { withFileTypes: true });
		const names = entries
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.sort();
		assert.deepEqual(names, [
			"codex-ultrawork-reviewer.toml",
			"explorer.toml",
			"librarian.toml",
			"plan.toml",
		]);
	} finally {
		await rm(codexHome, { recursive: true, force: true });
	}
});
