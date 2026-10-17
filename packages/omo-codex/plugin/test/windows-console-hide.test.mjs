import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Platform contract (#9838, same class as #7144 and #8501): plugin scripts run from Codex hooks, which
// have no console of their own. On Windows a console-subsystem child spawned there without windowsHide
// gets a FRESH console window; the detached `cmd.exe /c npm.cmd` auto-update got one on every update.
// This gate walks every plugin script and resolves the node:child_process entry points each file
// imports, so a new call site, or an exec*/fork call a spawn-only regex would miss, cannot ship
// unflagged. The flag is inert on posix, so the call text is the only place this is provable off Windows.
const ENTRY_POINTS = ["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec", "fork"];

// Intentionally visible processes, or calls whose text cannot carry the literal flag, go here with a
// reason. None today.
const ALLOWLIST = [];

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

// readdirSync returns backslash-separated entries on win32; matching on raw entries would silently
// find nothing there while the gate still looked green.
function toPosix(entry) {
	return entry.replaceAll("\\", "/");
}

function scriptSources() {
	return readdirSync(scriptsDir, { recursive: true, encoding: "utf8" })
		.map(toPosix)
		.filter((entry) => /\.(mjs|mts|js|cjs|ts)$/.test(entry))
		.sort();
}

function importedEntryPoints(source) {
	const locals = new Set();
	for (const [, clause] of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g)) {
		for (const specifier of (clause ?? "").split(",")) {
			const [importedPart, aliasPart] = specifier.split(/\s+as\s+/);
			const imported = (importedPart ?? "").trim().replace(/^type\s+/, "");
			if (!ENTRY_POINTS.includes(imported)) continue;
			locals.add((aliasPart ?? imported).trim());
		}
	}
	return [...locals];
}

// A namespace, default or require import would hide calls from the named-import resolution above, so
// the gate refuses those forms instead of silently auditing nothing.
function unsupportedImportForms(source) {
	return [
		/import\s+\*\s+as\s+\w+\s+from\s*["'](?:node:)?child_process["']/,
		/import\s+\w+\s*(?:,\s*\{[^}]*\})?\s*from\s*["'](?:node:)?child_process["']/,
		/require\(\s*["'](?:node:)?child_process["']\s*\)/,
	].filter((pattern) => pattern.test(source)).length;
}

function callText(source, openingParen) {
	let depth = 0;
	for (let index = openingParen; index < source.length; index += 1) {
		if (source[index] === "(") depth += 1;
		else if (source[index] === ")") {
			depth -= 1;
			if (depth === 0) return source.slice(openingParen, index + 1);
		}
	}
	return source.slice(openingParen);
}

// Comment prose names these functions too, so only the code spelling (identifier then `(`) on a
// non-comment line counts as a call.
function isCommentLine(source, offset) {
	const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
	const lead = source.slice(lineStart, offset).trimStart();
	return lead.startsWith("//") || lead.startsWith("*") || lead.startsWith("/*");
}

function collectCalls(file, source) {
	const calls = [];
	for (const local of importedEntryPoints(source)) {
		for (const match of source.matchAll(new RegExp(String.raw`(?<![\w$.])${local}\(`, "g"))) {
			if (isCommentLine(source, match.index)) continue;
			calls.push({
				file,
				line: source.slice(0, match.index).split("\n").length,
				callee: local,
				text: `${local}${callText(source, match.index + match[0].length - 1)}`,
			});
		}
	}
	return calls;
}

function auditedCalls() {
	return scriptSources().flatMap((file) => collectCalls(file, readFileSync(join(scriptsDir, file), "utf8")));
}

function isAllowlisted(call) {
	return ALLOWLIST.some((entry) => entry.file === call.file && entry.callee === call.callee);
}

test("#given every plugin script child_process call #when inspected #then each passes windowsHide: true or is allowlisted with a reason", () => {
	const offenders = auditedCalls()
		.filter((call) => !/windowsHide:\s*true/.test(call.text) && !isAllowlisted(call))
		.map((call) => `${call.file}:${call.line} ${call.callee}`);

	assert.deepEqual(offenders, []);
});

test("#given every plugin script #when its child_process import is read #then it uses a form the gate can audit", () => {
	const unauditable = scriptSources().filter((file) => unsupportedImportForms(readFileSync(join(scriptsDir, file), "utf8")) > 0);

	assert.deepEqual(unauditable, []);
});

test("#given the audit #when it runs #then it still reaches the detached auto-update spawn it exists for", () => {
	const autoUpdate = auditedCalls().filter((call) => call.file === "auto-update.mjs" && call.callee === "spawn");

	assert.ok(autoUpdate.length > 0, "the gate no longer sees auto-update.mjs spawn calls");
});

test("#given the allowlist #when checked #then every entry has a reason and still matches a real call", () => {
	const calls = auditedCalls();
	const stale = ALLOWLIST.filter(
		(entry) => !entry.reason || !calls.some((call) => call.file === entry.file && call.callee === entry.callee),
	);

	assert.deepEqual(stale, []);
});

test("#given an aliased execFile import without the flag #when audited #then the call is reported, not skipped", () => {
	const source = ['import { execFile as run } from "node:child_process";', 'run("powershell.exe", args, { encoding: "utf8" }, callback);'].join("\n");

	const calls = collectCalls("fixture.mjs", source);

	assert.deepEqual(
		calls.map((call) => call.callee),
		["run"],
	);
	assert.equal(/windowsHide:\s*true/.test(calls[0].text), false);
});

test("#given a namespace child_process import #when checked #then it is refused as unauditable", () => {
	assert.equal(unsupportedImportForms('import * as cp from "node:child_process";'), 1);
	assert.equal(unsupportedImportForms('const cp = require("child_process");'), 1);
	assert.equal(unsupportedImportForms('import { spawn } from "node:child_process";'), 0);
});

test("#given a win32 directory entry #when normalized #then it matches under POSIX separators", () => {
	assert.equal(toPosix("lib\\auto-update.mjs"), "lib/auto-update.mjs");
});
