import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runWithRequestContext } from "../request-context.js";
import { formatServerLookupError } from "./client-wrapper.js";
import { __resetServerBinaryResolutionCacheForTests } from "./server-installation.js";
import { findServerForExtension } from "./server-resolution.js";

const tempDirectories: string[] = [];
let previousPath: string | undefined;

function makeTempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(root);
	return root;
}

function writeExecutable(path: string): string {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, "#!/bin/sh\nexit 0\n");
	chmodSync(path, 0o755);
	return path;
}

function contextFor(cwd: string) {
	return {
		cwd,
		projectConfigPaths: [join(cwd, ".codex", "lsp-client.json")],
		userConfigPath: join(cwd, "home-config", "lsp-client.json"),
		installDecisionsPath: join(cwd, "home-config", "lsp-install-decisions.json"),
		capabilities: { installDecisionTool: true },
	} as const;
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

describe("findServerForExtension local binary substitution", () => {
	test("#given a repo-local biome #when looking up a typescript file #then the command spawns the absolute local path", () => {
		// given
		const root = makeTempRoot("lsp-resolution-local-");
		writeFileSync(join(root, "package.json"), "{}\n");
		const binaryPath = writeExecutable(join(root, "node_modules", ".bin", "biome"));
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"));

		// then
		expect(result.status).toBe("found");
		if (result.status !== "found") throw new Error("expected a found server");
		expect(result.server.command[0]).toBe(binaryPath);
		expect(result.server.command.slice(1)).toEqual(["lsp-proxy", "--stdio"]);
	});

	test("#given a PATH-only server #when looking up #then the resolved PATH entry is substituted", () => {
		// given
		const root = makeTempRoot("lsp-resolution-path-root-");
		writeFileSync(join(root, "package.json"), "{}\n");
		const pathDir = makeTempRoot("lsp-resolution-path-");
		const pathBinary = writeExecutable(join(pathDir, "biome"));
		process.env["PATH"] = pathDir;

		// when
		const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"));

		// then
		expect(result.status).toBe("found");
		if (result.status !== "found") throw new Error("expected a found server");
		expect(result.server.command[0]).toBe(pathBinary);
	});

	test("#given no server anywhere #when looking up #then the not_installed result is preserved", () => {
		// given
		const root = makeTempRoot("lsp-resolution-missing-");
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"));

		// then
		expect(result.status).toBe("not_installed");
		if (result.status !== "not_installed") throw new Error("expected not_installed");
		expect(result.installHint.length).toBeGreaterThan(0);
	});

	test("#given an unknown extension #when looking up #then the not_configured result is preserved", () => {
		// given
		const root = makeTempRoot("lsp-resolution-unknown-");
		process.env["PATH"] = join(root, "definitely-empty");

		// when
		const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".unknown-ext"));

		// then
		expect(result.status).toBe("not_configured");
	});
});

describe("not-installed message repo-local guidance", () => {
	test("#given a missing biome #when formatting the message #then the repo-local install is suggested before the global hint", () => {
		// given: .css is served by biome alone, so the lookup cannot fall through to typescript
		const root = makeTempRoot("lsp-message-biome-");
		process.env["PATH"] = join(root, "definitely-empty");
		const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".css"));
		if (result.status !== "not_installed") throw new Error("expected not_installed");
		expect(result.server.id).toBe("biome");

		// when
		const message = runWithRequestContext(contextFor(root), () => formatServerLookupError(result));

		// then
		expect(message).toContain("bun add -d @biomejs/biome");
		expect(message).toContain("npm install -g @biomejs/biome");
		expect(message.indexOf("bun add -d @biomejs/biome")).toBeLessThan(message.indexOf("npm install -g @biomejs/biome"));
		expect(message).toContain("ACTION REQUIRED");
		expect(message).toContain("NOT INSTALLED");
	});

	test("#given a server with no repo-local route #when formatting the message #then only the global hint is shown", () => {
		// given
		const root = makeTempRoot("lsp-message-global-");
		process.env["PATH"] = join(root, "definitely-empty");
		const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".rs"));
		if (result.status !== "not_installed") throw new Error("expected not_installed");

		// when
		const message = runWithRequestContext(contextFor(root), () => formatServerLookupError(result));

		// then
		expect(message).toContain("To install, run:");
		expect(message).not.toContain("THIS repository");
		expect(message).toContain("ACTION REQUIRED");
	});

	test("#given a pre-authorized install #when formatting the message #then both install routes stay visible", () => {
		// given
		const root = makeTempRoot("lsp-message-allowed-");
		process.env["PATH"] = join(root, "definitely-empty");
		const context = contextFor(root);
		mkdirSync(join(root, "home-config"), { recursive: true });
		writeFileSync(
			context.installDecisionsPath,
			`${JSON.stringify({ biome: { decision: "allowed", decidedAt: new Date().toISOString() } })}\n`,
		);
		const result = runWithRequestContext(context, () => findServerForExtension(".css"));
		if (result.status !== "not_installed") throw new Error("expected not_installed");

		// when
		const message = runWithRequestContext(context, () => formatServerLookupError(result));

		// then
		expect(message).toContain("pre-authorized");
		expect(message).toContain("bun add -d @biomejs/biome");
		expect(message).toContain("npm install -g @biomejs/biome");
	});
});
