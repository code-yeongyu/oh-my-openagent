import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SCRIPT_URL = new URL("./build-runtime.mjs", import.meta.url);

test("#given a built component runtime #when the manifest is inspected #then it pins sorted output hashes", async () => {
	const manifest = JSON.parse(await readFile(new URL("../dist/.omo-runtime-manifest.json", import.meta.url), "utf8"));
	assert.equal(manifest.schemaVersion, 1);
	assert.match(manifest.inputDigest, /^sha256:[0-9a-f]{64}$/u);
	assert.deepEqual(
		manifest.outputs.map((output) => output.path),
		[...manifest.outputs.map((output) => output.path)].sort(),
	);
	assert(manifest.outputs.some((output) => output.path === "cli.js"));
	assert(manifest.outputs.every((output) => /^[0-9a-f]{64}$/u.test(output.sha256)));
});

test("#given a dist-only installed component #when output bytes are tampered #then validation fails actionably", async () => {
	const root = await mkdtemp(join(tmpdir(), "codex-lsp-dist-only-"));
	try {
		const componentRoot = join(root, "component");
		await mkdir(join(componentRoot, "scripts"), { recursive: true });
		await copyFile(SCRIPT_URL, join(componentRoot, "scripts", "build-runtime.mjs"));
		await writeFile(join(componentRoot, "package.json"), JSON.stringify({ version: "4.17.0" }));
		await mkdir(join(componentRoot, "dist"), { recursive: true });
		await writeFile(join(componentRoot, "dist", "cli.js"), "console.log('tampered')\n");
		await writeFile(
			join(componentRoot, "dist", ".omo-runtime-manifest.json"),
			JSON.stringify(
				{
					schemaVersion: 1,
					version: "4.17.0",
					inputDigest: `sha256:${"0".repeat(64)}`,
					outputs: [{ path: "cli.js", sha256: "1".repeat(64) }],
				},
				null,
				2,
			),
		);

		const result = spawnSync(process.execPath, [join(componentRoot, "scripts", "build-runtime.mjs")], {
			encoding: "utf8",
		});

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Invalid installed codex-lsp runtime manifest/u);
		assert.match(result.stderr, /hash mismatch/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
