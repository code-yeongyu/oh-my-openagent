import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function makeFixture() {
	const root = await mkdtemp(join(tmpdir(), "codex-lsp-build-"));
	await mkdir(join(root, "packages", "omo-codex", "plugin", "components", "lsp", "scripts"), { recursive: true });
	await mkdir(join(root, "packages", "lsp-tools-mcp", "dist"), { recursive: true });
	await copyFile(
		new URL("./build-lsp-tools.mjs", import.meta.url),
		join(root, "packages", "omo-codex", "plugin", "components", "lsp", "scripts", "build-lsp-tools.mjs"),
	);
	await writeFile(join(root, "packages", "lsp-tools-mcp", "package.json"), "{}\n");
	await writeFile(join(root, "packages", "lsp-tools-mcp", "dist", "cli.js"), "cli\n");
	const fakeBin = join(root, "bin");
	await mkdir(fakeBin, { recursive: true });
	const npmLog = join(root, "npm.log");
	await writeFile(
		join(fakeBin, "npm"),
		`#!/usr/bin/env node\nconst { appendFileSync } = require("node:fs");\nappendFileSync(${JSON.stringify(npmLog)}, process.argv.slice(2).join(" ") + "\\n");\n`,
	);
	await chmod(join(fakeBin, "npm"), 0o755);
	return { root, npmLog, script: join(root, "packages", "omo-codex", "plugin", "components", "lsp", "scripts", "build-lsp-tools.mjs"), fakeBin };
}

function runScript(script, fakeBin, args = []) {
	return spawnSync(process.execPath, [script, ...args], {
		encoding: "utf8",
		env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
	});
}

test("#given dist cli exists but required hook outputs are missing #when bootstrapping #then it rebuilds", async () => {
	// given
	const fixture = await makeFixture();

	// when
	const result = runScript(fixture.script, fixture.fakeBin);

	// then
	assert.equal(result.status, 0);
	assert.match(await readFile(fixture.npmLog, "utf8"), /ci\nrun build\n/u);
});

test("#given package metadata is newer than required outputs #when bootstrapping #then it rebuilds", async () => {
	// given
	const fixture = await makeFixture();
	await mkdir(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "lsp"), { recursive: true });
	await writeFile(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "lsp", "manager.js"), "manager\n");
	await writeFile(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "tools.js"), "tools\n");
	const older = new Date("2026-01-01T00:00:00.000Z");
	const newer = new Date("2026-01-02T00:00:00.000Z");
	for (const path of [
		join(fixture.root, "packages", "lsp-tools-mcp", "dist", "cli.js"),
		join(fixture.root, "packages", "lsp-tools-mcp", "dist", "tools.js"),
		join(fixture.root, "packages", "lsp-tools-mcp", "dist", "lsp", "manager.js"),
	]) {
		await utimes(path, older, older);
	}
	await utimes(join(fixture.root, "packages", "lsp-tools-mcp", "package.json"), newer, newer);

	// when
	const result = runScript(fixture.script, fixture.fakeBin);

	// then
	assert.equal(result.status, 0);
	assert.match(await readFile(fixture.npmLog, "utf8"), /ci\nrun build\n/u);
});

test("#given force flag #when bootstrapping #then it rebuilds even when dist exists", async () => {
	// given
	const fixture = await makeFixture();
	await mkdir(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "lsp"), { recursive: true });
	await writeFile(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "lsp", "manager.js"), "manager\n");
	await writeFile(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "tools.js"), "tools\n");

	// when
	const result = runScript(fixture.script, fixture.fakeBin, ["--force"]);

	// then
	assert.equal(result.status, 0);
	assert.match(await readFile(fixture.npmLog, "utf8"), /ci\nrun build\n/u);
});

test("#given packaged dist without package metadata #when bootstrapping #then it uses bundled runtime", async () => {
	// given
	const fixture = await makeFixture();
	await mkdir(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "lsp"), { recursive: true });
	await writeFile(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "lsp", "manager.js"), "manager\n");
	await writeFile(join(fixture.root, "packages", "lsp-tools-mcp", "dist", "tools.js"), "tools\n");
	await writeFile(fixture.npmLog, "");
	await rm(join(fixture.root, "packages", "lsp-tools-mcp", "package.json"));

	// when
	const result = runScript(fixture.script, fixture.fakeBin);

	// then
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Using bundled lsp-tools-mcp dist/);
	assert.equal(await readFile(fixture.npmLog, "utf8"), "");
});
