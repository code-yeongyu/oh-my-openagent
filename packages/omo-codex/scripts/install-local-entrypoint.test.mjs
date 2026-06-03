import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveDefaultRepoRoot } from "./install-local.mjs";

test("#given published lazycodex bin runs outside the package #when resolving default repo root #then uses installer location", () => {
	// given
	const scriptsDir = dirname(fileURLToPath(import.meta.url));

	// when
	const repoRoot = resolveDefaultRepoRoot();

	// then
	assert.equal(repoRoot, join(scriptsDir, "..", "..", ".."));
});

test("#given lazycodex version flag #when running the Node installer entrypoint #then prints the package version", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));
	const manifestPath = fileURLToPath(new URL("../../../package.json", import.meta.url));
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

	// when
	const output = execFileSync(process.execPath, [scriptPath, "--version"], {
		encoding: "utf8",
	}).trim();

	// then
	assert.equal(output, `lazycodex-ai ${manifest.version}`);
});

test("#given lazycodex runs through an npm bin symlink #when running the Node installer entrypoint #then it still executes main", { skip: process.platform === "win32" }, () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));
	const manifestPath = fileURLToPath(new URL("../../../package.json", import.meta.url));
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const tempDir = mkdtempSync(join(tmpdir(), "lazycodex-bin-"));
	const binPath = join(tempDir, "lazycodex-ai");

	try {
		symlinkSync(scriptPath, binPath);

		// when
		const output = execFileSync(process.execPath, [binPath, "--version"], {
			encoding: "utf8",
		}).trim();

		// then
		assert.equal(output, `lazycodex-ai ${manifest.version}`);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("#given dry-run install flags #when running the Node installer entrypoint #then prints delegated autonomous codex install command", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(
		process.execPath,
		[scriptPath, "--dry-run", "install", "--no-tui"],
		{ encoding: "utf8" },
	).trim();

	// then
	assert.equal(output, "npx --yes --package oh-my-openagent omo install --platform=codex --no-tui --codex-autonomous");
});

test("#given dry-run install opt-out #when running the Node installer entrypoint #then preserves existing Codex permission settings", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(
		process.execPath,
		[scriptPath, "--dry-run", "install", "--no-tui", "--no-codex-autonomous"],
		{ encoding: "utf8" },
	).trim();

	// then
	assert.equal(output, "npx --yes --package oh-my-openagent omo install --platform=codex --no-tui --no-codex-autonomous");
});

test("#given dry-run doctor #when running the Node installer entrypoint #then prints delegated doctor command", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(process.execPath, [scriptPath, "--dry-run", "doctor"], {
		encoding: "utf8",
	}).trim();

	// then
	assert.equal(output, "npx --yes --package oh-my-openagent omo doctor");
});

test("#given dry-run cleanup #when running the Node installer entrypoint #then prints delegated codex cleanup command", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(
		process.execPath,
		[scriptPath, "--dry-run", "cleanup", "--project", "/tmp/lazycodex-qa"],
		{ encoding: "utf8" },
	).trim();

	// then
	assert.equal(output, "npx --yes --package oh-my-openagent omo cleanup --platform=codex --project /tmp/lazycodex-qa");
});

test("#given dry-run uninstall #when running the Node installer entrypoint #then prints delegated codex cleanup command", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(
		process.execPath,
		[scriptPath, "--dry-run", "uninstall", "--project", "/tmp/lazycodex-qa"],
		{ encoding: "utf8" },
	).trim();

	// then
	assert.equal(output, "npx --yes --package oh-my-openagent omo cleanup --platform=codex --project /tmp/lazycodex-qa");
});

test("#given stale lazycodex version #when running update dry-run #then prints the latest installer command", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(process.execPath, [scriptPath, "--dry-run", "update"], {
		encoding: "utf8",
		env: {
			...process.env,
			LAZYCODEX_CURRENT_VERSION: "1.0.0",
			LAZYCODEX_LATEST_VERSION: "1.0.1",
		},
	}).trim();

	// then
	assert.equal(output, "npx --yes lazycodex-ai@latest install --no-tui --codex-autonomous");
});

test("#given current lazycodex version #when running update dry-run #then reports already current", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(process.execPath, [scriptPath, "--dry-run", "update"], {
		encoding: "utf8",
		env: {
			...process.env,
			LAZYCODEX_CURRENT_VERSION: "1.0.1",
			LAZYCODEX_LATEST_VERSION: "1.0.1",
		},
	}).trim();

	// then
	assert.equal(output, "lazycodex-ai 1.0.1 is already up to date.");
});

test("#given dry-run ulw-loop #when running the Node installer entrypoint #then prints delegated ulw-loop command", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(process.execPath, [scriptPath, "--dry-run", "ulw-loop", "help"], {
		encoding: "utf8",
	}).trim();

	// then
	assert.equal(output, "npx --yes --package oh-my-openagent omo ulw-loop help");
});

test("#given the invoking argv path disappears #when importing the Node installer module #then the entrypoint guard does not throw", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));
	const tempDir = mkdtempSync(join(tmpdir(), "lazycodex-import-"));
	const missingArgvPath = join(tempDir, "missing-entrypoint.mjs");
	const probePath = join(tempDir, "probe.mjs");

	try {
		writeFileSync(
			probePath,
			[
				`process.argv[1] = ${JSON.stringify(missingArgvPath)};`,
				`await import(${JSON.stringify(pathToFileURL(scriptPath).href)});`,
			].join("\n"),
		);

		// when
		const output = execFileSync(process.execPath, [probePath], {
			encoding: "utf8",
		}).trim();

		// then
		assert.equal(output, "");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
