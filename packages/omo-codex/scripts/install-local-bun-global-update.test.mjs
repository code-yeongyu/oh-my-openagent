import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

test("#given direct bun global lazycodex bin #when running update dry-run #then prints bun global update command", { skip: process.platform === "win32" }, () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));
	const tempHome = mkdtempSync(join(tmpdir(), "lazycodex-bun-global-bin-"));
	const binDir = join(tempHome, ".bun", "bin");
	const binPath = join(binDir, "lazycodex-ai");
	mkdirSync(binDir, { recursive: true });

	try {
		writeDirectBunGlobalLazyCodexBin(binPath, scriptPath);

		// when
		const output = execFileSync(process.execPath, [binPath, "--dry-run", "update"], {
			encoding: "utf8",
			env: {
				...process.env,
				HOME: tempHome,
				LAZYCODEX_CURRENT_VERSION: "1.0.0",
				LAZYCODEX_LATEST_VERSION: "1.0.1",
			},
		}).trim();

		// then
		assert.equal(output, "bun update -g lazycodex-ai@latest\nnpx --yes lazycodex-ai@latest install --no-tui --codex-autonomous");
	} finally {
		rmSync(tempHome, { recursive: true, force: true });
	}
});

function writeDirectBunGlobalLazyCodexBin(binPath, scriptPath) {
	const generatedInstallerUrl = pathToFileURL(fileURLToPath(new URL("./install-dist/install-local.mjs", import.meta.url))).href;
	const repoRoot = join(dirname(scriptPath), "..", "..", "..");
	writeFileSync(
		binPath,
		`#!/usr/bin/env node
import { runLazyCodexInstallLocalCli } from ${JSON.stringify(generatedInstallerUrl)};

runLazyCodexInstallLocalCli({
	argv: process.argv.slice(2),
	defaultRepoRoot: ${JSON.stringify(repoRoot)},
	entrypointPath: ${JSON.stringify(scriptPath)},
	invokedPath: process.argv[1] ?? "",
	cwd: process.cwd(),
	env: process.env,
	log: console.log,
}).then((exitCode) => {
	process.exitCode = exitCode;
}).catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
`,
	);
	chmodSync(binPath, 0o755);
}
