import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runWithRequestContext } from "../request-context.js";
import { checkLspComponents, isLspLanguageProblem, type LspLanguageReport } from "./component-check.js";
import { __resetServerBinaryResolutionCacheForTests } from "./server-installation.js";
import type { LspProbeResult } from "./server-probe.js";

const PROBE_SERVER = join(import.meta.dir, "fixtures", "probe-server.mjs");
const tempDirectories: string[] = [];
let previousPath: string | undefined;

function makeTempRoot(prefix: string): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	tempDirectories.push(root);
	return root;
}

function writeFile(path: string, content = ""): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content);
}

function writeExecutable(path: string, script: string): void {
	writeFile(path, script);
	chmodSync(path, 0o755);
}

/** A project with its own git root, an empty PATH except `bin/`, and a user LSP config. */
function makeProject(userLsp: Record<string, unknown> = {}): { root: string; bin: string; userConfig: string } {
	const root = makeTempRoot("omo-lsp-components-");
	mkdirSync(join(root, ".git"));
	const bin = join(root, "..", `${root.split("/").pop()}-bin`);
	mkdirSync(bin, { recursive: true });
	tempDirectories.push(bin);
	const userConfig = join(root, "..", `${root.split("/").pop()}-home`, "lsp.json");
	writeFile(userConfig, JSON.stringify({ lsp: userLsp }));
	tempDirectories.push(join(userConfig, ".."));
	process.env["PATH"] = bin;
	return { root, bin, userConfig };
}

function run(
	project: { root: string; userConfig: string },
	options: Parameters<typeof checkLspComponents>[0] = {},
): ReturnType<typeof checkLspComponents> {
	return runWithRequestContext(
		{
			cwd: project.root,
			projectConfigPaths: [join(project.root, ".omo", "lsp.json")],
			userConfigPath: project.userConfig,
			installDecisionsPath: join(project.userConfig, "..", "decisions.json"),
			capabilities: { installDecisionTool: true },
		},
		() => checkLspComponents(options),
	);
}

function byLanguage(languages: readonly LspLanguageReport[], language: string): LspLanguageReport {
	const report = languages.find((entry) => entry.language === language);
	if (report === undefined) throw new Error(`no report for ${language}`);
	return report;
}

const okProbe = async (): Promise<LspProbeResult> => ({ status: "ok", durationMs: 1, symbols: 1, diagnostics: 0 });

beforeEach(() => {
	previousPath = process.env["PATH"];
	__resetServerBinaryResolutionCacheForTests();
});

afterEach(() => {
	if (previousPath === undefined) delete process.env["PATH"];
	else process.env["PATH"] = previousPath;
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("checkLspComponents", () => {
	test("#given a used language whose server is not installed #when checked #then reports missing with install remediation", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "deploy.sh"), "echo hi\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		const shell = byLanguage(report.languages, "shellscript");
		expect(shell.status).toBe("missing");
		expect(shell.serverId).toBe("bash");
		expect(shell.remediation.join("\n")).toContain("bash-language-server");
		expect(isLspLanguageProblem(shell)).toBe(true);
	});

	test("#given only deno installed and no deno.json #when checked #then the built-in deno is not selected and typescript is missing", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "index.ts"), "export const a = 1\n");
		writeExecutable(join(project.bin, "deno"), "#!/bin/sh\nexit 0\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		const typescript = byLanguage(report.languages, "typescript");
		expect(typescript.status).toBe("missing");
		expect(typescript.serverId).toBe("typescript");
	});

	test("#given a user-configured deno and no deno.json #when checked #then reports wrong routing", async () => {
		// given
		const project = makeProject({ deno: { command: ["deno", "lsp"], extensions: [".ts"] } });
		writeFile(join(project.root, "index.ts"), "export const a = 1\n");
		writeExecutable(join(project.bin, "deno"), "#!/bin/sh\nexit 0\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		const typescript = byLanguage(report.languages, "typescript");
		expect(typescript.status).toBe("wrong_routing");
		expect(typescript.serverId).toBe("deno");
		expect(typescript.detail).toContain("'typescript' also handles .ts");
	});

	test("#given deno with a deno.json project #when checked #then deno is accepted", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "deno.json"), "{}");
		writeFile(join(project.root, "main.ts"), "export const a = 1\n");
		writeExecutable(join(project.bin, "deno"), "#!/bin/sh\nexit 0\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		expect(byLanguage(report.languages, "typescript").status).toBe("ok");
	});

	test("#given a required language the project does not use #when its server is missing #then it is a required problem", async () => {
		// given
		const project = makeProject();

		// when
		const report = await run(project, { requiredLanguages: ["yml"], probeServer: okProbe });

		// then
		const yaml = byLanguage(report.languages, "yaml");
		expect(yaml.required).toBe(true);
		expect(yaml.projectFiles).toBe(0);
		expect(yaml.status).toBe("missing");
		expect(isLspLanguageProblem(yaml)).toBe(true);
	});

	test("#given an unused optional language #when nothing handles it #then it is reported but not a problem", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "settings.ini"), "a=1\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		const ini = byLanguage(report.languages, "ini");
		expect(ini.status).toBe("unconfigured");
		expect(isLspLanguageProblem(ini)).toBe(false);
	});

	test("#given vscode-json-language-server and biome both installed #when checking json #then the schema-aware json server is selected", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "package.json"), "{}\n");
		writeExecutable(join(project.bin, "vscode-json-language-server"), "#!/bin/sh\nexit 0\n");
		writeExecutable(join(project.bin, "biome"), "#!/bin/sh\nexit 0\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		expect(byLanguage(report.languages, "json").serverId).toBe("json");
	});

	test("#given only eslint handles .ts and it fails the probe #when checked #then reports typescript missing, not eslint broken", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "index.ts"), "export const a = 1\n");
		writeExecutable(join(project.bin, "vscode-eslint-language-server"), "#!/bin/sh\nexit 0\n");
		const failingProbe = async (): Promise<LspProbeResult> => ({ status: "request_failed", stage: "request", durationMs: 1, detail: "no symbols" });

		// when
		const report = await run(project, { probeServer: failingProbe });

		// then
		const typescript = byLanguage(report.languages, "typescript");
		expect(typescript.status).toBe("missing");
		expect(typescript.serverId).toBe("typescript");
		expect(typescript.detail).toContain("'eslint' was selected instead");
		expect(typescript.remediation.join("\n")).toContain("typescript-language-server");
	});

	test("#given only eslint handles .ts and it answers the probe #when checked #then the fallback is accepted", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "index.ts"), "export const a = 1\n");
		writeExecutable(join(project.bin, "vscode-eslint-language-server"), "#!/bin/sh\nexit 0\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		expect(byLanguage(report.languages, "typescript")).toMatchObject({ status: "ok", serverId: "eslint" });
	});

	test("#given a markdown file and no marksman #when checked #then reports marksman missing", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "README.md"), "# hi\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		const markdown = byLanguage(report.languages, "markdown");
		expect(markdown.status).toBe("missing");
		expect(markdown.serverId).toBe("marksman");
	});

	test("#given a configured server that works #when probed for real #then reports ok", async () => {
		// given
		const project = makeProject({
			"probe-ls": { command: [process.execPath, PROBE_SERVER, "ok"], extensions: [".yaml", ".yml"] },
		});
		writeFile(join(project.root, "ci.yml"), "a: 1\n");

		// when
		const report = await run(project);

		// then
		const yaml = byLanguage(report.languages, "yaml");
		expect(yaml.status).toBe("ok");
		expect(yaml.serverId).toBe("probe-ls");
		expect(yaml.probe?.status).toBe("ok");
	});

	test("#given a configured server that crashes #when probed for real #then reports startup_failed", async () => {
		// given
		const project = makeProject({
			"probe-ls": { command: [process.execPath, PROBE_SERVER, "exit"], extensions: [".yaml"] },
		});

		// when
		const report = await run(project, { requiredLanguages: ["yaml"] });

		// then
		expect(byLanguage(report.languages, "yaml").status).toBe("startup_failed");
	});

	test("#given a nested repository #when scanning #then its files are not counted", async () => {
		// given
		const project = makeProject();
		writeFile(join(project.root, "nested", ".git", "HEAD"), "ref: refs/heads/main\n");
		writeFile(join(project.root, "nested", "script.py"), "x = 1\n");

		// when
		const report = await run(project, { probeServer: okProbe });

		// then
		expect(report.languages.find((entry) => entry.language === "python")).toBeUndefined();
	});
});
