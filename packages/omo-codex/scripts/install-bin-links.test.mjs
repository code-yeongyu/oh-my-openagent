// allow: SIZE_OK - bin link installer tests share one cross-platform link fixture; this release adds narrow link cases and future additions should split by platform family.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

import { linkCachedPluginBins, linkRootRuntimeBin } from "./install-dist/install-local.mjs";
import { makeTempDir, writeJson } from "./install-test-fixtures.mjs";

const BROKEN_WINDOWS_DOUBLE_QUOTE_TRIM = 'if "!OMO_NODE_BINARY:~0,1!"=="^"" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~1!"';

async function writeRuntimeWrapperFixture({ withNodeCli = false } = {}) {
	const root = await makeTempDir();
	const repoRoot = join(root, "repo");
	const binDir = join(root, "bin");
	const codexHome = join(root, "codex");
	const homeDir = join(root, "home");
	await mkdir(join(repoRoot, "dist", "cli"), { recursive: true });
	await writeFile(join(repoRoot, "dist", "cli", "index.js"), "");
	if (withNodeCli) {
		await mkdir(join(repoRoot, "dist", "cli-node"), { recursive: true });
		await writeFile(
			join(repoRoot, "dist", "cli-node", "index.js"),
			'console.log("OMO_NODE_OK", process.argv.slice(2).join(" "));\n',
		);
	}
	await mkdir(homeDir, { recursive: true });
	const link = await linkRootRuntimeBin({ binDir, codexHome, repoRoot, platform: "linux" });
	return { homeDir, link, repoRoot };
}

function runtimeWrapperEnv(homeDir) {
	return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: homeDir };
}

test("#given bun absent from PATH but present in ~/.bun/bin #when running the omo runtime wrapper #then resolves the bun fallback", async (t) => {
	if (process.platform === "win32") return t.skip("posix wrapper execution");
	const { homeDir, link } = await writeRuntimeWrapperFixture();
	await mkdir(join(homeDir, ".bun", "bin"), { recursive: true });
	await writeFile(join(homeDir, ".bun", "bin", "bun"), '#!/bin/sh\necho "fake-bun-ran $2"\n');
	await chmod(join(homeDir, ".bun", "bin", "bun"), 0o755);

	const result = spawnSync(link.path, ["--version"], {
		encoding: "utf8",
		env: { PATH: "/usr/bin:/bin", HOME: homeDir },
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /fake-bun-ran --version/);
});

test("#given bun absent everywhere #when running the omo runtime wrapper #then fails with an actionable install hint", async (t) => {
	if (process.platform === "win32") return t.skip("posix wrapper execution");
	const { homeDir, link } = await writeRuntimeWrapperFixture();

	const result = spawnSync(link.path, ["--version"], {
		encoding: "utf8",
		env: { PATH: "/usr/bin:/bin", HOME: homeDir },
	});

	assert.equal(result.status, 127);
	assert.match(result.stderr, /bun runtime not found/);
	assert.match(result.stderr, /https:\/\/bun\.sh/);
});

test("#given OMO_RUNTIME=node and a node CLI bundle #when running the omo runtime wrapper #then executes the node CLI", async (t) => {
	if (process.platform === "win32") return t.skip("posix wrapper execution");
	const { homeDir, link } = await writeRuntimeWrapperFixture({ withNodeCli: true });

	const result = spawnSync(link.path, ["--help"], {
		encoding: "utf8",
		env: { ...runtimeWrapperEnv(homeDir), OMO_RUNTIME: "node" },
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /OMO_NODE_OK --help/);
});

test("#given bun absent everywhere and a node CLI bundle #when running the omo runtime wrapper #then falls back to node", async (t) => {
	if (process.platform === "win32") return t.skip("posix wrapper execution");
	const { homeDir, link } = await writeRuntimeWrapperFixture({ withNodeCli: true });

	const result = spawnSync(link.path, ["--version"], {
		encoding: "utf8",
		env: runtimeWrapperEnv(homeDir),
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /OMO_NODE_OK --version/);
});

test("#given bun absent and no node CLI bundle #when running the omo runtime wrapper #then the error names both runtimes", async (t) => {
	if (process.platform === "win32") return t.skip("posix wrapper execution");
	const { homeDir, link } = await writeRuntimeWrapperFixture();

	const result = spawnSync(link.path, ["--version"], {
		encoding: "utf8",
		env: runtimeWrapperEnv(homeDir),
	});

	assert.equal(result.status, 127);
	assert.match(result.stderr, /bun runtime not found/);
	assert.match(result.stderr, /https:\/\/bun\.sh/);
	assert.match(result.stderr, /dist\/cli-node\/index\.js/);
	assert.match(result.stderr, /OMO_RUNTIME=node/);
});

test("#given Windows platform #when writing the omo runtime wrapper #then embeds the node fallback chain", async () => {
	const root = await makeTempDir();
	const repoRoot = join(root, "repo");
	const binDir = join(root, "bin");
	await mkdir(join(repoRoot, "dist", "cli"), { recursive: true });
	await writeFile(join(repoRoot, "dist", "cli", "index.js"), "");

	const link = await linkRootRuntimeBin({ binDir, codexHome: join(root, "codex"), repoRoot, platform: "win32" });

	const wrapper = await readFile(link.path, "utf8");
	assert.match(wrapper, /OMO_RUNTIME/);
	assert.match(wrapper, /dist[\\/]cli-node[\\/]index\.js/);
	assert.ok(!wrapper.includes(BROKEN_WINDOWS_DOUBLE_QUOTE_TRIM), "Windows runtime wrapper must not contain invalid quote comparison");
	assert.ok(wrapper.indexOf("OMO_RUNTIME") < wrapper.indexOf("where bun"), "node override must precede bun discovery");
});

test("#given Windows platform #when writing the omo runtime wrapper #then embeds the bun fallback chain", async () => {
	const root = await makeTempDir();
	const repoRoot = join(root, "repo");
	const binDir = join(root, "bin");
	await mkdir(join(repoRoot, "dist", "cli"), { recursive: true });
	await writeFile(join(repoRoot, "dist", "cli", "index.js"), "");

	const link = await linkRootRuntimeBin({ binDir, codexHome: join(root, "codex"), repoRoot, platform: "win32" });

	const wrapper = await readFile(link.path, "utf8");
	assert.match(wrapper, /where bun/);
	assert.match(wrapper, /%USERPROFILE%\\\.bun\\bin\\bun\.exe/);
	assert.match(wrapper, /bun runtime not found/);
	assert.match(wrapper, /exit \/b 127/);
});

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
	assert.match(shim, /NODE_REPL_NODE_PATH/);
	assert.match(shim, /"%OMO_NODE_BINARY%"/);
	assert.ok(!shim.includes(BROKEN_WINDOWS_DOUBLE_QUOTE_TRIM), "Windows command shim must not contain invalid quote comparison");
	assert.match(shim, new RegExp(`"${join(pluginRoot, "dist", "cli.js").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" %\\*`));
	assert.doesNotMatch(shim, new RegExp(`node "${join(pluginRoot, "dist", "cli.js").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" %\\*`));
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
			ulw: "./dist/cli.js",
			"ulw-loop": "./dist/cli.js",
		},
	});
	await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");

	const linked = await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" });

	assert.deepEqual(linked, [
		{ name: "omo-ulw-loop", path: join(binDir, "omo-ulw-loop"), target: join(componentRoot, "dist", "cli.js") },
		{ name: "ulw", path: join(binDir, "ulw"), target: join(componentRoot, "dist", "cli.js") },
		{ name: "ulw-loop", path: join(binDir, "ulw-loop"), target: join(componentRoot, "dist", "cli.js") },
	]);
	await assert.rejects(readlink(join(binDir, "omo")));
	assert.equal(await readlink(join(binDir, "omo-ulw-loop")), join(componentRoot, "dist", "cli.js"));
	assert.equal(await readlink(join(binDir, "ulw")), join(componentRoot, "dist", "cli.js"));
	assert.equal(await readlink(join(binDir, "ulw-loop")), join(componentRoot, "dist", "cli.js"));
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
		/Invalid package bin command name/,
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
		/Package bin target must stay inside package root/,
	);
	await assert.rejects(readlink(join(binDir, "omo")));
});
