import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

const POINTER_MAX_BYTES = 4096;
const skillPath = join(root, "skills", "ultrawork", "SKILL.md");

function runUserPromptSubmitCli(component, extraArgs = []) {
	const payload = {
		hook_event_name: "UserPromptSubmit",
		session_id: "s-ultrawork-pointer",
		turn_id: "t-ultrawork-pointer",
		transcript_path: null,
		cwd: root,
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "ulw this change",
	};
	return spawnSync(
		process.execPath,
		[join(root, "components", component, "dist", "cli.js"), "hook", "user-prompt-submit", ...extraArgs],
		{ cwd: root, encoding: "utf8", input: `${JSON.stringify(payload)}\n` },
	);
}

test("#given synced skills #when the ultrawork skill is inspected #then it carries the full directive body", () => {
	assert.equal(existsSync(skillPath), true);
	const skill = readFileSync(skillPath, "utf8");
	const directive = readFileSync(join(root, "components", "ultrawork", "directive.md"), "utf8");
	assert.match(skill, /^---\nname: ultrawork\n/);
	assert.equal(skill.endsWith(directive), true);
	assert.match(skill, /## 1\. Create the goal with binding success criteria/);
});

test("#given the built ultrawork CLI #when a ulw prompt is submitted #then a compact skill pointer is emitted", () => {
	const result = runUserPromptSubmitCli("ultrawork");
	assert.equal(result.status, 0);
	const output = JSON.parse(result.stdout);
	const context = output.hookSpecificOutput.additionalContext;
	assert.match(context, /^<ultrawork-mode>/);
	assert.match(context, /First user-visible line this turn MUST be exactly:/);
	assert.match(context, /create_goal/);
	assert.equal(context.includes(skillPath), true);
	assert.equal(context.includes("Tier triage"), false);
	assert.equal(Buffer.byteLength(context, "utf8") < POINTER_MAX_BYTES, true);
});

test("#given the built ultrawork and ulw-loop CLIs #when both emit the pointer #then the payloads match byte for byte", () => {
	const ultrawork = JSON.parse(runUserPromptSubmitCli("ultrawork").stdout);
	const ulwLoop = JSON.parse(runUserPromptSubmitCli("ulw-loop", ["--with-ultrawork"]).stdout);
	assert.equal(ulwLoop.hookSpecificOutput.additionalContext, ultrawork.hookSpecificOutput.additionalContext);
});
