#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const evidenceDir = parseEvidenceDir(process.argv.slice(2));
const workRoot = mkdtempSync(join(tmpdir(), "lsp-daemon-client-package-"));
const outputPath = evidenceDir ? join(evidenceDir, "package-smoke.json") : "";
const commandLog = [];

function parseEvidenceDir(args) {
	const index = args.indexOf("--evidence-dir");
	if (index === -1) return "";
	const value = args[index + 1];
	if (!value || !value.startsWith("/")) throw new Error("--evidence-dir must be absolute");
	mkdirSync(value, { recursive: true });
	return value;
}

function run(command, args, options = {}) {
	commandLog.push({ command, args, cwd: options.cwd ?? packageRoot });
	return execFileSync(command, args, {
		cwd: options.cwd ?? packageRoot,
		encoding: "utf8",
		env: { ...process.env, NODE_PATH: "", ...(options.env ?? {}) },
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function runStatus(command, args, options = {}) {
	commandLog.push({ command, args, cwd: options.cwd ?? packageRoot });
	return spawnSync(command, args, {
		cwd: options.cwd ?? packageRoot,
		encoding: "utf8",
		env: { ...process.env, NODE_PATH: "", ...(options.env ?? {}) },
	});
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeConsumerScript(path) {
	writeFileSync(
		path,
		`
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	OMO_LSP_DAEMON_CLI,
	OMO_LSP_DAEMON_DIR,
	OMO_LSP_DAEMON_VERSION,
	callToolViaDaemon,
	currentRequestContext,
	resolveDaemonRuntime,
	validateDaemonVersion,
} from "@code-yeongyu/lsp-daemon/client";

const [output, projectRaw, homeRaw, omoRoot, version] = process.argv.slice(2);
mkdirSync(projectRaw, { recursive: true });
mkdirSync(homeRaw, { recursive: true });
const projectDir = realpathSync(projectRaw);
const homeDir = realpathSync(homeRaw);
const cliResolved = await import.meta.resolve("@code-yeongyu/lsp-daemon/cli");
const cliPath = fileURLToPath(cliResolved);
const context = currentRequestContext({ HOME: homeDir });
const runtime = resolveDaemonRuntime({
	[OMO_LSP_DAEMON_CLI]: cliPath,
	[OMO_LSP_DAEMON_VERSION]: version,
}, { cliPath, version });
process.env[OMO_LSP_DAEMON_DIR] = omoRoot;
process.env[OMO_LSP_DAEMON_CLI] = cliPath;
process.env[OMO_LSP_DAEMON_VERSION] = version;
process.chdir(projectDir);
const baseline = await callToolViaDaemon("status", {}, { context: currentRequestContext({ HOME: homeDir }), requestTimeoutMs: 10000 });
const baselineText = baseline.content.map((block) => block.text).join("\\n");
const firstServer = /^- (\\S+): /m.exec(baselineText)?.[1] ?? null;
if (!firstServer) throw new Error("status output did not list a builtin server");
const projectConfigPath = join(projectDir, ".codex", "lsp-client.json");
mkdirSync(join(projectDir, ".codex"), { recursive: true });
writeFileSync(projectConfigPath, JSON.stringify({ lsp: { [firstServer]: { disabled: true } } }));
const scopedContext = {
	cwd: projectDir,
	projectConfigPaths: [projectConfigPath],
	userConfigPath: join(homeDir, ".codex", "lsp-client.json"),
	installDecisionsPath: join(homeDir, ".codex", "lsp-install-decisions.json"),
	capabilities: { installDecisionTool: true },
};
const scoped = await callToolViaDaemon("status", {}, { context: scopedContext, requestTimeoutMs: 10000 });
const scopedText = scoped.content.map((block) => block.text).join("\\n");
const aborted = await callToolViaDaemon("status", {}, {
	context: scopedContext,
	requestTimeoutMs: 10000,
	signal: AbortSignal.abort("client-package-smoke"),
});
const clientModule = await import("@code-yeongyu/lsp-daemon/client");
async function rejected(specifier) {
	try {
		await import(specifier);
		return { rejected: false };
	} catch (error) {
		return { rejected: true, code: error?.code ?? null, message: String(error?.message ?? error) };
	}
}
const rootImport = await rejected("@code-yeongyu/lsp-daemon");
const unknownImport = await rejected("@code-yeongyu/lsp-daemon/unknown");
const deepImport = await rejected("@code-yeongyu/lsp-daemon/dist/cli.js");
const serverSymbols = [
	"runMcpStdioProxy",
	"startDaemonServer",
	"ensureDaemonRunning",
	"probeDaemon",
	"daemonPaths",
	"disposeDefaultLspManager",
].filter((name) => Object.prototype.hasOwnProperty.call(clientModule, name));
writeFileSync(output, JSON.stringify({
	result: "PASS",
	envConstants: [OMO_LSP_DAEMON_CLI, OMO_LSP_DAEMON_DIR, OMO_LSP_DAEMON_VERSION].sort(),
	runtime,
	versionValidated: validateDaemonVersion(version),
	defaultContext: context,
	scopedContext,
	statusOk: baseline.isError !== true,
	typedContextForwarded: scopedText.includes("- " + firstServer + ": disabled"),
	cancellation: { accepted: aborted.isError === true, text: aborted.content.map((block) => block.text).join("\\n") },
	cliResolved,
	rootImport,
	unknownImport,
	deepImport,
	serverSymbols,
	publicKeys: Object.keys(clientModule).sort(),
}, null, 2) + "\\n");
`,
	);
}

function writeConsumerTypes(path) {
	writeFileSync(
		path,
		`
import {
	type CallToolOptions,
	type LspDiagnosticsDetails,
	type LspRequestContext,
	type ToolExecutionResult,
	callDiagnosticsViaDaemon,
	callToolViaDaemon,
	currentRequestContext,
} from "@code-yeongyu/lsp-daemon/client";

const context: LspRequestContext = {
	cwd: "/tmp/lsp-client-package",
	projectConfigPaths: ["/tmp/lsp-client-package/.codex/lsp-client.json"],
	userConfigPath: "/tmp/lsp-client-package/user-lsp.json",
	installDecisionsPath: "/tmp/lsp-client-package/install-decisions.json",
	capabilities: { installDecisionTool: true },
};
const options: CallToolOptions = { context, signal: new AbortController().signal, requestTimeoutMs: 1 };
const statusPromise: Promise<ToolExecutionResult> = callToolViaDaemon("status", {}, options);
const diagnosticsPromise: Promise<ToolExecutionResult> = callDiagnosticsViaDaemon("file.ts", options);
const inferredContext = currentRequestContext({ HOME: "/tmp/lsp-client-package" });
const details: LspDiagnosticsDetails = {
	filePath: "file.ts",
	severity: "error",
	mode: "file",
	diagnostics: [],
	totalDiagnostics: 0,
	truncated: false,
};
const pair = [statusPromise, diagnosticsPromise];
console.log(pair.length, inferredContext.capabilities.installDecisionTool, details.totalDiagnostics);
`,
	);
}

function killDaemon(omoRoot, version) {
	const pidPath = join(omoRoot, `v${version}`, "daemon.pid");
	if (!existsSync(pidPath)) return { pidFile: false, killed: false };
	const raw = readFileSync(pidPath, "utf8").trim();
	const pid = Number(raw);
	if (!Number.isInteger(pid) || pid <= 0) return { pidFile: true, killed: false, reason: "invalid_pid" };
	try {
		process.kill(pid, "SIGTERM");
		return { pidFile: true, killed: true, pid };
	} catch (error) {
		return { pidFile: true, killed: false, reason: error?.code ?? String(error) };
	}
}

function assertPackageContract(result) {
	const checks = [
		result.build.requiredOutputs.clientJs,
		result.build.requiredOutputs.clientDts,
		result.build.requiredOutputs.cliJs,
		result.build.requiredOutputs.indexJs,
		result.build.staleDistRemoved,
		result.packageJson.hasOnlyClientAndCliExports,
		result.scans.clientJsNoWorkspaceDeps,
		result.scans.clientDtsNoWorkspaceDeps,
		result.scans.noRepositoryPathCoupling,
		result.consumer.js.statusOk,
		result.consumer.js.typedContextForwarded,
		result.consumer.js.cancellation.accepted,
		result.consumer.js.rootImport.rejected,
		result.consumer.js.unknownImport.rejected,
		result.consumer.js.deepImport.rejected,
		result.consumer.js.serverSymbols.length === 0,
		result.consumer.tscExitCode === 0,
		result.consumer.emptyNodePath,
	];
	if (!checks.every(Boolean)) {
		throw new Error(`client package smoke refused PASS: ${JSON.stringify(result, null, 2)}`);
	}
}

let finalResult;
try {
	const staleFile = join(packageRoot, "dist", "todo2-stale-file.js");
	mkdirSync(dirname(staleFile), { recursive: true });
	writeFileSync(staleFile, "stale\\n");
	run("npm", ["run", "build", "--silent"]);

	const dist = join(packageRoot, "dist");
	const clientJs = readFileSync(join(dist, "client.js"), "utf8");
	const clientDts = readFileSync(join(dist, "client.d.ts"), "utf8");
	const packageJson = readJson(join(packageRoot, "package.json"));
	const distPackageJson = readJson(join(dist, "package.json"));
	const tarballName = run("npm", ["pack", "--pack-destination", workRoot]).trim().split("\\n").at(-1);
	const tarball = join(workRoot, tarballName);
	const consumerRoot = join(workRoot, "consumer");
	mkdirSync(consumerRoot, { recursive: true });
	run("npm", ["init", "-y"], { cwd: consumerRoot });
	const consumerPackageJsonPath = join(consumerRoot, "package.json");
	const consumerPackageJson = readJson(consumerPackageJsonPath);
	writeFileSync(consumerPackageJsonPath, `${JSON.stringify({ ...consumerPackageJson, type: "module" }, null, 2)}\n`);
	run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: consumerRoot });

	const consumerScript = join(consumerRoot, "consumer.mjs");
	const consumerTypes = join(consumerRoot, "consumer.ts");
	const consumerOutput = join(consumerRoot, "consumer-result.json");
	const projectDir = join(workRoot, "project");
	const homeDir = join(workRoot, "home");
	const omoRoot = join(workRoot, "omo-lsp-daemon");
	writeConsumerScript(consumerScript);
	writeConsumerTypes(consumerTypes);
	const consumerRun = runStatus(process.execPath, [
		consumerScript,
		consumerOutput,
		projectDir,
		homeDir,
		omoRoot,
		distPackageJson.version,
	], { cwd: consumerRoot });
	const consumerResult = existsSync(consumerOutput) ? readJson(consumerOutput) : { result: "MISSING" };
	const tscBin = join(packageRoot, "node_modules", "typescript", "bin", "tsc");
	const tscRun = runStatus(process.execPath, [
		tscBin,
		"--noEmit",
		"--strict",
		"--target",
		"ES2022",
		"--module",
		"Node16",
		"--moduleResolution",
		"Node16",
		"--lib",
		"ES2022,DOM",
		consumerTypes,
	], { cwd: consumerRoot });
	const cleanup = killDaemon(omoRoot, distPackageJson.version);
	finalResult = {
		result: "PASS",
		workRoot,
		packageRoot,
		build: {
			requiredOutputs: {
				clientJs: existsSync(join(dist, "client.js")),
				clientDts: existsSync(join(dist, "client.d.ts")),
				cliJs: existsSync(join(dist, "cli.js")),
				cliDts: existsSync(join(dist, "cli.d.ts")),
				indexJs: existsSync(join(dist, "index.js")),
				indexDts: existsSync(join(dist, "index.d.ts")),
				stampedPackage: existsSync(join(dist, "package.json")),
			},
			staleDistRemoved: !existsSync(staleFile),
		},
		packageJson: {
			exports: packageJson.exports,
			hasOnlyClientAndCliExports:
				packageJson.main === undefined &&
				packageJson.types === undefined &&
				JSON.stringify(Object.keys(packageJson.exports ?? {}).sort()) === JSON.stringify(["./cli", "./client"]),
			distPackageJson,
		},
		scans: {
			clientJsNoWorkspaceDeps: !clientJs.includes("@oh-my-opencode/"),
			clientDtsNoWorkspaceDeps: !clientDts.includes("@oh-my-opencode/"),
			noRepositoryPathCoupling: !clientJs.includes(repoRoot) && !clientDts.includes(repoRoot),
			clientDtsHasNoPackageRootImport: !clientDts.includes("@code-yeongyu/lsp-daemon"),
		},
		pack: { tarball: relative(repoRoot, tarball) },
		consumer: {
			emptyNodePath: true,
			jsExitCode: consumerRun.status,
			jsStdout: consumerRun.stdout.trim(),
			jsStderr: consumerRun.stderr.trim(),
			js: consumerResult,
			tscExitCode: tscRun.status,
			tscStdout: tscRun.stdout.trim(),
			tscStderr: tscRun.stderr.trim(),
		},
		adversarial: {
			rootImportRejected: consumerResult.rootImport?.rejected === true,
			unknownSubpathRejected: consumerResult.unknownImport?.rejected === true,
			deepDistRejected: consumerResult.deepImport?.rejected === true,
			serverSymbolsAbsent: Array.isArray(consumerResult.serverSymbols) && consumerResult.serverSymbols.length === 0,
			malformedExportsPinned: packageJson.exports?.["."] === undefined && packageJson.main === undefined,
			staleDistRemoved: !existsSync(staleFile),
			repositoryHiddenByInstall: consumerRoot.startsWith(repoRoot) === false,
			symlinkPath: "not applicable; npm pack install copies the tarball into a real temp project",
			promptInjection: "not applicable; deterministic package metadata and local JSON are the only inputs",
		},
		cleanup,
		commands: commandLog,
	};
	assertPackageContract(finalResult);
} catch (error) {
	finalResult = {
		result: "FAIL",
		workRoot,
		error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { value: String(error) },
		commands: commandLog,
	};
	process.exitCode = 1;
} finally {
	if (outputPath) writeFileSync(outputPath, `${JSON.stringify(finalResult, null, 2)}\n`);
	process.stdout.write(`${JSON.stringify(finalResult, null, 2)}\n`);
	if (process.env["OMO_KEEP_CLIENT_PACKAGE_SMOKE"] !== "1") rmSync(workRoot, { recursive: true, force: true });
}
