#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	closeSync,
	openSync,
	realpathSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	assert,
	bunBin,
	directProbePath,
	evidenceDir,
	fakeLog,
	hashFile,
	hashTree,
	installLog,
	installer,
	mockLog,
	mockScript,
	readFakeLog,
	repoRoot,
	run,
	runAppServerScenario,
	serveProbePath,
	sourceMetadataRows,
	waitForFakeInvocation,
	waitForMockPort,
	writeDirectProbe,
	writeFakeCodegraph,
	writeServeProbe,
	writeWorkerProbe,
	workerProbePath,
} from "./live-codegraph-support.mjs";

const qaRoot = mkdtempSync(join(tmpdir(), "omo-verify-5836-"));
const isolatedHome = join(qaRoot, "home");
const codexHome = join(qaRoot, "codex");
const localBin = join(codexHome, "bin");
const fakeBin = join(qaRoot, "fake-codegraph.mjs");
const cleanup = [];
let mock = null;
let mockFd = null;

function qaEnv(baseEnv, normalProject) {
	return {
		...baseEnv,
		CODEX_HOME: codexHome,
		CODEX_LOCAL_BIN_DIR: localBin,
		HOME: isolatedHome,
		OMO_CODEX_DISABLE_POSTHOG: "1",
		OMO_DISABLE_POSTHOG: "1",
		OMO_CODEGRAPH_BIN: fakeBin,
		OMO_QA_CODEGRAPH_LOG: fakeLog,
		PATH: `${localBin}:${baseEnv.PATH ?? ""}`,
		QA_FAKE_CODEGRAPH_BIN: fakeBin,
		QA_ISOLATED_HOME: isolatedHome,
		QA_NORMAL_CWD: normalProject,
		XDG_CACHE_HOME: join(qaRoot, "xdg-cache"),
		XDG_CONFIG_HOME: join(qaRoot, "xdg-config"),
		XDG_DATA_HOME: join(qaRoot, "xdg-data"),
		XDG_STATE_HOME: join(qaRoot, "xdg-state"),
	};
}

function seedGcStores(projectsDir, liveSource) {
	const deadStore = join(projectsDir, "dead-store");
	const liveStore = join(projectsDir, "live-store");
	mkdirSync(deadStore, { recursive: true });
	mkdirSync(liveStore, { recursive: true });
	writeFileSync(join(deadStore, "source.json"), `${JSON.stringify({ sourceDir: join(qaRoot, "missing-source"), version: 1 }, null, 2)}\n`);
	writeFileSync(join(liveStore, "source.json"), `${JSON.stringify({ sourceDir: liveSource, version: 1 }, null, 2)}\n`);
	writeFileSync(join(deadStore, "payload.txt"), "dead\n");
	writeFileSync(join(liveStore, "payload.txt"), "live\n");
	return { deadStore, liveStore };
}

function runDirectSkipProbe(realHome, env, cwd, outputName) {
	run(bunBin(realHome), [directProbePath], {
		env: { ...env, QA_TARGET_CWD: cwd },
		outputPath: join(evidenceDir, outputName),
	});
}

function cleanupPaths(paths) {
	for (const path of paths) rmSync(path, { recursive: true, force: true });
}

try {
	const realHome = process.env.HOME ?? homedir();
	const before = {
		realCodexConfig: hashFile(join(realHome, ".codex", "config.toml")),
		realOmoTree: hashTree(join(realHome, ".omo")),
	};
	writeFileSync(join(evidenceDir, "real-home-before.json"), `${JSON.stringify(before, null, 2)}\n`);
	writeFileSync(fakeLog, "");
	mkdirSync(isolatedHome, { recursive: true });
	mkdirSync(codexHome, { recursive: true });
	mkdirSync(localBin, { recursive: true });
	writeFakeCodegraph(fakeBin);
	writeDirectProbe();
	writeServeProbe();
	writeWorkerProbe();

	const tmpExcluded = mkdtempSync("/tmp/omo-codegraph-excluded-");
	const omoExcludedRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-omo-root-"));
	const omoExcluded = join(omoExcludedRoot, ".omo", "ultraresearch", "run", "clones", "repo");
	const normalProject = mkdtempSync(join(repoRoot, ".qa-normal-codegraph-"));
	const liveSource = mkdtempSync(join(tmpdir(), "omo-codegraph-live-source-"));
	mkdirSync(omoExcluded, { recursive: true });
	cleanup.push(tmpExcluded, omoExcludedRoot, normalProject, liveSource);

	const projectsDir = join(isolatedHome, ".omo", "codegraph", "projects");
	const stores = seedGcStores(projectsDir, liveSource);
	const env = qaEnv(process.env, normalProject);
	run(process.execPath, [installer, "install"], { env, outputPath: installLog });

	mockFd = openSync(mockLog, "w");
	mock = spawn(process.execPath, [mockScript], { cwd: repoRoot, env, stdio: ["ignore", mockFd, mockFd] });
	const mockPort = waitForMockPort(mock);

	runDirectSkipProbe(realHome, env, tmpExcluded, "direct-skip-tmp.json");
	runDirectSkipProbe(realHome, env, omoExcluded, "direct-skip-omo.json");
	runAppServerScenario("tmp-excluded", tmpExcluded, mockPort, env);
	assert(readFakeLog().every((row) => row.cwd !== realpathSync(tmpExcluded)), "tmp excluded cwd invoked fake CodeGraph");
	assert(!sourceMetadataRows(projectsDir).some((row) => row.metadata.sourceDir === realpathSync(tmpExcluded)), "tmp excluded cwd created a project store");
	assert(!existsSync(stores.deadStore), "dead store survived SessionStart GC");
	assert(existsSync(stores.liveStore), "live store was deleted by SessionStart GC");

	runAppServerScenario("omo-excluded", omoExcluded, mockPort, env);
	assert(readFakeLog().every((row) => row.cwd !== realpathSync(omoExcluded)), ".omo excluded cwd invoked fake CodeGraph");
	assert(!sourceMetadataRows(projectsDir).some((row) => row.metadata.sourceDir === realpathSync(omoExcluded)), ".omo excluded cwd created a project store");

	runAppServerScenario("normal-included", normalProject, mockPort, env);
	const normalReal = realpathSync(normalProject);
	run(bunBin(realHome), [workerProbePath], { env, outputPath: join(evidenceDir, "worker-normal-included.json") });
	const rows = waitForFakeInvocation((row) => row.cwd === normalReal && row.argv.includes("init"), "normal project init");
	const normalRows = rows.filter((row) => row.cwd === normalReal);
	assert(normalRows.every((row) => row.env.CODEGRAPH_NO_DAEMON === "1"), "worker child missing CODEGRAPH_NO_DAEMON=1");
	const metadataRows = sourceMetadataRows(projectsDir);
	assert(metadataRows.some((row) => row.metadata.sourceDir === normalReal), "normal project source metadata missing");

	run(bunBin(realHome), [serveProbePath], { env, outputPath: join(evidenceDir, "serve-env.json") });
	assert(readFileSync(join(evidenceDir, "serve-env.json"), "utf8").includes('"CODEGRAPH_NO_DAEMON": "1"'), "serve env missing CODEGRAPH_NO_DAEMON=1");

	const liveSummary = {
		exclusionLive: { tmpExcluded, omoExcluded, noFakeCodegraphInvocationsForExcludedRoots: true, noProjectStoresForExcludedRoots: true },
		inclusionControl: { normalProject, fakeInvocationCount: normalRows.length, recordedSourceMetadata: metadataRows.filter((row) => row.metadata.sourceDir === normalReal) },
		noDaemon: { workerRows: normalRows.map((row) => ({ argv: row.argv, cwd: row.cwd, env: row.env })), serveEnvPath: "serve-env.json" },
		gc: { deadStoreRemoved: !existsSync(stores.deadStore), liveStoreSurvived: existsSync(stores.liveStore), liveStore: stores.liveStore },
		isolation: { isolatedHome, codexHome },
	};
	writeFileSync(join(evidenceDir, "live-codegraph-summary.json"), `${JSON.stringify(liveSummary, null, 2)}\n`);

	cleanupPaths(cleanup);
	rmSync(qaRoot, { recursive: true, force: true });
	const after = {
		realCodexConfig: hashFile(join(realHome, ".codex", "config.toml")),
		realOmoTree: hashTree(join(realHome, ".omo")),
	};
	writeFileSync(join(evidenceDir, "real-home-after.json"), `${JSON.stringify(after, null, 2)}\n`);
	assert(before.realCodexConfig === after.realCodexConfig, "real ~/.codex/config.toml changed");
	assert(before.realOmoTree === after.realOmoTree, "real ~/.omo changed");
	writeFileSync(join(evidenceDir, "cleanup-receipt.txt"), `removed qaRoot=${qaRoot}\nremoved workspaces=${cleanup.map((p) => `${basename(p)}:${!existsSync(p)}`).join(",")}\n`);
	console.log(JSON.stringify({ ok: true, summary: liveSummary }, null, 2));
} catch (error) {
	if (mock !== null) mock.kill("SIGTERM");
	if (mockFd !== null) {
		closeSync(mockFd);
		mockFd = null;
	}
	cleanupPaths(cleanup);
	try {
		rmSync(qaRoot, { recursive: true, force: true });
	} catch {}
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exit(1);
} finally {
	if (mock !== null) mock.kill("SIGTERM");
	if (mockFd !== null) closeSync(mockFd);
}
