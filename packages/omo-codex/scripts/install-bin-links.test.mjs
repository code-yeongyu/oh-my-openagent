import assert from "node:assert/strict";
import { mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
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

test("#given managed legacy Codex component symlink #when linking bins #then removes stale symlink and writes OMO bin", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");
	const oldTarget = join(root, "codex-home", "plugins", "cache", "legacy-market", "omo", "0.0.1", "components", "rules", "dist", "cli.js");

	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await mkdir(join(root, "codex-home", "plugins", "cache", "legacy-market", "omo", "0.0.1", "components", "rules", "dist"), { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
		bin: { "omo-rules": "./dist/cli.js" },
	});
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeFile(oldTarget, "#!/usr/bin/env node\n");
	await symlink(oldTarget, join(binDir, "codex-rules"));

	await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" });

	await assert.rejects(readlink(join(binDir, "codex-rules")));
	assert.equal(await readlink(join(binDir, "omo-rules")), join(pluginRoot, "dist", "cli.js"));
});

test("#given user-owned legacy Codex symlink #when linking bins #then preserves the user symlink", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");
	const userTarget = join(root, "user-tools", "codex-rules");

	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await mkdir(join(root, "user-tools"), { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
		bin: { "omo-rules": "./dist/cli.js" },
	});
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeFile(userTarget, "#!/usr/bin/env node\n");
	await symlink(userTarget, join(binDir, "codex-rules"));

	await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" });

	assert.equal(await readlink(join(binDir, "codex-rules")), userTarget);
	assert.equal(await readlink(join(binDir, "omo-rules")), join(pluginRoot, "dist", "cli.js"));
});

test("#given user-owned legacy Codex symlink with component-like target #when linking bins #then preserves it", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");
	const userTarget = join(root, "workspace", "components", "rules", "dist", "cli.js");

	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await mkdir(join(root, "workspace", "components", "rules", "dist"), { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
		bin: { "omo-rules": "./dist/cli.js" },
	});
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeFile(userTarget, "#!/usr/bin/env node\n");
	await symlink(userTarget, join(binDir, "codex-rules"));

	await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" });

	assert.equal(await readlink(join(binDir, "codex-rules")), userTarget);
	assert.equal(await readlink(join(binDir, "omo-rules")), join(pluginRoot, "dist", "cli.js"));
});
