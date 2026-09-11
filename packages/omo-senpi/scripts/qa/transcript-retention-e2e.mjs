#!/usr/bin/env node
// Live canary for bounded, opt-in Senpi task-transcript retention.
//
// Proves, through the REAL senpi binary in an isolated sandbox:
//  1. selected synthetic tasks (task tool: one retain_transcript: true, one "metadata") complete;
//  2. after their records age past task.ttl_ms, the NEXT session start's TTL sweep archives them
//     and expunges the records and children dirs: the full task as a finder-discoverable metadata
//     manifest + deterministic gzip content sidecar, the protected task as a manifest ONLY;
//  3. the compressed sidecar decompresses to the session-shaped visible transcript (prompt,
//     assistant prose, final response) with a synthetic credential redacted everywhere;
//  4. the EXISTING Senpi session finder (thread address-book disk scan) discovers the manifests;
//  5. no OpenCode/SQLite database exists or is needed anywhere in the flow, and the real agent
//     dir gains no archive artifacts (scoped isolation proof with disclosed changed paths).
//
// Usage: SENPI_BIN=<senpi> node packages/omo-senpi/scripts/qa/transcript-retention-e2e.mjs [--evidence-dir <d>] [--self-test]
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { changedSnapshotPaths, createSandbox, seedSandbox, snapshotDirectory } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../..")
const finderFixture = join(scriptDir, "transcript-retention-finder-fixture.ts")
const ARCHIVE_DIR_NAME = "--omo-senpi-task-archive--"
// Synthetic, obviously-fake credential: exercises the redaction pipeline end to end. Never a
// real secret; the pattern shape is what matters.
const FAKE_SECRET = "sk-ant-api03-qa000000000000000000000000000000000000"
const CHILD_TEXT = `retention child unit complete after touching ${FAKE_SECRET}`
const PROTECTED_CHILD_TEXT = "protected child finished, metadata only"
const FINAL_TEXT = "retained tasks returned inline, done"

const OMO_CONFIG = {
	categories: { mockcat: { description: "Local mock category pinned to the mock provider.", model: "omo-mock/mock-1" } },
	task: {
		ttl_ms: 1000,
		transcript_retention: {
			enabled: true,
			categories: ["mockcat"],
			ttl_ms: 600000,
			max_bytes: 262144,
			success_sample_denominator: 4,
			metadata_only_paths: [],
		},
	},
}

const RETENTION_SCRIPT = {
	childSteps: [{ type: "text", text: CHILD_TEXT }],
	parentSteps: [
		{
			type: "tool_call",
			name: "task",
			arguments: { category: "mockcat", prompt: "do retained deep work", run_in_background: false, name: "retainedchild", retain_transcript: true },
		},
		{
			type: "tool_call",
			name: "task",
			arguments: { category: "mockcat", prompt: "audit protected clinical content without retaining it", run_in_background: false, name: "protectedchild", retain_transcript: "metadata" },
		},
		{ type: "text", text: FINAL_TEXT },
	],
}

const IDLE_SCRIPT = {
	childSteps: [{ type: "text", text: "unused" }],
	parentSteps: [{ type: "text", text: "second session says hello, nothing to do" }],
}

function findOnPath(bin) {
	if (bin.includes("/")) return existsSync(bin) ? bin : null
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		const candidate = resolve(dir || ".", bin)
		if (existsSync(candidate)) return candidate
	}
	return null
}

function await0(ms) {
	const shared = new Int32Array(new SharedArrayBuffer(4))
	Atomics.wait(shared, 0, 0, ms)
}

function driveSenpi(senpiBin, sandbox, sessionDir, prompt) {
	const run = spawnSync(
		senpiBin,
		["-e", join(scriptDir, "task-e2e-mock-provider.ts"), "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, prompt],
		{
			cwd: sandbox.cwd,
			// Isolation: scrub every agent-dir override from the caller env before pinning the
			// sandbox one, so a stale OMO_/PI_ variable can never route runtime resolution (session
			// storage, transcript archive) into a real agent dir.
			env: {
				...process.env,
				OMO_CODING_AGENT_DIR: sandbox.agentDir,
				SENPI_CODING_AGENT_DIR: sandbox.agentDir,
				PI_CODING_AGENT_DIR: sandbox.agentDir,
				XDG_CONFIG_HOME: sandbox.xdgConfigHome,
				SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
				OMO_SENPI_QA: "1",
			},
			encoding: "utf8",
			timeout: 120_000,
			maxBuffer: 64 * 1024 * 1024,
		},
	)
	return { exit: run.status, signal: run.signal ?? null, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

function readStoreTaskIds(stateDir) {
	const tasksDir = join(stateDir, "tasks")
	if (!existsSync(tasksDir)) return []
	return readdirSync(tasksDir).filter((entry) => entry.endsWith(".json")).map((entry) => entry.replace(/\.json$/, ""))
}

function findDatabaseFiles(root) {
	const found = []
	const walk = (dir) => {
		let entries
		try {
			entries = readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			const path = join(dir, entry.name)
			if (entry.isDirectory()) walk(path)
			else if (/\.(db|sqlite|sqlite3|duckdb)$/i.test(entry.name)) found.push(path)
		}
	}
	walk(root)
	return found
}

function parseJsonl(text) {
	return text.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line))
}

function textsOf(lines, role) {
	return lines
		.filter((entry) => entry.type === "message" && entry.message?.role === role)
		.map((entry) => entry.message.content.filter((part) => part.type === "text").map((part) => part.text).join(""))
}

function archiveMetaOf(lines) {
	const entry = lines.find((line) => line.type === "custom" && line.customType === "omo-senpi.task-archive")
	return entry?.data
}

// Scoped real-agent-dir proof: the whole-home digest can flip when the machine runs other live
// senpi sessions, so the hard assertions cover everything this feature could possibly write (the
// archive sentinel dir and archive-shaped artifacts); every other observed change is disclosed.
function realAgentArchiveSafety(before, after) {
	const changed = changedSnapshotPaths(before.snapshot, after.snapshot)
	const archiveSentinel = changed.filter((path) => path.includes(ARCHIVE_DIR_NAME))
	const archiveShaped = changed.filter((path) => /\.jsonl\.gz$/.test(path))
	return {
		certified: archiveSentinel.length === 0 && archiveShaped.length === 0 && before.complete && after.complete,
		archiveSentinelPaths: archiveSentinel,
		archiveShapedPaths: archiveShaped,
		changedPathCount: changed.length,
		changedPathsSample: changed.slice(0, 20),
	}
}

async function runCanary(evidenceDir) {
	const senpiBin = process.env.SENPI_BIN ?? findOnPath("senpi")
	if (senpiBin === null) {
		process.stdout.write(`${JSON.stringify({ result: "SKIP", reason: "senpi binary not found on PATH or SENPI_BIN" }, null, 2)}\n`)
		process.exitCode = 1
		return
	}

	const sandbox = createSandbox()
	mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
	writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
	writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(RETENTION_SCRIPT, null, 2)}\n`)
	seedSandbox(sandbox)
	const sessionDirOne = join(sandbox.root, "sessions-one")
	const sessionDirTwo = join(sandbox.root, "sessions-two")
	mkdirSync(sessionDirOne, { recursive: true })
	mkdirSync(sessionDirTwo, { recursive: true })
	const stateDir = join(sandbox.cwd, ".omo", "senpi-task")
	const archiveDir = join(sandbox.agentDir, "sessions", ARCHIVE_DIR_NAME)
	const realAgentDir = join(homedir(), ".omo", "agent")
	const realBefore = snapshotDirectory(realAgentDir)

	// Run 1: spawn a fully-retained task and a metadata-only task; both complete inline.
	const runOne = driveSenpi(senpiBin, sandbox, sessionDirOne, "spawn a retained deep child and a protected child")
	const taskIds = readStoreTaskIds(stateDir)
	if (taskIds.length !== 2) throw new Error(`expected exactly two task records after run 1, saw ${JSON.stringify(taskIds)}; stderr: ${runOne.stderr.slice(-400)}`)
	const records = Object.fromEntries(taskIds.map((taskId) => [taskId, JSON.parse(readFileSync(join(stateDir, "tasks", `${taskId}.json`), "utf8"))]))
	const fullTaskId = taskIds.find((taskId) => records[taskId]?.name === "retainedchild")
	const protectedTaskId = taskIds.find((taskId) => records[taskId]?.name === "protectedchild")
	if (fullTaskId === undefined || protectedTaskId === undefined) throw new Error(`task names not recovered: ${JSON.stringify(Object.values(records).map((record) => record.name))}`)
	const fullRecord = records[fullTaskId]
	const protectedRecord = records[protectedTaskId]

	// Deterministic wait: the records must age past ttl_ms before the next session start can sweep them.
	const newestTerminal = Math.max(...Object.values(records).map((record) => Date.parse(record.terminal_at ?? record.updated_at)))
	await0(1100)
	if (Date.now() - newestTerminal < 1000) throw new Error("records did not age past ttl_ms")

	// Run 2: a fresh session start runs the recovery chain (incl. TTL cleanup).
	writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(IDLE_SCRIPT, null, 2)}\n`)
	const runTwo = driveSenpi(senpiBin, sandbox, sessionDirTwo, "start a fresh session with nothing to do")

	const realAfter = snapshotDirectory(realAgentDir)
	const realSafety = realAgentArchiveSafety(realBefore, realAfter)

	const recordsGone = taskIds.every((taskId) => !existsSync(join(stateDir, "tasks", `${taskId}.json`)))
	const childrenGone = taskIds.every((taskId) => !existsSync(join(stateDir, "children", taskId)))
	const files = existsSync(archiveDir) ? readdirSync(archiveDir).toSorted() : []
	const manifests = files.filter((name) => name.endsWith(".jsonl"))
	const sidecars = files.filter((name) => name.endsWith(".jsonl.gz"))
	const fullManifestName = manifests.find((name) => name.endsWith(`_${fullTaskId}.jsonl`))
	const protectedManifestName = manifests.find((name) => name.endsWith(`_${protectedTaskId}.jsonl`))
	const fullSidecarName = `${fullManifestName}.gz`
	const fullManifest = fullManifestName !== undefined ? parseJsonl(readFileSync(join(archiveDir, fullManifestName), "utf8")) : []
	const protectedManifest = protectedManifestName !== undefined ? parseJsonl(readFileSync(join(archiveDir, protectedManifestName), "utf8")) : []
	const fullMeta = archiveMetaOf(fullManifest)
	const protectedMeta = archiveMetaOf(protectedManifest)
	const pointer = fullManifest.find((entry) => entry.type === "custom" && entry.customType === "omo-senpi.task-archive.content")?.data
	const sidecarBytes = fullSidecarName !== undefined && sidecars.includes(fullSidecarName) ? readFileSync(join(archiveDir, fullSidecarName)) : undefined
	const content = sidecarBytes !== undefined ? parseJsonl(gunzipSync(sidecarBytes).toString("utf8")) : []
	const contentTexts = textsOf(content, "assistant")
	const contentUserTexts = textsOf(content, "user")
	const mode = (name) => (name !== undefined && existsSync(join(archiveDir, name)) ? (statSync(join(archiveDir, name)).mode & 0o777).toString(8) : null)

	// The EXISTING Senpi session finder discovers the archive manifests.
	const finder = spawnSync(process.execPath.includes("bun") ? process.execPath : "bun", [finderFixture, join(sandbox.agentDir, "sessions")], { encoding: "utf8", timeout: 60_000 })
	if (finder.status !== 0) throw new Error(`finder fixture failed: ${finder.stderr}`)
	const foundPaths = new Set(JSON.parse(finder.stdout).sessions.map((session) => session.session_path))
	const databaseFiles = findDatabaseFiles(sandbox.root)

	const checks = {
		runOneCompleted: runOne.exit === 0,
		runTwoCompleted: runTwo.exit === 0,
		tasksCompleted: fullRecord?.status === "completed" && protectedRecord?.status === "completed",
		recordsExpunged: recordsGone,
		childrenDirsExpunged: childrenGone,
		exactlyTwoManifests: manifests.length === 2,
		exactlyOneCompressedSidecar: sidecars.length === 1 && sidecars[0] === fullSidecarName,
		manifestIsSessionJsonl: fullManifest[0]?.type === "session" && fullManifest[0]?.cwd === sandbox.cwd,
		manifestPermissionsRestrictive: mode(fullManifestName) === "600",
		sidecarPermissionsRestrictive: mode(fullSidecarName) === "600",
		archiveNamesCarryTaskIds: fullManifestName?.endsWith(`_${fullTaskId}.jsonl`) === true && protectedManifestName?.endsWith(`_${protectedTaskId}.jsonl`) === true,
		sidecarGunzipsToSessionJsonl: content[0]?.type === "session" && content[0]?.cwd === sandbox.cwd,
		sidecarSmallerThanContent: sidecarBytes !== undefined && sidecarBytes.byteLength < gunzipSync(sidecarBytes).byteLength,
		archiveHoldsPrompt: contentUserTexts.includes("do retained deep work"),
		archiveHoldsChildVisibleText: contentTexts.some((text) => text.startsWith("retention child unit complete after touching")),
		archiveHoldsFinalResponse: fullMeta?.final_response === String(fullRecord?.final_response ?? "").replaceAll(FAKE_SECRET, "[REDACTED]"),
		archiveHoldsParentLinkage: fullMeta?.parent_session_id === fullRecord?.parent_session_id && fullMeta?.root_session_id === fullRecord?.root_session_id,
		archiveHoldsModelMetadata: fullMeta?.resolved_model?.model_id === fullRecord?.resolved_model?.model_id && fullMeta?.requested_model?.model_id === fullRecord?.requested_model?.model_id,
		archiveHoldsOutcomeAndTimes: fullMeta?.status === "completed" && fullMeta?.terminal_at === fullRecord?.terminal_at,
		manifestPointerMatchesSidecar: pointer?.file === fullSidecarName && pointer?.sha256 !== undefined && pointer?.compressed_bytes === sidecarBytes?.byteLength,
		credentialsRedactedEverywhere:
			sidecarBytes !== undefined &&
			!gunzipSync(sidecarBytes).toString("utf8").includes(FAKE_SECRET) &&
			!readFileSync(join(archiveDir, fullManifestName), "utf8").includes(FAKE_SECRET) &&
			gunzipSync(sidecarBytes).toString("utf8").includes("[REDACTED]"),
		metadataOnlyTaskHasNoContent: protectedManifest.length > 0 && !sidecars.some((name) => name.endsWith(`_${protectedTaskId}.jsonl.gz`)),
		metadataOnlyManifestHoldsNoTranscript: !protectedManifest.some((entry) => entry.type === "message") && !readFileSync(join(archiveDir, protectedManifestName), "utf8").includes("clinical content") && !readFileSync(join(archiveDir, protectedManifestName), "utf8").includes(FAKE_SECRET),
		metadataOnlyManifestCarriesAuditFacts: protectedMeta?.content_retention === "metadata-only" && protectedMeta?.task_id === protectedTaskId && protectedMeta?.status === "completed" && !("final_response" in (protectedMeta ?? {})) && !("task_summary" in (protectedMeta ?? {})),
		finderDiscoveredBothManifests: foundPaths.has(join(archiveDir, fullManifestName)) && foundPaths.has(join(archiveDir, protectedManifestName)),
		finderReadsManifestName: JSON.parse(finder.stdout).sessions.some((session) => session.name === "omo task retainedchild (completed)" && session.cwd === sandbox.cwd),
		noDatabaseFiles: databaseFiles.length === 0,
		realAgentFreeOfArchiveArtifacts: realSafety.certified,
	}
	const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name)
	const summary = {
		result: failed.length === 0 ? "PASS" : "FAIL",
		failedChecks: failed,
		taskIds: { full: fullTaskId, protected: protectedTaskId },
		archiveFiles: files,
		archiveModes: { manifest: mode(fullManifestName), sidecar: mode(fullSidecarName) },
		finderEntries: JSON.parse(finder.stdout).sessions
			.filter((session) => session.session_path?.includes(ARCHIVE_DIR_NAME))
			.map((session) => ({ name: session.name, cwd: session.cwd, status: session.status ?? null })),
		metadataRetention: { full: fullMeta?.content_retention, protected: protectedMeta?.content_retention, protectedByPath: protectedMeta?.protected_by_path ?? false },
		redactionCanary: { secretShape: "sk-ant-api03-qa...", replacedWith: "[REDACTED]", appearsInArchive: checks.credentialsRedactedEverywhere === true ? "never" : "LEAKED" },
		databaseFiles,
		sandbox: { root: sandbox.root, agentDir: sandbox.agentDir, stateDir },
		realAgentDir,
		realAgentIsolation: {
			certified: realSafety.certified,
			note: "scoped proof: no archive-sentinel path and no .jsonl.gz artifact may appear in the real agent dir; unrelated changed paths are disclosed because this machine runs other live senpi sessions",
			archiveSentinelPaths: realSafety.archiveSentinelPaths,
			archiveShapedPaths: realSafety.archiveShapedPaths,
			changedPathCount: realSafety.changedPathCount,
			changedPathsSample: realSafety.changedPathsSample,
		},
		isolation: "SENPI_CODING_AGENT_DIR pointed at the sandbox; the drivers build their own agent dir and ignore a caller-provided one",
		redactions: "all transcript content is synthetic (mock provider); the one embedded credential is an intentionally fake canary proving the redaction pipeline",
		runOne: { exit: runOne.exit, signal: runOne.signal },
		runTwo: { exit: runTwo.exit, signal: runTwo.signal },
	}
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
	if (evidenceDir !== undefined) {
		mkdirSync(evidenceDir, { recursive: true })
		writeFileSync(join(evidenceDir, "final.json"), `${JSON.stringify(summary, null, 2)}\n`)
		if (fullManifestName !== undefined) writeFileSync(join(evidenceDir, "manifest-full-copy.jsonl"), readFileSync(join(archiveDir, fullManifestName), "utf8"))
		if (protectedManifestName !== undefined) writeFileSync(join(evidenceDir, "manifest-protected-copy.jsonl"), readFileSync(join(archiveDir, protectedManifestName), "utf8"))
		if (sidecarBytes !== undefined) writeFileSync(join(evidenceDir, "content-full-copy.jsonl.gz"), sidecarBytes)
	}
	if (failed.length > 0) process.exitCode = 1
}

function runSelfTest() {
	// Pure helpers: the finder fixture on an empty dir, and the real-agent safety classifier on
	// synthetic snapshots.
	const dir = join(createSandbox().root, "empty-sessions")
	mkdirSync(dir, { recursive: true })
	const finder = spawnSync(process.execPath.includes("bun") ? process.execPath : "bun", [finderFixture, dir], { encoding: "utf8", timeout: 60_000 })
	const emptyOk = finder.status === 0 && JSON.parse(finder.stdout).sessions.length === 0
	const before = { snapshot: new Map([["sessions/a.jsonl", "1"]]), complete: true }
	const after = { snapshot: new Map([["sessions/a.jsonl", "1"], [`sessions/${ARCHIVE_DIR_NAME}/x.jsonl`, "2"]]) }
	const safety = realAgentArchiveSafety(before, after)
	const classifierOk = safety.certified === false && safety.archiveSentinelPaths.length === 1
	process.stdout.write(`${JSON.stringify({
		result: emptyOk && classifierOk ? "PASS" : "FAIL",
		checks: {
			finderEmptyDir: emptyOk,
			realAgentSafetyClassifierFlagsSentinel: classifierOk,
		},
	}, null, 2)}\n`)
	if (!emptyOk || !classifierOk) process.exitCode = 1
}

const args = process.argv.slice(2)
const evidenceIndex = args.indexOf("--evidence-dir")
const evidenceDir = evidenceIndex >= 0 ? resolve(args[evidenceIndex + 1]) : undefined
if (args.includes("--self-test")) runSelfTest()
else await runCanary(evidenceDir)
