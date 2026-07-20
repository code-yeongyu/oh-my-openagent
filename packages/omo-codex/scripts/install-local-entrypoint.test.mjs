import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
	assert.equal(output, "npx --yes oh-my-openagent@latest install --platform=codex --no-tui --codex-autonomous");
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
	assert.equal(output, "npx --yes oh-my-openagent@latest install --platform=codex --no-tui --no-codex-autonomous");
});

test("#given explicit non-Codex dry-run platform #when running the Node installer entrypoint #then rejects it", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when/then
	assert.throws(
		() =>
			execFileSync(process.execPath, [scriptPath, "--dry-run", "install", "--platform=gemini", "--no-tui"], {
				encoding: "utf8",
			}),
		/lazycodex-ai installs the Codex Light edition only/,
	);
});

test("#given dry-run doctor #when running the Node installer entrypoint #then prints Codex LazyCodex doctor workflow command", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(process.execPath, [scriptPath, "--dry-run", "doctor", "--json"], {
		encoding: "utf8",
	}).trim();

	// then
	assert.match(output, /^codex exec /);
	assert.match(output, /--sandbox danger-full-access/);
	assert.doesNotMatch(output, /--model/);
	assert.doesNotMatch(output, /gpt-5\.5-codex-mini/);
	assert.doesNotMatch(output, /--sandbox read-only/);
	assert.match(output, /Use \$omo:lcx-doctor/);
	assert.match(output, /\$\{TMPDIR:-\/tmp\}\/lazycodex-sources/);
	assert.match(output, /Requested doctor arguments: --json/);
	assert.match(output, /Return exactly one JSON object/);
	assert.doesNotMatch(output, /oh-my-openagent omo doctor/);
});

test("#given recursive doctor env #when running the Node installer entrypoint #then refuses to re-enter doctor", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when/then
	assert.throws(
		() =>
			execFileSync(process.execPath, [scriptPath, "--dry-run", "doctor"], {
				encoding: "utf8",
				env: {
					...process.env,
					LAZYCODEX_DOCTOR_LCX_ACTIVE: "1",
				},
			}),
		/Refusing recursive lazycodex doctor invocation/,
	);
});

test("#given dry-run cleanup path needs quoting #when running the Node installer entrypoint #then prints shell-safe command", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));

	// when
	const output = execFileSync(
		process.execPath,
		[scriptPath, "--dry-run", "cleanup", "--project", "/tmp/lazy codex's qa"],
		{ encoding: "utf8" },
	).trim();

	// then
	assert.equal(output, "npx --yes --package oh-my-openagent omo cleanup --platform=codex --project '/tmp/lazy codex'\\''s qa'");
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

test("#given bun global lazycodex wrapper #when running update dry-run #then prints bun global update command", { skip: process.platform === "win32" }, () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));
	const tempHome = mkdtempSync(join(tmpdir(), "lazycodex-bun-global-dry-run-"));
	const binPath = createBunGlobalLazyCodexSymlink(tempHome, scriptPath);

	try {
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

test("#given bun global lazycodex wrapper and untrusted known scripts #when update runs noninteractively #then prints manual scoped trust command", { skip: process.platform === "win32" }, () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));
	const tempHome = mkdtempSync(join(tmpdir(), "lazycodex-bun-global-trust-"));
	const tempBin = mkdtempSync(join(tmpdir(), "lazycodex-bun-bin-"));
	const commandLogPath = join(tempHome, "commands.log");
	const binPath = createBunGlobalLazyCodexSymlink(tempHome, scriptPath);
	writeFakeBunCommand(tempBin);
	writeFakeNpxCommand(tempBin);

	try {
		// when
		const output = execFileSync(process.execPath, [binPath, "update"], {
			encoding: "utf8",
			env: {
				...process.env,
				HOME: tempHome,
				LAZYCODEX_CURRENT_VERSION: "1.0.0",
				LAZYCODEX_LATEST_VERSION: "1.0.1",
				LAZYCODEX_TEST_COMMAND_LOG: commandLogPath,
				PATH: `${tempBin}:${process.env.PATH ?? ""}`,
			},
		});
		const commandLog = readFileSync(commandLogPath, "utf8");

		// then
		assert.match(commandLog, /^bun update -g lazycodex-ai@latest$/m);
		assert.match(commandLog, /^bun pm -g untrusted$/m);
		assert.match(commandLog, /^npx --yes lazycodex-ai@latest install --no-tui --codex-autonomous$/m);
		assert.doesNotMatch(commandLog, /^bun pm -g trust/m);
		assert.match(output, /bun pm -g trust oh-my-openagent @code-yeongyu\/comment-checker/);
		assert.doesNotMatch(output, /left-pad/);
	} finally {
		rmSync(tempHome, { recursive: true, force: true });
		rmSync(tempBin, { recursive: true, force: true });
	}
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

function createBunGlobalLazyCodexSymlink(homeDir, scriptPath) {
	const packageBinDir = join(homeDir, ".bun", "install", "global", "node_modules", "lazycodex-ai", "bin");
	mkdirSync(packageBinDir, { recursive: true });
	const binPath = join(packageBinDir, "lazycodex-ai");
	symlinkSync(scriptPath, binPath);
	return binPath;
}

function writeExecutable(path, source) {
	writeFileSync(path, source);
	chmodSync(path, 0o755);
}

function writeFakeBunCommand(binDir) {
	writeExecutable(
		join(binDir, "bun"),
		`#!/bin/sh
printf '%s\\n' "bun $*" >> "$LAZYCODEX_TEST_COMMAND_LOG"
if [ "$1" = "pm" ] && [ "$2" = "-g" ] && [ "$3" = "untrusted" ]; then
  cat <<'EOF'
./node_modules/oh-my-openagent @4.9.2
 » [postinstall]: node postinstall.mjs

./node_modules/left-pad @1.0.0
 » [postinstall]: node postinstall.js

./node_modules/@code-yeongyu/comment-checker @0.8.0
 » [postinstall]: node postinstall.js
EOF
fi
exit 0
`,
	);
}

function writeFakeNpxCommand(binDir) {
	writeExecutable(
		join(binDir, "npx"),
		`#!/bin/sh
printf '%s\\n' "npx $*" >> "$LAZYCODEX_TEST_COMMAND_LOG"
exit 0
`,
	);
}

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
