import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.argv[2];
assert.ok(repo, "Pass the remote scratch checkout path");
const component = join(repo, "packages/omo-codex/plugin/components/rules");
const sandbox = join(repo, "task-1-qa");
const home = join(sandbox, "home");
const project = join(sandbox, "project");
const codexHome = join(home, ".codex");
for (const path of [home, project, codexHome]) mkdirSync(path, { recursive: true });

for (const [model, variant] of [["gpt-6-astra", "gpt-6.md"], ["gpt-6-astra-fast", "gpt-6.md"], ["gpt-5.5", "gpt-5.5.md"]]) {
	const payload = {
		session_id: `qa-task-1-${model}`,
		transcript_path: "/dev/null",
		cwd: project,
		hook_event_name: "SessionStart",
		model,
		permission_mode: "default",
		source: "startup",
	};
	const command = [join(component, "dist/cli.js"), "hook", "session-start"];
	const env = {
		...process.env,
		HOME: home,
		CODEX_HOME: codexHome,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local/share"),
		XDG_STATE_HOME: join(home, ".local/state"),
		XDG_CACHE_HOME: join(home, ".cache"),
		PLUGIN_ROOT: component,
		PLUGIN_DATA: join(sandbox, model),
		CODEX_RULES_ENABLED_SOURCES: "plugin-bundled",
	};
	const result = spawnSync(process.execPath, command, {
		cwd: project,
		env,
		input: JSON.stringify(payload),
		encoding: "utf8",
		timeout: 30_000,
	});
	console.log(JSON.stringify({ command: [process.execPath, ...command], payload, home, codexHome, exit: result.status, stdout: result.stdout, stderr: result.stderr }));
	if (result.error) throw result.error;
	assert.equal(result.status, 0);
	const output = JSON.parse(result.stdout);
	assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
	assert.deepEqual(Object.keys(output.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
	assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
	const rulePath = join(component, "bundled-rules/hephaestus", variant);
	const shipped = readFileSync(rulePath, "utf8");
	const body = shipped.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
	const context = output.hookSpecificOutput.additionalContext;
	assert.ok(context.includes(`Instructions from: ${rulePath}`));
	assert.ok(context.includes(body));
	for (const other of ["gpt-5.5.md", "gpt-5.6.md", "gpt-6.md"].filter((name) => name !== variant)) {
		assert.ok(!context.includes(join(component, "bundled-rules/hephaestus", other)));
	}
	console.log(JSON.stringify({ model, variant, shippedBodyEqual: true, bodyBytes: Buffer.byteLength(body), ruleSha256: createHash("sha256").update(shipped).digest("hex") }));
}
console.log("SESSION_START_QA=PASS");
