import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installCachedPlugin } from "./install/cache.mjs";
import { makeTempDir } from "./install-test-fixtures.mjs";

test("#given source plugin has a stale npm lockfile #when caching plugin #then lockfile is regenerated rather than copied", async () => {
	// given
	const root = await makeTempDir();
	const codexHome = join(root, "codex-home");
	const sourceRoot = join(root, "plugin");
	await mkdir(sourceRoot, { recursive: true });
	await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }));
	await writeFile(join(sourceRoot, "package-lock.json"), '{"packages":{"components/ulw-loop":{}}}\n');

	// when
	const installed = await installCachedPlugin({
		codexHome,
		marketplaceName: "debug",
		name: "omo",
		sourcePath: sourceRoot,
		version: "0.1.0",
		runCommand: async () => {},
	});

	// then
	await assert.rejects(stat(join(installed.path, "package-lock.json")));
});

test("#given existing cache #when npm install fails #then previous active cache is preserved", async () => {
	// given
	const root = await makeTempDir();
	const codexHome = join(root, "codex-home");
	const sourceRoot = join(root, "plugin");
	const cacheRoot = join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0");
	await mkdir(sourceRoot, { recursive: true });
	await mkdir(cacheRoot, { recursive: true });
	await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }));
	await writeFile(join(cacheRoot, "package.json"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }));

	// when
	await assert.rejects(
		installCachedPlugin({
			codexHome,
			marketplaceName: "debug",
			name: "omo",
			sourcePath: sourceRoot,
			version: "0.1.0",
			runCommand: async (_command, args) => {
				if (args.join(" ") === "install --omit=dev") throw new Error("spawn npm ENOENT");
			},
		}),
		/spawn npm ENOENT/,
	);

	// then
	assert.equal(await readFile(join(cacheRoot, "package.json"), "utf8"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }));
	const cacheParentEntries = await readdir(join(codexHome, "plugins", "cache", "debug", "omo"));
	assert.deepEqual(cacheParentEntries, ["0.1.0"]);
});
