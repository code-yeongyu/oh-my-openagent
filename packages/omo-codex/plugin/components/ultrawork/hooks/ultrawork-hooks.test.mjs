import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const hookDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(hookDir);
const detectorPath = join(hookDir, "ultrawork-detector.py");

async function runPython(scriptPath, input, env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn("python3", [scriptPath], {
			env: {
				...process.env,
				...env,
			},
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
		child.once("close", (code, signal) => {
			resolve({ code, signal, stdout, stderr });
		});
		child.stdin.end(input);
	});
}

test("#given ultrawork prompt #when detector runs #then emits directive", async () => {
	const payload = JSON.stringify({
		hook_event_name: "UserPromptSubmit",
		prompt: "please ulw this change",
	});

	const result = await runPython(detectorPath, payload);

	assert.equal(result.code, 0);
	assert.equal(result.signal, null);
	assert.equal(result.stderr, "");
	assert.match(result.stdout, /^<ultrawork-mode>/);
	assert.match(result.stdout, /First user-visible line this turn MUST be exactly:/);
});

test("#given ultrawork prompt #when detector runs #then directive keeps goal budget unlimited", async () => {
	const payload = JSON.stringify({
		hook_event_name: "UserPromptSubmit",
		prompt: "please ultrawork this change",
	});

	const result = await runPython(detectorPath, payload);

	assert.equal(result.code, 0);
	assert.equal(result.signal, null);
	assert.equal(result.stderr, "");
	assert.match(result.stdout, /Goals are\s+unlimited/);
	assert.match(result.stdout, /exactly `objective` and `status` fields/);
	assert.doesNotMatch(result.stdout, /token[_-]?budget/i);
	assert.doesNotMatch(result.stdout, /200000/i);
});

test("#given ultrawork prompt #when detector runs #then directive mandates manual-QA-as-scenario for http/tmux/computer-use", async () => {
	const payload = JSON.stringify({
		hook_event_name: "UserPromptSubmit",
		prompt: "please ultrawork",
	});

	const result = await runPython(detectorPath, payload);

	assert.equal(result.code, 0);
	assert.equal(result.stderr, "");
	assert.match(result.stdout, /SURFACE-AS-SCENARIO/);
	assert.match(result.stdout, /MANUAL QA \u2014 YOU EXECUTE IT, NO STUBS/);
	assert.match(result.stdout, /curl -i/);
	assert.match(result.stdout, /tmux new-session/);
});

test("#given ultrawork prompt #when detector runs #then directive enumerates 4 manual-QA channels explicitly", async () => {
	const payload = JSON.stringify({
		hook_event_name: "UserPromptSubmit",
		prompt: "please ultrawork",
	});

	const result = await runPython(detectorPath, payload);

	assert.equal(result.code, 0);
	assert.equal(result.stderr, "");
	assert.match(result.stdout, /# Manual-QA channels/);
	assert.match(result.stdout, /PICK ONE PER CRITERION \u2014 ACTUALLY RUN IT/);
	assert.match(result.stdout, /1\. HTTP call/);
	assert.match(result.stdout, /2\. tmux/);
	assert.match(result.stdout, /3\. Browser use/);
	assert.match(result.stdout, /4\. Computer use/);
});

test("#given ultrawork prompt #when detector runs #then directive forbids tests-alone verification", async () => {
	const payload = JSON.stringify({
		hook_event_name: "UserPromptSubmit",
		prompt: "please ultrawork",
	});

	const result = await runPython(detectorPath, payload);

	assert.equal(result.code, 0);
	assert.equal(result.stderr, "");
	assert.match(result.stdout, /TESTS ALONE NEVER PROVE DONE/);
	assert.match(result.stdout, /Every[\s\n]+criterion needs its own real-usage scenario/);
	assert.match(result.stdout, /every time/);
});

test("#given ultrawork prompt #when detector runs #then directive mandates paired cleanup with receipt and leftover-state stop rule", async () => {
	const payload = JSON.stringify({
		hook_event_name: "UserPromptSubmit",
		prompt: "please ultrawork",
	});

	const result = await runPython(detectorPath, payload);

	assert.equal(result.code, 0);
	assert.equal(result.stderr, "");
	assert.match(result.stdout, /CLEANUP \(PAIRED \u2014 NEVER SKIP\)/);
	assert.match(result.stdout, /cleanup receipt/);
	assert.match(result.stdout, /tmux kill-session/);
	assert.match(result.stdout, /Leftover state from QA/);
	assert.match(result.stdout, /means NOT done/);
});

test("#given identifier-like ulw #when detector runs #then does not emit directive", async () => {
	const payload = JSON.stringify({
		hook_event_name: "UserPromptSubmit",
		prompt: "refactor ulw_helper.ts",
	});

	const result = await runPython(detectorPath, payload);

	assert.equal(result.code, 0);
	assert.equal(result.signal, null);
	assert.equal(result.stdout, "");
	assert.equal(result.stderr, "");
});

test("#given hook manifest #when read #then registers only the prompt detector hook", async () => {
	const manifest = JSON.parse(await readFile(join(hookDir, "hooks.json"), "utf8"));

	assert.match(
		manifest.hooks.UserPromptSubmit[0].hooks[0].command,
		/ultrawork-detector\.py/,
	);
	assert.equal(manifest.hooks.SessionStart, undefined);
	assert.equal(pluginRoot.endsWith("components/ultrawork"), true);
});

test("#given component package #when inspected #then plugin identity is owned by aggregate root", async () => {
	const pkg = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"));

	assert.equal(pkg.files.includes(".codex-plugin"), false);
	await assert.rejects(
		readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
		/code: 'ENOENT'|ENOENT/,
	);
});
