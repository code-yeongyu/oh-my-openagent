import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext, type LspRequestContext } from "../request-context.js";
import { getMergedServers } from "./config-loader.js";
import { BUILTIN_SERVERS } from "./server-definitions.js";

const LEAN_TYPESCRIPT_INITIALIZATION = {
	tsserver: { useSyntaxServer: "never" },
	disableAutomaticTypingAcquisition: true,
};

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function contextWithConfigs(configs: { project?: unknown; user?: unknown }): LspRequestContext {
	const directory = mkdtempSync(join(tmpdir(), "lsp-ts-defaults-"));
	tempDirectories.push(directory);
	const projectPath = join(directory, "project-lsp.json");
	const userPath = join(directory, "user-lsp.json");
	if (configs.project !== undefined) writeFileSync(projectPath, JSON.stringify(configs.project));
	if (configs.user !== undefined) writeFileSync(userPath, JSON.stringify(configs.user));
	return {
		cwd: directory,
		projectConfigPaths: [projectPath],
		userConfigPath: userPath,
		installDecisionsPath: join(directory, "install-decisions.json"),
		capabilities: { installDecisionTool: false },
	};
}

function mergedTypescript(configs: { project?: unknown; user?: unknown }) {
	const servers = runWithRequestContext(contextWithConfigs(configs), () => getMergedServers());
	return servers.find((server) => server.id === "typescript");
}

describe("TypeScript language server defaults", () => {
	it("#given the builtin definition #then its default config turns off the syntax server and automatic typings", () => {
		expect(BUILTIN_SERVERS["typescript"]?.initialization).toEqual(LEAN_TYPESCRIPT_INITIALIZATION);
	});

	it("#given no config #when merging servers #then the builtin typescript server carries the defaults", () => {
		expect(mergedTypescript({})?.initialization).toEqual(LEAN_TYPESCRIPT_INITIALIZATION);
	});

	it("#given a user entry that only changes priority #then the defaults survive", () => {
		const server = mergedTypescript({ user: { lsp: { typescript: { priority: 5 } } } });
		expect(server?.source).toBe("user");
		expect(server?.initialization).toEqual(LEAN_TYPESCRIPT_INITIALIZATION);
	});

	it("#given a project entry with its own initialization #then its keys win over the defaults", () => {
		const server = mergedTypescript({
			project: { lsp: { typescript: { initialization: { tsserver: { useSyntaxServer: "auto" }, hostInfo: "x" } } } },
		});
		expect(server?.source).toBe("project");
		expect(server?.initialization).toEqual({
			tsserver: { useSyntaxServer: "auto" },
			disableAutomaticTypingAcquisition: true,
			hostInfo: "x",
		});
	});

	it("#given a user entry with only a custom command #then no builtin defaults are injected", () => {
		const server = mergedTypescript({ user: { lsp: { typescript: { command: ["vtsls", "--stdio"] } } } });
		expect(server?.command).toEqual(["vtsls", "--stdio"]);
		expect(server?.initialization).toBeUndefined();
	});

	it("#given a user entry with a custom command #then no builtin defaults are injected", () => {
		const server = mergedTypescript({
			user: { lsp: { typescript: { command: ["custom-ts-ls", "--stdio"], extensions: [".ts"] } } },
		});
		expect(server?.command).toEqual(["custom-ts-ls", "--stdio"]);
		expect(server?.initialization).toBeUndefined();
	});
});
