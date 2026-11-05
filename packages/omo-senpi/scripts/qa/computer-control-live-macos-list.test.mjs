import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const driver = fileURLToPath(new URL("./computer-control-live-macos.mjs", import.meta.url));

describe("computer-control-live-macos --list", () => {
	// Guards the driver CLI contract: --list must answer on any host without loading the SDK lane or an engine.
	test("#given --list on any host #then it prints every scenario, the SDK-lane ones included, and exits 0", () => {
		const run = spawnSync(process.execPath, [driver, "--list"], { encoding: "utf8" });
		const names = run.stdout.trim().split("\n");
		expect(run.status).toBe(0);
		expect(names).toEqual(expect.arrayContaining(["chrome-two-window-typing", "dense-window-observe", "two-window-typing"]));
		expect(new Set(names).size).toBe(names.length);
	});
});
