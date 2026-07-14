import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const drivers = [
	".agents/skills/codex-qa/scripts/lsp-e2e.sh",
	".agents/skills/opencode-qa/scripts/lsp-e2e.sh",
] as const;
const runtimeDependencies = [
	"packages/lsp-daemon/scripts/qa/cancellation-smoke.mjs",
	"packages/lsp-daemon/scripts/qa/commit-barrier-smoke.mjs",
] as const;
const cancellationSmoke = runtimeDependencies[0];

describe("LSP QA driver portability", () => {
	it("#given a fresh clone #when cancellation QA runs #then every runtime dependency is tracked outside evidence", () => {
		for (const driver of drivers) {
			const source = readFileSync(join(repositoryRoot, driver), "utf8");
			expect(source).not.toContain(".omo/evidence");
			for (const dependency of runtimeDependencies) expect(source).toContain(dependency);
		}

		const expectedTrackedFiles = [...drivers, ...runtimeDependencies].sort();
		const trackedFiles = execFileSync("git", ["ls-files", "--", ...expectedTrackedFiles], {
			cwd: repositoryRoot,
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.filter(Boolean)
			.sort();

		expect(trackedFiles).toEqual(expectedTrackedFiles);
	});

	it("#given the native platform #when the cancellation smoke runs #then it binds the production endpoint kind", () => {
		const output = execFileSync("bun", [join(repositoryRoot, cancellationSmoke), repositoryRoot], {
			cwd: repositoryRoot,
			encoding: "utf8",
			timeout: 30_000,
		});
		const expectedEndpointKind = process.platform === "win32" ? "named-pipe" : "unix-socket";

		expect(JSON.parse(output)).toMatchObject({ daemonEndpointKind: expectedEndpointKind });
	});
});
