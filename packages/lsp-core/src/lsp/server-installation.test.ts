import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	__resetServerBinaryResolutionCacheForTests,
	__serverBinaryProbeCountForTests,
	isServerInstalled,
	resolveServerBinary,
} from "./server-installation.js";

const tempDirectories: string[] = [];
let previousPath: string | undefined;

function makeTempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(root);
	return root;
}

function writeExecutable(path: string, body = "#!/bin/sh\nexit 0\n"): string {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, body);
	chmodSync(path, 0o755);
	return path;
}

beforeEach(() => {
	previousPath = process.env["PATH"];
	__resetServerBinaryResolutionCacheForTests();
});

afterEach(() => {
	if (previousPath === undefined) delete process.env["PATH"];
	else process.env["PATH"] = previousPath;
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
	__resetServerBinaryResolutionCacheForTests();
});

describe("resolveServerBinary node marker resolution", () => {
	test("#given a package.json marker and a local node bin #when resolving with an empty PATH #then it returns the local absolute path", () => {
		// given
		const root = makeTempRoot("lsp-local-node-");
		writeFileSync(join(root, "package.json"), "{}\n");
		const binaryPath = writeExecutable(join(root, "node_modules", ".bin", "biome"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const resolved = resolveServerBinary(["biome", "lsp-proxy", "--stdio"], root);

		// then
		expect(resolved).toBe(binaryPath);
	});

	test("#given a nested working directory #when resolving #then it walks up to the marker root", () => {
		// given
		const root = makeTempRoot("lsp-local-nested-");
		writeFileSync(join(root, "package.json"), "{}\n");
		const binaryPath = writeExecutable(join(root, "node_modules", ".bin", "biome"));
		const nested = join(root, "packages", "deep", "src");
		mkdirSync(nested, { recursive: true });
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const resolved = resolveServerBinary(["biome", "lsp-proxy", "--stdio"], nested);

		// then
		expect(resolved).toBe(binaryPath);
	});

	test("#given a local bin without any project marker #when resolving #then the unmarked directory is not trusted", () => {
		// given
		const root = makeTempRoot("lsp-local-unmarked-");
		writeExecutable(join(root, "node_modules", ".bin", "biome"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const resolved = resolveServerBinary(["biome", "lsp-proxy", "--stdio"], root);

		// then
		expect(resolved).toBeNull();
	});

	test("#given a bun.lock marker #when resolving #then the node bin directory is probed", () => {
		// given
		const root = makeTempRoot("lsp-local-bunlock-");
		writeFileSync(join(root, "bun.lock"), "");
		const binaryPath = writeExecutable(join(root, "node_modules", ".bin", "biome"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["biome"], root)).toBe(binaryPath);
	});
});

describe("resolveServerBinary non-node ecosystems", () => {
	test("#given a pyproject marker and a venv binary #when resolving #then it returns the venv path", () => {
		// given
		const root = makeTempRoot("lsp-local-python-");
		writeFileSync(join(root, "pyproject.toml"), "[project]\n");
		const binaryPath = writeExecutable(join(root, ".venv", "bin", "ruff"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["ruff", "server"], root)).toBe(binaryPath);
	});

	test("#given a Gemfile marker and a bundled binary #when resolving #then it returns the vendored bundle path", () => {
		// given
		const root = makeTempRoot("lsp-local-ruby-");
		writeFileSync(join(root, "Gemfile"), "source 'https://rubygems.org'\n");
		const binaryPath = writeExecutable(join(root, "vendor", "bundle", "bin", "rubocop"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["rubocop", "--lsp"], root)).toBe(binaryPath);
	});

	test("#given a go.mod marker and a project bin #when resolving #then it returns the project bin path", () => {
		// given
		const root = makeTempRoot("lsp-local-go-");
		writeFileSync(join(root, "go.mod"), "module example.com/demo\n");
		const binaryPath = writeExecutable(join(root, "bin", "gopls"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["gopls"], root)).toBe(binaryPath);
	});

	test("#given a python marker without a matching venv binary #when resolving #then node bin dirs are not borrowed", () => {
		// given
		const root = makeTempRoot("lsp-local-python-miss-");
		writeFileSync(join(root, "requirements.txt"), "ruff\n");
		writeExecutable(join(root, "node_modules", ".bin", "ruff"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["ruff", "server"], root)).toBeNull();
	});
});

describe("resolveServerBinary probe ordering", () => {
	test("#given a local binary and a PATH binary #when resolving #then the local binary wins", () => {
		// given
		const root = makeTempRoot("lsp-local-priority-");
		writeFileSync(join(root, "package.json"), "{}\n");
		const localBinary = writeExecutable(join(root, "node_modules", ".bin", "biome"));
		const pathDir = makeTempRoot("lsp-path-priority-");
		writeExecutable(join(pathDir, "biome"));
		process.env["PATH"] = pathDir;

		// when / then
		expect(resolveServerBinary(["biome"], root)).toBe(localBinary);
	});

	test("#given only a PATH binary #when resolving #then the PATH entry is returned", () => {
		// given
		const root = makeTempRoot("lsp-path-fallback-root-");
		writeFileSync(join(root, "package.json"), "{}\n");
		const pathDir = makeTempRoot("lsp-path-fallback-");
		const pathBinary = writeExecutable(join(pathDir, "biome"));
		process.env["PATH"] = pathDir;

		// when / then
		expect(resolveServerBinary(["biome"], root)).toBe(pathBinary);
	});

	test("#given a path-shaped command #when resolving #then the command path itself is validated", () => {
		// given
		const root = makeTempRoot("lsp-explicit-path-");
		const binaryPath = writeExecutable(join(root, "tools", "custom-ls"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(resolveServerBinary([binaryPath, "--stdio"], root)).toBe(binaryPath);
		expect(resolveServerBinary([join(root, "tools", "absent-ls")], root)).toBeNull();
	});

	test("#given no working directory #when resolving #then it falls back to PATH only", () => {
		// given
		const pathDir = makeTempRoot("lsp-no-cwd-");
		const pathBinary = writeExecutable(join(pathDir, "biome"));
		process.env["PATH"] = pathDir;

		// when / then
		expect(resolveServerBinary(["biome"])).toBe(pathBinary);
	});

	test("#given nothing anywhere #when resolving #then it returns null", () => {
		// given
		const root = makeTempRoot("lsp-unresolved-");
		writeFileSync(join(root, "package.json"), "{}\n");
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["biome"], root)).toBeNull();
		expect(resolveServerBinary([], root)).toBeNull();
	});
});

describe("resolveServerBinary containment", () => {
	test("#given a marker only above the working directory root #when resolving with a stop boundary #then it does not escape the boundary", () => {
		// given
		const outer = makeTempRoot("lsp-boundary-outer-");
		writeFileSync(join(outer, "package.json"), "{}\n");
		writeExecutable(join(outer, "node_modules", ".bin", "biome"));
		const inner = join(outer, "inner");
		mkdirSync(inner, { recursive: true });
		process.env["PATH"] = join(outer, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["biome"], inner, { stopAt: inner })).toBeNull();
		expect(resolveServerBinary(["biome"], inner)).toBe(join(outer, "node_modules", ".bin", "biome"));
	});

	test("#given a git repository boundary #when resolving #then the walk stops at the repository root", () => {
		// given
		const outer = makeTempRoot("lsp-git-boundary-");
		writeFileSync(join(outer, "package.json"), "{}\n");
		writeExecutable(join(outer, "node_modules", ".bin", "biome"));
		const repo = join(outer, "repo");
		mkdirSync(join(repo, ".git"), { recursive: true });
		process.env["PATH"] = join(outer, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["biome"], repo)).toBeNull();
	});
});

describe("resolveServerBinary windows suffix probing", () => {
	test("#given a windows platform and a .cmd shim #when resolving locally #then the suffixed binary is found", () => {
		// given
		const root = makeTempRoot("lsp-win-local-");
		writeFileSync(join(root, "package.json"), "{}\n");
		const binaryPath = writeExecutable(join(root, "node_modules", ".bin", "biome.cmd"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const resolved = resolveServerBinary(["biome"], root, { platform: "win32", pathExt: ".COM;.EXE;.CMD" });

		// then
		expect(resolved).toBe(binaryPath);
	});

	test("#given a windows platform and a PATH .exe #when resolving #then the suffixed PATH entry is found", () => {
		// given
		const pathDir = makeTempRoot("lsp-win-path-");
		const binaryPath = writeExecutable(join(pathDir, "biome.exe"));
		process.env["PATH"] = pathDir;

		// when / then
		expect(resolveServerBinary(["biome"], undefined, { platform: "win32", pathExt: ".COM;.EXE" })).toBe(binaryPath);
	});
});

describe("resolveServerBinary caching", () => {
	test("#given a repeated lookup #when resolving twice #then the filesystem is probed only once", () => {
		// given
		const root = makeTempRoot("lsp-cache-hit-");
		writeFileSync(join(root, "package.json"), "{}\n");
		const binaryPath = writeExecutable(join(root, "node_modules", ".bin", "biome"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const first = resolveServerBinary(["biome"], root);
		const probesAfterFirst = __serverBinaryProbeCountForTests();
		const second = resolveServerBinary(["biome"], root);
		const probesAfterSecond = __serverBinaryProbeCountForTests();

		// then
		expect(first).toBe(binaryPath);
		expect(second).toBe(binaryPath);
		expect(probesAfterFirst).toBeGreaterThan(0);
		expect(probesAfterSecond).toBe(probesAfterFirst);
	});

	test("#given a cached negative lookup #when resolving twice #then the miss is also cached", () => {
		// given
		const root = makeTempRoot("lsp-cache-miss-");
		writeFileSync(join(root, "package.json"), "{}\n");
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		expect(resolveServerBinary(["biome"], root)).toBeNull();
		const probesAfterFirst = __serverBinaryProbeCountForTests();
		expect(resolveServerBinary(["biome"], root)).toBeNull();

		// then
		expect(__serverBinaryProbeCountForTests()).toBe(probesAfterFirst);
	});

	test("#given distinct working directories #when resolving the same command #then the cache keys stay separate", () => {
		// given
		const first = makeTempRoot("lsp-cache-key-a-");
		writeFileSync(join(first, "package.json"), "{}\n");
		const firstBinary = writeExecutable(join(first, "node_modules", ".bin", "biome"));
		const second = makeTempRoot("lsp-cache-key-b-");
		writeFileSync(join(second, "package.json"), "{}\n");
		process.env["PATH"] = join(first, "definitely-empty");

		// when / then
		expect(resolveServerBinary(["biome"], first)).toBe(firstBinary);
		expect(resolveServerBinary(["biome"], second)).toBeNull();
	});
});

describe("isServerInstalled compatibility", () => {
	test("#given a repo-local binary #when checking installation #then it reports installed", () => {
		// given
		const root = makeTempRoot("lsp-compat-local-");
		writeFileSync(join(root, "package.json"), "{}\n");
		writeExecutable(join(root, "node_modules", ".bin", "biome"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(isServerInstalled(["biome", "lsp-proxy"], root)).toBe(true);
	});

	test("#given a PATH binary and no working directory #when checking installation #then it reports installed", () => {
		// given
		const pathDir = makeTempRoot("lsp-compat-path-");
		writeExecutable(join(pathDir, "typescript-language-server"));
		process.env["PATH"] = pathDir;

		// when / then
		expect(isServerInstalled(["typescript-language-server", "--stdio"])).toBe(true);
	});

	test("#given no binary at all #when checking installation #then it reports not installed", () => {
		// given
		const root = makeTempRoot("lsp-compat-missing-");
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(isServerInstalled(["totally-absent-language-server"], root)).toBe(false);
		expect(isServerInstalled([])).toBe(false);
	});

	test("#given the node command #when checking installation #then the existing node allowance is preserved", () => {
		// given
		const root = makeTempRoot("lsp-compat-node-");
		process.env["PATH"] = join(root, "definitely-empty");

		// when / then
		expect(isServerInstalled(["node", "server.js"], root)).toBe(true);
	});
});

describe("resolveServerBinary node fallback", () => {
	test("#given a node command missing from PATH #when resolving #then the name is kept so the server stays selectable", () => {
		// given: a user-configured server such as { command: ["node", "my-ls.js"] } must keep
		// working, matching the node allowance isServerInstalled() has always had.
		const root = makeTempRoot("lsp-node-fallback-");
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const resolved = resolveServerBinary(["node", "server.js"], root);

		// then: unresolved rather than rewritten, so the spawn still goes through node
		expect(resolved).toBe("node");
		expect(isServerInstalled(["node", "server.js"], root)).toBe(true);
	});

	test("#given a node command present on PATH #when resolving #then the PATH entry still wins", () => {
		// given
		const pathDir = makeTempRoot("lsp-node-on-path-");
		const pathBinary = writeExecutable(join(pathDir, "node"));
		process.env["PATH"] = pathDir;

		// when / then
		expect(resolveServerBinary(["node", "server.js"])).toBe(pathBinary);
	});
});
