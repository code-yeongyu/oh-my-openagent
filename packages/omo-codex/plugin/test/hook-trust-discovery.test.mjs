import assert from "node:assert/strict";
import test from "node:test";

import {
	trustedHookStatesForPlugin,
	hookManifestPaths,
	trustedHookStatesForHooksFile,
	commandHookHash,
	canonicalJson,
	stripDotSlash,
	isRecord,
} from "../scripts/hook-trust-discovery.mjs";

test("hookManifestPaths accepts a single string", () => {
	assert.deepEqual(hookManifestPaths("hooks.json"), ["hooks.json"]);
});

test("hookManifestPaths accepts an array of strings", () => {
	assert.deepEqual(hookManifestPaths(["a.json", "b.json"]), ["a.json", "b.json"]);
});

test("hookManifestPaths strips leading ./ from paths", () => {
	assert.deepEqual(hookManifestPaths("./hooks.json"), ["hooks.json"]);
	assert.deepEqual(hookManifestPaths(["./a.json", "b.json"]), ["a.json", "b.json"]);
});

test("hookManifestPaths returns empty array for invalid input", () => {
	assert.deepEqual(hookManifestPaths(undefined), []);
	assert.deepEqual(hookManifestPaths(123), []);
	assert.deepEqual(hookManifestPaths(""), []);
	assert.deepEqual(hookManifestPaths(["", "  "]), []);
});

test("stripDotSlash removes leading ./ from a path", () => {
	assert.equal(stripDotSlash("./foo/bar"), "foo/bar");
	assert.equal(stripDotSlash("foo/bar"), "foo/bar");
});

test("isRecord distinguishes plain objects from arrays and nulls", () => {
	assert.equal(isRecord({}), true);
	assert.equal(isRecord({ a: 1 }), true);
	assert.equal(isRecord([]), false);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord(undefined), false);
	assert.equal(isRecord("string"), false);
	assert.equal(isRecord(42), false);
});

test("canonicalJson sorts object keys recursively", () => {
	const input = { b: 1, a: { d: 2, c: 3 } };
	const result = canonicalJson(input);
	assert.equal(JSON.stringify(result), '{"a":{"c":3,"d":2},"b":1}');
});

test("canonicalJson passes through primitives and arrays", () => {
	assert.equal(canonicalJson(42), 42);
	assert.equal(canonicalJson("hello"), "hello");
	assert.equal(canonicalJson(null), null);
	assert.deepEqual(canonicalJson([3, 1, 2]), [3, 1, 2]);
});

test("commandHookHash produces a stable sha256 hash", () => {
	const handler = { command: "node script.mjs", timeout: 300 };
	const hash1 = commandHookHash("session_start", undefined, handler);
	const hash2 = commandHookHash("session_start", undefined, handler);
	assert.equal(hash1, hash2);
	assert.ok(hash1.startsWith("sha256:"));
});

test("commandHookHash changes when event or command changes", () => {
	const handler = { command: "node script.mjs" };
	const hashA = commandHookHash("session_start", undefined, handler);
	const hashB = commandHookHash("pre_tool_use", undefined, handler);
	const hashC = commandHookHash("session_start", undefined, { command: "node other.mjs" });
	assert.notEqual(hashA, hashB);
	assert.notEqual(hashA, hashC);
});

test("trustedHookStatesForPlugin returns empty array when manifest is missing", async () => {
	const result = await trustedHookStatesForPlugin({
		marketplaceName: "sisyphuslabs",
		pluginName: "omo",
		pluginRoot: "/nonexistent/path",
	});
	assert.deepEqual(result, []);
});

test("trustedHookStatesForHooksFile extracts command hooks", () => {
	const hooks = {
		SessionStart: [
			{
				hooks: [
					{ type: "command", command: "node start.mjs" },
					{ type: "command", command: "node other.mjs", async: true },
					{ type: "command", command: "" },
					{ type: "webhook", url: "https://example.com" },
				],
			},
		],
	};
	const states = trustedHookStatesForHooksFile({ keySource: "omo@sisyphuslabs:hooks.json", hooks });
	assert.equal(states.length, 1);
	assert.ok(states[0].key.startsWith("omo@sisyphuslabs:hooks.json:session_start:0:"));
	assert.ok(states[0].trustedHash.startsWith("sha256:"));
});
