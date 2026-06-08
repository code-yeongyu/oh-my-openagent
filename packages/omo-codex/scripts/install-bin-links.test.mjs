import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
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

test("#given managed legacy Codex LSP symlink #when linking bins #then removes stale lsp symlink", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");
	const oldTarget = join(root, "codex-home", "plugins", "cache", "legacy-market", "omo", "0.0.1", "components", "lsp", "dist", "cli.js");

	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await mkdir(join(root, "codex-home", "plugins", "cache", "legacy-market", "omo", "0.0.1", "components", "lsp", "dist"), { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
		bin: { omo: "./dist/cli.js" },
	});
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeFile(oldTarget, "#!/usr/bin/env node\n");
	await symlink(oldTarget, join(binDir, "codex-lsp"));

	await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" });

	await assert.rejects(readlink(join(binDir, "codex-lsp")));
	assert.equal(await readlink(join(binDir, "omo")), join(pluginRoot, "dist", "cli.js"));
});

test("#given nested component declares reserved omo bin #when linking bins #then skips the nested top-level command", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const componentRoot = join(pluginRoot, "components", "ulw-loop");
	const binDir = join(root, "bin");

	await mkdir(join(componentRoot, "dist"), { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
	});
	await writeJson(join(componentRoot, "package.json"), {
		name: "@example/ulw-loop",
		bin: {
			omo: "./dist/cli.js",
			"omo-ulw-loop": "./dist/cli.js",
		},
	});
	await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");

	const linked = await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" });

	assert.deepEqual(linked, [
		{ name: "omo-ulw-loop", path: join(binDir, "omo-ulw-loop"), target: join(componentRoot, "dist", "cli.js") },
	]);
	await assert.rejects(readlink(join(binDir, "omo")));
	assert.equal(await readlink(join(binDir, "omo-ulw-loop")), join(componentRoot, "dist", "cli.js"));
});

test("#given stale managed ulw-loop omo symlink #when linking bins #then removes it without touching user-owned omo", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const componentRoot = join(pluginRoot, "components", "rules");
	const binDir = join(root, "bin");
	const oldTarget = join(root, "codex-home", "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist", "cli.js");

	await mkdir(join(componentRoot, "dist"), { recursive: true });
	await mkdir(join(root, "codex-home", "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist"), { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
	});
	await writeJson(join(componentRoot, "package.json"), {
		name: "@example/rules",
		bin: { "omo-rules": "./dist/cli.js" },
	});
	await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeFile(oldTarget, "#!/usr/bin/env node\n");
	await symlink(oldTarget, join(binDir, "omo"));

	await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" });

	await assert.rejects(readlink(join(binDir, "omo")));
	assert.equal(await readlink(join(binDir, "omo-rules")), join(componentRoot, "dist", "cli.js"));
});

test("#given stale local-source ulw-loop omo symlink #when linking bins #then removes it", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const componentRoot = join(pluginRoot, "components", "rules");
	const binDir = join(root, "bin");
	const oldTarget = join(root, "repo", "packages", "omo-codex", "plugin", "components", "ulw-loop", "dist", "cli.js");

	await mkdir(join(componentRoot, "dist"), { recursive: true });
	await mkdir(join(root, "repo", "packages", "omo-codex", "plugin", "components", "ulw-loop", "dist"), { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
	});
	await writeJson(join(componentRoot, "package.json"), {
		name: "@example/rules",
		bin: { "omo-rules": "./dist/cli.js" },
	});
	await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
	await writeFile(oldTarget, "#!/usr/bin/env node\n");
	await symlink(oldTarget, join(binDir, "omo"));

	await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" });

	await assert.rejects(readlink(join(binDir, "omo")));
	assert.equal(await readlink(join(binDir, "omo-rules")), join(componentRoot, "dist", "cli.js"));
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

test("#given package bin name escapes bin directory #when linking bins #then rejects without writing outside link", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");
	const escapedLink = join(root, "escaped");

	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
		bin: { "../escaped": "./dist/cli.js" },
	});
	await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");

	await assert.rejects(
		linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" }),
		/invalid package bin name/,
	);
	await assert.rejects(lstat(escapedLink));
});

test("#given package bin target escapes plugin root #when linking bins #then rejects without linking outside target", async () => {
	const root = await makeTempDir();
	const pluginRoot = join(root, "plugin");
	const binDir = join(root, "bin");
	const outsideTarget = join(root, "outside.js");

	await mkdir(pluginRoot, { recursive: true });
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/omo",
		bin: { omo: "../outside.js" },
	});
	await writeFile(outsideTarget, "#!/usr/bin/env node\n");

	await assert.rejects(
		linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" }),
		/escapes package root/,
	);
	await assert.rejects(readlink(join(binDir, "omo")));
});
