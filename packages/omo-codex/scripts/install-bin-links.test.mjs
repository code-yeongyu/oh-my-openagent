import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { linkCachedPluginBins } from "./install/cache.mjs";
import { makeTempDir, writeJson } from "./install-test-fixtures.mjs";

test("#given Windows platform #when linking cached plugin bins #then writes command shims", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");

	await mkdir(pluginRoot, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/alpha",
		bin: {
			alpha: "./dist/cli.js",
		},
	});
	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");

	const linked = await linkCachedPluginBins({ binDir, pluginRoot, platform: "win32" });

	assert.deepEqual(linked, [{ name: "alpha", path: join(binDir, "alpha.cmd"), target: join(pluginRoot, "dist", "cli.js") }]);
	const shim = await readFile(join(binDir, "alpha.cmd"), "utf8");
	assert.match(shim, /@echo off/);
	assert.match(shim, new RegExp(`node "${join(pluginRoot, "dist", "cli.js").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" %\\*`));
});

test("#given existing custom Windows command shim #when linking bins #then rejects without overwriting", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");

	await mkdir(pluginRoot, { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/alpha",
		bin: {
			alpha: "./dist/cli.js",
		},
	});
	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeFile(join(binDir, "alpha.cmd"), "@echo off\r\necho custom\r\n");

	await assert.rejects(
		linkCachedPluginBins({ binDir, pluginRoot, platform: "win32" }),
		/already exists and is not a generated command shim/,
	);
	assert.match(await readFile(join(binDir, "alpha.cmd"), "utf8"), /echo custom/);
});
