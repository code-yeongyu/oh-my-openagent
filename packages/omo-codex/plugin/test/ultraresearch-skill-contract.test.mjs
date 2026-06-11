import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readUltraresearchCopies() {
	const sharedPath = join(sharedSkillsRootPath(), "ultraresearch", "SKILL.md");
	const packagedPath = join(root, "skills", "ultraresearch", "SKILL.md");
	return [
		{ label: "shared", path: sharedPath, content: await readFile(sharedPath, "utf8") },
		{ label: "packaged", path: packagedPath, content: await readFile(packagedPath, "utf8") },
	];
}

function frontmatterDescription(content) {
	const match = content.match(/^---\r?\n[\s\S]*?\bdescription:\s*"([\s\S]*?)"\r?\n[\s\S]*?---/);
	assert.notEqual(match, null, "SKILL.md frontmatter description not found");
	return match[1];
}

test("#given ultraresearch skill #when scanned for non-English content #then it contains no Hangul", async () => {
	for (const copy of await readUltraresearchCopies()) {
		assert.doesNotMatch(
			copy.content,
			/[ᄀ-ᇿ㄰-㆏가-힣]/,
			`${copy.label} copy contains Hangul characters`,
		);
	}
});

test("#given ultraresearch description #when activation policy is inspected #then it gates on explicit research demands only", async () => {
	for (const copy of await readUltraresearchCopies()) {
		const description = frontmatterDescription(copy.content);
		assert.match(description, /explicit/i, `${copy.label}: description must gate activation on explicit demand`);
		assert.match(
			description,
			/ultra-precise investigation/i,
			`${copy.label}: description must name the ultra-precise investigation trigger`,
		);
		assert.match(description, /\bresearch\b/i, `${copy.label}: description must name the research trigger`);
	}
});

test("#given ultraresearch body #when authority is inspected #then it takes precedence over exploration-bounding instructions", async () => {
	for (const copy of await readUltraresearchCopies()) {
		assert.match(
			copy.content,
			/exploration-bounding|exploration (?:caps|budgets|limits)/i,
			`${copy.label}: body must name the exploration-bounding instructions it overrides`,
		);
		assert.match(
			copy.content,
			/supersede|override|do(?:es)? not (?:bind|apply)/i,
			`${copy.label}: body must state precedence while the mode is active`,
		);
	}
});

test("#given ultraresearch worker protocol #when EXPAND flow is inspected #then markers travel as message text and workers never write files", async () => {
	for (const copy of await readUltraresearchCopies()) {
		assert.match(copy.content, /EXPAND/, `${copy.label}: body must keep the EXPAND marker protocol`);
		assert.match(
			copy.content,
			/(?:reply|message|response) text|end (?:its|the|your) (?:reply|response|final message)/i,
			`${copy.label}: EXPAND markers must be returned as message text`,
		);
		assert.match(
			copy.content,
			/read-only|cannot write files|never ask (?:a )?worker(?:s)? to write/i,
			`${copy.label}: body must state the read-only worker constraint`,
		);
		assert.doesNotMatch(
			copy.content,
			/APPEND (?:your )?findings to \$SESSION_DIR/i,
			`${copy.label}: workers must not be instructed to append session-dir files`,
		);
	}
});

test("#given ultraresearch journaling #when ownership is inspected #then the orchestrator owns the session journal", async () => {
	for (const copy of await readUltraresearchCopies()) {
		assert.match(
			copy.content,
			/orchestrator[\s\S]{0,200}journal|journal[\s\S]{0,200}orchestrator/i,
			`${copy.label}: body must assign session-journal writes to the orchestrator`,
		);
		assert.match(copy.content, /SESSION_DIR/, `${copy.label}: body must keep the session directory protocol`);
	}
});

test("#given ultraresearch expansion loop #when stop rules are inspected #then convergence rules and a depth cap are stated", async () => {
	for (const copy of await readUltraresearchCopies()) {
		assert.match(copy.content, /converg/i, `${copy.label}: body must define convergence`);
		assert.match(copy.content, /depth/i, `${copy.label}: body must define an expansion depth cap`);
		assert.match(
			copy.content,
			/minimum (?:of )?(?:2|two) expansion waves|at least (?:2|two) expansion waves/i,
			`${copy.label}: body must require a minimum of two expansion waves before convergence`,
		);
	}
});

test("#given ultraresearch under ultrawork #when coexistence is inspected #then marker and done-definition conflicts are resolved", async () => {
	for (const copy of await readUltraresearchCopies()) {
		assert.match(copy.content, /ultrawork|\bulw\b/i, `${copy.label}: body must address ultrawork coexistence`);
		assert.match(
			copy.content,
			/first(?:-| )line/i,
			`${copy.label}: body must resolve the first-line activation marker conflict`,
		);
	}
});

test("#given ultraresearch worker sizing #when spawn guidance is inspected #then capable-model and high-effort routing is stated", async () => {
	for (const copy of await readUltraresearchCopies()) {
		assert.match(
			copy.content,
			/capable model|high(?:est)? (?:reasoning )?effort/i,
			`${copy.label}: body must route research workers to a capable model or high effort`,
		);
	}
});
