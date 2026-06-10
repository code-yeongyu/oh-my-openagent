import assert from "node:assert/strict";
import test from "node:test";

import { parseLazyCodexInstallCliArgs } from "./install/cli-args.mjs";

test("#given repair-config command #when parsing Node installer argv #then returns native repair intent", () => {
	const parsed = parseLazyCodexInstallCliArgs(["repair-config"]);
	assert.deepEqual(parsed, { kind: "repair-config", dryRun: false });
});

test("#given dry-run repair-config command #when parsing Node installer argv #then preserves dry-run intent", () => {
	const parsed = parseLazyCodexInstallCliArgs(["--dry-run", "repair-config"]);
	assert.deepEqual(parsed, { kind: "repair-config", dryRun: true });
});