import assert from "node:assert/strict";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function makeFixture() {
	const root = await mkdtemp(join(tmpdir(), "codex-lsp-daemon-build-"));
	const componentRoot = join(root, "packages", "omo-codex", "plugin", "components", "lsp");
	const packageDir = join(root, "packages", "lsp-daemon");
	const script = join(componentRoot, "scripts", "build-lsp-daemon.mjs");
	await mkdir(join(componentRoot, "scripts"), { recursive: true });
	await mkdir(join(packageDir, "dist"), { recursive: true });
	await copyFile(new URL("./build-lsp-daemon.mjs", import.meta.url), script);
	await writeFile(join(packageDir, "package.json"), "{}\n");
	await writeDaemonOutputs(packageDir);
	return { root, componentRoot, packageDir, script };
}

async function writeDaemonOutputs(packageDir) {
	for (const output of ["cli.js", "client.js", "client.d.ts", "index.js", "index.d.ts"]) {
		await writeFile(join(packageDir, "dist", output), `${output}\n`);
	}
}

function runScript(script, fakeBin, args = []) {
	return spawnSync(process.execPath, [script, ...args], {
		encoding: "utf8",
		env: { ...process.env, PATH: fakeBin ? `${fakeBin}${delimiter}${process.env.PATH ?? ""}` : process.env.PATH },
	});
}

test("#given fresh daemon dist #when bootstrapping component #then local package link is created", async () => {
	// given
	const fixture = await makeFixture();
	const link = join(fixture.componentRoot, "node_modules", "@code-yeongyu", "lsp-daemon");

	// when
	const result = runScript(fixture.script);

	// then
	assert.equal(result.status, 0, result.stderr);
	assert.equal((await lstat(link)).isSymbolicLink(), true);
	assert.equal(await realpath(link), await realpath(fixture.packageDir));
});

test("#given client outputs are missing #when bootstrapping component #then daemon rebuild runs before linking", async () => {
	// given
	const fixture = await makeFixture();
	await rm(join(fixture.packageDir, "dist", "client.d.ts"));
	const fakeBin = join(fixture.root, "bin");
	const npmLog = join(fixture.root, "npm.log");
	await mkdir(fakeBin, { recursive: true });
	await writeFile(
		join(fakeBin, "npm.js"),
		`const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");\n` +
			`const { join } = require("node:path");\n` +
			`appendFileSync(${JSON.stringify(npmLog)}, process.argv.slice(2).join(" ") + "\\n");\n` +
			`if (process.argv.slice(2).join(" ") === "run build") {\n` +
			`  const dist = join(process.cwd(), "dist");\n` +
			`  mkdirSync(dist, { recursive: true });\n` +
			`  for (const name of ["cli.js", "client.js", "client.d.ts", "index.js", "index.d.ts"]) writeFileSync(join(dist, name), name + "\\n");\n` +
			`}\n`,
	);
	await writeFile(join(fakeBin, "npm"), "#!/usr/bin/env node\nrequire('./npm.js');\n");
	await chmod(join(fakeBin, "npm"), 0o755);

	// when
	const result = runScript(fixture.script, fakeBin);

	// then
	assert.equal(result.status, 0, result.stderr);
	assert.match(await readFile(npmLog, "utf8"), /ci\nrun build\n/u);
	assert.equal(await realpath(join(fixture.componentRoot, "node_modules", "@code-yeongyu", "lsp-daemon")), await realpath(fixture.packageDir));
});
