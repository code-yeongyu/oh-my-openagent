#!/usr/bin/env node
// Live proof that an isolated task child runs in a copy-on-write clone of the checkout and that the
// clone is merged back (or retained with a recovery command) when it settles. Drives the REAL senpi
// binary against the built plugin bundles with the shared lane mock provider; no provider credential
// is needed and the real ~/.senpi/agent is never read or written.
//
// Usage: node isolation-e2e.mjs [--evidence-dir <d>] [--plugin-root <p>] [--senpi-cli <p>]
//                               [--only applied,conflict,control] [--keep-sandbox] [--self-test]
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox } from "./drive.mjs"
import {
	APPLIED_SCRIPT,
	CONFLICT_SCRIPT,
	OMO_CONFIG,
	assertApplied,
	assertIsolatedRejected,
	assertNotApplied,
} from "./isolation-e2e-scenarios.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const defaultPluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")

function arg(name, fallback) {
	const index = process.argv.indexOf(name)
	return index === -1 ? fallback : process.argv[index + 1]
}

function findOnPath(bin) {
	if (bin.includes("/")) return existsSync(bin) ? bin : null
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		const candidate = resolve(dir || ".", bin)
		if (existsSync(candidate)) return candidate
	}
	return null
}

function git(cwd, ...args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" })
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr ?? ""}`)
	return result.stdout
}

function seed(sandbox, pluginRoot, script) {
	for (const dir of [sandbox.cwd, sandbox.agentDir, sandbox.homeDir, sandbox.xdgConfigHome, sandbox.xdgDataHome, sandbox.xdgCacheHome]) {
		mkdirSync(dir, { recursive: true })
	}
	writeFileSync(join(sandbox.agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "ask", packages: [pluginRoot] }, null, 2)}\n`)
	writeFileSync(join(sandbox.agentDir, "trust.json"), `${JSON.stringify({ [sandbox.canonicalCwd]: true }, null, 2)}\n`)
	// A real git checkout is the precondition isolation refuses to run without.
	git(sandbox.cwd, "init", "-q", "-b", "main")
	git(sandbox.cwd, "config", "user.name", "omo qa")
	git(sandbox.cwd, "config", "user.email", "qa@example.invalid")
	writeFileSync(join(sandbox.cwd, "README.md"), "isolation e2e fixture\n")
	git(sandbox.cwd, "add", "README.md")
	git(sandbox.cwd, "commit", "-q", "-m", "seed")
	mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
	writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
	writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
}

function runSenpi(senpiBin, sandbox, prompt) {
	return spawnSync(senpiBin, ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", prompt], {
		cwd: sandbox.cwd,
		env: {
			...process.env,
			OMO_CODING_AGENT_DIR: sandbox.agentDir,
			SENPI_CODING_AGENT_DIR: sandbox.agentDir,
			PI_CODING_AGENT_DIR: sandbox.agentDir,
			HOME: sandbox.homeDir,
			USERPROFILE: sandbox.homeDir,
			XDG_CONFIG_HOME: sandbox.xdgConfigHome,
			XDG_DATA_HOME: sandbox.xdgDataHome,
			XDG_CACHE_HOME: sandbox.xdgCacheHome,
			PI_OFFLINE: "1",
			OMO_SENPI_QA: "1",
			OMO_QA_PARENT_REPO: sandbox.cwd,
		},
		encoding: "utf8",
		timeout: 180_000,
	})
}

function scenario({ name, script, assert, senpiBin, pluginRoot, keepSandbox }) {
	const sandbox = createSandbox()
	const started = Date.now()
	try {
		seed(sandbox, pluginRoot, script)
		const run = runSenpi(senpiBin, sandbox, "spawn the isolated child now")
		const checks = assert(sandbox.cwd, run)
		return {
			name,
			plugin_root: pluginRoot,
			command: `senpi -e <mock-provider> -p --provider omo-mock --model mock-1 "spawn the isolated child now"`,
			exit_code: run.status,
			duration_ms: Date.now() - started,
			checks,
			pass: checks.every((check) => check.pass),
			...(keepSandbox ? { sandbox: sandbox.root } : {}),
			...(run.status !== 0 ? { stderr_tail: String(run.stderr ?? "").slice(-2000) } : {}),
		}
	} finally {
		if (!keepSandbox) rmSync(sandbox.root, { recursive: true, force: true })
	}
}

function selfTest() {
	const applied = assertApplied("/nonexistent-checkout")
	if (applied.some((check) => check.pass && check.name === "merge_result.kind")) {
		throw new Error("assertApplied must fail without a record")
	}
	const control = assertIsolatedRejected("/nonexistent-checkout")
	if (control[1].pass) throw new Error("the control must report that no task record exists")
	if (!control[0].pass) throw new Error("an absent checkout records no isolation")
	console.log("SELF-TEST OK")
}

function main() {
	if (process.argv.includes("--self-test")) return selfTest()
	const senpiBin = findOnPath(arg("--senpi-cli", "senpi"))
	if (senpiBin === null) throw new Error("senpi binary not found; pass --senpi-cli <path>")
	const pluginRoot = resolve(arg("--plugin-root", defaultPluginRoot))
	const controlPluginRoot = arg("--control-plugin-root")
	const keepSandbox = process.argv.includes("--keep-sandbox")
	const only = String(arg("--only", "applied,conflict,control")).split(",")

	const results = []
	if (only.includes("applied")) {
		results.push(scenario({ name: "applied", script: APPLIED_SCRIPT, assert: assertApplied, senpiBin, pluginRoot, keepSandbox }))
	}
	if (only.includes("conflict")) {
		results.push(scenario({ name: "conflict-not-applied", script: CONFLICT_SCRIPT, assert: assertNotApplied, senpiBin, pluginRoot, keepSandbox }))
	}
	if (only.includes("control") && controlPluginRoot !== undefined) {
		results.push(scenario({
			name: "control-pre-change-plugin-rejects-isolated",
			script: APPLIED_SCRIPT,
			assert: (cwd) => assertIsolatedRejected(cwd),
			senpiBin,
			pluginRoot: resolve(controlPluginRoot),
			keepSandbox,
		}))
	}

	const summary = { at: new Date().toISOString(), senpi: senpiBin, plugin_root: pluginRoot, scenarios: results, pass: results.every((r) => r.pass) }
	const evidenceDir = arg("--evidence-dir")
	if (evidenceDir !== undefined) {
		mkdirSync(evidenceDir, { recursive: true })
		writeFileSync(join(evidenceDir, "e2e.json"), `${JSON.stringify(summary, null, 2)}\n`)
	}
	console.log(JSON.stringify(summary, null, 2))
	process.exit(summary.pass ? 0 : 1)
}

main()
