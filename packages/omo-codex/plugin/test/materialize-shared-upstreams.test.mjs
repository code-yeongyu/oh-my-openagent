import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

// Drive the shipped CLI in a disposable layout. Only external Git results and
// backoff time are controlled; no test-only export or option is added to it.
function runCli(t, { failures = 0, strict = true, strictEnv = false, skip = false, pins = "valid" } = {}) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-materialize-retry-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const entry = join(root, "packages", "omo-codex", "plugin", "scripts");
	const shared = join(root, "packages", "shared-skills");
	mkdirSync(entry, { recursive: true });
	mkdirSync(join(shared, "scripts"), { recursive: true });
	for (const name of ["materialize-shared-upstreams.mjs", "entry-guard.mjs"]) {
		copyFileSync(join(scripts, name), join(entry, name));
	}
	writeFileSync(join(shared, "scripts", "materialize-frontend-refs.mjs"),
		'export async function materializeFrontendRefs({ strict }) { globalThis.record({ op: "materialize", strict }); return { skipped: false }; }\n');
	writeFileSync(join(shared, "stage-omowright-runtime.mjs"),
		'export async function stageOmowrightRuntime() { globalThis.record({ op: "stage" }); return { version: "fixture" }; }\n');
	const trace = join(root, "trace.json");
	writeFileSync(trace, "[]");
	const preload = join(root, "git-fixture.mjs");
	writeFileSync(preload, `
import childProcess from "node:child_process";
import timers from "node:timers/promises";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
const events = [];
const realSleep = timers.setTimeout;
let attempts = 0;
let paths = [];
globalThis.record = (event) => {
  events.push(event);
  writeFileSync(${JSON.stringify(trace)}, JSON.stringify(events));
};
childProcess.execFileSync = (command, args, options) => {
  if (command !== "git") throw new Error("unexpected command: " + command);
  record({ op: args[0], args, cwd: options.cwd, windowsHide: options.windowsHide });
  if (args[0] === "submodule") {
    paths = args.slice(4);
    if (++attempts <= ${failures}) throw new Error("fixture fetch unavailable");
    return Buffer.alloc(0);
  }
  if (args[0] !== "ls-files") throw new Error("unexpected Git operation");
  if (${JSON.stringify(pins)} === "error") throw new Error("fixture index unavailable");
  return paths.map((path, i) => {
    const mode = ${JSON.stringify(pins)} === "invalid" ? "100644" : "160000";
    const stage = ${JSON.stringify(pins)} === "unmerged" ? "2" : "0";
    const sha = String(i + 1).repeat(${JSON.stringify(pins)} === "sha256" ? 64 : 40);
    return mode + " " + sha + " " + stage + "\\t" + path + "\\0";
  }).join("");
};
timers.setTimeout = async (ms) => {
  record({ op: "sleep", ms });
  await realSleep(15);
  record({ op: "wake", ms });
};
syncBuiltinESMExports();
`);
	const env = { ...process.env };
	delete env.NODE_OPTIONS;
	delete env.OMO_SKIP_MATERIALIZE;
	delete env.OMO_MATERIALIZE_STRICT;
	if (strictEnv) env.OMO_MATERIALIZE_STRICT = "1";
	if (skip) env.OMO_SKIP_MATERIALIZE = "1";
	const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(entry, "materialize-shared-upstreams.mjs"), ...(strict ? ["--strict"] : [])], {
		cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 10000,
	});
	assert.ifError(result.error);
	assert.equal(result.signal, null, result.stderr);
	return { ...result, events: JSON.parse(readFileSync(trace, "utf8")), root };
}

const operations = (result) => result.events.map(({ op }) => op);
const attempts = (result) => result.events.filter(({ op }) => op === "submodule");
const delays = (result) => result.events.filter(({ op }) => op === "sleep").map(({ ms }) => ms);

function assertFetchContract(result, count) {
	assert.equal(attempts(result).length, count);
	for (const call of attempts(result)) {
		assert.deepEqual(call.args.slice(0, 4), ["submodule", "update", "--init", "--recursive"]);
		assert.equal(call.args.includes("--remote"), false);
		assert.equal(call.cwd, result.root);
		assert.equal(call.windowsHide, true);
	}
}

test("#given reachable pins #when strict materialization runs #then fetch once without backoff", (t) => {
	const r = runCli(t);
	assert.equal(r.status, 0, r.stderr);
	assertFetchContract(r, 1);
	assert.deepEqual(operations(r), ["submodule", "materialize", "stage"]);
});

test("#given one failed fetch #when strict materialization retries #then await recovery before staging", (t) => {
	const r = runCli(t, { failures: 1 });
	assert.equal(r.status, 0, r.stderr);
	assertFetchContract(r, 2);
	assert.deepEqual(delays(r), [1000]);
	assert.deepEqual(operations(r), ["submodule", "sleep", "wake", "submodule", "materialize", "stage"]);
});

test("#given two failed fetches #when the final attempt recovers #then stop retrying with bounded backoff", (t) => {
	const r = runCli(t, { failures: 2 });
	assert.equal(r.status, 0, r.stderr);
	assertFetchContract(r, 3);
	assert.deepEqual(delays(r), [1000, 2000]);
	assert.equal(r.events.filter(({ op }) => op === "materialize").length, 1);
	assert.equal(r.events.some(({ op }) => op === "ls-files"), false);
});

test("#given persistent fetch failure #when strict attempts exhaust #then fail with every path and pinned SHA", (t) => {
	const r = runCli(t, { failures: 9 });
	assert.equal(r.status, 1, r.stderr);
	assertFetchContract(r, 3);
	assert.deepEqual(delays(r), [1000, 2000]);
	assert.equal(r.events.some(({ op }) => op === "materialize" || op === "stage"), false);
	assert.match(r.stderr, /failed after 3 attempts/);
	assert.match(r.stderr, /fixture fetch unavailable/);
	const paths = attempts(r)[0].args.slice(4);
	paths.forEach((path, i) => assert.ok(r.stderr.includes(`${path}@${String(i + 1).repeat(40)}`), r.stderr));
	const lookup = r.events.find(({ op }) => op === "ls-files");
	assert.deepEqual(lookup.args, ["ls-files", "--stage", "-z", "--", ...paths]);
	assert.equal(lookup.cwd, r.root);
	assert.equal(lookup.windowsHide, true);
});

test("#given persistent fetch failure #when best-effort attempts exhaust #then warn and materialize once", (t) => {
	const r = runCli(t, { failures: 9, strict: false });
	assert.equal(r.status, 0, r.stderr);
	assertFetchContract(r, 3);
	assert.deepEqual(delays(r), [1000, 2000]);
	assert.deepEqual(operations(r).slice(-3), ["ls-files", "materialize", "stage"]);
	assert.match(r.stderr, /continuing without submodule refresh/);
	assert.equal(r.events.find(({ op }) => op === "materialize").strict, false);
});

test("#given an unreadable index #when retries exhaust #then preserve the original fetch failure and name paths", (t) => {
	const r = runCli(t, { failures: 9, pins: "error" });
	assert.equal(r.status, 1, r.stderr);
	assertFetchContract(r, 3);
	assert.match(r.stderr, /fixture fetch unavailable/);
	for (const path of attempts(r)[0].args.slice(4)) assert.ok(r.stderr.includes(`${path}@unknown`), r.stderr);
	assert.match(r.stderr, /pinned SHA unavailable/);
});

for (const pins of ["invalid", "unmerged"]) {
	test(`#given ${pins} index entries #when reporting failure #then do not invent resolved gitlink pins`, (t) => {
		const r = runCli(t, { failures: 9, pins });
		assert.equal(r.status, 1, r.stderr);
		for (const path of attempts(r)[0].args.slice(4)) assert.ok(r.stderr.includes(`${path}@unknown`), r.stderr);
	});
}

test("#given SHA-256 gitlinks #when retries exhaust #then retain complete pinned object IDs", (t) => {
	const r = runCli(t, { failures: 9, pins: "sha256" });
	assert.equal(r.status, 1, r.stderr);
	attempts(r)[0].args.slice(4).forEach((path, i) => assert.ok(r.stderr.includes(`${path}@${String(i + 1).repeat(64)}`), r.stderr));
});

test("#given strict mode from the environment #when retries exhaust #then fail before downstream materialization", (t) => {
	const r = runCli(t, { failures: 9, strict: false, strictEnv: true });
	assert.equal(r.status, 1, r.stderr);
	assertFetchContract(r, 3);
	assert.equal(r.events.some(({ op }) => op === "materialize"), false);
});

test("#given materialization was already performed #when skip is set #then perform no Git or materializer calls", (t) => {
	const r = runCli(t, { failures: 9, skip: true });
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(r.events, []);
});
