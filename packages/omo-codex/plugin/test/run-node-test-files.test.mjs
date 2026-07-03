import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

test("#given extra node test arguments #when aggregate test wrapper runs #then forwards them to node", async () => {
	// given
	const fixtureRoot = await mkdtemp(join(tmpdir(), "omo-node-test-wrapper-"));
	const fixtureTestRoot = join(fixtureRoot, "test");
	const reportPath = join(fixtureRoot, "node-test-report.xml");
	await mkdir(fixtureTestRoot);
	await writeFile(
		join(fixtureTestRoot, "argument-forwarding.test.mjs"),
		[
			'import assert from "node:assert/strict";',
			'import test from "node:test";',
			'test("selected wrapper case", () => assert.equal(1, 1));',
			'test("unselected wrapper case", () => assert.fail("test-name-pattern was not forwarded"));',
		].join("\n"),
	);
	const childEnv = { ...process.env };
	delete childEnv.NODE_TEST_CONTEXT;
	let result;
	let report = "";

	// when
	try {
		result = spawnSync(
			process.execPath,
			[
				join(root, "scripts", "run-node-test-files.mjs"),
				"--test-name-pattern",
				"^selected wrapper case$",
				"--test-reporter=junit",
				"--test-reporter-destination",
				reportPath,
			],
			{ cwd: fixtureRoot, encoding: "utf8", env: childEnv },
		);
		report = result.status === 0 ? await readFile(reportPath, "utf8") : "";
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true });
	}

	// then
	assert.equal(result.status, 0, result.stderr);
	assert.match(report, /<testcase name="selected wrapper case"/);
	assert.match(report, /message="test name does not match pattern"/);
	assert.match(report, /<!-- fail 0 -->/);
});
