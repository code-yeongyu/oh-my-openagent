import assert from "node:assert/strict";
import test from "node:test";

import { parseLazyCodexInstallCliArgs } from "./install/cli-args.mjs";

test("#given lazycodex install flags #when parsing Node installer argv #then keeps Codex autonomous intent", () => {
	// given
	const argv = ["install", "--no-tui", "--codex-autonomous", "--platform=codex"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "install",
		autonomousPermissions: true,
		repoRoot: undefined,
	});
});

test("#given unsupported OpenCode platform override #when parsing Node installer argv #then rejects the Bun-backed path", () => {
	// given
	const argv = ["install", "--platform=both"];

	// when
	const parse = () => parseLazyCodexInstallCliArgs(argv);

	// then
	assert.throws(parse, /lazycodex-ai installs the Codex Light edition only/);
});

test("#given install help flag #when parsing Node installer argv #then returns help", () => {
	// given
	const argv = ["install", "--help"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, { kind: "help" });
});
