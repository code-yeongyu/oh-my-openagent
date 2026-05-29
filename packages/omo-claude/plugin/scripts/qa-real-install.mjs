#!/usr/bin/env node
// F3 real-install QA: prove the built plugin works from a COPIED cache tree
// (no node_modules, no `../` traversal) — the failure mode CI cannot catch,
// because CI runs from the monorepo where relative paths resolve.
//
// Steps: build the plugin -> copy plugin/ to a temp dir (the "cache") -> with
// CLAUDE_PLUGIN_ROOT pointed at the copy, fire each hook and boot both MCP
// servers, asserting each succeeds. Evidence is written under .omo/evidence/.
//
//   node scripts/qa-real-install.mjs            build, copy, exercise
//   node scripts/qa-real-install.mjs --no-build use the already-built plugin

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGE_ROOT = dirname(PLUGIN_ROOT);
const REPO_ROOT = dirname(dirname(PACKAGE_ROOT));
const EVIDENCE = join(REPO_ROOT, ".omo", "evidence", "task-30-install-qa");

const failures = [];
function check(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures.push(name);
}

function hook(cli, sub, payload, env = {}) {
	const res = spawnSync("node", [cli, "hook", sub], {
		input: JSON.stringify(payload),
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	return { status: res.status, out: (res.stdout ?? "") + (res.stderr ?? "") };
}

function mcpInitialize(cli, env) {
	const req = `${JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "qa", version: "0" } },
	})}\n`;
	const res = spawnSync("node", [cli, "mcp"], { input: req, encoding: "utf8", timeout: 15000, env: { ...process.env, ...env } });
	return (res.stdout ?? "") + (res.stderr ?? "");
}

if (!process.argv.includes("--no-build")) {
	const build = spawnSync("npm", ["run", "build"], { cwd: PLUGIN_ROOT, stdio: "inherit" });
	if (build.status !== 0) {
		console.error("plugin build failed");
		process.exit(1);
	}
}

mkdirSync(EVIDENCE, { recursive: true });
const cache = join(mkdtempSync(join(tmpdir(), "omo-cache-")), "omo");
cpSync(PLUGIN_ROOT, cache, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "omo-work-"));
writeFileSync(join(work, "CLAUDE.md"), "QA-RULE-MARKER project guidance\n");
writeFileSync(join(work, "x.ts"), "export const a = 1;\n");
const env = { CLAUDE_PLUGIN_ROOT: cache, PLUGIN_DATA: join(work, "pd") };
const C = (name) => join(cache, "components", name, "dist", "cli.js");

const ups = hook(C("rules"), "user-prompt-submit", {
	hook_event_name: "UserPromptSubmit",
	session_id: "qa",
	transcript_path: null,
	cwd: work,
	permission_mode: "default",
	prompt: "hello",
}, env);
check("rules injects from cache (no turn_id/model)", ups.status === 0 && ups.out.includes("hookSpecificOutput"));

const ulw = hook(C("ultrawork"), "user-prompt-submit", {
	hook_event_name: "UserPromptSubmit",
	session_id: "qa",
	transcript_path: null,
	cwd: work,
	prompt: "ulw: go",
}, env);
check("ultrawork directive injects on `ulw:`", /ULTRAWORK/i.test(ulw.out));

for (const comp of ["comment-checker", "lsp", "rules"]) {
	const ptu = hook(C(comp), "post-tool-use", {
		hook_event_name: "PostToolUse",
		session_id: "qa",
		transcript_path: null,
		cwd: work,
		permission_mode: "default",
		tool_name: "Write",
		tool_use_id: "t",
		tool_input: { file_path: join(work, "x.ts"), content: "export const a = 1;\n" },
		tool_response: "ok",
	}, env);
	check(`${comp} PostToolUse runs from cache`, ptu.status === 0);
}

const stop = hook(C("start-work-continuation"), "stop", {
	hook_event_name: "Stop",
	session_id: "qa",
	transcript_path: null,
	cwd: work,
	permission_mode: "default",
	stop_hook_active: false,
}, env);
check("start-work-continuation Stop no-ops without boulder", stop.status === 0);

for (const server of ["ast-grep", "lsp"]) {
	const handshake = mcpInitialize(join(cache, "mcp", server, "cli.js"), env);
	writeFileSync(join(EVIDENCE, `mcp-${server}-handshake.txt`), handshake);
	check(`${server} MCP server boots from cache`, handshake.includes('"serverInfo"'));
}

writeFileSync(join(EVIDENCE, "summary.txt"), `failures: ${failures.length ? failures.join(", ") : "none"}\ncache: ${cache}\n`);
console.log(failures.length === 0 ? "\nF3 real-install QA: ALL PASS" : `\nF3 real-install QA: ${failures.length} FAILURE(S)`);
process.exit(failures.length === 0 ? 0 : 1);
