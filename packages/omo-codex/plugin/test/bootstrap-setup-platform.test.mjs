import assert from "node:assert/strict";
import { chmod, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
	readConfig,
	runWorkerSetup,
	setupOptions,
	withSetupFixture,
} from "./bootstrap-setup-fixture.mjs";

test("#given an unwritable config.toml #when the worker setup runs #then it degrades naming config.toml and leaves the file untouched", async () => {
	await withSetupFixture(async (fixture) => {
		const configPath = join(fixture.codexHome, "config.toml");
		const before = await readFile(configPath, "utf8");
		await chmod(configPath, 0o444);
		try {
			const outcome = await runWorkerSetup(setupOptions(fixture));

			const configEntries = outcome.degraded.filter(
				(entry) => entry.component === "config",
			);
			assert.equal(configEntries.length, 1);
			assert.match(configEntries[0].reason, /config\.toml/);
			assert.equal(await readFile(configPath, "utf8"), before);
			assert.equal((await stat(configPath)).mode & 0o777, 0o444);
		} finally {
			await chmod(configPath, 0o644);
		}
	});
});

test("#given win32 without Git Bash #when the worker setup runs #then it degrades instead of throwing and disables the git_bash MCP", async () => {
	await withSetupFixture(async (fixture) => {
		const outcome = await runWorkerSetup(
			setupOptions(fixture, {
				platform: "win32",
				resolveGitBash: () => ({
					checkedPaths: [],
					found: false,
					installHint: "install git bash",
				}),
			}),
		);

		const gitBashEntries = outcome.degraded.filter(
			(entry) => entry.component === "git-bash",
		);
		assert.equal(gitBashEntries.length, 1);
		const config = await readConfig(fixture);
		assert.match(
			config,
			/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]\nenabled = false/,
		);
		assert.match(
			config,
			/\[plugins\."omo@sisyphuslabs"\]\nenabled = true/,
			"setup must continue past a missing Git Bash",
		);
	});
});

test("#given win32 with Git Bash and OMO_CODEX_GIT_BASH_PATH #when the worker setup runs #then git_bash is enabled and the MCP env is stamped", async () => {
	await withSetupFixture(async (fixture) => {
		const bashPath = "C:\\Tools\\Git\\bin\\bash.exe";
		const outcome = await runWorkerSetup(
			setupOptions(fixture, {
				env: { OMO_CODEX_GIT_BASH_PATH: bashPath },
				platform: "win32",
				resolveGitBash: () => ({
					checkedPaths: [bashPath],
					found: true,
					path: bashPath,
					source: "env",
				}),
			}),
		);

		assert.deepEqual(outcome.degraded, []);
		const config = await readConfig(fixture);
		assert.match(
			config,
			/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]\nenabled = true/,
		);
		const manifest = JSON.parse(
			await readFile(join(fixture.pluginRoot, ".mcp.json"), "utf8"),
		);
		assert.equal(
			manifest.mcpServers.git_bash.env.OMO_CODEX_GIT_BASH_PATH,
			bashPath,
		);
	});
});
